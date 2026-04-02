from __future__ import annotations

from services.cloudflare_crawl import CloudflareCrawlService


def test_cloudflare_runtime_auth_failure_blocks_future_attempts(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "demo-account")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "demo-token")
    monkeypatch.setenv("CLOUDFLARE_CRAWL_ENABLED", "true")
    monkeypatch.setenv("WHISPER_TEST_MODE", "false")

    crawler = CloudflareCrawlService()
    assert crawler.unavailable_reason() is None

    crawler._remember_runtime_failure("401 Unauthorized", status_code=401)
    reason = crawler.unavailable_reason()
    assert reason is not None
    assert "legacy research" in reason.lower()

    crawler._clear_runtime_failure()
    assert crawler.unavailable_reason() is None
