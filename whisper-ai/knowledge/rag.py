"""
Whisper AI - RAG (Retrieval-Augmented Generation)
Combines vector search with language model for knowledge-grounded responses.
"""

from typing import Any, Dict, List, Optional, Protocol, Tuple
from dataclasses import dataclass
from loguru import logger


class VectorStoreLike(Protocol):
    metadata: List[Dict[str, Any]]

    def add(
        self,
        vectors,
        texts: List[str],
        metadata: Optional[List[Dict]] = None,
    ) -> List[int]: ...

    def search(self, query_vectors, k: int = 5) -> List[List[Tuple[int, float, Dict]]]: ...

    def get_stats(self) -> Dict[str, Any]: ...


class EmbedderLike(Protocol):
    def embed(self, texts: List[str]): ...

    def embed_single(self, text: str): ...


@dataclass
class RAGConfig:
    """RAG system configuration."""
    top_k: int = 5
    min_similarity: float = 0.3
    context_window: int = 2000
    use_reranking: bool = True
    chunk_size: int = 256
    chunk_overlap: int = 32


class RAGSystem:
    """
    Retrieval-Augmented Generation system.
    
    Features:
    - Knowledge retrieval from vector database
    - Context injection for generation
    - Source attribution
    - Dynamic chunk management
    """
    
    def __init__(
        self,
        vectordb: VectorStoreLike,
        embedder: EmbedderLike,
        config: Optional[RAGConfig] = None
    ):
        self.vectordb = vectordb
        self.embedder = embedder
        self.config = config or RAGConfig()
    
    def chunk_text(self, text: str, metadata: Dict = None) -> List[Dict]:
        """
        Split text into overlapping chunks for indexing.
        
        Args:
            text: Text to chunk
            metadata: Additional metadata to include
        
        Returns:
            List of chunk dictionaries
        """
        words = text.split()
        chunks = []
        
        chunk_size = self.config.chunk_size
        overlap = self.config.chunk_overlap
        
        i = 0
        chunk_idx = 0
        while i < len(words):
            chunk_words = words[i:i + chunk_size]
            chunk_text = ' '.join(chunk_words)
            
            chunk = {
                "text": chunk_text,
                "chunk_idx": chunk_idx,
                "start_word": i,
                **(metadata or {})
            }
            chunks.append(chunk)
            
            i += chunk_size - overlap
            chunk_idx += 1
        
        return chunks
    
    def index_document(self, text: str, source: str = "unknown", metadata: Dict = None) -> int:
        """
        Index a document into the knowledge base.
        
        Args:
            text: Document text
            source: Source identifier
            metadata: Additional metadata
        
        Returns:
            Number of chunks indexed
        """
        meta = {"source": source, **(metadata or {})}
        chunks = self.chunk_text(text, meta)
        
        if not chunks:
            return 0
        
        # Compute embeddings for chunks
        texts = [c["text"] for c in chunks]
        embeddings = self.embedder.embed(texts)
        
        # Add to vector database
        self.vectordb.add(embeddings, texts, chunks)
        
        logger.info(f"Indexed {len(chunks)} chunks from {source}")
        return len(chunks)
    
    def retrieve(self, query: str, k: Optional[int] = None) -> List[Tuple[str, float, Dict]]:
        """
        Retrieve relevant chunks for a query.
        
        Args:
            query: Search query
            k: Number of results (default from config)
        
        Returns:
            List of (text, score, metadata) tuples
        """
        k = k or self.config.top_k
        
        # Embed query
        query_embedding = self.embedder.embed_single(query)
        
        # Search
        results = self.vectordb.search(query_embedding.reshape(1, -1), k)[0]
        
        # Filter by minimum similarity
        filtered = [
            (r[2]["text"], r[1], r[2])
            for r in results
            if r[1] >= self.config.min_similarity
        ]
        
        return filtered
    
    def build_context(self, query: str, k: Optional[int] = None) -> Tuple[str, List[Dict]]:
        """
        Build context string for augmented generation.
        
        Args:
            query: User query
            k: Number of chunks to retrieve
        
        Returns:
            Tuple of (context_string, sources)
        """
        results = self.retrieve(query, k)
        
        if not results:
            return "", []
        
        # Build context string
        context_parts = []
        sources = []
        total_length = 0
        
        for text, score, meta in results:
            if total_length + len(text) > self.config.context_window:
                break
            
            context_parts.append(f"[Source: {meta.get('source', 'unknown')}]\n{text}")
            sources.append({
                "source": meta.get("source", "unknown"),
                "score": score,
                "chunk": meta.get("chunk_idx", 0)
            })
            total_length += len(text)
        
        context = "\n\n".join(context_parts)
        return context, sources
    
    def augmented_prompt(self, query: str, system_prompt: str = "") -> str:
        """
        Create an augmented prompt with retrieved context.
        
        Args:
            query: User query
            system_prompt: Optional system prompt
        
        Returns:
            Augmented prompt string
        """
        context, sources = self.build_context(query)
        
        if context:
            prompt = f"""Use the following context to answer the question.

Context:
{context}

Question: {query}

Answer:"""
        else:
            prompt = f"Question: {query}\n\nAnswer:"
        
        if system_prompt:
            prompt = f"{system_prompt}\n\n{prompt}"
        
        return prompt
    
    def get_stats(self) -> Dict[str, Any]:
        """Get RAG system statistics."""
        return {
            "vectordb_stats": self.vectordb.get_stats(),
            "config": {
                "top_k": self.config.top_k,
                "min_similarity": self.config.min_similarity,
                "chunk_size": self.config.chunk_size
            }
        }


class KnowledgeManager:
    """
    High-level knowledge management interface.
    Coordinates scraping, indexing, and retrieval.
    """
    
    def __init__(self, rag_system: RAGSystem):
        self.rag = rag_system
        self.indexed_sources = set()
    
    def add_knowledge(self, text: str, source: str = "user") -> int:
        """Add knowledge from text."""
        if source in self.indexed_sources and len(text) < 100:
            return 0  # Skip short duplicates
        
        count = self.rag.index_document(text, source)
        if count > 0:
            self.indexed_sources.add(source)
        
        return count
    
    def query(self, question: str) -> Dict[str, Any]:
        """
        Query the knowledge base.
        
        Returns:
            Dictionary with context and sources
        """
        context, sources = self.rag.build_context(question)
        
        return {
            "context": context,
            "sources": sources,
            "has_knowledge": len(context) > 0
        }
    
    def search(self, query: str, k: int = 5) -> List[Dict]:
        """Search for relevant documents."""
        results = self.rag.retrieve(query, k)
        
        return [
            {
                "text": text,
                "score": score,
                "source": meta.get("source", "unknown")
            }
            for text, score, meta in results
        ]
