"""
Cosmo Specialized Distillation Service
Extracts "Constitutional Lessons" from Mythos Memory for fine-tuning.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
from loguru import logger

from utils.app_paths import DATA_ROOT
from utils.encryption import EncryptedJSONLReader
from utils.anonymizer import anonymize_lesson
from services.system_jobs import start_training_job

TRAINING_PAIRS_PATH = DATA_ROOT / "training_pairs.jsonl"
COSMO_DATASTORE_DIR = DATA_ROOT / "knowledge" / "cosmo_mythos"
MYTHOS_GRAPH = COSMO_DATASTORE_DIR / "graph.jsonl"

def distill_memory_to_training(app_state, steps: int = 100) -> dict:
    """
    Parses encrypted Mythos memory, appends new lessons to the training corpus,
    and triggers the self-learner training job.
    """
    if not MYTHOS_GRAPH.exists():
        logger.info("[Distillation] No Mythos memory graph found at {}", MYTHOS_GRAPH)
        return {"success": False, "message": "No Mythos memory found."}

    added_count = 0
    try:
        # Load existing inputs to prevent simple duplicates
        existing_inputs = set()
        if TRAINING_PAIRS_PATH.exists():
            with TRAINING_PAIRS_PATH.open("r", encoding="utf-8") as f:
                for line in f:
                    try:
                        existing_inputs.add(json.loads(line).get("input"))
                    except: continue

        reader = EncryptedJSONLReader(MYTHOS_GRAPH)
        new_records = []
        
        for entry in reader:
            prompt = ""
            response = ""
            
            # Specialized parsing for "Reviewer" distillation
            if entry.get("type") == "business_lesson":
                prompt = f"Critique this task execution: {entry.get('task')}"
                response = f"Constitutional Critique: {entry.get('critique')}"
            elif "prompt" in entry and "response" in entry:
                prompt = entry["prompt"]
                response = entry["response"]
            
            if prompt and response and prompt not in existing_inputs:
                new_records.append({
                    "input": anonymize_lesson(prompt),
                    "output": anonymize_lesson(response),
                    "source": "mythos:distillation",
                    "timestamp": time.time(),
                    "metadata": {"logic": "constitutional_distillation", "anonymized": True}
                })
                existing_inputs.add(prompt)
                added_count += 1

        if added_count == 0:
            return {"success": False, "message": "No new unique lessons found for distillation."}

        with TRAINING_PAIRS_PATH.open("a", encoding="utf-8") as f:
            for record in new_records:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

        logger.info(f"[Distillation] Successfully injected {added_count} learned records into transformer training pipeline.")
        return start_training_job(app_state, steps)

    except Exception as e:
        logger.error(f"Distillation pipeline failed: {e}")
        return {"success": False, "message": f"Distillation failure: {str(e)}"}
