"""
Curated dataset import and normalization helpers.

This service downloads public Hugging Face datasets or remote CSV/JSON/JSONL
files, normalizes them into local JSONL corpora, and optionally syncs the
prepared files to the configured HF dataset repo.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

from loguru import logger
import requests

from services import hf_dataset_sync
from utils.app_paths import DATASETS_DIR, ensure_app_dirs

try:
    from datasets import Dataset, DatasetDict, IterableDataset, IterableDatasetDict, load_dataset  # type: ignore

    DATASETS_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    class _MissingDatasetsType:
        pass

    Dataset = DatasetDict = IterableDataset = IterableDatasetDict = _MissingDatasetsType
    load_dataset = None
    DATASETS_AVAILABLE = False


# ensure_app_dirs() - Moved to app.py

CURATED_ROOT = DATASETS_DIR / "curated"
CURATED_TEXT_DIR = CURATED_ROOT / "text"
CURATED_IMAGE_PROMPT_DIR = CURATED_ROOT / "image_prompts"
CURATED_VISION_DIR = CURATED_ROOT / "vision"
CURATED_VISION_ASSETS_DIR = CURATED_VISION_DIR / "assets"
CURATED_MANIFEST_PATH = CURATED_ROOT / "manifest.json"
CURATED_TEXT_DIR.mkdir(parents=True, exist_ok=True)
CURATED_IMAGE_PROMPT_DIR.mkdir(parents=True, exist_ok=True)
CURATED_VISION_DIR.mkdir(parents=True, exist_ok=True)
CURATED_VISION_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_TEXT_ROWS = max(100, int(os.getenv("COSMO_CURATED_TEXT_MAX_ROWS", "25000")))
DEFAULT_IMAGE_PROMPT_ROWS = max(100, int(os.getenv("COSMO_CURATED_IMAGE_PROMPT_MAX_ROWS", "50000")))
HF_DATASET_VIEWER_BASE_URL = os.getenv("HF_DATASET_VIEWER_BASE_URL", "https://datasets-server.huggingface.co")


@dataclass(frozen=True)
class CuratedDatasetSpec:
    id: str
    name: str
    kind: str  # text, image_prompt, vision, or all
    source_type: str  # hf_dataset, csv_url, json_url, jsonl_url
    source: str
    config_name: str = ""
    split: str = "train"
    default_max_rows: int = DEFAULT_TEXT_ROWS
    description: str = ""


CURATED_DATASET_SPECS: tuple[CuratedDatasetSpec, ...] = (
    CuratedDatasetSpec(
        id="stable_diffusion_prompts_uncensored",
        name="Stable Diffusion Prompts Uncensored",
        kind="image_prompt",
        source_type="hf_dataset",
        source="jtatman/stable-diffusion-prompts-stats-full-uncensored",
        split="train",
        default_max_rows=DEFAULT_IMAGE_PROMPT_ROWS,
        description="Prompt corpus used as a local image prompt prior for better descriptive generations.",
    ),
    CuratedDatasetSpec(
        id="open_instruct_uncensored",
        name="Open Instruct Uncensored",
        kind="text",
        source_type="hf_dataset",
        source="QuixiAI/open-instruct-uncensored",
        split="train",
        default_max_rows=DEFAULT_TEXT_ROWS,
        description="Instruction-following uncensored chat data.",
    ),
    CuratedDatasetSpec(
        id="toxic_uncensored_lgbtq",
        name="Toxic Uncensored LGBTQ CSV",
        kind="text",
        source_type="hf_dataset",
        source="arafatar/toxic_uncensored_LGBTQ_csv",
        split="train",
        default_max_rows=min(10000, DEFAULT_TEXT_ROWS),
        description="Specialized direct style dataset imported as optional text training data.",
    ),
    CuratedDatasetSpec(
        id="ultrachat_uncensored",
        name="UltraChat Uncensored",
        kind="text",
        source_type="hf_dataset",
        source="branles14/ultrachat-uncensored",
        split="train",
        default_max_rows=DEFAULT_TEXT_ROWS,
        description="Conversation-style uncensored chat data.",
    ),
    CuratedDatasetSpec(
        id="iris_uncensored_reformat_r2",
        name="Iris Uncensored Reformat R2",
        kind="text",
        source_type="csv_url",
        source="https://huggingface.co/datasets/N-Bot-Int/Iris-Uncensored-Reformat-R2/resolve/main/cleaned_dataset.csv",
        split="train",
        default_max_rows=DEFAULT_TEXT_ROWS,
        description="Remote CSV instruction data.",
    ),
    CuratedDatasetSpec(
        id="airoboros_uncensored_conversations",
        name="Airoboros Uncensored Conversations",
        kind="text",
        source_type="json_url",
        source="https://huggingface.co/datasets/jondurbin/airoboros-uncensored/resolve/main/as_conversations.json?download=true",
        split="train",
        default_max_rows=DEFAULT_TEXT_ROWS,
        description="Conversation-form uncensored Airoboros data.",
    ),
    CuratedDatasetSpec(
        id="airoboros_uncensored_instructions",
        name="Airoboros Uncensored Instructions",
        kind="text",
        source_type="jsonl_url",
        source="https://huggingface.co/datasets/jondurbin/airoboros-uncensored/resolve/main/instructions.jsonl?download=true",
        split="train",
        default_max_rows=DEFAULT_TEXT_ROWS,
        description="Instruction-form uncensored Airoboros data.",
    ),
)

_SPEC_BY_ID = {spec.id: spec for spec in CURATED_DATASET_SPECS}
_STOPWORDS = {
    "a", "an", "and", "the", "of", "for", "with", "in", "on", "at", "to", "from",
    "into", "over", "under", "by", "is", "are", "be", "it", "this", "that", "or",
}
_SUPPORTED_IMPORT_KINDS = {"auto", "text", "image_prompt", "vision", "all", "both"}
_IMAGE_VALUE_KEYS = (
    "image_url",
    "image",
    "image_path",
    "image_file",
    "img_url",
    "img",
    "photo",
    "picture",
    "thumbnail",
    "url",
    "src",
    "file",
)
_CURATED_KIND_DIRS = {
    "text": CURATED_TEXT_DIR,
    "image_prompt": CURATED_IMAGE_PROMPT_DIR,
    "vision": CURATED_VISION_DIR,
}


def list_curated_specs() -> list[dict[str, Any]]:
    manifest = _load_manifest()
    return [
        {
            **asdict(spec),
            "output_path": _output_path(spec).as_posix(),
            "manifest": manifest.get(spec.id) or {},
        }
        for spec in CURATED_DATASET_SPECS
    ]


def get_curated_spec(spec_id: str) -> CuratedDatasetSpec:
    spec = _SPEC_BY_ID.get(spec_id)
    if spec is None:
        raise KeyError(spec_id)
    return spec


def _load_manifest() -> dict[str, Any]:
    if not CURATED_MANIFEST_PATH.exists():
        return {}
    try:
        return json.loads(CURATED_MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"Failed to read curated manifest: {exc}")
        return {}


def _save_manifest(manifest: dict[str, Any]) -> None:
    CURATED_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    CURATED_MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _output_path(spec: CuratedDatasetSpec) -> Path:
    return _output_path_for_kind(spec.kind, spec.id)


def _output_path_for_kind(kind: str, spec_id: str) -> Path:
    base_dir = _CURATED_KIND_DIRS.get(kind, CURATED_TEXT_DIR)
    return base_dir / f"{spec_id}.jsonl"


def _slugify_identifier(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())
    return slug.strip("_") or "dataset"


def _normalize_text(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()


def _normalize_role(value: Any) -> str | None:
    role = str(value or "").strip().lower()
    if role in {"user", "human", "prompt", "instruction", "question", "client"}:
        return "user"
    if role in {"assistant", "gpt", "model", "bot", "response", "answer"}:
        return "assistant"
    return None


def _normalize_turns(raw_turns: Any) -> list[tuple[str, str]]:
    if not isinstance(raw_turns, list):
        return []

    normalized: list[tuple[str, str]] = []
    for item in raw_turns:
        if isinstance(item, dict):
            role = _normalize_role(
                item.get("role") or item.get("from") or item.get("speaker") or item.get("author")
            )
            content = _normalize_text(
                item.get("content") or item.get("value") or item.get("text") or item.get("message")
            )
            if role and content:
                normalized.append((role, content))
        elif isinstance(item, str):
            content = _normalize_text(item)
            if content:
                role = "user" if len(normalized) % 2 == 0 else "assistant"
                normalized.append((role, content))
    return normalized


def _extract_pairs_from_turns(turns: list[tuple[str, str]]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for index in range(len(turns) - 1):
        role, content = turns[index]
        next_role, next_content = turns[index + 1]
        if role == "user" and next_role == "assistant":
            pairs.append((content, next_content))
    return pairs


def _extract_turn_pairs(record: dict[str, Any]) -> list[tuple[str, str]]:
    for key in ("conversations", "conversation", "messages", "chat", "dialogue", "dialog", "turns", "items"):
        pairs = _extract_pairs_from_turns(_normalize_turns(record.get(key)))
        if pairs:
            return pairs
    return []


def _value_from_keys(record: dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        if key in record:
            text = _normalize_text(record.get(key))
            if text:
                return text
    return ""


def _extract_prompt_response(record: dict[str, Any]) -> tuple[str, str]:
    candidate_mappings = (
        (("prompt",), ("response", "output", "answer", "completion")),
        (("instruction", "input"), ("output", "response", "answer")),
        (("instruction",), ("output", "response", "answer", "completion")),
        (("question",), ("answer", "response")),
        (("user", "human"), ("assistant", "bot", "model")),
        (("query",), ("reply", "response", "answer")),
    )
    for prompt_keys, response_keys in candidate_mappings:
        prompt = _value_from_keys(record, prompt_keys)
        response = _value_from_keys(record, response_keys)
        if prompt and response:
            return prompt, response
    return "", ""


def _extract_any_text(record: dict[str, Any]) -> str:
    for key in ("text", "content", "body", "document", "markdown", "article"):
        text = _normalize_text(record.get(key))
        if text and len(text) >= 32:
            return text
    return ""


def _extract_text_records(record: dict[str, Any], spec: CuratedDatasetSpec) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []

    for prompt, response in _extract_turn_pairs(record):
        output.append(
            {
                "prompt": prompt,
                "response": response,
                "source": spec.source,
                "dataset_id": spec.id,
            }
        )

    if output:
        return output

    prompt, response = _extract_prompt_response(record)
    if prompt and response:
        return [
            {
                "prompt": prompt,
                "response": response,
                "source": spec.source,
                "dataset_id": spec.id,
            }
        ]

    text = _extract_any_text(record)
    if text:
        return [
            {
                "prompt": f"Summarize or continue this {spec.name} sample.",
                "response": text,
                "source": spec.source,
                "dataset_id": spec.id,
            }
        ]

    return []


def _extract_image_prompt(record: dict[str, Any]) -> str:
    candidates = [
        _value_from_keys(record, ("prompt", "positive_prompt", "caption", "text", "description")),
        _extract_any_text(record),
    ]
    for prompt in candidates:
        if prompt and len(prompt) >= 12:
            return prompt
    return ""


def _extract_image_value(record: dict[str, Any]) -> Any | None:
    for key in _IMAGE_VALUE_KEYS:
        if key not in record:
            continue
        value = record.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, dict) and not value:
            continue
        return value
    return None


def _save_image_asset(spec_id: str, image_bytes: bytes, *, suffix: str = ".png") -> str:
    if not image_bytes:
        return ""
    safe_suffix = suffix if suffix.startswith(".") else f".{suffix}"
    digest = hashlib.sha1(image_bytes).hexdigest()
    asset_dir = CURATED_VISION_ASSETS_DIR / _slugify_identifier(spec_id)
    asset_dir.mkdir(parents=True, exist_ok=True)
    asset_path = asset_dir / f"{digest[:20]}{safe_suffix}"
    if not asset_path.exists():
        asset_path.write_bytes(image_bytes)
    return str(asset_path.resolve())


def _coerce_image_reference(spec_id: str, value: Any, *, persist_assets: bool = True) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return ""
        lowered = candidate.lower()
        if candidate.startswith(("http://", "https://")):
            return candidate
        if candidate.startswith("data:image/") and "," in candidate:
            if not persist_assets:
                return "__inline_image__"
            header, encoded = candidate.split(",", 1)
            extension = ".png"
            if "/" in header and ";" in header:
                extension = f".{header.split('/', 1)[1].split(';', 1)[0].strip() or 'png'}"
            try:
                import base64

                return _save_image_asset(spec_id, base64.b64decode(encoded), suffix=extension)
            except Exception:
                return ""
        path_candidate = Path(candidate)
        if path_candidate.exists():
            return str(path_candidate.resolve())
        if lowered.startswith("/static/") or lowered.startswith("/uploads/"):
            return candidate
        return ""

    if isinstance(value, (bytes, bytearray)):
        if not persist_assets:
            return "__inline_image__"
        return _save_image_asset(spec_id, bytes(value))

    if isinstance(value, dict):
        for key in ("image_url", "url", "src", "path", "filename", "file_name"):
            ref = _coerce_image_reference(spec_id, value.get(key), persist_assets=persist_assets)
            if ref:
                return ref
        raw_bytes = value.get("bytes")
        if raw_bytes is not None:
            return _coerce_image_reference(spec_id, raw_bytes, persist_assets=persist_assets)
        return ""

    if hasattr(value, "save"):
        if not persist_assets:
            return "__inline_image__"
        try:
            buffer = io.BytesIO()
            image_format = str(getattr(value, "format", "") or "PNG").upper()
            value.save(buffer, format=image_format)
            return _save_image_asset(spec_id, buffer.getvalue(), suffix=f".{image_format.lower()}")
        except Exception:
            return ""

    return ""


def _extract_vision_record(
    record: dict[str, Any],
    spec: CuratedDatasetSpec,
    *,
    prompt: str | None = None,
    persist_assets: bool = True,
) -> dict[str, Any] | None:
    image_reference = _coerce_image_reference(spec.id, _extract_image_value(record), persist_assets=persist_assets)
    if not image_reference:
        return None

    text_representation = str(prompt or _extract_image_prompt(record) or "").strip()
    if not text_representation:
        text_representation = f"Imported visual sample from {spec.source}"

    payload: dict[str, Any] = {
        "text": text_representation,
        "source": spec.source,
        "dataset_id": spec.id,
        "config_name": spec.config_name,
        "split": spec.split,
        "metadata": {
            "source_type": spec.source_type,
        },
    }
    if image_reference.startswith(("http://", "https://", "/static/", "/uploads/")):
        payload["image_url"] = image_reference
    else:
        payload["image_path"] = image_reference
    return payload


def _iter_dataset_rows(dataset: Any, max_rows: int) -> Iterator[dict[str, Any]]:
    yielded = 0

    if isinstance(dataset, (DatasetDict, IterableDatasetDict)):
        split_name = next(iter(dataset.keys()))
        dataset = dataset[split_name]

    if isinstance(dataset, Dataset):
        length = min(len(dataset), max_rows)
        for index in range(length):
            row = dataset[index]
            if isinstance(row, dict):
                yielded += 1
                yield row
        return

    for row in dataset:
        if yielded >= max_rows:
            break
        if isinstance(row, dict):
            yielded += 1
            yield row


def _hf_headers() -> dict[str, str]:
    token = hf_dataset_sync.get_hf_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


def _viewer_get_json(path: str, *, params: dict[str, Any]) -> dict[str, Any]:
    response = requests.get(
        f"{HF_DATASET_VIEWER_BASE_URL}{path}",
        params=params,
        headers=_hf_headers(),
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(str(payload["error"]))
    return payload


def _fallback_hf_dataset_rows(spec: CuratedDatasetSpec, max_rows: int) -> Iterator[dict[str, Any]]:
    splits_payload = _viewer_get_json("/splits", params={"dataset": spec.source})
    splits = splits_payload.get("splits") or []
    if not splits:
        raise RuntimeError(f"No splits were returned for dataset '{spec.source}'")

    preferred_config = str(spec.config_name or "").strip()
    preferred_split = str(spec.split or "").strip() or "train"

    split_record = None
    if preferred_config:
        split_record = next(
            (
                item
                for item in splits
                if item.get("config") == preferred_config and item.get("split") == preferred_split
            ),
            None,
        )
        if split_record is None:
            split_record = next((item for item in splits if item.get("config") == preferred_config), None)

    if split_record is None:
        split_record = next((item for item in splits if item.get("split") == preferred_split), splits[0])

    config = split_record.get("config")
    split = split_record.get("split") or preferred_split
    if not config or not split:
        raise RuntimeError(f"Could not resolve config/split for dataset '{spec.source}'")

    offset = 0
    remaining = max_rows
    while remaining > 0:
        page = min(100, remaining)
        rows_payload = _viewer_get_json(
            "/rows",
            params={
                "dataset": spec.source,
                "config": config,
                "split": split,
                "offset": offset,
                "length": page,
            },
        )
        rows = rows_payload.get("rows") or []
        if not rows:
            break

        emitted = 0
        for item in rows:
            row = item.get("row") if isinstance(item, dict) else None
            if isinstance(row, dict):
                emitted += 1
                yield row

        if emitted <= 0:
            break
        offset += emitted
        remaining -= emitted


def _fallback_remote_rows(spec: CuratedDatasetSpec, max_rows: int) -> Iterator[dict[str, Any]]:
    if spec.source_type == "hf_dataset":
        yield from _fallback_hf_dataset_rows(spec, max_rows)
        return

    response = requests.get(spec.source, headers=_hf_headers(), timeout=120)
    response.raise_for_status()

    if spec.source_type == "csv_url":
        reader = csv.DictReader(io.StringIO(response.text))
        for index, row in enumerate(reader):
            if index >= max_rows:
                break
            if isinstance(row, dict):
                yield row
        return

    if spec.source_type == "json_url":
        payload = response.json()
        if isinstance(payload, list):
            for index, row in enumerate(payload):
                if index >= max_rows:
                    break
                if isinstance(row, dict):
                    yield row
            return
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, list):
                    for index, row in enumerate(value):
                        if index >= max_rows:
                            break
                        if isinstance(row, dict):
                            yield row
                    return
        raise RuntimeError(f"Unsupported JSON payload shape for '{spec.source}'")

    if spec.source_type == "jsonl_url":
        emitted = 0
        for line in response.text.splitlines():
            if emitted >= max_rows:
                break
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                emitted += 1
                yield row
        return

    raise ValueError(f"Unsupported source_type '{spec.source_type}'")


def _load_source_dataset(spec: CuratedDatasetSpec):
    if not DATASETS_AVAILABLE:
        logger.warning(
            "datasets package is not installed; falling back to HTTP import for '{}'",
            spec.source,
        )
        return None

    if spec.source_type == "hf_dataset":
        load_kwargs: dict[str, Any] = {"trust_remote_code": True}
        if spec.config_name:
            load_kwargs["name"] = spec.config_name
        try:
            return load_dataset(spec.source, split=spec.split, **load_kwargs)
        except Exception:
            return load_dataset(spec.source, **load_kwargs)

    if spec.source_type == "csv_url":
        return load_dataset("csv", data_files={"train": spec.source}, split="train")

    if spec.source_type in {"json_url", "jsonl_url"}:
        return load_dataset("json", data_files={"train": spec.source}, split="train")

    raise ValueError(f"Unsupported source_type '{spec.source_type}'")


def _detect_dataset_modalities(spec: CuratedDatasetSpec, max_rows: int) -> list[str]:
    row_limit = max(1, min(max_rows, 48))
    dataset = _load_source_dataset(spec)
    row_source: Iterator[dict[str, Any]]
    if dataset is None:
        row_source = _fallback_remote_rows(spec, row_limit)
    else:
        row_source = _iter_dataset_rows(dataset, row_limit)

    text_score = 0
    image_prompt_score = 0
    vision_score = 0
    for row in row_source:
        text_records = _extract_text_records(row, spec)
        if text_records:
            text_score += len(text_records)
        prompt = _extract_image_prompt(row)
        if prompt:
            image_prompt_score += 1
        if _extract_vision_record(row, spec, prompt=prompt, persist_assets=False):
            vision_score += 1

    detected: list[str] = []
    if text_score > 0:
        detected.append("text")
    if image_prompt_score > 0:
        detected.append("image_prompt")
    if vision_score > 0:
        detected.append("vision")
    return detected or ["text"]


def _resolve_requested_modalities(requested_kind: str, detected_modalities: list[str]) -> list[str]:
    normalized = "all" if requested_kind == "both" else requested_kind
    if normalized == "auto":
        return detected_modalities
    if normalized == "all":
        return ["text", "image_prompt", "vision"]
    if normalized in {"text", "image_prompt", "vision"}:
        return [normalized]
    raise ValueError("kind must be one of: auto, text, image_prompt, vision, all")


def _resolved_kind_label(modalities: list[str]) -> str:
    if len(modalities) == 1:
        return modalities[0]
    return "all"


def _import_dataset_spec(
    spec: CuratedDatasetSpec,
    *,
    max_rows: int | None = None,
    auto_sync: bool = False,
    requested_kind: str | None = None,
    resolved_modalities: list[str] | None = None,
) -> dict[str, Any]:
    row_limit = max_rows or spec.default_max_rows
    dataset = _load_source_dataset(spec)
    row_source: Iterator[dict[str, Any]]
    if dataset is None:
        row_source = _fallback_remote_rows(spec, row_limit)
    else:
        row_source = _iter_dataset_rows(dataset, row_limit)

    selected_modalities = resolved_modalities or [spec.kind]
    output_paths = {kind: _output_path_for_kind(kind, spec.id) for kind in selected_modalities}
    for path in output_paths.values():
        path.parent.mkdir(parents=True, exist_ok=True)

    imported_rows = 0
    skipped_rows = 0
    counts_by_kind = {kind: 0 for kind in selected_modalities}

    with ExitStack() as stack:
        handles = {
            kind: stack.enter_context(path.open("w", encoding="utf-8"))
            for kind, path in output_paths.items()
        }
        for row in row_source:
            wrote_any = False
            prompt = _extract_image_prompt(row) if ("image_prompt" in handles or "vision" in handles) else ""

            if "text" in handles:
                text_records = _extract_text_records(row, spec)
                for record in text_records:
                    handles["text"].write(json.dumps(record, ensure_ascii=False) + "\n")
                    counts_by_kind["text"] += 1
                    imported_rows += 1
                    wrote_any = True

            if "image_prompt" in handles and prompt:
                handles["image_prompt"].write(
                    json.dumps(
                        {
                            "prompt": prompt,
                            "source": spec.source,
                            "dataset_id": spec.id,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                counts_by_kind["image_prompt"] += 1
                imported_rows += 1
                wrote_any = True

            if "vision" in handles:
                vision_record = _extract_vision_record(row, spec, prompt=prompt)
                if vision_record:
                    handles["vision"].write(json.dumps(vision_record, ensure_ascii=False) + "\n")
                    counts_by_kind["vision"] += 1
                    imported_rows += 1
                    wrote_any = True

            if not wrote_any:
                skipped_rows += 1

    sync_result: dict[str, Any] | None = None
    size_by_kind: dict[str, int] = {}
    for kind, path in output_paths.items():
        if counts_by_kind.get(kind, 0) <= 0:
            if path.exists():
                path.unlink()
            continue
        size_by_kind[kind] = path.stat().st_size if path.exists() else 0

    if auto_sync and hf_dataset_sync.is_configured():
        sync_result = {}
        for kind, path in output_paths.items():
            if counts_by_kind.get(kind, 0) <= 0 or not path.exists() or path.stat().st_size <= 0:
                continue
            sync_result[kind] = hf_dataset_sync.sync_path(path)

    manifest = _load_manifest()
    resolved_kind = _resolved_kind_label(selected_modalities)
    manifest[spec.id] = {
        "id": spec.id,
        "kind": resolved_kind,
        "modalities": selected_modalities,
        "requested_kind": requested_kind or resolved_kind,
        "source": spec.source,
        "source_type": spec.source_type,
        "config_name": spec.config_name,
        "split": spec.split,
        "rows_imported": imported_rows,
        "rows_imported_by_kind": counts_by_kind,
        "rows_skipped": skipped_rows,
        "output_paths": {kind: str(path) for kind, path in output_paths.items() if counts_by_kind.get(kind, 0) > 0},
        "size_bytes_by_kind": size_by_kind,
        "output_path": str(next(iter(output_paths.values()))) if len(output_paths) == 1 else None,
        "size_bytes": sum(size_by_kind.values()),
        "auto_synced": bool(sync_result),
    }
    _save_manifest(manifest)

    return {
        "status": "imported",
        "dataset": asdict(spec),
        "rows_imported": imported_rows,
        "rows_imported_by_kind": counts_by_kind,
        "rows_skipped": skipped_rows,
        "output_paths": {kind: str(path) for kind, path in output_paths.items() if counts_by_kind.get(kind, 0) > 0},
        "output_path": str(next(iter(output_paths.values()))) if len(output_paths) == 1 else None,
        "size_bytes": sum(size_by_kind.values()),
        "size_bytes_by_kind": size_by_kind,
        "sync": sync_result,
        "requested_kind": requested_kind or resolved_kind,
        "resolved_kind": resolved_kind,
        "resolved_modalities": selected_modalities,
    }


def import_curated_dataset(
    spec_id: str,
    *,
    max_rows: int | None = None,
    auto_sync: bool = False,
) -> dict[str, Any]:
    spec = get_curated_spec(spec_id)
    return _import_dataset_spec(spec, max_rows=max_rows, auto_sync=auto_sync)


def import_hf_dataset(
    dataset_id: str,
    *,
    config_name: str | None = None,
    split: str | None = "train",
    kind: str = "auto",
    max_rows: int | None = None,
    auto_sync: bool = False,
) -> dict[str, Any]:
    normalized_dataset_id = str(dataset_id or "").strip()
    if not normalized_dataset_id:
        raise ValueError("dataset_id is required")

    normalized_config = str(config_name or "").strip()
    normalized_split = str(split or "").strip() or "train"
    requested_kind = str(kind or "auto").strip().lower() or "auto"
    if requested_kind not in _SUPPORTED_IMPORT_KINDS:
        raise ValueError("kind must be one of: auto, text, image_prompt, vision, all")

    row_limit = max_rows or DEFAULT_TEXT_ROWS
    probe_spec = CuratedDatasetSpec(
        id="hf_probe",
        name=normalized_dataset_id,
        kind="text",
        source_type="hf_dataset",
        source=normalized_dataset_id,
        config_name=normalized_config,
        split=normalized_split,
        default_max_rows=row_limit,
        description="User-supplied Hugging Face dataset probe",
    )
    detected_modalities = _detect_dataset_modalities(probe_spec, row_limit)
    resolved_modalities = _resolve_requested_modalities(requested_kind, detected_modalities)
    resolved_kind = _resolved_kind_label(resolved_modalities)

    output_id_parts = [
        "hf",
        _slugify_identifier(normalized_dataset_id),
        _slugify_identifier(normalized_split),
    ]
    if normalized_config:
        output_id_parts.append(_slugify_identifier(normalized_config))
    output_id_parts.append(_slugify_identifier(resolved_kind))

    if max_rows is None and "image_prompt" in resolved_modalities and "text" not in resolved_modalities:
        row_limit = DEFAULT_IMAGE_PROMPT_ROWS

    spec = CuratedDatasetSpec(
        id="_".join(output_id_parts),
        name=normalized_dataset_id,
        kind=resolved_kind,
        source_type="hf_dataset",
        source=normalized_dataset_id,
        config_name=normalized_config,
        split=normalized_split,
        default_max_rows=row_limit,
        description="User-imported Hugging Face dataset",
    )
    return _import_dataset_spec(
        spec,
        max_rows=max_rows,
        auto_sync=auto_sync,
        requested_kind=requested_kind,
        resolved_modalities=resolved_modalities,
    )


def import_curated_datasets(
    spec_ids: Iterable[str] | None = None,
    *,
    max_rows: int | None = None,
    auto_sync: bool = False,
) -> list[dict[str, Any]]:
    targets = list(spec_ids) if spec_ids else [spec.id for spec in CURATED_DATASET_SPECS]
    return [
        import_curated_dataset(spec_id, max_rows=max_rows, auto_sync=auto_sync)
        for spec_id in targets
    ]


def iter_curated_text_records(limit: int | None = None) -> Iterator[dict[str, Any]]:
    emitted = 0
    for path in sorted(CURATED_TEXT_DIR.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if limit is not None and emitted >= limit:
                    return
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                emitted += 1
                yield payload


def count_curated_text_records() -> int:
    return sum(1 for _ in iter_curated_text_records())


def list_local_curated_files() -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for kind, root in (("text", CURATED_TEXT_DIR), ("image_prompt", CURATED_IMAGE_PROMPT_DIR), ("vision", CURATED_VISION_DIR)):
        for path in sorted(root.glob("*.jsonl")):
            files.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "kind": kind,
                    "size_bytes": path.stat().st_size,
                }
            )
    return files


def keyword_set(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9][a-z0-9_+-]{2,}", text.lower())
        if token not in _STOPWORDS
    }
