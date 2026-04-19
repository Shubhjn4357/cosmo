from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from api.routes import research
from knowledge.scraper import CrawlResult, ScraperConfig, WebScraper
from services.research_index_sync import _is_research_metadata_entry, rebuild_vector_index_with_research


class FakeVectorDB:
    def __init__(self):
        self.metadata = [
            {"id": 0, "text": "keep manual knowledge", "source": "manual.seed"},
            {"id": 1, "text": "old research chunk", "source": "research:old:example.com"},
        ]
        self.saved = False

    def clear(self):
        self.metadata = []

    def add(self, _embeddings, texts, metadata):
        for index, (text, meta) in enumerate(zip(texts, metadata)):
            row = {"id": len(self.metadata) + index, "text": text, **meta}
            self.metadata.append(row)

    def save(self):
        self.saved = True

    def get_stats(self):
        return {"total_vectors": len(self.metadata)}


class FakeEmbedder:
    def embed(self, texts):
        return np.ones((len(texts), 4), dtype=np.float32)


def test_rebuild_vector_index_with_research_keeps_non_research_and_readds_current_docs():
    vectordb = FakeVectorDB()
    embedder = FakeEmbedder()
    documents = [
        {
            "topic": "fresh topic",
            "provider": "legacy",
            "domain": "developers.cloudflare.com",
            "source": "research:fresh topic:developers.cloudflare.com",
            "source_url": "https://developers.cloudflare.com/browser-rendering/",
            "url": "https://developers.cloudflare.com/browser-rendering/",
            "text": " ".join(["cloudflare"] * 300),
        }
    ]

    result = rebuild_vector_index_with_research(
        vectordb=vectordb,
        embedder=embedder,
        research_documents=documents,
    )

    sources = [row.get("source") for row in vectordb.metadata]
    assert "manual.seed" in sources
    assert all(not str(source).startswith("research:old:") for source in sources)
    assert any(str(source).startswith("research:fresh topic:developers.cloudflare.com") for source in sources)
    assert result["status"] == "rebuilt"
    assert result["retained_chunks"] == 1
    assert result["research_chunks"] >= 1
    assert vectordb.saved is True


def test_is_research_metadata_entry_detects_legacy_research_chunks():
    assert _is_research_metadata_entry({"source": "research:topic:domain"})
    assert _is_research_metadata_entry(
        {
            "source": "python programming best practices",
            "topic": "python programming best practices",
            "domain": "unknown",
            "provider": "unknown",
        }
    )
    assert _is_research_metadata_entry({"source": "topic", "source_url": "https://example.com"})
    assert not _is_research_metadata_entry({"source": "manual.seed"})


def test_scraper_force_refresh_allows_recrawling_visited_url(tmp_path: Path):
    scraper = WebScraper(ScraperConfig(seed_urls=[]), storage_path=str(tmp_path))
    url = "https://developers.cloudflare.com/browser-rendering/"
    scraper.visited_urls.add(url)
    scraper.content_hashes.add("duplicate")

    async def fake_check_robots(_url: str) -> bool:
        return True

    async def fake_fetch_url(_url: str) -> str:
        return "<html><body><main>Browser Rendering docs content</main></body></html>"

    def fake_extract_content(_html: str, current_url: str) -> CrawlResult:
        return CrawlResult(
            url=current_url,
            title="Browser Rendering",
            text="Browser Rendering docs content",
            links=[],
            timestamp=0,
            success=True,
            content_hash="duplicate",
        )

    scraper._check_robots = fake_check_robots  # type: ignore[method-assign]
    scraper._fetch_url = fake_fetch_url  # type: ignore[method-assign]
    scraper._extract_content = fake_extract_content  # type: ignore[method-assign]
    scraper.prepare_session(
        [url],
        force_urls=[url],
        allow_duplicate_content=True,
    )

    result = asyncio.run(scraper.crawl_url(url))
    assert result is not None
    assert result.success is True


def test_scraper_prune_and_reset_state(tmp_path: Path):
    scraper = WebScraper(ScraperConfig(seed_urls=[]), storage_path=str(tmp_path))
    scraper.visited_urls.update({"https://example.com/a", "https://example.com/b"})
    scraper.content_hashes.update({"hash-a", "hash-b"})
    scraper.queue = ["https://example.com/a", "https://example.com/c"]

    prune = scraper.prune_state(
        urls=["https://example.com/a"],
        content_hashes=["hash-a"],
    )
    assert prune["removed_urls"] == 1
    assert prune["removed_content_hashes"] == 1
    assert "https://example.com/a" not in scraper.visited_urls
    assert "hash-a" not in scraper.content_hashes
    assert "https://example.com/a" not in scraper.queue

    reset = scraper.reset_state()
    assert reset["removed_urls"] == 1
    assert reset["removed_content_hashes"] == 1
    assert scraper.visited_urls == set()
    assert scraper.content_hashes == set()
    assert scraper.queue == []


def test_route_rebuild_research_index_keeps_all_documents(monkeypatch):
    vectordb = FakeVectorDB()
    embedder = FakeEmbedder()
    all_documents = [
        {
            "topic": "topic one",
            "provider": "legacy",
            "domain": "one.example",
            "source": "research:topic one:one.example",
            "source_url": "https://one.example",
            "url": "https://one.example",
            "text": " ".join(["one"] * 300),
        },
        {
            "topic": "topic two",
            "provider": "legacy",
            "domain": "two.example",
            "source": "research:topic two:two.example",
            "source_url": "https://two.example",
            "url": "https://two.example",
            "text": " ".join(["two"] * 300),
        },
    ]

    def fake_filtered_documents(*, topic=None, domain=None, provider=None, search=None):
        if topic == "topic one":
            return [all_documents[0]]
        return list(all_documents)

    monkeypatch.setattr(research, "filtered_documents", fake_filtered_documents)
    monkeypatch.setattr(
        "api.route.get_app_state",
        lambda: SimpleNamespace(vectordb=vectordb, embedder=embedder),
    )

    result = research._rebuild_research_knowledge_index(topic="topic one")
    sources = [row.get("source") for row in vectordb.metadata]
    assert any(str(source).startswith("research:topic one:one.example") for source in sources)
    assert any(str(source).startswith("research:topic two:two.example") for source in sources)
    assert result["matched_documents"] == 1
    assert result["total_research_documents"] == 2
    assert result["rebuild_scope"] == "all_research_documents"
