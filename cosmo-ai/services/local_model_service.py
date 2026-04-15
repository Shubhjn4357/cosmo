from __future__ import annotations

import base64
import os
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

import httpx
from loguru import logger


class LocalModelError(RuntimeError):
    pass


LOCAL_ADAPTER_SPECS: dict[str, dict[str, Any]] = {
    "mimo": {
        "base_url_env": "LOCAL_MIMO_BASE_URL",
        "command_env": "LOCAL_MIMO_COMMAND_TEMPLATE",
        "command_cwd_env": "LOCAL_MIMO_COMMAND_CWD",
        "model_env": "LOCAL_MIMO_MODEL_ID",
        "api_key_env": "LOCAL_MIMO_API_KEY",
        "default_model": "XiaomiMiMo/MiMo-V2-Flash",
        "default_port": 8001,
        "label": "MiMo",
    },
    "glm_ocr": {
        "base_url_env": "LOCAL_GLM_OCR_BASE_URL",
        "command_env": "LOCAL_GLM_OCR_COMMAND_TEMPLATE",
        "command_cwd_env": "LOCAL_GLM_OCR_COMMAND_CWD",
        "model_env": "LOCAL_GLM_OCR_MODEL_ID",
        "api_key_env": "LOCAL_GLM_OCR_API_KEY",
        "default_model": "zai-org/GLM-OCR",
        "default_port": 8002,
        "label": "GLM-OCR",
    },
    "personaplex": {
        "base_url_env": "PERSONAPLEX_ENDPOINT_URL",
        "command_env": "",
        "command_cwd_env": "",
        "model_env": "PERSONAPLEX_MODEL_ID",
        "api_key_env": "PERSONAPLEX_AUTH_TOKEN",
        "default_model": "nvidia/personaplex-7b-v1",
        "default_port": 8003,
        "label": "PersonaPlex",
    },
}


def _timeout_seconds() -> float:
    return float(os.getenv("COSMO_LOCAL_MODEL_TIMEOUT", "180"))


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/chat/completions"
    return f"{normalized}/v1/chat/completions"


def _default_base_urls(port: int) -> list[str]:
    return [
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
    ]


def _endpoint_reachable(base_url: str) -> bool:
    normalized = (base_url or "").strip()
    if not normalized:
        return False

    try:
        parsed = urlparse(normalized if "://" in normalized else f"http://{normalized}")
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme == "https" else 80
        with socket.create_connection((host, port), timeout=0.35):
            return True
    except Exception:
        return False


def resolve_local_adapter(adapter_id: str) -> dict[str, Any]:
    spec = LOCAL_ADAPTER_SPECS[adapter_id]
    base_url_env = spec["base_url_env"]
    command_env = spec["command_env"]
    command_cwd_env = spec["command_cwd_env"]
    model_env = spec["model_env"]
    api_key_env = spec["api_key_env"]
    default_base_urls = _default_base_urls(int(spec["default_port"]))

    configured_base = os.getenv(base_url_env, "").strip()
    command_template = os.getenv(command_env, "").strip() if command_env else ""
    command_cwd = os.getenv(command_cwd_env, "").strip() if command_cwd_env else ""
    model_name = os.getenv(model_env, spec["default_model"]).strip() or spec["default_model"]
    api_key = os.getenv(api_key_env, "").strip() or None

    base_url = configured_base
    source = "none"
    reachable = False

    if configured_base:
        source = "env"
        reachable = _endpoint_reachable(configured_base)
    else:
        for candidate in default_base_urls:
            if _endpoint_reachable(candidate):
                base_url = candidate
                source = "auto_default_port"
                reachable = True
                break

    if not source and command_template:
        source = "env_command"

    return {
        "adapter": adapter_id,
        "label": spec["label"],
        "base_url": base_url,
        "command_template": command_template,
        "command_cwd": command_cwd,
        "command_template_configured": bool(command_template),
        "configured": bool(configured_base or command_template),
        "available": bool(reachable or command_template),
        "reachable": reachable,
        "model_name": model_name,
        "api_key": api_key,
        "config_source": source or "none",
        "default_base_url": default_base_urls[0],
        "searched_base_urls": default_base_urls,
        "override_envs": [value for value in (base_url_env, command_env or None) if value],
        "timeout_seconds": _timeout_seconds(),
    }


