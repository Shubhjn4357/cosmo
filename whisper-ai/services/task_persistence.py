"""
AI Horde Background Task Persistence Service
Manages async task execution, polling, and result storage for image generation, chat, and roleplay.
"""

import os
import json
import time
import asyncio
import sqlite3
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from enum import Enum
from loguru import logger
import threading

from .horde_client import get_horde_client


class TaskType(str, Enum):
    """Task types supported by the persistence service"""
    IMAGE_GENERATION = "image_generation"
    CHAT_RESPONSE = "chat_response"
    ROLEPLAY_RESPONSE = "roleplay_response"


class TaskStatus(str, Enum):
    """Task status states"""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskPersistenceService:
    """Background task persistence and polling service for AI Horde"""
    
    def __init__(self, db_path: str = "data/tasks.db"):
        """Initialize task persistence service"""
        self.db_path = db_path
        self._ensure_db()
        self.horde = get_horde_client()
        self._poll_thread = None
        self._running = False
        
    def _ensure_db(self):
        """Create database and tables if they don't exist"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                task_type TEXT NOT NULL,
                horde_request_id TEXT,
                prompt TEXT,
                parameters TEXT,
                status TEXT NOT NULL,
                result TEXT,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_user_status 
            ON tasks(user_id, status)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_horde_request 
            ON tasks(horde_request_id)
        """)
        
        conn.commit()
        conn.close()
        
        logger.info(f"Task database initialized: {self.db_path}")
    
    def create_task(
        self,
        user_id: str,
        task_type: TaskType,
        horde_request_id: str,
        prompt: str,
        parameters: Dict[str, Any]
    ) -> str:
        """
        Create a new background task
        
        Returns:
            task_id for tracking
        """
        import uuid
        task_id = f"{task_type.value}_{uuid.uuid4().hex[:12]}"
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO tasks (
                task_id, user_id, task_type, horde_request_id,
                prompt, parameters, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            task_id,
            user_id,
            task_type.value,
            horde_request_id,
            prompt,
            json.dumps(parameters),
            TaskStatus.QUEUED.value
        ))
        
        conn.commit()
        conn.close()
        
        logger.info(f"Created task {task_id} for user {user_id}")
        return task_id
    
    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task details by ID"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM tasks WHERE task_id = ?
        """, (task_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        task = dict(row)
        if task.get("parameters"):
            task["parameters"] = json.loads(task["parameters"])
        if task.get("result"):
            task["result"] = json.loads(task["result"])
        
        return task
    
    def get_user_tasks(
        self,
        user_id: str,
        status: Optional[TaskStatus] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get all tasks for a user, optionally filtered by status"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        if status:
            cursor.execute("""
                SELECT * FROM tasks 
                WHERE user_id = ? AND status = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (user_id, status.value, limit))
        else:
            cursor.execute("""
                SELECT * FROM tasks 
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (user_id, limit))
        
        rows = cursor.fetchall()
        conn.close()
        
        tasks = []
        for row in rows:
            task = dict(row)
            if task.get("parameters"):
                task["parameters"] = json.loads(task["parameters"])
            if task.get("result"):
                task["result"] = json.loads(task["result"])
            tasks.append(task)
        
        return tasks
    
    def update_task_status(
        self,
        task_id: str,
        status: TaskStatus,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ):
        """Update task status and optionally store result"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        updates = {
            "status": status.value,
            "updated_at": datetime.now().isoformat()
        }
        
        if result:
            updates["result"] = json.dumps(result)
        
        if error:
            updates["error_message"] = error
        
        if status == TaskStatus.COMPLETED or status == TaskStatus.FAILED:
            updates["completed_at"] = datetime.now().isoformat()
        
        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [task_id]
        
        cursor.execute(f"""
            UPDATE tasks SET {set_clause}
            WHERE task_id = ?
        """, values)
        
        conn.commit()
        conn.close()
        
        logger.info(f"Updated task {task_id} to status {status.value}")
    
    def cleanup_old_tasks(self, days_old: int = 1):
        """Remove completed/failed tasks older than specified days"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cutoff = (datetime.now() - timedelta(days=days_old)).isoformat()
        
        cursor.execute("""
            DELETE FROM tasks
            WHERE (status IN (?, ?) AND completed_at < ?)
        """, (TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, cutoff))
        
        deleted = cursor.rowcount
        conn.commit()
        conn.close()
        
        if deleted > 0:
            logger.info(f"Cleaned up {deleted} old tasks")
    
    async def poll_task(self, task_id: str):
        """Poll a single task for completion"""
        task = self.get_task(task_id)
        if not task or task["status"] not in [TaskStatus.QUEUED.value, TaskStatus.PROCESSING.value]:
            return
        
        horde_request_id = task["horde_request_id"]
        task_type = TaskType(task["task_type"])
        
        try:
            # Update to processing
            if task["status"] == TaskStatus.QUEUED.value:
                self.update_task_status(task_id, TaskStatus.PROCESSING)
            
            # Check AI Horde based on task type
            if task_type == TaskType.IMAGE_GENERATION:
                # Check image generation status
                check_url = f"{self.horde.BASE_URL}/generate/check/{horde_request_id}"
                status_url = f"{self.horde.BASE_URL}/generate/status/{horde_request_id}"
                
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(check_url) as check_resp:
                        check_data = await check_resp.json()
                        
                        if check_data.get("done", False):
                            # Get final result
                            async with session.get(status_url) as status_resp:
                                result = await status_resp.json()
                                
                                generations = result.get("generations", [])
                                if generations:
                                    gen = generations[0]
                                    self.update_task_status(
                                        task_id,
                                        TaskStatus.COMPLETED,
                                        result={
                                            "image_url": gen["img"],
                                            "seed": gen.get("seed", "unknown"),
                                            "model": gen.get("model", "unknown")
                                        }
                                    )
                                else:
                                    self.update_task_status(
                                        task_id,
                                        TaskStatus.FAILED,
                                        error="No image generated"
                                    )
            
            elif task_type in [TaskType.CHAT_RESPONSE, TaskType.ROLEPLAY_RESPONSE]:
                # Check text generation status
                status_url = f"{self.horde.BASE_URL}/generate/text/status/{horde_request_id}"
                
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(status_url) as status_resp:
                        result = await status_resp.json()
                        
                        if result.get("done", False):
                            generations = result.get("generations", [])
                            if generations:
                                self.update_task_status(
                                    task_id,
                                    TaskStatus.COMPLETED,
                                    result={
                                        "response": generations[0].get("text", ""),
                                        "model": task.get("parameters", {}).get("model", "unknown")
                                    }
                                )
                            else:
                                self.update_task_status(
                                    task_id,
                                    TaskStatus.FAILED,
                                    error="No response generated"
                                )
                                
        except Exception as e:
            logger.error(f"Error polling task {task_id}: {e}")
            self.update_task_status(task_id, TaskStatus.FAILED, error=str(e))
    
    async def poll_all_pending_tasks(self):
        """Poll all pending tasks"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT task_id FROM tasks
            WHERE status IN (?, ?)
        """, (TaskStatus.QUEUED.value, TaskStatus.PROCESSING.value))
        
        task_ids = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        if task_ids:
            logger.debug(f"Polling {len(task_ids)} pending tasks")
            # Poll all tasks concurrently
            await asyncio.gather(*[self.poll_task(tid) for tid in task_ids])
    
    def start_background_polling(self, interval: int = 3):
        """Start background thread for continuous polling"""
        if self._running:
            logger.warning("Background polling already running")
            return
        
        self._running = True
        
        def poll_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            while self._running:
                try:
                    loop.run_until_complete(self.poll_all_pending_tasks())
                    time.sleep(interval)
                except Exception as e:
                    logger.error(f"Error in polling loop: {e}")
                    time.sleep(interval)
            
            loop.close()
        
        self._poll_thread = threading.Thread(target=poll_loop, daemon=True)
        self._poll_thread.start()
        
        logger.info(f"Started background task polling (interval: {interval}s)")
    
    def stop_background_polling(self):
        """Stop background polling thread"""
        self._running = False
        if self._poll_thread:
            self._poll_thread.join(timeout=5)
        logger.info("Stopped background task polling")


# Singleton instance
_task_service: Optional[TaskPersistenceService] = None

def get_task_service() -> TaskPersistenceService:
    """Get or create task service singleton"""
    global _task_service
    if _task_service is None:
        _task_service = TaskPersistenceService()
        # Start background polling
        _task_service.start_background_polling()
    return _task_service
