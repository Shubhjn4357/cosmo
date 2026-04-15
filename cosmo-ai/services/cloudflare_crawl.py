from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from loguru import logger

from utils.app_paths import DATA_ROOT


QUOTA_STATE_PATH = DATA_ROOT / "research" / "cloudflare_quota.json"
VALIDATION_STATE_PATH = DATA_ROOT / "research" / "cloudflare_validation.json"


class CloudflareQuotaError(RuntimeError):
    pass


class CloudflareCrawlService:
    def __init__(self):
        self.account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        if not self.account_id:
            secret_path = Path("/run/secrets/CLOUDFLARE_ACCOUNT_ID")
            if secret_path.exists():
                self.account_id = secret_path.read_text(encoding="utf-8").strip()

        self.api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
        if not self.api_token:
            secret_path = Path("/run/secrets/CLOUDFLARE_API_TOKEN")
            if secret_path.exists():
                self.api_token = secret_path.read_text(encoding="utf-8").strip()
        self.test_mode = os.getenv("COSMO_TEST_MODE", "false").lower() == "true"
        self.enabled = os.getenv("CLOUDFLARE_CRAWL_ENABLED", "true").lower() == "true"
        self.plan = (os.getenv("CLOUDFLARE_CRAWL_PLAN", "free") or "free").strip().lower()
        self.requests_per_minute_limit = max(1, int(os.getenv("CLOUDFLARE_REST_REQUESTS_PER_MINUTE", "6")))
        self.jobs_per_day_limit = max(1, int(os.getenv("CLOUDFLARE_CRAWL_JOBS_PER_DAY", "5")))
        self.pages_per_job_limit = max(1, int(os.getenv("CLOUDFLARE_CRAWL_PAGES_PER_JOB", "100")))
        configured_poll_interval = float(os.getenv("CLOUDFLARE_CRAWL_POLL_INTERVAL_SECONDS", "10"))
        minimum_poll_interval = 60.0 / max(1, self.requests_per_minute_limit)
        self.poll_interval_seconds = max(configured_poll_interval, minimum_poll_interval)
        self.max_polls = int(os.getenv("CLOUDFLARE_CRAWL_MAX_POLLS", "60"))
        self.base_url = "https://api.cloudflare.com/client/v4"
        self._quota_state_path = Path(os.getenv("CLOUDFLARE_CRAWL_QUOTA_PATH", str(QUOTA_STATE_PATH)))
        self._validation_state_path = Path(
            os.getenv("CLOUDFLARE_CRAWL_VALIDATION_PATH", str(VALIDATION_STATE_PATH))
        )
        self._quota_lock = threading.Lock()
        self._runtime_failure_reason: Optional[str] = None
        self._runtime_failure_status_code: Optional[int] = None

    def is_available(self) -> bool:
        return self.unavailable_reason() is None

    def is_configured(self) -> bool:
        return bool(self.account_id and self.api_token)

    def unavailable_reason(self) -> Optional[str]:
        if not self.enabled:
            return "Cloudflare crawl is disabled"
        if not self.test_mode and not self.is_configured():
            return "Cloudflare crawl is not configured"
        if self._runtime_failure_reason:
            return self._runtime_failure_reason
        quota = self.quota_status()
        if not quota["job_quota_available"]:
            return (
                f"Cloudflare crawl daily job quota reached "
                f"({quota['jobs_started_today']}/{quota['jobs_per_day_limit']})"
            )
        return None

    def _clear_runtime_failure(self) -> None:
        self._runtime_failure_reason = None
        self._runtime_failure_status_code = None

    def _remember_runtime_failure(self, message: str, *, status_code: int | None = None) -> None:
        normalized_message = message.strip() or "Cloudflare crawl is unavailable"
        if status_code in {401, 403}:
            normalized_message = (
                f"Cloudflare crawl credentials were rejected ({status_code}); "
                "falling back to legacy research until restart or successful validation"
            )
        elif status_code is None:
            lowered = normalized_message.lower()
            if "401" in lowered or "403" in lowered or "unauthorized" in lowered or "forbidden" in lowered:
                normalized_message = (
                    "Cloudflare crawl credentials were rejected; "
                    "falling back to legacy research until restart or successful validation"
                )
                status_code = 401
        self._runtime_failure_reason = normalized_message
        self._runtime_failure_status_code = status_code

    def status(self) -> dict[str, Any]:
        quota = self.quota_status()
        validation = self.validation_status()
        status_message = self.unavailable_reason() or "Cloudflare crawl is ready"
        if quota["job_quota_available"] and not quota["request_quota_available"]:
            status_message = (
                f"Cloudflare crawl is throttled for about "
                f"{quota['next_request_available_in_seconds']}s"
            )
        return {
            "enabled": self.enabled,
            "available": self.is_available(),
            "test_mode": self.test_mode,
            "configured": self.is_configured(),
            "status_message": status_message,
            "plan": self.plan,
            "default_render": False,
            "poll_interval_seconds": self.poll_interval_seconds,
            "max_polls": self.max_polls,
            "requests_per_minute_limit": self.requests_per_minute_limit,
            "jobs_per_day_limit": self.jobs_per_day_limit,
            "pages_per_job_limit": self.pages_per_job_limit,
            "quota": quota,
            "validation": validation,
        }

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

    def _endpoint(self, suffix: str = "") -> str:
        return f"{self.base_url}/accounts/{self.account_id}/browser-rendering/crawl{suffix}"

    def _rest_endpoint(self, resource: str) -> str:
        return f"{self.base_url}/accounts/{self.account_id}/browser-rendering/{resource.lstrip('/')}"

    def _ensure_quota_dir(self) -> None:
        self._quota_state_path.parent.mkdir(parents=True, exist_ok=True)

    def _load_validation_state(self) -> dict[str, Any]:
        if not self._validation_state_path.exists():
            return {}
        try:
            return json.loads(self._validation_state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _write_validation_state(self, state: dict[str, Any]) -> None:
        self._validation_state_path.parent.mkdir(parents=True, exist_ok=True)
        self._validation_state_path.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")

    def validation_status(self) -> dict[str, Any]:
        state = self._load_validation_state()
        return {
            "last_validated_at": state.get("last_validated_at"),
            "last_valid": state.get("last_valid"),
            "last_error": state.get("last_error"),
            "last_message": state.get("last_message"),
            "validated_endpoint": state.get("validated_endpoint"),
            "links_found": state.get("links_found"),
            "status_code": state.get("status_code"),
            "validation_path": str(self._validation_state_path),
        }

    def _record_validation_result(
        self,
        *,
        last_valid: bool,
        last_message: str,
        validated_endpoint: str,
        status_code: int | None = None,
        last_error: str | None = None,
        links_found: int | None = None,
    ) -> dict[str, Any]:
        state = {
            "last_validated_at": time.time(),
            "last_valid": last_valid,
            "last_error": last_error,
            "last_message": last_message,
            "validated_endpoint": validated_endpoint,
            "links_found": links_found,
            "status_code": status_code,
        }
        self._write_validation_state(state)
        return self.validation_status()

    def _utc_day_key(self, now: Optional[float] = None) -> str:
        current = datetime.fromtimestamp(now or time.time(), tz=timezone.utc)
        return current.date().isoformat()

    def _load_quota_state(self) -> dict[str, Any]:
        if not self._quota_state_path.exists():
            return {}
        try:
            return json.loads(self._quota_state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _normalize_quota_state(self, state: dict[str, Any], now: Optional[float] = None) -> dict[str, Any]:
        current = float(now or time.time())
        day_key = self._utc_day_key(current)
        request_timestamps = []
        for value in state.get("request_timestamps", []):
            try:
                timestamp = float(value)
            except (TypeError, ValueError):
                continue
            if current - timestamp < 60:
                request_timestamps.append(timestamp)
        request_timestamps.sort()

        jobs_started_today = 0
        if state.get("day") == day_key:
            try:
                jobs_started_today = max(0, int(state.get("jobs_started_today") or 0))
            except (TypeError, ValueError):
                jobs_started_today = 0

        return {
            "day": day_key,
            "jobs_started_today": jobs_started_today,
            "request_timestamps": request_timestamps,
            "last_job_at": state.get("last_job_at"),
            "last_request_at": state.get("last_request_at"),
        }

    def _write_quota_state(self, state: dict[str, Any]) -> None:
        self._ensure_quota_dir()
        self._quota_state_path.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")

    def quota_status(self) -> dict[str, Any]:
        with self._quota_lock:
            state = self._normalize_quota_state(self._load_quota_state())
            self._write_quota_state(state)

        requests_last_minute = len(state["request_timestamps"])
        jobs_remaining_today = max(0, self.jobs_per_day_limit - state["jobs_started_today"])
        requests_remaining_current_minute = max(0, self.requests_per_minute_limit - requests_last_minute)
        next_request_available_in_seconds = 0.0
        if requests_last_minute >= self.requests_per_minute_limit and state["request_timestamps"]:
            next_request_available_in_seconds = max(
                0.0,
                60.0 - (time.time() - state["request_timestamps"][0]),
            )

        return {
            "day": state["day"],
            "jobs_started_today": state["jobs_started_today"],
            "jobs_remaining_today": jobs_remaining_today,
            "jobs_per_day_limit": self.jobs_per_day_limit,
            "job_quota_available": jobs_remaining_today > 0,
            "requests_last_minute": requests_last_minute,
            "requests_remaining_current_minute": requests_remaining_current_minute,
            "requests_per_minute_limit": self.requests_per_minute_limit,
            "request_quota_available": requests_remaining_current_minute > 0,
            "next_request_available_in_seconds": round(next_request_available_in_seconds, 1),
            "last_job_at": state.get("last_job_at"),
            "last_request_at": state.get("last_request_at"),
            "quota_path": str(self._quota_state_path),
        }

    def reset_quota(self) -> dict[str, Any]:
        with self._quota_lock:
            state = self._normalize_quota_state({})
            self._write_quota_state(state)
        return self.quota_status()

    def _reserve_job_slot(self) -> dict[str, Any]:
        with self._quota_lock:
            now = time.time()
            state = self._normalize_quota_state(self._load_quota_state(), now)
            if state["jobs_started_today"] >= self.jobs_per_day_limit:
                self._write_quota_state(state)
                raise CloudflareQuotaError(
                    f"Cloudflare crawl daily job quota reached ({state['jobs_started_today']}/{self.jobs_per_day_limit})"
                )
            state["jobs_started_today"] += 1
            state["last_job_at"] = now
            self._write_quota_state(state)
            return state

    async def _throttle_request_slot(self) -> None:
        while True:
            wait_seconds = 0.0
            with self._quota_lock:
                now = time.time()
                state = self._normalize_quota_state(self._load_quota_state(), now)
                if len(state["request_timestamps"]) < self.requests_per_minute_limit:
                    state["request_timestamps"].append(now)
                    state["request_timestamps"].sort()
                    state["last_request_at"] = now
                    self._write_quota_state(state)
                    return
                oldest = state["request_timestamps"][0]
                wait_seconds = max(0.5, 60.0 - (now - oldest) + 0.1)
                self._write_quota_state(state)
            await asyncio.sleep(wait_seconds)

    async def _request_json(
        self,
        client: httpx.AsyncClient,
        method: str,
        suffix: str = "",
        **kwargs,
    ) -> dict[str, Any]:
        await self._throttle_request_slot()
        response = await client.request(
            method,
            self._endpoint(suffix),
            headers=self._headers(),
            **kwargs,
        )
        response.raise_for_status()
        return response.json()

    async def validate_remote(self) -> dict[str, Any]:
        if not self.enabled:
            validation = self._record_validation_result(
                last_valid=False,
                last_message="Cloudflare crawl is disabled",
                validated_endpoint="/links",
                last_error="disabled",
            )
            return {
                "reachable": False,
                "configured": self.is_configured(),
                "message": "Cloudflare crawl is disabled",
                "validation": validation,
            }

        if self.test_mode:
            self._clear_runtime_failure()
            validation = self._record_validation_result(
                last_valid=True,
                last_message="Validated in test mode with synthetic inline HTML",
                validated_endpoint="/links",
                status_code=200,
                links_found=1,
            )
            return {
                "reachable": True,
                "configured": self.is_configured(),
                "message": "Validated in test mode with synthetic inline HTML",
                "validation": validation,
            }

        missing = []
        if not self.account_id:
            missing.append("CLOUDFLARE_ACCOUNT_ID")
        if not self.api_token:
            missing.append("CLOUDFLARE_API_TOKEN")
        if missing:
            message = f"Cloudflare crawl is not configured: missing {', '.join(missing)}"
            validation = self._record_validation_result(
                last_valid=False,
                last_message=message,
                validated_endpoint="/links",
                last_error=message,
            )
            return {
                "reachable": False,
                "configured": False,
                "message": message,
                "missing": missing,
                "validation": validation,
            }

        payload = {
            "html": "<html><body><a href='https://example.com'>ok</a></body></html>",
            "visibleLinksOnly": True,
            "excludeExternalLinks": False,
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                await self._throttle_request_slot()
                response = await client.post(
                    self._rest_endpoint("links"),
                    headers=self._headers(),
                    json=payload,
                )
                status_code = response.status_code
                response.raise_for_status()
                body = response.json()
                links = body.get("result") or []
        except Exception as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            message = str(exc)
            if status_code in {401, 403}:
                self._remember_runtime_failure(message, status_code=status_code)
            validation = self._record_validation_result(
                last_valid=False,
                last_message=message,
                validated_endpoint="/links",
                status_code=status_code,
                last_error=message,
            )
            return {
                "reachable": False,
                "configured": True,
                "message": message,
                "validation": validation,
            }

        self._clear_runtime_failure()
        validation = self._record_validation_result(
            last_valid=True,
            last_message="Cloudflare Browser Rendering /links validation succeeded",
            validated_endpoint="/links",
            status_code=status_code,
            links_found=len(links),
        )
        return {
            "reachable": True,
            "configured": True,
            "message": "Cloudflare Browser Rendering /links validation succeeded",
            "links_found": len(links),
            "validation": validation,
        }

    def _extract_texts(self, records: list[dict[str, Any]]) -> list[str]:
        texts: list[str] = []
        for record in records:
            if record.get("status") != "completed":
                continue
            content = record.get("markdown") or record.get("html")
            if not content and record.get("json") is not None:
                content = json.dumps(record["json"], ensure_ascii=True)
            if content:
                texts.append(content)
        return texts

    async def _poll_until_terminal(self, client: httpx.AsyncClient, job_id: str) -> dict[str, Any]:
        last_result: dict[str, Any] | None = None
        for _ in range(self.max_polls):
            payload = await self._request_json(
                client,
                "GET",
                f"/{job_id}",
                params={"limit": 1},
                timeout=60.0,
            )
            result = payload.get("result", {})
            last_result = result
            if result.get("status") != "running":
                return result
            await asyncio.sleep(self.poll_interval_seconds)
        raise TimeoutError(f"Cloudflare crawl job {job_id} did not complete after {self.max_polls} polls")

    async def _fetch_records(self, client: httpx.AsyncClient, job_id: str) -> dict[str, Any]:
        records: list[dict[str, Any]] = []
        cursor: Optional[str] = None
        status_payload: dict[str, Any] | None = None

        while True:
            params: dict[str, Any] = {"status": "completed", "limit": 100}
            if cursor:
                params["cursor"] = cursor
            payload = await self._request_json(
                client,
                "GET",
                f"/{job_id}",
                params=params,
                timeout=120.0,
            )
            result = payload.get("result", {})
            status_payload = result
            records.extend(result.get("records", []))
            cursor = result.get("cursor")
            if not cursor:
                break

        return {
            "job_id": job_id,
            "status": (status_payload or {}).get("status", "completed"),
            "total": (status_payload or {}).get("total", len(records)),
            "finished": (status_payload or {}).get("finished", len(records)),
            "browser_seconds_used": (status_payload or {}).get("browserSecondsUsed"),
            "records": records,
            "texts": self._extract_texts(records),
        }

    async def crawl(
        self,
        *,
        url: str,
        limit: int = 10,
        depth: int = 2,
        render: bool = False,
        formats: Optional[list[str]] = None,
        source: str = "all",
        include_patterns: Optional[list[str]] = None,
        exclude_patterns: Optional[list[str]] = None,
        include_external_links: bool = False,
        include_subdomains: bool = False,
        modified_since: Optional[int] = None,
        max_age: Optional[int] = None,
    ) -> dict[str, Any]:
        reason = self.unavailable_reason()
        if reason:
            raise CloudflareQuotaError(reason) if "quota" in reason else RuntimeError(reason)

        self._reserve_job_slot()

        if self.test_mode:
            records = [
                {
                    "url": url,
                    "status": "completed",
                    "markdown": f"# Test crawl for {url}\n\nThis is synthetic Cloudflare crawl content for testing the research pipeline.",
                    "metadata": {"status": 200, "title": "Synthetic page", "url": url},
                },
                {
                    "url": f"{url.rstrip('/')}/docs",
                    "status": "completed",
                    "markdown": f"## Follow-up page for {url}\n\nCloudflare crawl integration test content with enough text to be indexed into the local knowledge store.",
                    "metadata": {"status": 200, "title": "Synthetic child page", "url": f"{url.rstrip('/')}/docs"},
                },
            ]
            return {
                "job_id": "test-cloudflare-crawl",
                "status": "completed",
                "total": len(records),
                "finished": len(records),
                "browser_seconds_used": 0,
                "records": records,
                "texts": self._extract_texts(records),
            }

        effective_limit = max(1, min(limit, self.pages_per_job_limit))
        if effective_limit != limit:
            logger.info(
                "Clamped Cloudflare crawl limit from {} to {} based on configured pages/job limit",
                limit,
                effective_limit,
            )
        payload: dict[str, Any] = {
            "url": url,
            "limit": effective_limit,
            "depth": max(0, min(depth, 100000)),
            "render": render,
            "source": source,
            "formats": formats or ["markdown"],
        }
        if modified_since is not None:
            payload["modifiedSince"] = modified_since
        if max_age is not None:
            payload["maxAge"] = max_age

        options: dict[str, Any] = {
            "includeExternalLinks": include_external_links,
            "includeSubdomains": include_subdomains,
        }
        if include_patterns:
            options["includePatterns"] = include_patterns
        if exclude_patterns:
            options["excludePatterns"] = exclude_patterns
        if options:
            payload["options"] = options

        async with httpx.AsyncClient() as client:
            try:
                start_payload = await self._request_json(
                    client,
                    "POST",
                    json=payload,
                    timeout=60.0,
                )
                job_id = start_payload.get("result")
                if not job_id:
                    raise RuntimeError(f"Cloudflare crawl start failed: {start_payload}")

                terminal = await self._poll_until_terminal(client, job_id)
                status = terminal.get("status")
                if status != "completed":
                    self._clear_runtime_failure()
                    return {
                        "job_id": job_id,
                        "status": status,
                        "total": terminal.get("total", 0),
                        "finished": terminal.get("finished", 0),
                        "browser_seconds_used": terminal.get("browserSecondsUsed"),
                        "records": [],
                        "texts": [],
                    }

                self._clear_runtime_failure()
                return await self._fetch_records(client, job_id)
            except Exception as exc:
                status_code = getattr(getattr(exc, "response", None), "status_code", None)
                if status_code in {401, 403}:
                    self._remember_runtime_failure(str(exc), status_code=status_code)
                    self._record_validation_result(
                        last_valid=False,
                        last_message=str(exc),
                        validated_endpoint="/crawl",
                        status_code=status_code,
                        last_error=str(exc),
                    )
                raise


try:
    import asyncio
except Exception:  # pragma: no cover
    asyncio = None


CRAWLER = CloudflareCrawlService()
