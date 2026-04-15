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
# Lazy imports for knowledge components moved into getters
from services.cloudflare_crawl import CRAWLER
from services.research_autonomy import (
    add_autonomy_source,
    autonomy_status,
    delete_autonomy_source,
    load_autonomy_config,
    record_autonomy_run,
    select_next_autonomy_source,
    update_autonomy_settings,
    update_autonomy_source,
)
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
AUTO_RESEARCH_RUNTIME = {
    "running": False,
    "current_source_id": None,
    "current_source_label": None,
    "last_cycle_started_at": None,
    "last_cycle_finished_at": None,
    "last_error": None,
    "completed_cycles": 0,
}

_SEARCH = None
_SCRAPER = None
_PROCESSOR = None

def get_search():
    global _SEARCH
    if _SEARCH is None:
        from knowledge.google_search import GoogleSearchIntegration, SearchConfig
        _SEARCH = GoogleSearchIntegration(SearchConfig())
    return _SEARCH

def get_scraper():
    global _SCRAPER
    if _SCRAPER is None:
        from knowledge.scraper import ScraperConfig, WebScraper
        _SCRAPER = WebScraper(
            ScraperConfig(
                seed_urls=["https://en.wikipedia.org/wiki/Main_Page"],
                max_pages_per_session=int(os.getenv("AUTO_CRAWL_MAX_PAGES", "5")),
                sleep_between_requests=float(os.getenv("AUTO_CRAWL_DELAY_SECONDS", "1.0")),
            ),
            storage_path=str(DATA_ROOT / "raw"),
        )
    return _SCRAPER

def get_processor():
    global _PROCESSOR
    if _PROCESSOR is None:
        from knowledge.scraper import ContentProcessor
        _PROCESSOR = ContentProcessor(output_dir=str(DATA_ROOT / "processed"))
    return _PROCESSOR

# Move stats calculation to a lazy getter as well
def get_research_stats_summary():
    stats = summarize_research_runs()
    stats.update(summarize_research_documents())
    return stats


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
    source_id: Optional[str] = None
    source_label: Optional[str] = None
    search: Optional[str] = None


class ResearchIndexRebuildRequest(BaseModel):
    topic: Optional[str] = None
    domain: Optional[str] = None
    provider: Optional[str] = None
    search: Optional[str] = None


class AutonomousResearchSettingsUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None
    auto_sync_hf: Optional[bool] = None
    learning_chunk_chars: Optional[int] = None
    learning_max_chunks_per_document: Optional[int] = None


class AutonomousResearchSourceRequest(BaseModel):
    label: Optional[str] = None
    topic: Optional[str] = None
    start_url: Optional[str] = None
    provider: str = "auto"
    max_pages: int = 3
    max_sites: int = 1
    depth: int = 1
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
    enabled: bool = True
    tags: List[str] = Field(default_factory=list)


class AutonomousResearchRunRequest(BaseModel):
    source_id: Optional[str] = None


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


async def _mirror_documents_into_learning(documents: List[dict[str, Any]]) -> dict[str, int]:
    if not documents:
        return {
            "added": 0,
            "skipped": 0,
            "training_pairs": 0,
            "external_sources": 0,
            "total_sequences": 0,
        }

    from api.routes.learn import ingest_research_documents, should_sync, sync_to_huggingface

    autonomy = autonomy_status()
    learning = ingest_research_documents(
        documents,
        chunk_chars=int(autonomy.get("learning_chunk_chars") or 1200),
        max_chunks_per_document=int(autonomy.get("learning_max_chunks_per_document") or 2),
    )
    if learning.get("added") and autonomy.get("auto_sync_hf") and should_sync():
        asyncio.create_task(asyncio.to_thread(sync_to_huggingface))
    return learning


def _refresh_research_stats():
    # Update stats locally if needed, or simply use the summary directly in the endpoint
    pass


def get_background_research_status() -> dict[str, Any]:
    return {
        **autonomy_status(),
        "task_running": bool(AUTO_RESEARCH_TASK and not AUTO_RESEARCH_TASK.done()),
        "runtime": dict(AUTO_RESEARCH_RUNTIME),
    }


