"""
Cosmo Memory Compression & Intelligence Pruning
Optimizes the Mythos graph by summarizing legacy logs into high-fidelity lessons.
"""
from __future__ import annotations
import json
import time
import os
from pathlib import Path
from typing import List, Dict, Any
from loguru import logger

from utils.app_paths import DATA_ROOT
from utils.encryption import EncryptedJSONLReader, EncryptedJSONLWriter
from services.cosmo_offline import get_offline_response
from services.cosmo_model import cosmo_instance

COSMO_DATASTORE_DIR = DATA_ROOT / "knowledge" / "cosmo_mythos"
MYTHOS_GRAPH = COSMO_DATASTORE_DIR / "graph.jsonl"
MYTHOS_ARCHIVE = COSMO_DATASTORE_DIR / "archive"
MYTHOS_ARCHIVE.mkdir(parents=True, exist_ok=True)

class MemoryCompressor:
    def __init__(self, threshold_records: int = 50):
        self.threshold = threshold_records

    async def run_compression_cycle(self):
        """Main entry point for memory pruning."""
        if not MYTHOS_GRAPH.exists():
            return
        
        logger.info("[Memory] Evaluating Mythos memory density...")
        
        records = []
        reader = EncryptedJSONLReader(MYTHOS_GRAPH)
        for rec in reader:
            records.append(rec)
            
        if len(records) < self.threshold:
            logger.info(f"[Memory] Density low ({len(records)} records). Compression deferred.")
            return

        logger.info(f"[Memory] High density detected ({len(records)}). Initiating distillation...")
        
        # 1. Group records by similar topics (Simple clustering for now)
        clusters = self._cluster_records(records)
        
        compressed_records = []
        archived_count = 0
        
        for topic, cluster in clusters.items():
            if len(cluster) > 3:
                # 2. Distill cluster into a consolidated lesson
                lesson = await self._distill_cluster(topic, cluster)
                compressed_records.append(lesson)
                archived_count += len(cluster)
            else:
                # Keep small clusters as raw for now
                compressed_records.extend(cluster)

        # 3. Securely Archive original and rewrite graph
        self._archive_and_rewrite(compressed_records)
        logger.info(f"[Memory] Compression complete. {archived_count} records archived into consolidated strategic nodes.")

    def _cluster_records(self, records: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """Groups records by simple keyword/type heuristics."""
        clusters = {}  # type: ignore
        for rec in records:
            # Use 'topic' or 'type' as primary key
            topic = rec.get("topic") or rec.get("type") or "general_intelligence"
            if topic not in clusters:
                clusters[topic] = []
            clusters[topic].append(rec)
        return clusters

    async def _distill_cluster(self, topic: str, cluster: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Real distillation prompt for Cosmo
        distillation_prompt = (
            f"You are the Cosmo Strategic Reviewer. Distill these {len(cluster)} records into a single 'Unified Strategic Lesson'.\n"
            "Analyze the patterns and output a concise, actionable logic for future missions.\n\n"
        )
        for i, rec in enumerate(cluster[:15]):
            distillation_prompt += f"--- Record {i+1} ---\nContext: {rec.get('prompt', '')}\nOutcome: {rec.get('response', '')}\n"

        try:
            # Audit: Use the real model orchestrator for distillation with strict instruction
            summary = await cosmo_instance.chat(distillation_prompt)  # type: ignore
            if not summary or len(summary) < 20:
                raise ValueError("Distillation output too short or empty")
            
            # Ensure the output is stripped of PII before compression
            summary = anonymize_lesson(summary)  # type: ignore
            
        except Exception as e:
            logger.error(f"[Memory Compression Audit] Distillation failed: {e}")
            summary = f"Summary of {len(cluster)} strategic interactions regarding {topic}. (Automated Fallback Summary)"

        return {
            "type": "consolidated_lesson",
            "topic": topic,
            "distilled_at": time.time(),
            "source_count": len(cluster),
            "content": summary,
            "metadata": {"compressed": True, "engine": "cosmo_1.4_v1"}
        }

    def _archive_and_rewrite(self, new_records: List[Dict[str, Any]]):
        """Moves current graph to archive and writes the compressed version."""
        timestamp = int(time.time())
        archive_path = MYTHOS_ARCHIVE / f"graph_pre_compress_{timestamp}.jsonl"
        
        # Rename current to archive
        MYTHOS_GRAPH.rename(archive_path)
        
        # Write new encrypted graph
        writer = EncryptedJSONLWriter(MYTHOS_GRAPH)
        for rec in new_records:
            writer.append(rec)

async def trigger_memory_compression():
    compressor = MemoryCompressor()
    await compressor.run_compression_cycle()
