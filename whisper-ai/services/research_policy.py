from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from utils.app_paths import DATA_ROOT


POLICY_PATH = DATA_ROOT / "research" / "source_policy.json"

DEFAULT_SOURCE_REGISTRY: dict[str, dict[str, Any]] = {
    "developers.cloudflare.com": {
        "allowed": True,
        "category": "official_docs",
        "license": "site_specific_terms",
        "trust": "official",
        "notes": "Cloudflare official developer documentation.",
    },
    "docs.python.org": {
        "allowed": True,
        "category": "official_docs",
        "license": "site_specific_terms",
        "trust": "official",
        "notes": "Python official documentation.",
    },
    "developer.mozilla.org": {
        "allowed": True,
        "category": "official_docs",
        "license": "site_specific_terms",
        "trust": "official",
        "notes": "MDN documentation and web platform references.",
    },
    "en.wikipedia.org": {
        "allowed": True,
        "category": "reference",
        "license": "cc_by_sa",
        "trust": "community",
        "notes": "Wikipedia content is attribution-sharealike.",
    },
    "arxiv.org": {
        "allowed": True,
        "category": "research",
        "license": "paper_specific_terms",
        "trust": "research",
        "notes": "Paper rights vary by submission; check paper metadata when exporting.",
    },
    "huggingface.co": {
        "allowed": True,
        "category": "model_docs",
        "license": "site_specific_terms",
        "trust": "official",
        "notes": "Model and dataset pages have per-repo licenses.",
    },
    "github.com": {
        "allowed": True,
        "category": "code",
        "license": "repository_specific_terms",
        "trust": "community",
        "notes": "Repository licenses vary; inspect repo metadata before dataset export.",
    },
}

DEFAULT_BLOCKED_DOMAINS = [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "reddit.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
]