def _source_to_discover_request(source: dict[str, Any]) -> DiscoverRequest:
    return DiscoverRequest(
        topic=source.get("topic") or source.get("label") or "research",
        max_pages=max(1, int(source.get("max_pages") or 3)),
        provider=source.get("provider") or "auto",
        start_url=source.get("start_url"),
        max_sites=max(1, int(source.get("max_sites") or 1)),
        depth=max(0, int(source.get("depth") or 1)),
        render=bool(source.get("render")),
        source=source.get("source") or "all",
        include_patterns=list(source.get("include_patterns") or []),
        exclude_patterns=list(source.get("exclude_patterns") or []),
        formats=list(source.get("formats") or ["markdown"]),
        include_external_links=bool(source.get("include_external_links")),
        include_subdomains=bool(source.get("include_subdomains")),
        modified_since=source.get("modified_since"),
        max_age=source.get("max_age"),
        refresh_existing=bool(source.get("refresh_existing")),
    )


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
    processor = get_processor()
    for result in results:
        text = processor._clean_text(f"{result.title}\n\n{result.text}") if result.text else ""
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
    autonomy_source: Optional[dict[str, Any]] = None,
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
    total_learning_added = 0
    total_learning_skipped = 0
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
        learning = await _mirror_documents_into_learning(documents)
        total_learning_added += int(learning.get("added") or 0)
        total_learning_skipped += int(learning.get("skipped") or 0)
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
                "learning_records_added": learning.get("added"),
                "learning_records_skipped": learning.get("skipped"),
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
        "learning_records_added": total_learning_added,
        "learning_records_skipped": total_learning_skipped,
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
            "learning_records_added": total_learning_added,
            "learning_records_skipped": total_learning_skipped,
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
            "autonomy_source_id": autonomy_source.get("id") if autonomy_source else None,
            "autonomy_source_label": autonomy_source.get("label") if autonomy_source else None,
        }
    )
    return result


async def _discover_with_legacy_scraper(
    request: DiscoverRequest,
    urls: List[str],
    fallback: Optional[dict] = None,
    policy_summary: Optional[dict[str, Any]] = None,
    autonomy_source: Optional[dict[str, Any]] = None,
) -> dict:
    if os.getenv("COSMO_TEST_MODE", "false").lower() == "true":
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
        scraper = get_scraper()
        scraper.prepare_session(
            urls,
            allowed_domains=allowed_domains,
            blocked_domains=SOURCE_POLICY.status()["blocked_domains"],
            reset_queue=True,
            force_urls=urls if request.refresh_existing else None,
            allow_duplicate_content=request.refresh_existing,
        )
        results = await scraper.crawl_session(max_pages=request.max_pages)
        documents = _legacy_documents(request.topic, results)
        pages_crawled = len(results)
    append_research_documents(documents)
    indexed = _index_documents(request.topic, documents)
    learning = await _mirror_documents_into_learning(documents)
    result = {
        "topic": request.topic,
        "provider": "legacy",
        "urls": urls,
        "pages_crawled": pages_crawled,
        "texts_processed": len(documents),
        "chunks_indexed": indexed,
        "learning_records_added": learning.get("added"),
        "learning_records_skipped": learning.get("skipped"),
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
            "learning_records_added": learning.get("added"),
            "learning_records_skipped": learning.get("skipped"),
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
            "autonomy_source_id": autonomy_source.get("id") if autonomy_source else None,
            "autonomy_source_label": autonomy_source.get("label") if autonomy_source else None,
        }
    )
    return result


async def _discover_and_ingest(request: DiscoverRequest, *, autonomy_source: Optional[dict[str, Any]] = None) -> dict:
    search = get_search()
    candidate_urls = [request.start_url] if request.start_url else await search.search_query(request.topic)
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
                "autonomy_source_id": autonomy_source.get("id") if autonomy_source else None,
                "autonomy_source_label": autonomy_source.get("label") if autonomy_source else None,
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
        result = await _discover_with_cloudflare(
            request,
            accepted_urls,
            policy_summary=policy_summary,
            autonomy_source=autonomy_source,
        )
        result["policy"] = policy_summary
        return result

    if provider == "auto" and CRAWLER.is_available():
        result = await _discover_with_cloudflare(
            request,
            accepted_urls,
            policy_summary=policy_summary,
            autonomy_source=autonomy_source,
        )
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
        autonomy_source=autonomy_source,
    )
    result["policy"] = policy_summary
    return result


