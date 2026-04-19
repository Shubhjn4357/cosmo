from __future__ import annotations
import os
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import faiss  # type: ignore
from loguru import logger
from knowledge.metadb import MetadataDB

@dataclass
class VectorDBConfig:
    """Vector database configuration for sharded clusters."""
    embedding_dim: int = 256
    base_path: str = "data/knowledge"
    shards_count: int = 4
    nlist: int = 100  # Number of clusters for IVF
    m: int = 8       # Number of subquantizers for PQ (must divide dim)
    nbits: int = 8   # Bits per code
    use_gpu: bool = False

class VectorDBShard:
    """A single partition of the vector database."""
    def __init__(self, shard_id: str, config: VectorDBConfig, metadb: MetadataDB):
        self.shard_id = shard_id
        self.config = config
        self.metadb = metadb
        self.shard_path = Path(config.base_path) / f"shard_{shard_id}.index"
        self.index: Optional[faiss.Index] = None
        self._load_or_init()

    def _load_or_init(self):
        if self.shard_path.exists():
            self.index = faiss.read_index(str(self.shard_path))
            logger.debug(f"Loaded shard {self.shard_id} with {self.index.ntotal} vectors")
        else:
            # Initialize IVFPQ index for memory efficiency and scaling
            dim = self.config.embedding_dim
            quantizer = faiss.IndexFlatIP(dim)
            # IndexIVFPQ(quantizer, d, nlist, m, nbits)
            self.index = faiss.IndexIVFPQ(quantizer, dim, self.config.nlist, self.config.m, self.config.nbits)
            self.index.metric_type = faiss.METRIC_INNER_PRODUCT
            logger.info(f"Initialized new IVFPQ shard {self.shard_id}")

    def add(self, vectors: np.ndarray, texts: List[str], metadata: Optional[List[Dict]] = None):
        vectors = vectors.astype(np.float32)
        # Normalize for cosine similarity
        faiss.normalize_L2(vectors)

        # Train if needed
        if not self.index.is_trained:  # type: ignore
            logger.info(f"Training shard {self.shard_id} with {len(vectors)} vectors")
            self.index.train(vectors)  # type: ignore

        start_idx = self.index.ntotal  # type: ignore
        self.index.add(vectors)  # type: ignore
        
        # Store in SQLite Metadata DB
        for i, text in enumerate(texts):
            meta = metadata[i] if metadata else {}
            self.metadb.add_metadata(self.shard_id, start_idx + i, text, meta)

    def search(self, query_vectors: np.ndarray, k: int = 5) -> List[List[Tuple[float, Dict]]]:
        faiss.normalize_L2(query_vectors)
        distances, indices = self.index.search(query_vectors, k)  # type: ignore
        
        results = []  # type: ignore
        for i in range(len(query_vectors)):
            query_results = []
            valid_indices = [int(idx) for idx in indices[i] if idx >= 0]
            if not valid_indices:
                results.append([])
                continue
            
            metas = self.metadb.get_batch_metadata(self.shard_id, valid_indices)
            for dist, meta in zip(distances[i], metas):
                if meta:
                    query_results.append((float(dist), meta))
            results.append(query_results)
        return results

    def save(self):
        faiss.write_index(self.index, str(self.shard_path))

class VectorDBCluster:
    """
    Orchestrates multiple FAISS shards and a single SQLite metadata DB.
    Scales to 10M+ vectors by distributing load.
    """
    def __init__(self, config: Optional[VectorDBConfig] = None):
        self.config = config or VectorDBConfig()
        base_dir = Path(self.config.base_path)
        base_dir.mkdir(parents=True, exist_ok=True)
        
        self.metadb = MetadataDB(str(base_dir / "metadata.db"))
        self.shards: Dict[str, VectorDBShard] = {}
        self._init_shards()

    def _init_shards(self):
        for i in range(self.config.shards_count):
            shard_id = str(i)
            self.shards[shard_id] = VectorDBShard(shard_id, self.config, self.metadb)
        logger.info(f"VectorDB Cluster ready with {len(self.shards)} shards")

    def _get_shard_for_vector(self, vector_hash: int) -> VectorDBShard:
        shard_idx = vector_hash % self.config.shards_count
        return self.shards[str(shard_idx)]

    def add(self, vectors: np.ndarray, texts: List[str], metadata: Optional[List[Dict]] = None):
        """Distribute vectors across shards based on a simple balancing logic."""
        # For simplicity in this implementation, we rotate or use current shard size
        # A more robust way would be hashing the text or using a router
        
        # Batch add to the shard with the fewest vectors to keep balance
        counts = {sid: shard.index.ntotal for sid, shard in self.shards.items()}  # type: ignore
        target_shard_id = min(counts, key=counts.get)  # type: ignore
        self.shards[target_shard_id].add(vectors, texts, metadata)

    def search(self, query_vectors: np.ndarray, k: int = 5) -> List[List[Dict[str, Any]]]:
        """Search across all shards and merge top K results."""
        all_query_results = []
        
        # In a real cluster, this would be parallelized
        for query_idx in range(len(query_vectors)):
            single_query_vec = query_vectors[query_idx : query_idx + 1]
            merged_results = []
            
            for shard in self.shards.values():
                shard_results = shard.search(single_query_vec, k)[0]
                merged_results.extend(shard_results)
            
            # Sort by distance (descending for Inner Product / Cosine)
            merged_results.sort(key=lambda x: x[0], reverse=True)
            top_k = [res[1] for res in merged_results[:k]]
            all_query_results.append(top_k)
            
        return all_query_results

    def search_text(self, query_embedding: np.ndarray, k: int = 5) -> List[Dict[str, Any]]:
        return self.search(query_embedding.reshape(1, -1), k)[0]

    def save(self):
        for shard in self.shards.values():
            shard.save()
        logger.info("VectorDB Cluster saved to disk")

    def get_stats(self) -> Dict[str, Any]:
        total = self.metadb.count()
        return {
            "total_vectors": total,
            "shards": len(self.shards),
            "dim": self.config.embedding_dim,
            "index_type": "IVFPQ"
        }

# For backward compatibility with existing code
VectorDB = VectorDBCluster
