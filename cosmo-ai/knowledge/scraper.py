from urllib.robotparser import RobotFileParser
import hashlib
from bs4 import BeautifulSoup
from loguru import logger


def _normalize_host(hostname: str) -> str:
    host = (hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


@dataclass
class ScraperConfig:
    """Web scraper configuration."""
    seed_urls: List[str] = field(default_factory=lambda: ["https://en.wikipedia.org/wiki/Main_Page"])
    max_pages_per_session: int = 10
    sleep_between_requests: float = 2.0
    respect_robots_txt: bool = True
    max_retries: int = 3
    timeout_seconds: int = 30
    user_agent: str = "NovaAI-Bot/1.0 (Self-learning AI; Educational purposes)"
    allowed_content_types: List[str] = field(default_factory=lambda: ["text/html"])
    max_content_length: int = 5000000  # 5MB
    allowed_domain_suffixes: List[str] = field(default_factory=list)
    blocked_domain_suffixes: List[str] = field(default_factory=list)
    allow_duplicate_content: bool = False
    exclude_patterns: List[str] = field(default_factory=lambda: [
        r"\.pdf$", r"\.jpg$", r"\.png$", r"\.gif$", r"\.mp4$", r"\.mp3$",
        r"/login", r"/signup", r"/auth", r"facebook\.com", r"twitter\.com"
    ])


@dataclass
class CrawlResult:
    """Result of crawling a single URL."""
    url: str
    title: str
    text: str
    links: List[str]
    timestamp: float
    success: bool
    error: Optional[str] = None
    content_hash: Optional[str] = None


class WebScraper:
    """
    Autonomous web scraper for knowledge acquisition.
    
    Features:
    - Polite crawling with rate limiting
    - robots.txt compliance
    - Deduplication
    - Error recovery
    - Content extraction and cleaning
    """
    
    def __init__(self, config: ScraperConfig, storage_path: str = "data/raw"):
        self.config = config
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        # State
        self.visited_urls: Set[str] = set()
        self.content_hashes: Set[str] = set()
        self.queue: List[str] = list(config.seed_urls)
        self.robots_cache: Dict[str, RobotFileParser] = {}
        self._session_force_urls: Set[str] = set()
        self._session_allow_duplicate_content = False
        
        # Load existing state
        self._load_state()
        
        # Compile exclude patterns
        self.exclude_regex = [re.compile(p) for p in config.exclude_patterns]
    
    def _load_state(self):
        """Load previously visited URLs and content hashes."""
        state_path = self.storage_path / "scraper_state.json"
        if state_path.exists():
            try:
                with open(state_path, 'r', encoding='utf-8') as f:
                    raw = f.read().strip()
                    if not raw:
                        return
                    state = json.loads(raw)
                    self.visited_urls = set(state.get("visited_urls", []))
                    self.content_hashes = set(state.get("content_hashes", []))
                    logger.info(f"Loaded {len(self.visited_urls)} visited URLs")
            except Exception as exc:
                logger.warning(f"Scraper state reset due to invalid file: {exc}")
                self.visited_urls = set()
                self.content_hashes = set()
    
    def _save_state(self):
        """Save current state."""
        state_path = self.storage_path / "scraper_state.json"
        with open(state_path, 'w', encoding='utf-8') as f:
            json.dump({
                "visited_urls": list(self.visited_urls)[-10000:],  # Keep last 10k
                "content_hashes": list(self.content_hashes)[-10000:]
            }, f)
        try:
            from utils.persistence import backup_file

            backup_file(str(state_path))
        except Exception as exc:
            logger.debug(f"Scraper state backup skipped: {exc}")
    
    def _should_crawl(self, url: str) -> bool:
        """Check if URL should be crawled."""
        if url in self.visited_urls and url not in self._session_force_urls:
            return False

        hostname = _normalize_host(urlparse(url).hostname or "")
        if self.config.blocked_domain_suffixes:
            for domain in self.config.blocked_domain_suffixes:
                suffix = _normalize_host(domain)
                if hostname == suffix or hostname.endswith(f".{suffix}"):
                    return False
        if self.config.allowed_domain_suffixes:
            if not any(
                hostname == _normalize_host(domain) or hostname.endswith(f".{_normalize_host(domain)}")
                for domain in self.config.allowed_domain_suffixes
            ):
                return False
        
        for pattern in self.exclude_regex:
            if pattern.search(url):
                return False
        
        return True
    
    async def _check_robots(self, url: str) -> bool:
        """Check if URL is allowed by robots.txt."""
        if not self.config.respect_robots_txt:
            return True
        
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        
        if robots_url not in self.robots_cache:
            rp = RobotFileParser()
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(robots_url, timeout=10) as response:
                        if response.status == 200:
                            content = await response.text()
                            rp.parse(content.splitlines())
                        else:
                            rp.parse([])  # No robots.txt = allow all
            except Exception:
                rp.parse([])  # Error = allow all
            
            self.robots_cache[robots_url] = rp
        
        return self.robots_cache[robots_url].can_fetch(self.config.user_agent, url)
    
    def _extract_content(self, html: str, url: str) -> CrawlResult:
        """Extract text and links from HTML."""
        try:
            soup = BeautifulSoup(html, 'lxml')
            
            # Remove script and style elements
            for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
                element.decompose()
            
            # Get title
            title = soup.title.string if soup.title else ""
            title = title.strip() if title else urlparse(url).path
            
            # Get main content
            main_content = soup.find('main') or soup.find('article') or soup.find('body')
            text = main_content.get_text(separator=' ', strip=True) if main_content else ""
            
            # Clean text
            text = re.sub(r'\s+', ' ', text)
            text = text[:50000]  # Limit text length
            
            # Extract links
            links = []
            for a in soup.find_all('a', href=True):
                href = a['href']
                full_url = urljoin(url, href)
                if full_url.startswith('http'):
                    links.append(full_url)
            
            # Content hash for deduplication
            content_hash = hashlib.md5(text.encode()).hexdigest()
            
            return CrawlResult(
                url=url,
                title=title,
                text=text,
                links=links[:100],  # Limit links
                timestamp=time.time(),
                success=True,
                content_hash=content_hash
            )
        
        except Exception as e:
            return CrawlResult(
                url=url,
                title="",
                text="",
                links=[],
                timestamp=time.time(),
                success=False,
                error=str(e)
            )
    
    async def _fetch_url(self, url: str) -> Optional[str]:
        """Fetch URL content."""
        headers = {
            'User-Agent': self.config.user_agent,
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9'
        }
        
        for attempt in range(self.config.max_retries):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        url,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self.config.timeout_seconds),
                        allow_redirects=True
                    ) as response:
                        if response.status != 200:
                            logger.warning(f"Non-200 status for {url}: {response.status}")
                            return None
                        
                        content_type = response.headers.get('Content-Type', '')
                        if not any(ct in content_type for ct in self.config.allowed_content_types):
                            return None
                        
                        content = await response.text()
                        return content
            
            except asyncio.TimeoutError:
                logger.warning(f"Timeout for {url} (attempt {attempt + 1})")
            except Exception as e:
                logger.warning(f"Error fetching {url}: {e}")
            
            await asyncio.sleep(1)  # Wait before retry
        
        return None
    
    async def crawl_url(self, url: str) -> Optional[CrawlResult]:
        """Crawl a single URL."""
        if not self._should_crawl(url):
            return None
        
        if not await self._check_robots(url):
            logger.debug(f"Blocked by robots.txt: {url}")
            return None
        
        self.visited_urls.add(url)
        
        html = await self._fetch_url(url)
        if not html:
            return None
        
        result = self._extract_content(html, url)
        
        # Check for duplicate content
        if result.content_hash in self.content_hashes and not self._session_allow_duplicate_content:
            logger.debug(f"Duplicate content: {url}")
            return None
        
        self.content_hashes.add(result.content_hash)
        
        return result
    
    async def crawl_session(self, max_pages: Optional[int] = None) -> List[CrawlResult]:
        """
        Run a crawling session.
        
        Args:
            max_pages: Maximum pages to crawl (default from config)
        
        Returns:
            List of successful crawl results
        """
        max_pages = max_pages or self.config.max_pages_per_session
        results = []
        pages_crawled = 0
        
        logger.info(f"Starting crawl session (max {max_pages} pages)")
        
        try:
            while self.queue and pages_crawled < max_pages:
                url = self.queue.pop(0)
                
                result = await self.crawl_url(url)
                
                if result and result.success and result.text:
                    results.append(result)
                    pages_crawled += 1
                    logger.info(f"Crawled: {result.title[:50]}...")
                    
                    # Add new links to queue
                    for link in result.links:
                        if link not in self.visited_urls and link not in self.queue:
                            self.queue.append(link)
                
                # Rate limiting
                await asyncio.sleep(self.config.sleep_between_requests)
        finally:
            self._session_force_urls = set()
            self._session_allow_duplicate_content = False
            self._save_state()
        
        logger.info(f"Crawl session complete: {pages_crawled} pages crawled")
        return results
    
    def add_seed_urls(self, urls: List[str]):
        """Add new seed URLs to the queue."""
        for url in urls:
            if (url not in self.visited_urls or url in self._session_force_urls) and url not in self.queue:
                self.queue.insert(0, url)  # Priority

    def prune_state(
        self,
        *,
        urls: Optional[List[str]] = None,
        content_hashes: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        url_set = {url for url in (urls or []) if url}
        hash_set = {content_hash for content_hash in (content_hashes or []) if content_hash}
        removed_urls = len([url for url in self.visited_urls if url in url_set])
        removed_hashes = len([content_hash for content_hash in self.content_hashes if content_hash in hash_set])
        self.visited_urls = {url for url in self.visited_urls if url not in url_set}
        self.content_hashes = {content_hash for content_hash in self.content_hashes if content_hash not in hash_set}
        self.queue = [url for url in self.queue if url not in url_set]
        self._save_state()
        return {
            "removed_urls": removed_urls,
            "removed_content_hashes": removed_hashes,
            "state_path": str(self.storage_path / "scraper_state.json"),
        }

    def reset_state(self) -> Dict[str, Any]:
        removed_urls = len(self.visited_urls)
        removed_hashes = len(self.content_hashes)
        self.visited_urls = set()
        self.content_hashes = set()
        self.queue = []
        self._session_force_urls = set()
        self._session_allow_duplicate_content = False
        self._save_state()
        return {
            "removed_urls": removed_urls,
            "removed_content_hashes": removed_hashes,
            "state_path": str(self.storage_path / "scraper_state.json"),
        }

    def prepare_session(
        self,
        urls: List[str],
        *,
        allowed_domains: Optional[List[str]] = None,
        blocked_domains: Optional[List[str]] = None,
        reset_queue: bool = True,
        force_urls: Optional[List[str]] = None,
        allow_duplicate_content: bool = False,
    ):
        """Prepare an isolated crawl session around explicit seeds and domain policy."""
        if allowed_domains is not None:
            self.config.allowed_domain_suffixes = [domain for domain in allowed_domains if domain]
        if blocked_domains is not None:
            self.config.blocked_domain_suffixes = [domain for domain in blocked_domains if domain]
        self._session_force_urls = {url for url in (force_urls or []) if url}
        self._session_allow_duplicate_content = allow_duplicate_content
        if reset_queue:
            self.queue = []
        self.add_seed_urls(urls)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get scraper statistics."""
        return {
            "visited_urls": len(self.visited_urls),
            "unique_content": len(self.content_hashes),
            "queue_size": len(self.queue),
            "allowed_domain_suffixes": list(self.config.allowed_domain_suffixes),
            "blocked_domain_suffixes": list(self.config.blocked_domain_suffixes),
            "force_recrawl_urls": len(self._session_force_urls),
            "allow_duplicate_content": self._session_allow_duplicate_content,
            "state_path": str(self.storage_path / "scraper_state.json"),
        }


class ContentProcessor:
    """Process and clean scraped content for training."""
    
    def __init__(self, output_dir: str = "data/processed"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def process_results(self, results: List[CrawlResult]) -> List[str]:
        """Process crawl results into training texts."""
        texts = []
        
        for result in results:
            if not result.success or not result.text:
                continue
            
            # Format: Title + Content
            text = f"{result.title}\n\n{result.text}"
            
            # Clean up
            text = self._clean_text(text)
            
            if len(text) > 100:  # Minimum length
                texts.append(text)
        
        return texts
    
    def _clean_text(self, text: str) -> str:
        """Clean text for training."""
        # Remove URLs
        text = re.sub(r'http[s]?://\S+', '', text)
        
        # Remove email addresses
        text = re.sub(r'\S+@\S+', '', text)
        
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove very short lines (navigation, etc.)
        lines = text.split('. ')
        lines = [l for l in lines if len(l.split()) > 3]
        text = '. '.join(lines)
        
        return text.strip()
    
    def save_texts(self, texts: List[str], batch_id: str):
        """Save processed texts."""
        output_path = self.output_dir / f"batch_{batch_id}.jsonl"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            for text in texts:
                f.write(json.dumps({"text": text}) + "\n")
        
        logger.info(f"Saved {len(texts)} texts to {output_path}")