@router.post("/discover")
async def discover_knowledge(request: DiscoverRequest, payload: dict = Depends(verify_admin_token)):
    try:
        if request.search_only:
            search = get_search()
            urls = [url for url in await search.search_query(request.topic) if url]
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
    stats = get_research_stats_summary()
    return {
        **stats,
        "scraper": get_scraper().get_stats(),
        "cloudflare": CRAWLER.status(),
        "policy": SOURCE_POLICY.status(),
        "autonomy": get_background_research_status(),
        "data_file": str(RESEARCH_DOCUMENTS_PATH),
        "data_file_exists": RESEARCH_DOCUMENTS_PATH.exists(),
    }


@router.get("/autonomy")
async def get_research_autonomy(payload: dict = Depends(verify_admin_token)):
    return get_background_research_status()


@router.put("/autonomy")
async def update_research_autonomy(
    request: AutonomousResearchSettingsUpdateRequest,
    payload: dict = Depends(verify_admin_token),
):
    updated = update_autonomy_settings(request.model_dump(exclude_none=True))
    if updated.get("enabled"):
        await start_background_research_task()
    else:
        await stop_background_research_task()
    return {
        "status": "updated",
        "autonomy": get_background_research_status(),
    }


@router.get("/autonomy/sources")
async def get_research_autonomy_sources(payload: dict = Depends(verify_admin_token)):
    return {
        "sources": autonomy_status().get("sources", []),
    }


@router.post("/autonomy/sources")
async def create_research_autonomy_source(
    request: AutonomousResearchSourceRequest,
    payload: dict = Depends(verify_admin_token),
):
    if not (request.topic or request.start_url):
        raise HTTPException(status_code=400, detail="topic or start_url is required")
    source = add_autonomy_source(request.model_dump(exclude_none=True))
    return {
        "status": "created",
        "source": source,
        "autonomy": get_background_research_status(),
    }


@router.put("/autonomy/sources/{source_id}")
async def patch_research_autonomy_source(
    source_id: str,
    request: AutonomousResearchSourceRequest,
    payload: dict = Depends(verify_admin_token),
):
    try:
        source = update_autonomy_source(source_id, request.model_dump(exclude_unset=True, exclude_none=True))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown autonomy source '{source_id}'") from exc
    return {
        "status": "updated",
        "source": source,
        "autonomy": get_background_research_status(),
    }


@router.delete("/autonomy/sources/{source_id}")
async def remove_research_autonomy_source(source_id: str, payload: dict = Depends(verify_admin_token)):
    result = delete_autonomy_source(source_id)
    if not result.get("deleted"):
        raise HTTPException(status_code=404, detail=f"Unknown autonomy source '{source_id}'")
    return {
        "status": "deleted",
        **result,
        "autonomy": get_background_research_status(),
    }


async def _run_autonomous_research_cycle(source_id: Optional[str] = None) -> dict[str, Any]:
    config = load_autonomy_config()
    if not config.get("enabled", True):
        return {
            "status": "skipped",
            "reason": "autonomy_disabled",
        }

    source: Optional[dict[str, Any]] = None
    if source_id:
        source = next((item for item in config.get("sources", []) if item.get("id") == source_id), None)
    else:
        source = select_next_autonomy_source()

    if source is None:
        return {
            "status": "skipped",
            "reason": "no_enabled_sources",
        }
    if not source.get("enabled", True):
        return {
            "status": "skipped",
            "reason": "source_disabled",
            "source": source,
        }

    AUTO_RESEARCH_RUNTIME["running"] = True
    AUTO_RESEARCH_RUNTIME["current_source_id"] = source.get("id")
    AUTO_RESEARCH_RUNTIME["current_source_label"] = source.get("label") or source.get("topic")
    AUTO_RESEARCH_RUNTIME["last_cycle_started_at"] = time.time()
    AUTO_RESEARCH_RUNTIME["last_error"] = None

    request = _source_to_discover_request(source)
    try:
        logger.info(f"Auto research cycle: {source.get('label') or source.get('topic')}")
        result = await _discover_and_ingest(request, autonomy_source=source)
        AUTO_RESEARCH_RUNTIME["completed_cycles"] = int(AUTO_RESEARCH_RUNTIME.get("completed_cycles") or 0) + 1
        record_autonomy_run(
            source["id"],
            status="completed",
            result={
                "pages_crawled": result.get("pages_crawled"),
                "texts_processed": result.get("texts_processed"),
                "chunks_indexed": result.get("chunks_indexed"),
                "learning_records_added": result.get("learning_records_added"),
            },
        )
        return {
            "status": "completed",
            "source": source,
            "result": result,
        }
    except Exception as exc:
        AUTO_RESEARCH_RUNTIME["last_error"] = str(exc)
        record_autonomy_run(source["id"], status="failed", error=str(exc))
        _store_research_history(
            {
                "topic": request.topic,
                "provider": request.provider,
                "requested_provider": request.provider,
                "urls": [request.start_url] if request.start_url else [],
                "pages_crawled": 0,
                "texts_processed": 0,
                "chunks_indexed": 0,
                "learning_records_added": 0,
                "learning_records_skipped": 0,
                "job_id": None,
                "status": "failed",
                "error": str(exc),
                "start_url": request.start_url,
                "depth": request.depth,
                "render": request.render,
                "max_pages": request.max_pages,
                "max_sites": request.max_sites,
                "source": request.source,
                "autonomy_source_id": source.get("id"),
                "autonomy_source_label": source.get("label"),
            }
        )
        logger.warning(f"Auto research cycle failed: {exc}")
        raise
    finally:
        AUTO_RESEARCH_RUNTIME["running"] = False
        AUTO_RESEARCH_RUNTIME["last_cycle_finished_at"] = time.time()
        AUTO_RESEARCH_RUNTIME["current_source_id"] = None
        AUTO_RESEARCH_RUNTIME["current_source_label"] = None


