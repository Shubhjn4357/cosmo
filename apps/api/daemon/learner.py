"""
Cosmo AI - Autonomous Learning Daemon
Background process for continuous self-learning.

Features:
- Web crawling on schedule
- Auto-training on new data
- Error recovery and retry logic
- Always-active learning loop
"""

import asyncio
import time
import json
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import threading
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger


@dataclass
class DaemonConfig:
    """Daemon configuration."""
    enabled: bool = True
    learning_interval_minutes: int = 30
    max_pages_per_session: int = 10
    retry_on_failure: bool = True
    max_retries: int = 3
    auto_train: bool = True
    train_after_pages: int = 50
    log_dir: str = "logs"


class LearningStats:
    """Track learning statistics."""
    
    def __init__(self, stats_path: str = "logs/learning_stats.json"):
        self.stats_path = Path(stats_path)
        self.stats_path.parent.mkdir(parents=True, exist_ok=True)
        self.load()
    
    def load(self):
        """Load stats from disk."""
        if self.stats_path.exists():
            with open(self.stats_path, 'r') as f:
                self._stats = json.load(f)
        else:
            self._stats = {
                "total_pages_crawled": 0,
                "total_tokens_learned": 0,
                "total_training_steps": 0,
                "errors_encountered": 0,
                "errors_recovered": 0,
                "last_crawl": None,
                "last_train": None,
                "sessions": []
            }
    
    def save(self):
        """Save stats to disk."""
        with open(self.stats_path, 'w') as f:
            json.dump(self._stats, f, indent=2)
    
    def record_crawl(self, pages: int, tokens: int):
        """Record a crawl session."""
        self._stats["total_pages_crawled"] += pages
        self._stats["total_tokens_learned"] += tokens
        self._stats["last_crawl"] = datetime.now().isoformat()
        self._stats["sessions"].append({
            "type": "crawl",
            "pages": pages,
            "tokens": tokens,
            "timestamp": datetime.now().isoformat()
        })
        # Keep only last 100 sessions
        self._stats["sessions"] = self._stats["sessions"][-100:]
        self.save()
    
    def record_training(self, steps: int, loss: float):
        """Record training session."""
        self._stats["total_training_steps"] += steps
        self._stats["last_train"] = datetime.now().isoformat()
        self._stats["sessions"].append({
            "type": "train",
            "steps": steps,
            "loss": loss,
            "timestamp": datetime.now().isoformat()
        })
        self._stats["sessions"] = self._stats["sessions"][-100:]
        self.save()
    
    def record_error(self, recovered: bool = False):
        """Record an error."""
        self._stats["errors_encountered"] += 1
        if recovered:
            self._stats["errors_recovered"] += 1
        self.save()
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current stats."""
        return self._stats.copy()


class AutonomousDaemon:
    """
    Autonomous learning daemon that runs continuously.
    
    This daemon:
    1. Crawls web pages on a schedule
    2. Indexes new content into the knowledge base
    3. Periodically retrains the model on new data
    4. Learns from errors and retries failed operations
    """
    
    def __init__(
        self,
        config: DaemonConfig,
        scraper=None,
        vectordb=None,
        embedder=None,
        dataset=None,
        trainer=None,
        tokenizer=None
    ):
        self.config = config
        self.scraper = scraper
        self.vectordb = vectordb
        self.embedder = embedder
        self.dataset = dataset
        self.trainer = trainer
        self.tokenizer = tokenizer
        
        self.scheduler = AsyncIOScheduler()
        self.stats = LearningStats(f"{config.log_dir}/learning_stats.json")
        
        self.is_running = False
        self.current_task = None
        self.pages_since_train = 0
        
        # Error tracking for learning from mistakes
        self.error_buffer = []
        
        logger.info("Autonomous learning daemon initialized")
    
    async def start(self):
        """Start the daemon."""
        if not self.config.enabled:
            logger.info("Daemon disabled in config")
            return
        
        if self.is_running:
            logger.warning("Daemon already running")
            return
        
        self.is_running = True
        
        # Schedule learning job
        self.scheduler.add_job(
            self._learning_cycle,
            IntervalTrigger(minutes=self.config.learning_interval_minutes),
            id="learning_cycle",
            name="Autonomous Learning Cycle",
            replace_existing=True
        )
        
        # Schedule error recovery job
        self.scheduler.add_job(
            self._error_recovery_cycle,
            IntervalTrigger(hours=1),
            id="error_recovery",
            name="Error Recovery Cycle",
            replace_existing=True
        )
        
        # Schedule frequent indexing job (every 1 minute)
        self.scheduler.add_job(
            self._quick_index_cycle,
            IntervalTrigger(minutes=1),
            id="quick_index",
            name="Quick Indexing Cycle",
            replace_existing=True
        )
        
        self.scheduler.start()
        logger.info(f"Daemon started. Learning every {self.config.learning_interval_minutes} minutes")
        
        # Run initial learning cycle
        asyncio.create_task(self._learning_cycle())
    
    async def stop(self):
        """Stop the daemon."""
        self.is_running = False
        self.scheduler.shutdown()
        logger.info("Daemon stopped")
    
    async def _learning_cycle(self):
        """
        Main learning cycle.
        
        1. Crawl web pages
        2. Process and index content
        3. Add to training data
        4. Train if needed
        """
        if self.current_task is not None:
            logger.info("Previous learning cycle still running, skipping")
            return
        
        self.current_task = "learning"
        logger.info("Starting learning cycle...")
        
        try:
            # Step 1: Crawl web pages
            if self.scraper:
                results = await self._crawl_with_retry()
                
                if results:
                    # Step 2: Process and index
                    await self._process_results(results)
                    
                    # Step 3: Check if training needed
                    if self.config.auto_train and self.pages_since_train >= self.config.train_after_pages:
                        await self._auto_train()
            
            logger.info("Learning cycle complete")
        
        except Exception as e:
            logger.error(f"Learning cycle failed: {e}")
            self.stats.record_error(recovered=False)
            self.error_buffer.append({
                "error": str(e),
                "phase": "learning_cycle",
                "timestamp": time.time()
            })
        
        finally:
            self.current_task = None
    
    async def _quick_index_cycle(self):
        """
        Quick indexing cycle - runs every minute.
        Indexes recent content without full crawl.
        """
        logger.debug("Running quick index cycle...")
        
        try:
            # Just save the vector DB to persist recent changes
            if self.vectordb:
                self.vectordb.save()
                logger.debug("Vector DB indexed")
        except Exception as e:
            logger.warning(f"Quick index failed: {e}")
    
    async def _crawl_with_retry(self):
        """Crawl with retry logic."""
        for attempt in range(self.config.max_retries):
            try:
                results = await self.scraper.crawl_session(
                    max_pages=self.config.max_pages_per_session
                )
                return results
            
            except Exception as e:
                logger.warning(f"Crawl attempt {attempt + 1} failed: {e}")
                if not self.config.retry_on_failure:
                    raise
                await asyncio.sleep(5 * (attempt + 1))  # Exponential backoff
        
        return []
    
    async def _process_results(self, results):
        """Process crawl results - index and prepare for training."""
        total_tokens = 0
        
        for result in results:
            if not result.success or not result.text:
                continue
            
            try:
                # Index in vector database
                if self.vectordb and self.embedder:
                    embedding = self.embedder.embed_single(result.text[:1000])
                    self.vectordb.add(
                        embedding.reshape(1, -1),
                        [result.text[:1000]],
                        [{"source": result.url, "title": result.title}]
                    )
                
                # Add to training dataset
                if self.dataset and self.tokenizer:
                    tokens = self.tokenizer.encode(result.text, add_special_tokens=False)
                    self.dataset.add_tokens(tokens)
                    total_tokens += len(tokens)
            
            except Exception as e:
                logger.warning(f"Failed to process {result.url}: {e}")
                self.stats.record_error(recovered=True)
        
        # Save vector DB
        if self.vectordb:
            self.vectordb.save()
        
        self.pages_since_train += len(results)
        self.stats.record_crawl(len(results), total_tokens)
        
        logger.info(f"Processed {len(results)} pages, {total_tokens} tokens")
    
    async def _auto_train(self):
        """Run automatic training on new data."""
        if not self.trainer:
            return
        
        logger.info("Starting auto-training...")
        
        try:
            # Run a short training session
            self.trainer.config.max_steps = self.trainer.global_step + 100
            
            # Run training in thread pool to not block
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self.trainer.train)
            
            self.pages_since_train = 0
            
            # Record stats
            if self.trainer.loss_history:
                last_loss = self.trainer.loss_history[-1].get("loss", 0)
                self.stats.record_training(100, last_loss)
            
            logger.info("Auto-training complete")
        
        except Exception as e:
            logger.error(f"Auto-training failed: {e}")
            self.stats.record_error()
    
    async def _error_recovery_cycle(self):
        """
        Attempt to recover from accumulated errors.
        
        This implements "learning from mistakes" by retrying
        failed operations with different strategies.
        """
        if not self.error_buffer:
            return
        
        logger.info(f"Attempting to recover from {len(self.error_buffer)} errors")
        
        recovered = 0
        remaining_errors = []
        
        for error in self.error_buffer:
            try:
                # Retry with backoff
                if error["phase"] == "crawl":
                    # Try with different seed URLs
                    if self.scraper:
                        self.scraper.add_seed_urls([
                            "https://en.wikipedia.org/wiki/Special:Random"
                        ])
                        recovered += 1
                
                elif error["phase"] == "train":
                    # Reduce learning rate and retry
                    if self.trainer:
                        self.trainer.config.learning_rate *= 0.5
                        recovered += 1
                
            except Exception as e:
                remaining_errors.append(error)
        
        self.error_buffer = remaining_errors
        
        if recovered > 0:
            self.stats.record_error(recovered=True)
            logger.info(f"Recovered from {recovered} errors")
    
    def trigger_learning(self):
        """Manually trigger a learning cycle."""
        if self.is_running:
            asyncio.create_task(self._learning_cycle())
        else:
            logger.warning("Daemon not running")
    
    def get_status(self) -> Dict[str, Any]:
        """Get daemon status."""
        return {
            "is_running": self.is_running,
            "current_task": self.current_task,
            "pages_since_train": self.pages_since_train,
            "error_buffer_size": len(self.error_buffer),
            "stats": self.stats.get_stats(),
            "next_run": str(self.scheduler.get_jobs()[0].next_run_time) if self.scheduler.get_jobs() else None
        }


class DaemonManager:
    """
    High-level daemon management.
    Provides easy interface for controlling the autonomous learning.
    """
    
    _instance: Optional['DaemonManager'] = None
    
    def __init__(self):
        self.daemon: Optional[AutonomousDaemon] = None
        self.config: Optional[DaemonConfig] = None
    
    @classmethod
    def get_instance(cls) -> 'DaemonManager':
        """Get singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    async def initialize(
        self,
        config: DaemonConfig,
        scraper,
        vectordb,
        embedder,
        dataset=None,
        trainer=None,
        tokenizer=None
    ):
        """Initialize the daemon with components."""
        self.config = config
        self.daemon = AutonomousDaemon(
            config=config,
            scraper=scraper,
            vectordb=vectordb,
            embedder=embedder,
            dataset=dataset,
            trainer=trainer,
            tokenizer=tokenizer
        )
        
        if config.enabled:
            await self.daemon.start()
    
    async def start(self):
        """Start the daemon."""
        if self.daemon:
            await self.daemon.start()
    
    async def stop(self):
        """Stop the daemon."""
        if self.daemon:
            await self.daemon.stop()
    
    def trigger_now(self):
        """Trigger learning immediately."""
        if self.daemon:
            self.daemon.trigger_learning()
    
    def get_status(self) -> Dict[str, Any]:
        """Get current status."""
        if self.daemon:
            return self.daemon.get_status()
        return {"is_running": False, "message": "Not initialized"}
