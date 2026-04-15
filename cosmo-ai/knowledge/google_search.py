"""
Google Search Integration for Knowledge Acquisition
Uses SerpAPI to fetch diverse content from Google search results.
"""

import os
import asyncio
import aiohttp
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from loguru import logger


@dataclass
class SearchConfig:
    """Google Search API configuration."""
    api_key: Optional[str] = None  # SerpAPI key (optional)
    max_results_per_query: int = 10
    queries: List[str] = None
    
    def __post_init__(self):
        if self.queries is None:
            self.queries = [
                "latest technology news",
                "scientific discoveries 2024",
                "artificial intelligence advances",
                "programming tutorials",
                "world news today",
                "educational articles",
                "how things work",
                "historical facts",
            ]


class GoogleSearchIntegration:
    """
    Integrates Google Search to find diverse content.
    
    If no API key provided, generates educational search URLs.
    """
    
    def __init__(self, config: SearchConfig):
        self.config = config
        self.api_key = config.api_key or os.getenv("SERPAPI_KEY")
    
    async def search_query(self, query: str) -> List[str]:
        """
        Search Google and return URLs.
        
        Args:
            query: Search query string
        
        Returns:
            List of URLs to crawl
        """
        if not self.api_key:
            # Fallback: generate educational URLs without API
            return self._generate_fallback_urls(query)
        
        try:
            urls = await self._search_with_serpapi(query)
            return urls
        except Exception as e:
            logger.warning(f"Search API failed: {e}, using fallback")
            return self._generate_fallback_urls(query)
    
    async def _search_with_serpapi(self, query: str) -> List[str]:
        """Use SerpAPI to search Google."""
        params = {
            "q": query,
            "api_key": self.api_key,
            "num": self.config.max_results_per_query,
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://serpapi.com/search",
                params=params,
                timeout=30
            ) as response:
                if response.status != 200:
                    return []
                
                data = await response.json()
                urls = []
                
                for result in data.get("organic_results", []):
                    url = result.get("link")
                    if url:
                        urls.append(url)
                
                return urls
    
    def _generate_fallback_urls(self, query: str) -> List[str]:
        """
        Generate high-quality educational URLs without API.
        Covers diverse knowledge areas.
        """
        # Map queries to known educational sources
        url_templates = {
            "technology": [
                "https://www.technologyreview.com/",
                "https://arstechnica.com/",
                "https://www.theverge.com/",
                "https://techcrunch.com/",
            ],
            "science": [
                "https://www.scientificamerican.com/",
                "https://www.nature.com/nature/",
                "https://www.newscientist.com/",
                "https://phys.org/",
            ],
            "news": [
                "https://www.bbc.com/news",
                "https://www.reuters.com/",
                "https://apnews.com/",
                "https://www.npr.org/",
            ],
            "education": [
                "https://en.wikipedia.org/wiki/Special:Random",
                "https://www.khanacademy.org/",
                "https://www.coursera.org/articles",
                "https://www.britannica.com/",
            ],
            "programming": [
                "https://stackoverflow.com/questions",
                "https://dev.to/",
                "https://www.freecodecamp.org/news/",
                "https://github.com/trending",
            ],
        }
        
        # Determine category from query
        query_lower = query.lower()
        urls = []
        
        for category, category_urls in url_templates.items():
            if category in query_lower:
                urls.extend(category_urls)
        
        # If no match, use educational sources
        if not urls:
            urls = url_templates["education"]
        
        return urls[:self.config.max_results_per_query]
    
    async def get_diverse_urls(self) -> List[str]:
        """
        Get diverse URLs from all configured queries.
        
        Returns:
            List of URLs covering multiple knowledge domains
        """
        all_urls = []
        
        for query in self.config.queries:
            try:
                urls = await self.search_query(query)
                all_urls.extend(urls)
                await asyncio.sleep(1)  # Rate limiting
            except Exception as e:
                logger.warning(f"Query failed '{query}': {e}")
        
        # Deduplicate
        return list(set(all_urls))


async def get_knowledge_urls(use_api: bool = False) -> List[str]:
    """
    Convenience function to get knowledge URLs.
    
    Args:
        use_api: Try to use SerpAPI if available
    
    Returns:
        List of diverse educational URLs
    """
    config = SearchConfig()
    search = GoogleSearchIntegration(config)
    
    urls = await search.get_diverse_urls()
    logger.info(f"Generated {len(urls)} knowledge URLs")
    
    return urls