def local_endpoint_status(
    *,
    base_url: str | None = None,
    command_template: str | None = None,
    resolved: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if resolved is not None:
        return {
            "base_url": resolved.get("base_url", ""),
            "default_base_url": resolved.get("default_base_url", ""),
            "searched_base_urls": resolved.get("searched_base_urls", []),
            "command_template_configured": bool(resolved.get("command_template")),
            "configured": bool(resolved.get("configured")),
            "available": bool(resolved.get("available")),
            "reachable": bool(resolved.get("reachable")),
            "config_source": resolved.get("config_source", "none"),
            "override_envs": resolved.get("override_envs", []),
            "timeout_seconds": _timeout_seconds(),
        }

    normalized_base = (base_url or "").strip()
    normalized_command = (command_template or "").strip()
    return {
        "base_url": normalized_base,
        "command_template_configured": bool(normalized_command),
        "configured": bool(normalized_base or normalized_command),
        "available": bool(normalized_command or _endpoint_reachable(normalized_base)),
        "reachable": _endpoint_reachable(normalized_base) if normalized_base else False,
        "config_source": "manual" if (normalized_base or normalized_command) else "none",
        "override_envs": [],
        "timeout_seconds": _timeout_seconds(),
    }


async def invoke_openai_compatible_chat(
    *,
    base_url: str,
    model: str,
    messages: list[dict[str, Any]],
    max_tokens: int = 256,
    temperature: float = 0.7,
    top_p: float = 0.9,
    api_key: str | None = None,
) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
    }

    url = _chat_completions_url(base_url)
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
    except Exception as exc:
        logger.warning(f"Local chat endpoint failed at {url}: {exc}")
        raise LocalModelError(str(exc)) from exc

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise LocalModelError(f"Local endpoint {url} returned no choices")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = str(item.get("text") or "").strip()
                if text:
                    parts.append(text)
        content = "\n".join(parts)

    text = str(content or "").strip()
    return {
        "text": text,
        "model_used": model,
        "backend": "local_endpoint",
        "endpoint": url,
    }


async def invoke_openai_compatible_ocr(
    *,
    base_url: str,
    model: str,
    image_bytes: bytes,
    prompt: str = "Extract all readable text from this image. Preserve line breaks when possible.",
    api_key: str | None = None,
) -> dict[str, Any]:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
            ],
        }
    ]
    return await invoke_openai_compatible_chat(
        base_url=base_url,
        model=model,
        messages=messages,
        max_tokens=512,
        temperature=0.0,
        top_p=1.0,
        api_key=api_key,
    )


async def invoke_audio_endpoint(
    *,
    url: str,
    audio_bytes: bytes,
    filename: str,
    fields: Mapping[str, Any] | None = None,
    bearer_token: str | None = None,
) -> tuple[bytes, str, dict[str, Any] | None]:
    headers: dict[str, str] = {}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    files = {"audio": (filename, audio_bytes, "audio/wav")}
    data = {key: str(value) for key, value in (fields or {}).items() if value is not None}

    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            response = await client.post(url, headers=headers, data=data, files=files)
            response.raise_for_status()
    except Exception as exc:
        logger.warning(f"Audio endpoint failed at {url}: {exc}")
        raise LocalModelError(str(exc)) from exc

    content_type = response.headers.get("content-type", "application/octet-stream")
    if "application/json" in content_type:
        payload = response.json()
        audio_base64 = payload.get("audio_base64") or payload.get("audio")
        if audio_base64:
            return base64.b64decode(audio_base64), payload.get("content_type", "audio/mpeg"), payload
        audio_url = payload.get("audio_url") or payload.get("url")
        if audio_url:
            async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
                download = await client.get(audio_url)
                download.raise_for_status()
            return download.content, download.headers.get("content-type", "audio/mpeg"), payload
        raise LocalModelError(f"Audio endpoint {url} returned JSON without audio content")

    return response.content, content_type, None


def run_local_command_template(
    *,
    command_template: str,
    values: Mapping[str, Any],
    cwd: str | None = None,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    timeout = timeout_seconds or _timeout_seconds()
    format_values = {
        "python": sys.executable,
        **{key: str(value) for key, value in values.items()},
    }
    try:
        command = command_template.format_map(format_values)
    except KeyError as exc:
        raise LocalModelError(f"Missing command template value: {exc}") from exc

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd or None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=max(30, int(timeout)),
        )
    except Exception as exc:
        raise LocalModelError(str(exc)) from exc

    output = (result.stdout or "").strip()
    if result.returncode != 0:
        error_text = (result.stderr or output or f"Command failed with exit code {result.returncode}").strip()
        raise LocalModelError(error_text)

    return {
        "text": output,
        "backend": "local_command",
        "command": command,
        "cwd": str(Path(cwd).resolve()) if cwd else "",
    }
