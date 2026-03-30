"""
Whisper AI - FAISS Vector Database
Vector storage and retrieval for RAG (Retrieval-Augmented Generation).
"""

import json
import numpy as np
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass
import faiss
from loguru import logger


@dataclass
class VectorDBConfig:
    """Vector database configuration."""
    embedding_dim: int = 256
    index_path: str = "data/knowledge/faiss.index"
    metadata_path: str = "data/knowledge/metadata.jsonl"
    use_gpu: bool = False
    nlist: int = 0  # Use Flat index by default (no training needed)
    nprobe: int = 10  # Number of clusters to search


class VectorDB:
    """
    FAISS-based vector database for knowledge storage.
    
    Features:
    - Efficient similarity search
    - Metadata storage
    - Incremental updates
    - Save/load persistence
    """
    
    def __init__(self, config: VectorDBConfig):
        self.config = config
        self.index_path = Path(config.index_path)
        self.metadata_path = Path(config.metadata_path)
        
        # Ensure directories exist
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize or load index
        self.index: Optional[faiss.Index] = None
        self.metadata: List[Dict[str, Any]] = []
        self.current_id = 0
        
        if self.index_path.exists():
            self._load()
        else:
            self._init_index()
    
    def _init_index(self):
        """Initialize a new FAISS index."""
        dim = self.config.embedding_dim
        
        # Use IVF for larger datasets, Flat for smaller
        if self.config.nlist > 0:
            # IVFFlat: faster search, needs training
            quantizer = faiss.IndexFlatIP(dim)  # Inner product
            self.index = faiss.IndexIVFFlat(quantizer, dim, self.config.nlist)
            self._needs_training = True
        else:
            # Flat: exact search, slower
            self.index = faiss.IndexFlatIP(dim)
            self._needs_training = False
        
        logger.info(f"Initialized FAISS index with dim={dim}")
    
    def _load(self):
        """Load index and metadata from disk."""
        try:
            self.index = faiss.read_index(str(self.index_path))
            
            if self.metadata_path.exists():
                self.metadata = []
                with open(self.metadata_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        self.metadata.append(json.loads(line))
                self.current_id = len(self.metadata)
            
            logger.info(f"Loaded {self.current_id} vectors from disk")
        except Exception as e:
            logger.error(f"Error loading index: {e}")
            self._init_index()
    
    def save(self):
        """Save index and metadata to disk."""
        faiss.write_index(self.index, str(self.index_path))
        
        with open(self.metadata_path, 'w', encoding='utf-8') as f:
            for meta in self.metadata:
                f.write(json.dumps(meta, ensure_ascii=False) + "\n")

        try:
            from utils.persistence import backup_file

            backup_file(str(self.index_path))
            backup_file(str(self.metadata_path))
        except Exception as exc:
            logger.debug(f"Vector backup skipped: {exc}")
        
        logger.info(f"Saved {len(self.metadata)} vectors to disk")
    
    def _normalize(self, vectors: np.ndarray) -> np.ndarray:
        """Normalize vectors for cosine similarity."""
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms = np.maximum(norms, 1e-8)  # Avoid division by zero
        return vectors / norms
    
    def add(
        self,
        vectors: np.ndarray,
        texts: List[str],
        metadata: Optional[List[Dict]] = None
    ) -> List[int]:
        """
        Add vectors to the database.
        
        Args:
            vectors: Embeddings (n, dim)
            texts: Original texts
            metadata: Additional metadata for each vector
        
        Returns:
            List of assigned IDs
        """
        vectors = vectors.astype(np.float32)
        vectors = self._normalize(vectors)
        
        # Train IVF if needed
        if hasattr(self, '_needs_training') and self._needs_training:
            if vectors.shape[0] >= self.config.nlist:
                self.index.train(vectors)
                self._needs_training = False
        
        # Add vectors
        ids = list(range(self.current_id, self.current_id + len(vectors)))
        self.index.add(vectors)
        
        # Store metadata
        for i, (text, vec_id) in enumerate(zip(texts, ids)):
            meta = {
                "id": vec_id,
                "text": text[:1000],  # Limit stored text
                **(metadata[i] if metadata else {})
            }
            self.metadata.append(meta)
        
        self.current_id += len(vectors)
        logger.debug(f"Added {len(vectors)} vectors (total: {self.current_id})")
        
        return ids
    
    def search(
        self,
        query_vectors: np.ndarray,
        k: int = 5
    ) -> List[List[Tuple[int, float, Dict]]]:
        """
        Search for similar vectors.
        
        Args:
            query_vectors: Query embeddings (n, dim)
            k: Number of results per query
        
        Returns:
            List of results per query, each result is (id, score, metadata)
        """
        if self.current_id == 0:
            return [[] for _ in range(len(query_vectors))]
        
        query_vectors = query_vectors.astype(np.float32)
        query_vectors = self._normalize(query_vectors)
        
        k = min(k, self.current_id)  # Can't return more than we have
        
        distances, indices = self.index.search(query_vectors, k)
        
        results = []
        for query_idx in range(len(query_vectors)):
            query_results = []
            for i in range(k):
                idx = indices[query_idx][i]
                if idx >= 0 and idx < len(self.metadata):
                    score = float(distances[query_idx][i])
                    meta = self.metadata[idx]
                    query_results.append((idx, score, meta))
            results.append(query_results)
        
        return results
    
    def search_text(
        self,
        query_embedding: np.ndarray,
        k: int = 5
    ) -> List[Tuple[str, float]]:
        """
        Search and return texts with scores.
        
        Args:
            query_embedding: Single query embedding
            k: Number of results
        
        Returns:
            List of (text, score) tuples
        """
        results = self.search(query_embedding.reshape(1, -1), k)[0]
        return [(r[2]["text"], r[1]) for r in results]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get database statistics."""
        return {
            "total_vectors": self.current_id,
            "embedding_dim": self.config.embedding_dim,
            "index_type": type(self.index).__name__
        }
    
    def clear(self):
        """Clear all data."""
        self._init_index()
        self.metadata = []
        self.current_id = 0
        logger.info("Database cleared")


class SimpleEmbedder:
    """
    Simple text embedder using model output.
    For production, use sentence-transformers or similar.
    """
    
    def __init__(self, model, tokenizer, device: str = "cpu"):
        self.model = model
        self.tokenizer = tokenizer
        self.device = device
        self.dim = model.config.d_model
    
    def embed(self, texts: List[str]) -> np.ndarray:
        """
        Compute embeddings for texts.
        
        Args:
            texts: List of texts to embed
        
        Returns:
            Embeddings array (n, dim)
        """
        import torch
        
        embeddings = []
        
        self.model.eval()
        with torch.no_grad():
            for text in texts:
                # Tokenize
                tokens = self.tokenizer.encode(text, add_special_tokens=True)
                tokens = tokens[:512]  # Limit length
                input_ids = torch.tensor([tokens]).to(self.device)
                
                # Get hidden states
                output = self.model(input_ids)
                logits = output["logits"]
                
                # Mean pooling over sequence
                embedding = logits.mean(dim=1).squeeze().cpu().numpy()
                embeddings.append(embedding[:self.dim])  # Truncate to dim
        
        return np.array(embeddings, dtype=np.float32)
    
    def embed_single(self, text: str) -> np.ndarray:
        """Embed a single text."""
        return self.embed([text])[0]
