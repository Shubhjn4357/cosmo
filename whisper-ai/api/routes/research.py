"""
Web research and autonomous knowledge ingestion endpoints.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

from .auth import verify_admin_token
from knowledge.google_search import GoogleSearchIntegration, SearchConfig
from knowledge.scraper import ContentProcessor, ScraperConfig, WebScraper
from services.cloudflare_crawl import CRAWLER
from services.research_documents import (
    RESEARCH_DOCUMENTS_PATH,
    append_research_documents,
    filtered_documents,
    delete_research_documents,
    export_research_documents,
    list_research_documents,
    summarize_research_documents,
)
from services.research_history import delete_research_runs, list_research_runs, record_research_run, summarize_research_runs
from services.research_index_sync import rebuild_vector_index_with_research
from services.research_policy import SOURCE_POLICY
from utils.app_paths import DATA_ROOT


router = APIRouter(prefix="/research", tags=["research"])
AUTO_RESEARCH_TASK = None

SEARCH = GoogleSearchIntegration(SearchConfig())
SCRAPER = WebScraper(
    ScraperConfig(
        seed_urls=["https://en.wikipedia.org/wiki/Main_Page"],
        max_pages_per_session=int(os.getenv("AUTO_CRAWL_MAX_PAGES", "5")),
        sleep_between_requests=float(os.getenv("AUTO_CRAWL_DELAY_SECONDS", "1.0")),
    ),
    storage_path=str(DATA_ROOT / "raw"),
)
PROCESSOR = ContentProcessor(output_dir=str(DATA_ROOT / "processed"))

RESEARCH_STATS = summarize_research_runs()
RESEARCH_STATS.update(summarize_research_documents())


class DiscoverRequest(BaseModel):
    topic: str
    max_pages: int = 5
    search_only: bool = False
    provider: str = "auto"
    start_url: Optional[str] = None
    max_sites: int = 1
    depth: int = 2
    render: bool = False
    source: str = "all"
    include_patterns: List[str] = Field(default_factory=list)
    exclude_patterns: List[str] = Field(default_factory=list)
    formats: List[str] = Field(default_factory=lambda: ["markdown"])
    include_external_links: bool = False
    include_subdomains: bool = False
    modified_since: Optional[int] = None
    max_age: Optional[int] = None
    refresh_existing: bool = False


class ResearchPolicyUpdateRequest(BaseModel):
    require_allowed_sources: Optional[bool] = None
    require_license_metadata: Optional[bool] = None
    allowed_domains: Optional[List[str]] = None
    allowed_prefixes: Optional[List[str]] = None
    blocked_domains: Optional[List[str]] = None
    source_overrides: Optional[dict[str, dict[str, Any]]] = None


class ResearchExportRequest(BaseModel):
    topic: Optional[str] = None
    domain: Optional[str] = None
    provider: Optional[str] = None
    search: Optional[str] = None
    include_text: bool = True
    dataset_name: Optional[str] = None


class ResearchDocumentDeleteRequest(BaseModel):
    topic: Optional[str] = None
    domain: Optional[str] = None
    provider: Optional[str] = None
    search: Optional[str] = None


class ResearchHistoryDeleteRequest(BaseModel):
    topic: Optional[str] = None
    provider: Optional[str] = None
    status: Optional[str] = None


class ResearchIndexRebuildRequest(BaseModel):
    topic: Optional[str] = None
    domain: Optional[str] = None
    provider: Optional[str] = None
    search: Optional[str] = None


def _index_documents(topic: str, documents: List[dict[str, Any]]) -> int:
    from api.route import get_app_state
    from api.routes.analytics import analytics

    state = get_app_state()
    if state.rag is None or state.vectordb is None:
        return 0

    indexed = 0
    for document in documents:
        text = document.get("text", "")
        if len(text) < 100:
            continue
        domain = document.get("domain") or "unknown"
        source = f"research:{topic}:{domain}"
        indexed += state.rag.index_document(text, source=source)

    state.vectordb.save()
    if indexed:
        analytics.record_knowledge_added(indexed)
    return indexed


def _refresh_research_stats():
    RESEARCH_STATS.update(summarize_research_runs())
    RESEARCH_STATS.update(summarize_research_documents())


def _store_research_history(entry: dict):
    record_research_run(entry)
    _refresh_research_stats()


def _rebuild_research_knowledge_index(
    *,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    provider: Optional[str] = None,
    search: Optional[str] = None,
) -> dict[str, Any]:
    from api.route import get_app_state

    state = get_app_state()
    all_documents = filtered_documents()
    matched_documents = filtered_documents(topic=topic, domain=domain, provider=provider, search=search)
    result = rebuild_vector_index_with_research(
        vectordb=state.vectordb,
        embedder=state.embedder,
        research_documents=all_documents,
    )
    result["matched_documents"] = len(matched_documents)
    result["total_research_documents"] = len(all_documents)
    result["rebuild_scope"] = "all_research_documents"
    return result


def _summarize_decisions(decisions: List[dict[str, Any]]) -> dict[str, Any]:
    accepted = [decision for decision in decisions if decision.get("allowed")]
    rejected = [decision for decision in decisions if not decision.get("allowed")]
    return {
        "candidate_urls": len(decisions),
        "accepted_urls": len(accepted),
        "rejected_urls": len(rejected),
        "accepted_domains": sorted({decision.get("domain") for decision in accepted if decision.get("domain")}),
        "rejected_samples": rejected[:10],
    }


def _policy_filter_urls(urls: List[str]) -> tuple[List[str], List[dict[str, Any]], dict[str, Any]]:
    accepted_urls, decisions = SOURCE_POLICY.filter_urls(urls)
    return accepted_urls, decisions, _summarize_decisions(decisions)


def _document_entry(
    *,
    topic: str,
    provider: str,
    url: str,
    text: str,
    title: str = "",
    source_url: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    decision = SOURCE_POLICY.evaluate_url(url)
    return {
        "topic": topic,
        "provider": provider,
        "source": f"research:{topic}:{decision.get('domain') or 'unknown'}",
        "source_url": source_url or url,
        "url": url,
        "domain": decision.get("domain"),
        "title": title,
        "text": text,
        "timestamp": time.time(),
        "policy": {
            "allowed": decision.get("allowed"),
            "reason": decision.get("reason"),
        },
        "provenance": decision.get("provenance", {}),
        "metadata": metadata or {},
    }


def _cloudflare_documents(topic: str, crawl_url: str, crawl_result: dict[str, Any]) -> tuple[List[dict[str, Any]], List[dict[str, Any]]]:
    documents: List[dict[str, Any]] = []
    rejected: List[dict[str, Any]] = []
    for record in crawl_result.get("records", []):
        if record.get("status") != "completed":
            continue
        record_url = record.get("url") or crawl_url
        text = record.get("markdown") or record.get("html")
        if not text and record.get("json") is not None:
            text = json.dumps(record["json"], ensure_ascii=True)
        if not text:
            continue
        decision = SOURCE_POLICY.evaluate_url(record_url)
        if not decision.get("allowed"):
            rejected.append(decision)
            continue
        documents.append(
            _document_entry(
                topic=topic,
                provider="cloudflare",
                url=record_url,
                source_url=crawl_url,
                title=((record.get("metadata") or {}).get("title") or ""),
                text=text,
                metadata={
                    "status": record.get("status"),
                    "record_metadata": record.get("metadata") or {},
                },
            )
        )
    return documents, rejected


def _legacy_documents(topic: str, results: List[Any]) -> List[dict[str, Any]]:
    documents: List[dict[str, Any]] = []
    for result in results:
        text = PROCESSOR._clean_text(f"{result.title}\n\n{result.text}") if result.text else ""
        if len(text) <= 100:
            continue
        documents.append(
            _document_entry(
                topic=topic,
                provider="legacy",
                url=result.url,
                title=result.title,
                text=text,
                metadata={
                    "timestamp": result.timestamp,
                    "content_hash": result.content_hash,
                },
            )
        )
    return documents


async def _discover_with_cloudflare(
    request: DiscoverRequest,
    urls: List[str],
    policy_summary: Optional[dict[str, Any]] = None,
) -> dict:
    reason = CRAWLER.unavailable_reason()
    if reason:
        status_code = 429 if "quota" in reason.lower() else 503
        raise HTTPException(status_code=status_code, detail=reason)
    policy_status = SOURCE_POLICY.status()
    if request.include_external_links and policy_status["require_allowed_sources"]:
        raise HTTPException(
            status_code=400,
            detail="include_external_links is disabled when research policy requires allowlisted sources",
        )

    crawl_urls = urls[: max(1, request.max_sites)]
    quota = CRAWLER.quota_status()
    if quota["jobs_remaining_today"] < len(crawl_urls):
        raise HTTPException(
            status_code=429,
            detail=(
                f"Cloudflare crawl has only {quota['jobs_remaining_today']} job(s) remaining today, "
                f"but {len(crawl_urls)} site(s) were requested"
            ),
        )
    per_site_limit = max(1, request.max_pages // max(1, len(crawl_urls)))
    jobs = []
    total_pages = 0
    total_texts = 0
    total_indexed = 0
    last_job_id = None
    policy_rejections: List[dict[str, Any]] = []

    for crawl_url in crawl_urls:
        crawl_result = await CRAWLER.crawl(
            url=crawl_url,
            limit=per_site_limit,
            depth=request.depth,
            render=request.render,
            formats=request.formats,
            source=request.source,
            include_patterns=request.include_patterns,
            exclude_patterns=request.exclude_patterns,
            include_external_links=request.include_external_links,
            include_subdomains=request.include_subdomains,
            modified_since=request.modified_since,
            max_age=request.max_age,
        )
        last_job_id = crawl_result.get("job_id") or last_job_id
        documents, rejected = _cloudflare_documents(request.topic, crawl_url, crawl_result)
        policy_rejections.extend(rejected)
        append_research_documents(documents)
        indexed = _index_documents(request.topic, documents)
        total_indexed += indexed
        total_pages += int(crawl_result.get("finished") or 0)
        total_texts += len(documents)
        jobs.append(
            {
                "url": crawl_url,
                "job_id": crawl_result.get("job_id"),
                "status": crawl_result.get("status"),
                "finished": crawl_result.get("finished"),
                "total": crawl_result.get("total"),
                "texts_processed": len(documents),
                "chunks_indexed": indexed,
                "policy_rejections": len(rejected),
            }
        )

    result = {
        "topic": request.topic,
        "provider": "cloudflare",
        "urls": crawl_urls,
        "pages_crawled": total_pages,
        "texts_processed": total_texts,
        "chunks_indexed": total_indexed,
        "jobs": jobs,
        "policy_rejections": policy_rejections[:10],
    }
    _store_research_history(
        {
            "topic": request.topic,
            "provider": "cloudflare",
            "requested_provider": request.provider,
            "urls": crawl_urls,
            "pages_crawled": total_pages,
            "texts_processed": total_texts,
            "chunks_indexed": total_indexed,
            "job_id": last_job_id,
            "status": "completed",
            "start_url": request.start_url,
            "depth": request.depth,
            "render": request.render,
            "max_pages": request.max_pages,
            "max_sites": request.max_sites,
            "source": request.source,
            "jobs": jobs,
            "policy_rejections": policy_rejections[:10],
            "policy": policy_summary,
        }
    )
    return result


async def _discover_with_legacy_scraper(
    request: DiscoverRequest,
    urls: List[str],
    fallback: Optional[dict] = None,
    policy_summary: Optional[dict[str, Any]] = None,
) -> dict:
    if os.getenv("WHISPER_TEST_MODE", "false").lower() == "true":
        documents = [
            _document_entry(
                topic=request.topic,
                provider="legacy",
                url=url,
                title="Synthetic legacy crawl",
                text=(
                    f"# Synthetic legacy crawl for {url}\n\n"
                    f"This is deterministic legacy crawler content for topic '{request.topic}' "
                    "used to verify fallback and indexing behavior during test runs."
                ),
            )
            for url in urls[: max(1, request.max_pages)]
        ]
        pages_crawled = len(documents)
    else:
        allowed_domains = sorted({decision.get("domain") for decision in SOURCE_POLICY.filter_urls(urls)[1] if decision.get("allowed") and decision.get("domain")})
        SCRAPER.prepare_session(
            urls,
            allowed_domains=allowed_domains,
            blocked_domains=SOURCE_POLICY.status()["blocked_domains"],
            reset_queue=True,
            force_urls=urls if request.refresh_existing else None,
            allow_duplicate_content=request.refresh_existing,
        )
        results = await SCRAPER.crawl_session(max_pages=request.max_pages)
        documents = _legacy_documents(request.topic, results)
        pages_crawled = len(results)
    append_research_documents(documents)
    indexed = _index_documents(request.topic, documents)
    result = {
        "topic": request.topic,
        "provider": "legacy",
        "urls": urls,
        "pages_crawled": pages_crawled,
        "texts_processed": len(documents),
        "chunks_indexed": indexed,
    }
    if fallback:
        result["fallback"] = fallback
    _store_research_history(
        {
            "topic": request.topic,
            "provider": "legacy",
            "requested_provider": request.provider,
            "urls": urls,
            "pages_crawled": pages_crawled,
            "texts_processed": len(documents),
            "chunks_indexed": indexed,
            "job_id": None,
            "status": "completed",
            "start_url": request.start_url,
            "depth": request.depth,
            "render": request.render,
            "max_pages": request.max_pages,
            "max_sites": request.max_sites,
            "source": request.source,
            "fallback": fallback,
            "policy": policy_summary,
        }
    )
    return result


async def _discover_and_ingest(request: DiscoverRequest) -> dict:
    candidate_urls = [request.start_url] if request.start_url else await SEARCH.search_query(request.topic)
    candidate_urls = [url for url in candidate_urls if url][: max(1, request.max_sites if request.provider == "cloudflare" else request.max_pages)]
    accepted_urls, decisions, policy_summary = _policy_filter_urls(candidate_urls)
    if not accepted_urls:
        _store_research_history(
            {
                "topic": request.topic,
                "provider": "none",
                "requested_provider": request.provider,
                "urls": [],
                "pages_crawled": 0,
                "texts_processed": 0,
                "chunks_indexed": 0,
                "job_id": None,
                "status": "completed",
                "start_url": request.start_url,
                "depth": request.depth,
                "render": request.render,
                "max_pages": request.max_pages,
                "max_sites": request.max_sites,
                "source": request.source,
                "policy": policy_summary,
            }
        )
        return {
            "topic": request.topic,
            "provider": "none",
            "urls": [],
            "pages_crawled": 0,
            "texts_processed": 0,
            "chunks_indexed": 0,
            "policy": policy_summary,
        }

    provider = request.provider.lower()
    if provider not in {"auto", "cloudflare", "legacy"}:
        raise HTTPException(status_code=400, detail="provider must be one of: auto, cloudflare, legacy")

    if provider == "cloudflare":
        result = await _discover_with_cloudflare(request, accepted_urls, policy_summary=policy_summary)
        result["policy"] = policy_summary
        return result

    if provider == "auto" and CRAWLER.is_available():
        result = await _discover_with_cloudflare(request, accepted_urls, policy_summary=policy_summary)
        result["policy"] = policy_summary
        return result

    fallback = None
    cloudflare_reason = CRAWLER.unavailable_reason()
    if provider == "auto" and cloudflare_reason and (CRAWLER.enabled and (CRAWLER.test_mode or CRAWLER.is_configured())):
        fallback = {
            "from": "cloudflare",
            "to": "legacy",
            "reason": cloudflare_reason,
        }
    result = await _discover_with_legacy_scraper(
        request,
        accepted_urls,
        fallback=fallback,
        policy_summary=policy_summary,
    )
    result["policy"] = policy_summary
    return result


@router.post("/discover")
async def discover_knowledge(request: DiscoverRequest, payload: dict = Depends(verify_admin_token)):
    try:
        if request.search_only:
            urls = [url for url in await SEARCH.search_query(request.topic) if url]
            accepted_urls, decisions, policy_summary = _policy_filter_urls(urls)
            return {
                "topic": request.topic,
                "urls": accepted_urls,
                "count": len(accepted_urls),
                "rejected_urls": policy_summary["rejected_samples"],
                "policy": policy_summary,
            }

        return await _discover_and_ingest(request)
    except HTTPException as exc:
        _store_research_history(
            {
                "topic": request.topic,
                "provider": request.provider,
                "requested_provider": request.provider,
                "urls": [request.start_url] if request.start_url else [],
                "pages_crawled": 0,
                "texts_processed": 0,
                "chunks_indexed": 0,
                "job_id": None,
                "status": "failed",
                "error": str(exc.detail),
                "start_url": request.start_url,
                "depth": request.depth,
                "render": request.render,
                "max_pages": request.max_pages,
                "max_sites": request.max_sites,
                "source": request.source,
            }
        )
        raise
    except Exception as exc:
        _store_research_history(
            {
                "topic": request.topic,
                "provider": request.provider,
                "requested_provider": request.provider,
                "urls": [request.start_url] if request.start_url else [],
                "pages_crawled": 0,
                "texts_processed": 0,
                "chunks_indexed": 0,
                "job_id": None,
                "status": "failed",
                "error": str(exc),
                "start_url": request.start_url,
                "depth": request.depth,
                "render": request.render,
                "max_pages": request.max_pages,
                "max_sites": request.max_sites,
                "source": request.source,
            }
        )
        logger.error(f"Research discovery failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/stats")
async def get_research_stats():
    return {
        **RESEARCH_STATS,
        "scraper": SCRAPER.get_stats(),
        "cloudflare": CRAWLER.status(),
        "policy": SOURCE_POLICY.status(),
        "data_file": str(RESEARCH_DOCUMENTS_PATH),
        "data_file_exists": RESEARCH_DOCUMENTS_PATH.exists(),
    }


@router.post("/cloudflare/validate")
async def validate_cloudflare_provider(payload: dict = Depends(verify_admin_token)):
    return await CRAWLER.validate_remote()


@router.get("/policy")
async def get_research_policy(payload: dict = Depends(verify_admin_token)):
    return SOURCE_POLICY.status()


@router.put("/policy")
async def update_research_policy(request: ResearchPolicyUpdateRequest, payload: dict = Depends(verify_admin_token)):
    return SOURCE_POLICY.update(request.model_dump(exclude_none=True))


@router.get("/history")
async def get_research_history(limit: int = 20, payload: dict = Depends(verify_admin_token)):
    return {
        "runs": list_research_runs(limit=max(1, min(limit, 100))),
    }


@router.get("/documents")
async def get_research_documents(
    limit: int = 20,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    provider: Optional[str] = None,
    search: Optional[str] = None,
    include_text: bool = False,
    payload: dict = Depends(verify_admin_token),
):
    return {
        "documents": list_research_documents(
            limit=max(1, min(limit, 100)),
            topic=topic,
            domain=domain,
            provider=provider,
            search=search,
            include_text=include_text,
        ),
        "summary": summarize_research_documents(),
    }


@router.post("/documents/export")
async def export_research_documents_endpoint(
    request: ResearchExportRequest,
    payload: dict = Depends(verify_admin_token),
):
    try:
        export = export_research_documents(
            topic=request.topic,
            domain=request.domain,
            provider=request.provider,
            search=request.search,
            include_text=request.include_text,
            dataset_name=request.dataset_name,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "status": "exported",
        "dataset": {
            "name": export["name"],
            "path": str(export["path"]),
            "rows": export["rows"],
            "size_bytes": export["size_bytes"],
        },
        "filters": export["filters"],
    }


@router.delete("/documents")
async def delete_research_documents_endpoint(
    request: ResearchDocumentDeleteRequest,
    payload: dict = Depends(verify_admin_token),
):
    matched_documents = filtered_documents(
        topic=request.topic,
        domain=request.domain,
        provider=request.provider,
        search=request.search,
    )
    result = delete_research_documents(
        topic=request.topic,
        domain=request.domain,
        provider=request.provider,
        search=request.search,
    )
    scraper_cleanup = SCRAPER.prune_state(
        urls=[document.get("url") for document in matched_documents if document.get("provider") == "legacy"],
        content_hashes=[
            (document.get("metadata") or {}).get("content_hash")
            for document in matched_documents
            if document.get("provider") == "legacy"
        ],
    )
    index_sync = _rebuild_research_knowledge_index(
        topic=request.topic,
        domain=request.domain,
        provider=request.provider,
        search=request.search,
    )
    _refresh_research_stats()
    return {
        "status": "deleted",
        **result,
        "scraper_cleanup": scraper_cleanup,
        "index_sync": index_sync,
        "summary": summarize_research_documents(),
    }


@router.delete("/history")
async def delete_research_history_endpoint(
    request: ResearchHistoryDeleteRequest,
    payload: dict = Depends(verify_admin_token),
):
    result = delete_research_runs(
        topic=request.topic,
        provider=request.provider,
        status=request.status,
    )
    _refresh_research_stats()
    return {
        "status": "deleted",
        **result,
        "summary": summarize_research_runs(),
    }


@router.post("/quota/reset")
async def reset_cloudflare_quota(payload: dict = Depends(verify_admin_token)):
    return {
        "status": "reset",
        "quota": CRAWLER.reset_quota(),
    }


@router.post("/scraper/reset")
async def reset_research_scraper(payload: dict = Depends(verify_admin_token)):
    return {
        "status": "reset",
        "scraper": SCRAPER.reset_state(),
    }


@router.post("/index/rebuild")
async def rebuild_research_index_endpoint(
    request: ResearchIndexRebuildRequest,
    payload: dict = Depends(verify_admin_token),
):
    return {
        "status": "rebuilt",
        "index_sync": _rebuild_research_knowledge_index(
            topic=request.topic,
            domain=request.domain,
            provider=request.provider,
            search=request.search,
        ),
        "summary": summarize_research_documents(),
    }


async def _background_research_loop():
    interval_minutes = int(os.getenv("AUTO_CRAWL_INTERVAL_MINUTES", "60"))
    topics = [
        "python programming best practices",
        "software engineering patterns",
        "artificial intelligence research",
        "developer tooling updates",
    ]
    index = 0

    while True:
        await asyncio.sleep(interval_minutes * 60)
        topic = topics[index % len(topics)]
        index += 1
        try:
            logger.info(f"Auto research cycle: {topic}")
            await _discover_and_ingest(
                DiscoverRequest(
                    topic=topic,
                    max_pages=int(os.getenv("AUTO_CRAWL_MAX_PAGES", "3")),
                )
            )
        except Exception as exc:
            _store_research_history(
                {
                    "topic": topic,
                    "provider": "auto",
                    "requested_provider": "auto",
                    "urls": [],
                    "pages_crawled": 0,
                    "texts_processed": 0,
                    "chunks_indexed": 0,
                    "job_id": None,
                    "status": "failed",
                    "error": str(exc),
                    "max_pages": int(os.getenv("AUTO_CRAWL_MAX_PAGES", "3")),
                }
            )
            logger.warning(f"Auto research cycle failed: {exc}")


async def start_background_research_task():
    global AUTO_RESEARCH_TASK

    if os.getenv("WHISPER_TEST_MODE", "false").lower() == "true":
        return
    if os.getenv("AUTO_CRAWL_ENABLED", "true").lower() != "true":
        logger.info("Auto research disabled by configuration")
        return
    if AUTO_RESEARCH_TASK and not AUTO_RESEARCH_TASK.done():
        logger.info("Auto research loop already running")
        return

    AUTO_RESEARCH_TASK = asyncio.create_task(_background_research_loop())
    logger.info("Auto research loop started")


async def stop_background_research_task():
    global AUTO_RESEARCH_TASK

    if AUTO_RESEARCH_TASK is None:
        return
    if AUTO_RESEARCH_TASK.done():
        AUTO_RESEARCH_TASK = None
        return

    AUTO_RESEARCH_TASK.cancel()
    try:
        await AUTO_RESEARCH_TASK
    except asyncio.CancelledError:
        logger.info("Auto research loop stopped")
    finally:
        AUTO_RESEARCH_TASK = None
