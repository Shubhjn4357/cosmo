from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import requests


def test_research_cloudflare_provider_uses_stub_crawl_in_test_mode(server, admin_headers):
    response = requests.post(
        f"{server.base_url}/api/research/discover",
        headers=admin_headers,
        json={
            "topic": "cloudflare browser rendering crawl",
            "provider": "cloudflare",
            "start_url": "https://developers.cloudflare.com/browser-rendering/",
            "max_pages": 4,
            "max_sites": 1,
            "depth": 1,
            "render": False,
            "formats": ["markdown"],
        },
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "cloudflare"
    assert payload["pages_crawled"] >= 1
    assert payload["texts_processed"] >= 1
    assert payload["jobs"]
    assert payload["jobs"][0]["job_id"] == "test-cloudflare-crawl"

    stats = requests.get(f"{server.base_url}/api/research/stats", timeout=60)
    assert stats.status_code == 200
    stats_payload = stats.json()
    assert stats_payload["last_provider"] == "cloudflare"
    assert stats_payload["last_job_id"] == "test-cloudflare-crawl"
    assert stats_payload["cloudflare"]["available"] is True
    assert stats_payload["cloudflare"]["jobs_per_day_limit"] == 5
    assert stats_payload["cloudflare"]["requests_per_minute_limit"] == 6
    assert stats_payload["cloudflare"]["quota"]["jobs_started_today"] >= 1
    assert stats_payload["policy"]["require_allowed_sources"] is False

    history = requests.get(f"{server.base_url}/api/research/history", headers=admin_headers, timeout=60)
    assert history.status_code == 200
    history_payload = history.json()
    assert history_payload["runs"]
    assert history_payload["runs"][0]["provider"] == "cloudflare"
    assert history_payload["runs"][0]["job_id"] == "test-cloudflare-crawl"

    crawled_file = Path(stats_payload["data_file"])
    assert crawled_file.exists()
    content = crawled_file.read_text(encoding="utf-8")
    assert "developers.cloudflare.com/browser-rendering/" in content
    first_record = json.loads(content.splitlines()[0])
    assert first_record["provider"] == "cloudflare"
    assert first_record["policy"]["allowed"] is True
    assert first_record["provenance"]["category"]
    assert first_record["domain"]


def test_research_cloudflare_validation_works_in_test_mode(server, admin_headers):
    response = requests.post(
        f"{server.base_url}/api/research/cloudflare/validate",
        headers=admin_headers,
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["reachable"] is True
    assert payload["validation"]["last_valid"] is True
    assert payload["validation"]["validated_endpoint"] == "/links"
    assert payload["validation"]["links_found"] == 1

    stats = requests.get(f"{server.base_url}/api/research/stats", timeout=60)
    assert stats.status_code == 200
    validation = stats.json()["cloudflare"]["validation"]
    assert validation["last_valid"] is True
    assert validation["validated_endpoint"] == "/links"


def test_research_auto_falls_back_to_legacy_when_cloudflare_quota_is_spent(server, admin_headers):
    quota_path = server.data_root / "research" / "cloudflare_quota.json"
    quota_path.parent.mkdir(parents=True, exist_ok=True)
    quota_path.write_text(
        json.dumps(
            {
                "day": datetime.now(timezone.utc).date().isoformat(),
                "jobs_started_today": 5,
                "request_timestamps": [],
                "last_job_at": None,
                "last_request_at": None,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    response = requests.post(
        f"{server.base_url}/api/research/discover",
        headers=admin_headers,
        json={
            "topic": "quota fallback",
            "provider": "auto",
            "start_url": "https://example.com/fallback",
            "max_pages": 2,
            "max_sites": 1,
        },
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "legacy"
    assert payload["fallback"]["from"] == "cloudflare"
    assert payload["fallback"]["to"] == "legacy"
    assert "quota" in payload["fallback"]["reason"].lower()

    history = requests.get(f"{server.base_url}/api/research/history", headers=admin_headers, timeout=60)
    assert history.status_code == 200
    latest = history.json()["runs"][0]
    assert latest["provider"] == "legacy"
    assert latest["fallback"]["from"] == "cloudflare"
    assert "quota" in latest["fallback"]["reason"].lower()


def test_research_cloudflare_provider_returns_429_when_quota_is_spent(server, admin_headers):
    quota_path = server.data_root / "research" / "cloudflare_quota.json"
    quota_path.parent.mkdir(parents=True, exist_ok=True)
    quota_path.write_text(
        json.dumps(
            {
                "day": datetime.now(timezone.utc).date().isoformat(),
                "jobs_started_today": 5,
                "request_timestamps": [],
                "last_job_at": None,
                "last_request_at": None,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    response = requests.post(
        f"{server.base_url}/api/research/discover",
        headers=admin_headers,
        json={
            "topic": "quota hard stop",
            "provider": "cloudflare",
            "start_url": "https://developers.cloudflare.com/browser-rendering/",
            "max_pages": 2,
            "max_sites": 1,
        },
        timeout=60,
    )
    assert response.status_code == 429
    payload = response.json()
    assert "quota" in payload["detail"].lower()


def test_research_policy_can_be_updated_and_blocks_unapproved_sources(server, admin_headers):
    update = requests.put(
        f"{server.base_url}/api/research/policy",
        headers=admin_headers,
        json={
            "require_allowed_sources": True,
            "require_license_metadata": False,
            "allowed_domains": ["developers.cloudflare.com"],
            "blocked_domains": ["example.com"],
        },
        timeout=60,
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["require_allowed_sources"] is True
    assert "developers.cloudflare.com" in payload["allowed_domains"]
    assert "example.com" in payload["blocked_domains"]

    blocked = requests.post(
        f"{server.base_url}/api/research/discover",
        headers=admin_headers,
        json={
            "topic": "blocked source",
            "provider": "legacy",
            "start_url": "https://example.com/blocked",
            "max_pages": 1,
        },
        timeout=60,
    )
    assert blocked.status_code == 200
    blocked_payload = blocked.json()
    assert blocked_payload["provider"] == "none"
    assert blocked_payload["policy"]["rejected_urls"] >= 1
    assert blocked_payload["policy"]["rejected_samples"][0]["reason"].startswith("blocked_domain:")

    search_only = requests.post(
        f"{server.base_url}/api/research/discover",
        headers=admin_headers,
        json={
            "topic": "filtered search",
            "provider": "auto",
            "search_only": True,
        },
        timeout=60,
    )
    assert search_only.status_code == 200
    search_payload = search_only.json()
    assert isinstance(search_payload["urls"], list)
    assert search_payload["policy"]["candidate_urls"] >= search_payload["count"]


def test_research_documents_can_be_listed_and_exported(server, admin_headers):
    discover = requests.post(
        f"{server.base_url}/api/research/discover",
        headers=admin_headers,
        json={
            "topic": "document export test",
            "provider": "cloudflare",
            "start_url": "https://developers.cloudflare.com/browser-rendering/",
            "max_pages": 2,
            "max_sites": 1,
        },
        timeout=60,
    )
    assert discover.status_code == 200

    documents = requests.get(
        f"{server.base_url}/api/research/documents?limit=5",
        headers=admin_headers,
        timeout=60,
    )
    assert documents.status_code == 200
    payload = documents.json()
    assert payload["documents"]
    first = payload["documents"][0]
    assert "text_preview" in first
    assert "text" not in first
    assert first["provider"] == "cloudflare"
    assert payload["summary"]["document_count"] >= 1

    export = requests.post(
        f"{server.base_url}/api/research/documents/export",
        headers=admin_headers,
        json={
            "topic": "document export test",
            "provider": "cloudflare",
            "include_text": True,
            "dataset_name": "research_document_export_test",
        },
        timeout=60,
    )
    assert export.status_code == 200
    export_payload = export.json()
    assert export_payload["dataset"]["name"] == "research_document_export_test.jsonl"
    export_path = server.data_root / "datasets" / "research_document_export_test.jsonl"
    assert export_path.exists()
    exported_content = export_path.read_text(encoding="utf-8")
    assert "document export test" in exported_content


def test_research_documents_normalize_legacy_rows(server, admin_headers):
    legacy_path = server.data_root / "crawled_documents.jsonl"
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path.write_text(
        json.dumps(
            {
                "source": "research:legacy compatibility topic",
                "text": "Legacy research row content that predates provider and provenance metadata.",
                "timestamp": 1234567890,
            },
            ensure_ascii=True,
        ) + "\n",
        encoding="utf-8",
    )

    documents = requests.get(
        f"{server.base_url}/api/research/documents?limit=5",
        headers=admin_headers,
        timeout=60,
    )
    assert documents.status_code == 200
    payload = documents.json()
    assert payload["documents"]
    first = payload["documents"][0]
    assert first["topic"] == "legacy compatibility topic"
    assert first["provider"] == "unknown"
    assert first["policy"]["reason"] == "legacy_record"
    assert first["provenance"]["category"] == "legacy"


def test_research_documents_and_history_can_be_deleted_by_filter(server, admin_headers):
    for topic in ("delete me", "keep me"):
        response = requests.post(
            f"{server.base_url}/api/research/discover",
            headers=admin_headers,
            json={
                "topic": topic,
                "provider": "cloudflare",
                "start_url": "https://developers.cloudflare.com/browser-rendering/",
                "max_pages": 1,
                "max_sites": 1,
            },
            timeout=60,
        )
        assert response.status_code == 200

    delete_documents = requests.delete(
        f"{server.base_url}/api/research/documents",
        headers=admin_headers,
        json={"topic": "delete me", "provider": "cloudflare"},
        timeout=60,
    )
    assert delete_documents.status_code == 200
    delete_documents_payload = delete_documents.json()
    assert delete_documents_payload["deleted"] >= 1
    assert delete_documents_payload["scraper_cleanup"]["removed_urls"] >= 0
    assert delete_documents_payload["index_sync"]["status"] == "skipped"

    documents = requests.get(
        f"{server.base_url}/api/research/documents?limit=20",
        headers=admin_headers,
        timeout=60,
    )
    assert documents.status_code == 200
    topics = {entry["topic"] for entry in documents.json()["documents"]}
    assert "delete me" not in topics
    assert "keep me" in topics

    delete_history = requests.delete(
        f"{server.base_url}/api/research/history",
        headers=admin_headers,
        json={"topic": "delete me", "provider": "cloudflare"},
        timeout=60,
    )
    assert delete_history.status_code == 200
    delete_history_payload = delete_history.json()
    assert delete_history_payload["deleted"] >= 1

    history = requests.get(
        f"{server.base_url}/api/research/history?limit=20",
        headers=admin_headers,
        timeout=60,
    )
    assert history.status_code == 200
    history_topics = {entry["topic"] for entry in history.json()["runs"]}
    assert "delete me" not in history_topics
    assert "keep me" in history_topics


def test_research_cloudflare_quota_can_be_reset(server, admin_headers):
    quota_path = server.data_root / "research" / "cloudflare_quota.json"
    quota_path.parent.mkdir(parents=True, exist_ok=True)
    quota_path.write_text(
        json.dumps(
            {
                "day": datetime.now(timezone.utc).date().isoformat(),
                "jobs_started_today": 5,
                "request_timestamps": [datetime.now(timezone.utc).timestamp()],
                "last_job_at": None,
                "last_request_at": None,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    reset = requests.post(
        f"{server.base_url}/api/research/quota/reset",
        headers=admin_headers,
        timeout=60,
    )
    assert reset.status_code == 200
    payload = reset.json()
    assert payload["status"] == "reset"
    assert payload["quota"]["jobs_started_today"] == 0
    assert payload["quota"]["requests_last_minute"] == 0


def test_research_scraper_state_can_be_reset(server, admin_headers):
    reset = requests.post(
        f"{server.base_url}/api/research/scraper/reset",
        headers=admin_headers,
        timeout=60,
    )
    assert reset.status_code == 200
    payload = reset.json()
    assert payload["status"] == "reset"
    assert "scraper" in payload
