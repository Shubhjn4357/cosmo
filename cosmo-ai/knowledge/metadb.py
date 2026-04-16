import sqlite3
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from loguru import logger

class MetadataDB:
    """
    SQLite-backed metadata storage for VectorDB.
    Handles millions of records without OOM.
    """
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metadata (
                    id INTEGER PRIMARY KEY,
                    shard_id TEXT,
                    vector_idx INTEGER,
                    text TEXT,
                    meta_json TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_shard_vector ON metadata(shard_id, vector_idx)")
            conn.commit()

    def add_metadata(self, shard_id: str, vector_idx: int, text: str, meta: Dict[str, Any]):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO metadata (shard_id, vector_idx, text, meta_json) VALUES (?, ?, ?, ?)",
                (shard_id, vector_idx, text, json.dumps(meta, ensure_ascii=False))
            )
            conn.commit()

    def get_metadata(self, shard_id: str, vector_idx: int) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT text, meta_json FROM metadata WHERE shard_id = ? AND vector_idx = ?",
                (shard_id, vector_idx)
            )
            row = cursor.fetchone()
            if row:
                text, meta_json = row
                meta = json.loads(meta_json)
                meta["text"] = text
                return meta
        return None

    def get_batch_metadata(self, shard_id: str, vector_indices: List[int]) -> List[Dict[str, Any]]:
        if not vector_indices:
            return []
        
        placeholders = ",".join("?" for _ in vector_indices)
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                f"SELECT vector_idx, text, meta_json FROM metadata WHERE shard_id = ? AND vector_idx IN ({placeholders})",
                [shard_id] + vector_indices
            )
            results = {row[0]: (row[1], json.loads(row[2])) for row in cursor.fetchall()}
            
            final = []
            for idx in vector_indices:
                if idx in results:
                    text, meta = results[idx]
                    meta["text"] = text
                    meta["vector_idx"] = idx
                    final.append(meta)
                else:
                    final.append({})
            return final

    def count(self, shard_id: Optional[str] = None) -> int:
        with sqlite3.connect(self.db_path) as conn:
            if shard_id:
                cursor = conn.execute("SELECT COUNT(*) FROM metadata WHERE shard_id = ?", (shard_id,))
            else:
                cursor = conn.execute("SELECT COUNT(*) FROM metadata")
            return cursor.fetchone()[0]

    def clear(self, shard_id: Optional[str] = None):
        with sqlite3.connect(self.db_path) as conn:
            if shard_id:
                conn.execute("DELETE FROM metadata WHERE shard_id = ?", (shard_id,))
            else:
                conn.execute("DELETE FROM metadata")
            conn.commit()
