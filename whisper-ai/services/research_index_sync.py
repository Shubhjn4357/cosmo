from __future__ import annotations

from typing import Any, Callable


def _is_research_metadata_entry(meta: dict[str, Any]) -> bool:
    source = str(meta.get("source") or "")
    if source.startswith("research:"):
        return True
    if meta.get("topic") or meta.get("domain") or meta.get("provider") or meta.get("source_url") or meta.get("url"):
        return True
    return False


def _keep_metadata_entry(meta: dict[str, Any]) -> bool:
    return not _is_research_metadata_entry(meta)


def rebuild_vector_index_with_research(
    *,
    vectordb,
    embedder,
    research_documents: list[dict[str, Any]],
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if vectordb is None or embedder is None:
        return {
            "status": "skipped",
            "reason": "knowledge_base_unavailable",
        }

    progress = progress or (lambda _message: None)
    kept_metadata = [dict(meta) for meta in getattr(vectordb, "metadata", []) if _keep_metadata_entry(meta)]
    progress(f"Retaining {len(kept_metadata)} non-research vector chunks")

    vectordb.clear()

    if kept_metadata:
        kept_texts = [str(meta.get("text") or "") for meta in kept_metadata]
        kept_embeddings = embedder.embed(kept_texts)
        vectordb.add(kept_embeddings, kept_texts, kept_metadata)
        progress(f"Reindexed {len(kept_metadata)} retained vector chunks")

    research_chunk_count = 0
    for document in research_documents:
        text = str(document.get("text") or "")
        if len(text) < 100:
            continue
        source = str(document.get("source") or f"research:{document.get('topic') or 'unknown'}:{document.get('domain') or 'unknown'}")
        metadata = {
            "topic": document.get("topic"),
            "domain": document.get("domain"),
            "provider": document.get("provider"),
            "source_url": document.get("source_url"),
            "url": document.get("url"),
        }
        words = text.split()
        chunk_size = 256
        overlap = 32
        start = 0
        chunk_index = 0
        chunk_texts: list[str] = []
        chunk_metadata: list[dict[str, Any]] = []
        while start < len(words):
            chunk_words = words[start:start + chunk_size]
            if not chunk_words:
                break
            chunk_text = " ".join(chunk_words)
            chunk_texts.append(chunk_text)
            chunk_metadata.append(
                {
                    "source": source,
                    "chunk_idx": chunk_index,
                    "start_word": start,
                    **metadata,
                }
            )
            start += chunk_size - overlap
            chunk_index += 1
        if chunk_texts:
            embeddings = embedder.embed(chunk_texts)
            vectordb.add(embeddings, chunk_texts, chunk_metadata)
            research_chunk_count += len(chunk_texts)

    vectordb.save()
    progress(f"Reindexed {research_chunk_count} research vector chunks")
    return {
        "status": "rebuilt",
        "retained_chunks": len(kept_metadata),
        "research_chunks": research_chunk_count,
        "total_vectors": vectordb.get_stats().get("total_vectors", 0),
    }
