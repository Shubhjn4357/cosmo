from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Optional

from loguru import logger

from services.google_auth import verify_google_id_token
from utils.app_paths import DB_PATH, ensure_app_dirs

try:
    import libsql  # type: ignore
except ImportError:
    libsql = None


MIGRATION_PATH = Path(__file__).resolve().parents[1] / "drizzle" / "0000_cosmo_initial.sql"
AUTO_ID_TABLES = {
    "chat_history",
    "token_purchases",
    "token_usage",
    "generated_images",
    "chats",
    "password_reset_tokens",
    "autoresearch_projects",
    "autoresearch_runs",
}
JSON_COLUMNS = {
    "chat_history": {"messages"},
    "autoresearch_projects": {"editable_paths"},
    "autoresearch_runs": {"changed_paths"},
}
BOOL_COLUMNS = {
    "profiles": {
        "consent_given",
        "data_collection_consent",
        "is_admin",
        "banned",
        "notifications_enabled",
        "nsfw_enabled",
    },
    "generated_images": {"is_local"},
    "token_usage": {"is_local"},
    "autoresearch_runs": {"accepted"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class QueryResult:
    data: list[Any]
    count: Optional[int] = None

    def execute(self) -> "QueryResult":
        return self


@dataclass
class AuthUser:
    id: str
    email: str
    display_name: Optional[str] = None

    def model_dump(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "email": self.email,
            "display_name": self.display_name,
        }


@dataclass
class AuthSession:
    access_token: str
    refresh_token: str


@dataclass
class AuthResponse:
    user: Optional[AuthUser]
    session: Optional[AuthSession]


class TursoQuery:
    def __init__(self, client: "TursoClient", table_name: str):
        self.client = client
        self.table_name = table_name
        self.operation: Optional[str] = None
        self.selected_columns: str = "*"
        self.count_mode: Optional[str] = None
        self.returning_columns: Optional[str] = None
        self.payload: Any = None
        self.filters: list[tuple[str, str, Any]] = []
        self.or_filters: list[tuple[str, str, str]] = []
        self.ordering: Optional[tuple[str, bool]] = None
        self.offset_value: Optional[int] = None
        self.limit_value: Optional[int] = None

    def select(self, columns: str = "*", count: Optional[str] = None):
        if self.operation == "insert":
            self.returning_columns = columns
            return self
        self.operation = "select"
        self.selected_columns = columns
        self.count_mode = count
        return self

    def insert(self, values: dict[str, Any] | list[dict[str, Any]]):
        self.operation = "insert"
        self.payload = values
        return self

    def update(self, values: dict[str, Any]):
        self.operation = "update"
        self.payload = values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def eq(self, column: str, value: Any):
        self.filters.append((column, "=", value))
        return self

    def gte(self, column: str, value: Any):
        self.filters.append((column, ">=", value))
        return self

    def order(self, column: str, desc: bool = False):
        self.ordering = (column, desc)
        return self

    def range(self, start: int, end: int):
        self.offset_value = start
        self.limit_value = max(0, end - start + 1)
        return self

    def or_(self, expression: str):
        for segment in expression.split(","):
            parts = segment.split(".")
            if len(parts) < 3:
                continue
            column = parts[0]
            operator = parts[1].lower()
            value = ".".join(parts[2:])
            self.or_filters.append((column, operator, value))
        return self

    def execute(self) -> QueryResult:
        return self.client.execute(self)


class TursoAuthAdapter:
    def __init__(self, client: "TursoClient"):
        self.client = client

    def sign_up(self, payload: dict[str, Any]) -> AuthResponse:
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""
        if not email or not password:
            raise ValueError("Email and password are required")

        existing = self.client.table("profiles").select("id").eq("email", email).execute()
        if existing.data:
            raise ValueError("User already exists")

        user_id = uuid.uuid4().hex
        display_name = (
            payload.get("options", {})
            .get("data", {})
            .get("display_name")
            or email.split("@")[0]
        )
        now = utc_now()
        self.client.table("profiles").insert(
            {
                "id": user_id,
                "email": email,
                "password_hash": hashlib.sha256(password.encode()).hexdigest(),
                "display_name": display_name,
                "last_active": now,
                "created_at": now,
                "updated_at": now,
            }
        ).execute()
        return AuthResponse(
            user=AuthUser(id=user_id, email=email, display_name=display_name),
            session=AuthSession(access_token="local-auth", refresh_token="local-auth"),
        )

    def sign_in_with_password(self, payload: dict[str, Any]) -> AuthResponse:
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""
        if not email or not password:
            raise ValueError("Email and password are required")

        result = self.client.table("profiles").select("*").eq("email", email).execute()
        if not result.data:
            raise ValueError("Invalid login credentials")

        profile = result.data[0]
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        if profile.get("password_hash") != password_hash:
            raise ValueError("Invalid login credentials")
        if profile.get("banned"):
            raise ValueError("User account is banned")

        self.client.table("profiles").update({"last_active": utc_now()}).eq("id", profile["id"]).execute()
        return AuthResponse(
            user=AuthUser(
                id=profile["id"],
                email=profile["email"],
                display_name=profile.get("display_name"),
            ),
            session=AuthSession(access_token="local-auth", refresh_token="local-auth"),
        )

    def sign_in_with_id_token(self, payload: dict[str, Any]) -> AuthResponse:
        provider = (payload.get("provider") or "").strip().lower()
        token = payload.get("token") or payload.get("id_token") or ""
        if provider != "google":
            raise ValueError("Unsupported identity provider")

        claims = verify_google_id_token(token)
        email = claims["email"]
        subject = str(claims.get("sub") or "").strip()
        if not subject:
            raise ValueError("Google token is missing subject")

        result = self.client.table("profiles").select("*").eq("email", email).execute()
        now = utc_now()
        display_name = str(claims.get("name") or email.split("@")[0]).strip() or email.split("@")[0]
        avatar_url = claims.get("picture")

        if result.data:
            profile = result.data[0]
            if profile.get("banned"):
                raise ValueError("User account is banned")
            self.client.table("profiles").update(
                {
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "last_active": now,
                    "updated_at": now,
                }
            ).eq("id", profile["id"]).execute()
            user_id = profile["id"]
        else:
            user_id = f"google_{subject}"
            self.client.table("profiles").insert(
                {
                    "id": user_id,
                    "email": email,
                    "password_hash": None,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "last_active": now,
                    "created_at": now,
                    "updated_at": now,
                }
            ).execute()

        return AuthResponse(
            user=AuthUser(id=user_id, email=email, display_name=display_name),
            session=AuthSession(access_token="google-auth", refresh_token="google-auth"),
        )

    def reset_password_for_email(self, email: str):
        email = (email or "").strip().lower()
        if not email:
            return None
        result = self.client.table("profiles").select("id").eq("email", email).execute()
        if not result.data:
            return None
        token = uuid.uuid4().hex
        self.client.table("password_reset_tokens").insert(
            {
                "id": token,
                "user_id": result.data[0]["id"],
                "email": email,
                "created_at": utc_now(),
            }
        ).execute()
        return token

    def sign_out(self):
        return True


class TursoClient:
    def __init__(self):
        self._lock = Lock()
        self._connection = None
        self._schema_ready = False
        self._table_columns: dict[str, set[str]] = {}
        self.auth = TursoAuthAdapter(self)

    def _connect(self):
        ensure_app_dirs()
        local_db_path = str(DB_PATH)
        turso_url = os.getenv("TURSO_DATABASE_URL", "").strip()
        turso_token = os.getenv("TURSO_AUTH_TOKEN", "").strip()

        if turso_url and libsql is not None:
            logger.info("Database Mode: Turso Remote (Local Replica: {})", local_db_path)
            logger.info("Connecting to Turso URL: {}...", turso_url[:15] + "...")
            connection = libsql.connect(local_db_path, sync_url=turso_url, auth_token=turso_token or None)
        else:
            if turso_url and libsql is None:
                logger.warning("TURSO_DATABASE_URL is set but libsql is not installed; using local sqlite fallback")
            logger.info("Database Mode: Local SQLite ({})", local_db_path)
            connection = sqlite3.connect(local_db_path, check_same_thread=False)

        try:
            connection.row_factory = sqlite3.Row
        except Exception:
            pass

        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def _get_connection(self):
        if self._connection is None:
            self._connection = self._connect()
        if not self._schema_ready:
            self._apply_schema()
            self._schema_ready = True
        return self._connection

    def _apply_schema(self):
        connection = self._connection or self._connect()
        if not MIGRATION_PATH.exists():
            raise RuntimeError(f"Missing database migration file: {MIGRATION_PATH}")
        sql = MIGRATION_PATH.read_text(encoding="utf-8")
        connection.executescript(sql)
        connection.commit()
        self._sync()

    def _sync(self):
        if self._connection is not None and hasattr(self._connection, "sync"):
            try:
                logger.info("Initiating remote database synchronization...")
                self._connection.sync()
                logger.info("Remote database synchronization successful.")
            except Exception as exc:
                logger.warning("Turso sync failed: {}", exc)

    def table(self, table_name: str) -> TursoQuery:
        return TursoQuery(self, table_name)

    def _table_has_column(self, table_name: str, column: str) -> bool:
        cached = self._table_columns.get(table_name)
        if cached is None:
            cursor = self._get_connection().execute(f"PRAGMA table_info({table_name})")
            cached = {row[1] for row in cursor.fetchall()}
            self._table_columns[table_name] = cached
        return column in cached

    def _encode_value(self, table_name: str, column: str, value: Any):
        if value == "now()":
            return utc_now()
        if column in JSON_COLUMNS.get(table_name, set()) and value is not None:
            return json.dumps(value)
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return value

    def _decode_row(self, table_name: str, row: Any) -> dict[str, Any]:
        data = dict(row)
        for column in JSON_COLUMNS.get(table_name, set()):
            if data.get(column):
                try:
                    data[column] = json.loads(data[column])
                except Exception:
                    pass
        for column in BOOL_COLUMNS.get(table_name, set()):
            if column in data and data[column] is not None:
                data[column] = bool(data[column])
        return data

    def _build_where(self, query: TursoQuery) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []

        for column, operator, value in query.filters:
            clauses.append(f"{column} {operator} ?")
            params.append(value)

        if query.or_filters:
            or_clauses: list[str] = []
            for column, operator, value in query.or_filters:
                if operator == "ilike":
                    or_clauses.append(f"LOWER({column}) LIKE LOWER(?)")
                    params.append(value)
            if or_clauses:
                clauses.append("(" + " OR ".join(or_clauses) + ")")

        if not clauses:
            return "", params
        return " WHERE " + " AND ".join(clauses), params

    def _select(self, query: TursoQuery) -> QueryResult:
        where_sql, params = self._build_where(query)
        sql = f"SELECT {query.selected_columns} FROM {query.table_name}{where_sql}"
        if query.ordering:
            column, desc = query.ordering
            sql += f" ORDER BY {column} {'DESC' if desc else 'ASC'}"
        if query.limit_value is not None:
            sql += " LIMIT ?"
            params.append(query.limit_value)
        if query.offset_value is not None:
            sql += " OFFSET ?"
            params.append(query.offset_value)

        cursor = self._get_connection().execute(sql, params)
        rows = [self._decode_row(query.table_name, row) for row in cursor.fetchall()]
        count = None
        if query.count_mode == "exact":
            count_cursor = self._get_connection().execute(
                f"SELECT COUNT(*) FROM {query.table_name}{where_sql}",
                params[: len(params) - (1 if query.limit_value is not None else 0) - (1 if query.offset_value is not None else 0)],
            )
            count = int(count_cursor.fetchone()[0])
        return QueryResult(data=rows, count=count)

    def _insert(self, query: TursoQuery) -> QueryResult:
        connection = self._get_connection()
        rows = query.payload if isinstance(query.payload, list) else [query.payload]
        inserted_rows: list[dict[str, Any]] = []

        for original_row in rows:
            row = dict(original_row)
            if query.table_name in AUTO_ID_TABLES and not row.get("id"):
                row["id"] = uuid.uuid4().hex
            if self._table_has_column(query.table_name, "created_at") and not row.get("created_at"):
                row["created_at"] = utc_now()
            if self._table_has_column(query.table_name, "updated_at") and not row.get("updated_at"):
                row["updated_at"] = row.get("created_at", utc_now())

            columns = list(row.keys())
            placeholders = ", ".join("?" for _ in columns)
            values = [self._encode_value(query.table_name, column, row[column]) for column in columns]
            sql = f"INSERT INTO {query.table_name} ({', '.join(columns)}) VALUES ({placeholders})"
            connection.execute(sql, values)

            if query.returning_columns:
                select_columns = query.returning_columns
            else:
                select_columns = "*"

            if "id" in row:
                inserted = (
                    connection.execute(
                        f"SELECT {select_columns} FROM {query.table_name} WHERE id = ?",
                        [row["id"]],
                    ).fetchone()
                )
                if inserted is not None:
                    inserted_rows.append(self._decode_row(query.table_name, inserted))
            else:
                inserted_rows.append(row)

        connection.commit()
        self._sync()
        return QueryResult(data=inserted_rows, count=len(inserted_rows))

    def _update(self, query: TursoQuery) -> QueryResult:
        connection = self._get_connection()
        updates = dict(query.payload or {})
        if self._table_has_column(query.table_name, "updated_at") and "updated_at" not in updates:
            updates["updated_at"] = utc_now()
        assignments = ", ".join(f"{column} = ?" for column in updates)
        values = [self._encode_value(query.table_name, column, value) for column, value in updates.items()]
        where_sql, params = self._build_where(query)
        cursor = connection.execute(
            f"UPDATE {query.table_name} SET {assignments}{where_sql}",
            values + params,
        )
        connection.commit()
        self._sync()
        return QueryResult(data=[], count=cursor.rowcount)

    def _delete(self, query: TursoQuery) -> QueryResult:
        connection = self._get_connection()
        where_sql, params = self._build_where(query)
        cursor = connection.execute(f"DELETE FROM {query.table_name}{where_sql}", params)
        connection.commit()
        self._sync()
        return QueryResult(data=[], count=cursor.rowcount)

    def execute(self, query: TursoQuery) -> QueryResult:
        with self._lock:
            if query.operation == "select":
                return self._select(query)
            if query.operation == "insert":
                return self._insert(query)
            if query.operation == "update":
                return self._update(query)
            if query.operation == "delete":
                return self._delete(query)
            raise ValueError(f"Unsupported query operation: {query.operation}")

    def rpc(self, name: str, payload: dict[str, Any]) -> QueryResult:
        if name != "use_tokens":
            raise ValueError(f"Unsupported RPC '{name}'")

        user_id = payload.get("p_user_id")
        requested_tokens = float(payload.get("p_tokens") or 0)
        if not user_id or requested_tokens <= 0:
            return QueryResult(data=[False], count=1)

        connection = self._get_connection()
        profile_row = connection.execute(
            "SELECT tokens_used, tokens_limit, last_token_refresh FROM profiles WHERE id = ?",
            [user_id],
        ).fetchone()
        if profile_row is None:
            return QueryResult(data=[False], count=1)

        now = datetime.now(timezone.utc)
        last_refresh = profile_row["last_token_refresh"]
        tokens_used = float(profile_row["tokens_used"] or 0)
        tokens_limit = float(profile_row["tokens_limit"] or 20)

        if last_refresh:
            try:
                refresh_time = datetime.fromisoformat(str(last_refresh).replace("Z", "+00:00"))
            except Exception:
                refresh_time = now - timedelta(days=1)
        else:
            refresh_time = now

        if refresh_time.date() < now.date():
            tokens_used = 0

        remaining = tokens_limit - tokens_used
        if remaining < requested_tokens:
            return QueryResult(data=[False], count=1)

        new_used = tokens_used + requested_tokens
        connection.execute(
            "UPDATE profiles SET tokens_used = ?, last_token_refresh = ?, updated_at = ? WHERE id = ?",
            [new_used, utc_now(), utc_now(), user_id],
        )
        connection.commit()
        self._sync()
        return QueryResult(data=[True], count=1)


_client: Optional[TursoClient] = None


def get_turso_client() -> TursoClient:
    global _client
    if _client is None:
        _client = TursoClient()
    return _client


def database_runtime_status() -> dict[str, Any]:
    turso_url = os.getenv("TURSO_DATABASE_URL", "").strip()
    return {
        "remote_configured": bool(turso_url),
        "libsql_available": libsql is not None,
        "mode": "turso-remote" if turso_url and libsql is not None else "local-sqlite",
        "db_path": str(DB_PATH),
    }


def validate_database_connection() -> dict[str, Any]:
    client = get_turso_client()
    base_status = database_runtime_status()
    started_at = time.time()

    try:
        connection = client._get_connection()
        select_row = connection.execute("SELECT 1 AS ok").fetchone()
        select_ok = False
        if select_row is not None:
            try:
                select_ok = int(select_row["ok"]) == 1
            except Exception:
                select_ok = int(select_row[0]) == 1

        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            ).fetchall()
        ]
        required_tables = {"profiles", "chat_history", "token_usage", "generated_images"}
        missing_tables = sorted(required_tables - set(tables))

        profile_count = connection.execute("SELECT COUNT(*) FROM profiles").fetchone()[0]
        if hasattr(connection, "sync"):
            try:
                connection.sync()
                sync_result = "ok"
            except Exception as exc:
                sync_result = f"failed: {exc}"
        else:
            sync_result = "not_applicable"

        return {
            **base_status,
            "reachable": bool(select_ok),
            "schema_ready": not missing_tables,
            "missing_tables": missing_tables,
            "table_count": len(tables),
            "tables_sample": tables[:20],
            "profiles_count": int(profile_count),
            "sync_result": sync_result,
            "validated_at": time.time(),
            "duration_seconds": round(time.time() - started_at, 3),
        }
    except Exception as exc:
        return {
            **base_status,
            "reachable": False,
            "schema_ready": False,
            "missing_tables": [],
            "table_count": 0,
            "tables_sample": [],
            "profiles_count": 0,
            "sync_result": "failed",
            "validated_at": time.time(),
            "duration_seconds": round(time.time() - started_at, 3),
            "error": str(exc),
        }