def _csv_env(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def _csv_env_raw(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_domain(value: str) -> str:
    domain = (value or "").strip().lower()
    if domain.startswith("http://") or domain.startswith("https://"):
        domain = urlparse(domain).hostname or ""
    if domain.startswith("www."):
        domain = domain[4:]
    return domain.strip(".")


def _normalize_url_prefix(value: str) -> str:
    return (value or "").strip()


def _domain_matches(hostname: str, rule: str) -> bool:
    host = _normalize_domain(hostname)
    domain = _normalize_domain(rule)
    if not host or not domain:
        return False
    return host == domain or host.endswith(f".{domain}")


class ResearchSourcePolicy:
    def __init__(self):
        self.path = Path(os.getenv("RESEARCH_POLICY_PATH", str(POLICY_PATH)))
        self._ensure_parent()
        self._ensure_default_file()

    def _ensure_parent(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _default_mutable_config(self) -> dict[str, Any]:
        return {
            "require_allowed_sources": _bool_env("RESEARCH_REQUIRE_ALLOWED_SOURCES", False),
            "require_license_metadata": _bool_env("RESEARCH_REQUIRE_LICENSE_METADATA", False),
            "allowed_domains": _csv_env("RESEARCH_ALLOWED_DOMAINS"),
            "allowed_prefixes": _csv_env_raw("RESEARCH_ALLOWED_PREFIXES"),
            "blocked_domains": _csv_env("RESEARCH_BLOCKED_DOMAINS"),
            "source_overrides": {},
        }

    def _ensure_default_file(self) -> None:
        if self.path.exists():
            return
        self.path.write_text(
            json.dumps(self._default_mutable_config(), ensure_ascii=True, indent=2),
            encoding="utf-8",
        )

    def _load_mutable_config(self) -> dict[str, Any]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return self._default_mutable_config()

    def _effective_config(self) -> dict[str, Any]:
        mutable = self._load_mutable_config()
        env_allowed = _csv_env("RESEARCH_ALLOWED_DOMAINS")
        env_prefixes = [_normalize_url_prefix(value) for value in _csv_env_raw("RESEARCH_ALLOWED_PREFIXES")]
        env_blocked = _csv_env("RESEARCH_BLOCKED_DOMAINS")

        allowed_domains = {
            _normalize_domain(domain)
            for domain in [*mutable.get("allowed_domains", []), *env_allowed]
            if _normalize_domain(domain)
        }
        blocked_domains = {
            _normalize_domain(domain)
            for domain in [*DEFAULT_BLOCKED_DOMAINS, *mutable.get("blocked_domains", []), *env_blocked]
            if _normalize_domain(domain)
        }
        allowed_prefixes = {
            _normalize_url_prefix(prefix)
            for prefix in [*mutable.get("allowed_prefixes", []), *env_prefixes]
            if _normalize_url_prefix(prefix)
        }

        source_overrides = {
            _normalize_domain(domain): details
            for domain, details in {**DEFAULT_SOURCE_REGISTRY, **mutable.get("source_overrides", {})}.items()
            if _normalize_domain(domain)
        }

        return {
            "require_allowed_sources": bool(mutable.get("require_allowed_sources", False)),
            "require_license_metadata": bool(mutable.get("require_license_metadata", False)),
            "allowed_domains": sorted(allowed_domains),
            "allowed_prefixes": sorted(allowed_prefixes),
            "blocked_domains": sorted(blocked_domains),
            "source_overrides": source_overrides,
        }

    def update(self, payload: dict[str, Any]) -> dict[str, Any]:
        current = self._load_mutable_config()
        for key in ("require_allowed_sources", "require_license_metadata"):
            if key in payload and payload[key] is not None:
                current[key] = bool(payload[key])
        for key in ("allowed_domains", "allowed_prefixes", "blocked_domains"):
            if key in payload and payload[key] is not None:
                if key == "allowed_prefixes":
                    current[key] = [
                        _normalize_url_prefix(value)
                        for value in payload[key]
                        if _normalize_url_prefix(value)
                    ]
                else:
                    current[key] = [
                        _normalize_domain(value)
                        for value in payload[key]
                        if _normalize_domain(value)
                    ]
        if "source_overrides" in payload and payload["source_overrides"] is not None:
            current["source_overrides"] = {
                _normalize_domain(domain): details
                for domain, details in payload["source_overrides"].items()
                if _normalize_domain(domain)
            }
        self.path.write_text(json.dumps(current, ensure_ascii=True, indent=2), encoding="utf-8")
        return self.status()

    def status(self) -> dict[str, Any]:
        config = self._effective_config()
        return {
            "require_allowed_sources": config["require_allowed_sources"],
            "require_license_metadata": config["require_license_metadata"],
            "allowed_domains": config["allowed_domains"],
            "allowed_prefixes": config["allowed_prefixes"],
            "blocked_domains": config["blocked_domains"],
            "source_override_count": len(config["source_overrides"]),
            "source_overrides": config["source_overrides"],
            "policy_path": str(self.path),
        }

    def evaluate_url(self, url: str) -> dict[str, Any]:
        config = self._effective_config()
        parsed = urlparse(url)
        domain = _normalize_domain(parsed.hostname or "")

        matched_override_domain = next(
            (candidate for candidate in config["source_overrides"] if _domain_matches(domain, candidate)),
            None,
        )
        override = config["source_overrides"].get(matched_override_domain or "", {})
        matched_allowed_domain = next(
            (candidate for candidate in config["allowed_domains"] if _domain_matches(domain, candidate)),
            None,
        )
        matched_blocked_domain = next(
            (candidate for candidate in config["blocked_domains"] if _domain_matches(domain, candidate)),
            None,
        )
        matched_allowed_prefix = next(
            (candidate for candidate in config["allowed_prefixes"] if url.startswith(candidate)),
            None,
        )

        license_name = (override.get("license") or "unknown").strip() if isinstance(override, dict) else "unknown"
        allowed = True
        reason = "default_allow"

        if matched_blocked_domain:
            allowed = False
            reason = f"blocked_domain:{matched_blocked_domain}"
        elif isinstance(override, dict) and "allowed" in override:
            allowed = bool(override.get("allowed"))
            reason = f"override:{matched_override_domain or domain or 'unknown'}"
        elif matched_allowed_domain:
            allowed = True
            reason = f"allowed_domain:{matched_allowed_domain}"
        elif matched_allowed_prefix:
            allowed = True
            reason = f"allowed_prefix:{matched_allowed_prefix}"
        elif config["require_allowed_sources"]:
            allowed = False
            reason = "missing_allowlist_match"

        if allowed and config["require_license_metadata"] and license_name == "unknown":
            allowed = False
            reason = "missing_license_metadata"

        return {
            "url": url,
            "domain": domain,
            "allowed": allowed,
            "reason": reason,
            "matched_allowed_domain": matched_allowed_domain,
            "matched_blocked_domain": matched_blocked_domain,
            "matched_allowed_prefix": matched_allowed_prefix,
            "provenance": {
                "category": override.get("category", "unknown") if isinstance(override, dict) else "unknown",
                "license": license_name,
                "trust": override.get("trust", "unknown") if isinstance(override, dict) else "unknown",
                "notes": override.get("notes", "") if isinstance(override, dict) else "",
                "override_domain": matched_override_domain,
            },
        }

    def filter_urls(self, urls: list[str]) -> tuple[list[str], list[dict[str, Any]]]:
        accepted: list[str] = []
        decisions: list[dict[str, Any]] = []
        seen: set[str] = set()
        for url in urls:
            if not url or url in seen:
                continue
            seen.add(url)
            decision = self.evaluate_url(url)
            decisions.append(decision)
            if decision["allowed"]:
                accepted.append(url)
        return accepted, decisions


SOURCE_POLICY = ResearchSourcePolicy()
