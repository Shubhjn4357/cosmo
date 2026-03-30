"""
Whisper AI - Knowledge API Routes
Vector database search and knowledge indexing.
"""

from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from loguru import logger


router = APIRouter()


class SearchRequest(BaseModel):
    """Knowledge search request."""
    query: str
    k: int = 5


class SearchResult(BaseModel):
    """Single search result."""
    text: str
    score: float
    source: str


class SearchResponse(BaseModel):
    """Knowledge search response."""
    results: List[SearchResult]
    query: str


class IndexRequest(BaseModel):
    """Knowledge indexing request."""
    text: str
    source: str = "api"


class IndexResponse(BaseModel):
    """Knowledge indexing response."""
    chunks_indexed: int
    source: str


@router.post("/knowledge/search")
async def search_knowledge(request: SearchRequest) -> SearchResponse:
    """
    Search the knowledge base for relevant information.
    
    Args:
        request: Search query and parameters
    
    Returns:
        Matching documents with relevance scores
    """
    from api.route import get_app_state
    
    state = get_app_state()
    
    # Graceful handling when knowledge base not configured
    if state.rag is None:
        logger.warning("Knowledge base not initialized - returning empty results")
        return SearchResponse(
            results=[],
            query=request.query
        )
    
    try:
        results = state.rag.retrieve(request.query, k=request.k)
        
        return SearchResponse(
            results=[
                SearchResult(
                    text=text,
                    score=score,
                    source=meta.get("source", "unknown")
                )
                for text, score, meta in results
            ],
            query=request.query
        )
    
    except Exception as e:
        logger.error(f"Search failed: {e}")
        # Return empty results instead of error
        return SearchResponse(
            results=[],
            query=request.query
        )


@router.post("/knowledge/index")
async def index_knowledge(request: IndexRequest) -> IndexResponse:
    """
    Add new knowledge to the database.
    
    Args:
        request: Text and source to index
    
    Returns:
        Number of chunks indexed
    """
    from api.route import get_app_state
    
    state = get_app_state()
    
    # Graceful handling when knowledge base not configured
    if state.rag is None:
        logger.warning("Knowledge base not initialized - feature disabled")
        return IndexResponse(
            chunks_indexed=0,
            source=request.source
        )
    
    if len(request.text) < 10:
        raise HTTPException(status_code=400, detail="Text too short to index")
    
    try:
        chunks = state.rag.index_document(
            request.text,
            source=request.source
        )
        if chunks:
            from api.routes.analytics import analytics

            analytics.record_knowledge_added(chunks)
        
        # Save to disk if vectordb available
        if state.vectordb:
            state.vectordb.save()
        
        return IndexResponse(
            chunks_indexed=chunks,
            source=request.source
        )
    
    except Exception as e:
        logger.error(f"Indexing failed: {e}")
        # Return graceful response instead of 500
        return IndexResponse(
            chunks_indexed=0,
            source=request.source
        )


# Alias for /knowledge/index - used by the generator
@router.post("/knowledge/add")
async def add_knowledge(request: IndexRequest) -> IndexResponse:
    """Alias for index_knowledge - adds knowledge to the database."""
    return await index_knowledge(request)


@router.get("/knowledge/stats")
async def knowledge_stats():
    """Get knowledge base statistics."""
    from api.route import get_app_state
    
    state = get_app_state()
    
    if state.vectordb is None:
        return {"status": "not_initialized"}
    
    return {
        "status": "active",
        **state.vectordb.get_stats()
    }


@router.delete("/knowledge/clear")
async def clear_knowledge():
    """Clear all knowledge from the database."""
    from api.route import get_app_state
    
    state = get_app_state()
    
    # Graceful handling when knowledge base not configured
    if state.vectordb is None:
        logger.warning("Knowledge base not initialized - nothing to clear")
        return {"status": "not_configured", "message": "Knowledge base not configured"}
    
    try:
        state.vectordb.clear()
        state.vectordb.save()
        logger.info("Knowledge base cleared")
        return {"status": "cleared"}
    except Exception as e:
        logger.error(f"Failed to clear knowledge base: {e}")
        return {"status": "error", "message": str(e)}
