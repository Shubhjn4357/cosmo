"""
Load training data into Whisper AI's knowledge base via the API.
This script can add data to RAG or prepare data for model fine-tuning.
"""

import json
import os
import asyncio
from typing import List

import httpx

from utils.app_paths import DATA_ROOT, ensure_app_dirs

# Configuration
API_URL = os.environ.get("WHISPER_API_URL", "http://localhost:7860")
ensure_app_dirs()


async def add_to_knowledge_base(texts: List[str], sources: List[str], batch_size: int = 10):
    """Add texts to knowledge base via API."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        total = len(texts)
        indexed = 0
        
        for i in range(0, total, batch_size):
            batch_texts = texts[i:i + batch_size]
            batch_sources = sources[i:i + batch_size]
            
            for text, source in zip(batch_texts, batch_sources):
                try:
                    response = await client.post(
                        f"{API_URL}/api/knowledge/add",
                        json={"text": text, "source": source}
                    )
                    if response.status_code == 200:
                        indexed += 1
                except Exception as e:
                    print(f"Error adding knowledge: {e}")
            
            print(f"Processed {min(i + batch_size, total)}/{total} entries")
        
        return indexed


async def load_jsonl_to_rag(jsonl_path: str):
    """Load JSONL file to RAG knowledge base via API."""
    print(f"Loading {jsonl_path}...")
    
    entries = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                entries.append(json.loads(line))
    
    print(f"Found {len(entries)} entries")
    
    # Prepare texts and sources
    texts = []
    sources = []
    for i, entry in enumerate(entries):
        # Combine instruction and output
        text = f"Q: {entry['instruction']}\nA: {entry['output']}"
        texts.append(text)
        sources.append(f"training_data_{i}")
    
    # Add to knowledge base
    indexed = await add_to_knowledge_base(texts, sources)
    print(f"Added {indexed} entries to knowledge base")
    
    return indexed


def prepare_training_jsonl(input_path: str, output_path: str = str(DATA_ROOT / "training.jsonl")):
    """Convert JSONL to training format for model fine-tuning."""
    print(f"Preparing training data from {input_path}...")
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    count = 0
    with open(input_path, 'r', encoding='utf-8') as fin, \
         open(output_path, 'w', encoding='utf-8') as fout:
        for line in fin:
            if line.strip():
                data = json.loads(line)
                # Format for causal LM training
                training_text = f"### Instruction:\n{data['instruction']}\n\n### Response:\n{data['output']}"
                fout.write(json.dumps({"text": training_text}) + '\n')
                count += 1
    
    print(f"Saved {count} training samples to {output_path}")
    return output_path


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Load data into Whisper AI")
    parser.add_argument("--file", default="cynic_10k.jsonl", help="JSONL file to load")
    parser.add_argument("--mode", choices=["rag", "train", "both"], default="rag",
                       help="Mode: 'rag' adds to knowledge base, 'train' prepares for training")
    parser.add_argument("--api", default=API_URL, help="API base URL")
    args = parser.parse_args()

    api_url = args.api

    if args.mode in ["rag", "both"]:
        API_URL = api_url
        print(f"Adding to RAG via {API_URL}...")
        asyncio.run(load_jsonl_to_rag(args.file))
    
    if args.mode in ["train", "both"]:
        prepare_training_jsonl(args.file)
        print("\nTo fine-tune the model, run:")
        print("  python train.py")