@router.post("/autonomy/run")
async def run_research_autonomy_now(
    request: AutonomousResearchRunRequest,
    payload: dict = Depends(verify_admin_token),
):
    result = await _run_autonomous_research_cycle(request.source_id)
    return {
        **result,
        "autonomy": get_background_research_status(),
    }


@router.post("/autonomy/start")
async def start_research_autonomy(payload: dict = Depends(verify_admin_token)):
    settings = update_autonomy_settings({"enabled": True})
    await start_background_research_task()
    return {
        "status": "started",
        "autonomy": get_background_research_status(),
        "settings": settings,
    }


@router.post("/autonomy/stop")
async def stop_research_autonomy(payload: dict = Depends(verify_admin_token)):
    settings = update_autonomy_settings({"enabled": False})
    await stop_background_research_task()
    return {
        "status": "stopped",
        "autonomy": get_background_research_status(),
        "settings": settings,
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
async def get_research_history(
    limit: int = 20,
    topic: Optional[str] = None,
    provider: Optional[str] = None,
    status: Optional[str] = None,
    source_id: Optional[str] = None,
    source_label: Optional[str] = None,
    search: Optional[str] = None,
    payload: dict = Depends(verify_admin_token),
):
    return {
        "runs": list_research_runs(
            limit=max(1, min(limit, 100)),
            topic=topic,
            provider=provider,
            status=status,
            source_id=source_id,
            source_label=source_label,
            search=search,
        ),
        "summary": summarize_research_runs(
            topic=topic,
            provider=provider,
            status=status,
            source_id=source_id,
            source_label=source_label,
            search=search,
        ),
    }


@router.get("/autonomy/sources/{source_id}/history")
async def get_research_autonomy_source_history(
    source_id: str,
    limit: int = 20,
    payload: dict = Depends(verify_admin_token),
):
    source = next((item for item in autonomy_status().get("sources", []) if item.get("id") == source_id), None)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Unknown autonomy source '{source_id}'")
    return {
        "source": source,
        "runs": list_research_runs(limit=max(1, min(limit, 100)), source_id=source_id),
        "summary": summarize_research_runs(source_id=source_id),
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
    scraper_cleanup = get_scraper().prune_state(
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
        source_id=request.source_id,
        source_label=request.source_label,
        search=request.search,
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
        "scraper": get_scraper().reset_state(),
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
    while True:
        settings = load_autonomy_config()
        if not settings.get("enabled", True):
            await asyncio.sleep(60)
            continue

        try:
            await _run_autonomous_research_cycle()
        except Exception:
            pass

        await asyncio.sleep(max(60, int(settings.get("interval_minutes") or 60) * 60))


async def start_background_research_task():
    global AUTO_RESEARCH_TASK

    if os.getenv("COSMO_TEST_MODE", "false").lower() == "true":
        return
    if os.getenv("AUTO_CRAWL_ENABLED", "true").lower() != "true":
        logger.info("Auto research disabled by environment configuration")
        return
    if not load_autonomy_config().get("enabled", True):
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
