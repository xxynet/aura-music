from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional, Tuple


def _default_db_path() -> str:
  base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  return os.path.join(base_dir, "data", "data.db")


def _columns(conn: sqlite3.Connection, table: str) -> set:
  rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
  return {str(row["name"]) for row in rows}


class SQLiteStore:
  def __init__(self, db_path: Optional[str] = None) -> None:
    self.db_path = db_path or _default_db_path()
    self._init()

  def _connect(self) -> sqlite3.Connection:
    conn = sqlite3.connect(self.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

  @contextmanager
  def _conn(self) -> Iterator[sqlite3.Connection]:
    conn = self._connect()
    try:
      yield conn
      conn.commit()
    finally:
      conn.close()

  def _init(self) -> None:
    with self._conn() as conn:
      conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rooms (
          room_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL
        )
        """,
      )
      conn.execute(
        """
        CREATE TABLE IF NOT EXISTS media (
          media_id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          path TEXT NOT NULL,
          uploader_id INTEGER
        )
        """,
      )
      conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          email TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          created_at INTEGER NOT NULL
        )
        """,
      )
      # Legacy databases predate the role / uploader_id columns.
      if "role" not in _columns(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
      if "uploader_id" not in _columns(conn, "media"):
        conn.execute("ALTER TABLE media ADD COLUMN uploader_id INTEGER")
      conn.execute(
        """
        CREATE TABLE IF NOT EXISTS room_viewers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          user_id INTEGER,
          client_id TEXT,
          display_name TEXT NOT NULL,
          last_seen_ms INTEGER NOT NULL
        )
        """,
      )
      conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_room_viewers_room
        ON room_viewers(room_id)
        """
      )

  def get_room(self, room_id: str) -> Optional[Tuple[int, Dict[str, Any]]]:
    with self._conn() as conn:
      row = conn.execute(
        "SELECT revision, state_json FROM rooms WHERE room_id = ?",
        (room_id,),
      ).fetchone()
      if not row:
        return None
      return int(row["revision"]), json.loads(row["state_json"])

  def upsert_room(self, room_id: str, revision: int, state: Dict[str, Any]) -> None:
    with self._conn() as conn:
      conn.execute(
        """
        INSERT INTO rooms(room_id, revision, state_json)
        VALUES(?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          revision=excluded.revision,
          state_json=excluded.state_json
        """,
        (room_id, revision, json.dumps(state, ensure_ascii=False)),
      )

  def delete_room(self, room_id: str) -> bool:
    with self._conn() as conn:
      deleted = conn.execute(
        "DELETE FROM rooms WHERE room_id = ?",
        (room_id,),
      ).rowcount
      conn.execute("DELETE FROM room_viewers WHERE room_id = ?", (room_id,))
      return deleted > 0

  def list_rooms(self) -> list:
    with self._conn() as conn:
      rows = conn.execute(
        "SELECT room_id, revision, state_json FROM rooms ORDER BY room_id"
      ).fetchall()
    rooms = []
    for row in rows:
      try:
        state = json.loads(row["state_json"])
      except Exception:
        continue
      if not isinstance(state, dict):
        continue
      rooms.append({
        "roomId": str(row["room_id"]),
        "revision": int(row["revision"]),
        "creatorUserId": state.get("creatorUserId"),
        "creatorName": state.get("creatorName"),
        "songCount": len(state.get("queue") or []),
        "isPlaying": bool(state.get("isPlaying")),
      })
    return rooms

  def put_media(self, media_id: str, filename: str, content_type: str, path: str, uploader_id: Optional[int] = None) -> None:
    with self._conn() as conn:
      conn.execute(
        """
        INSERT INTO media(media_id, filename, content_type, path, uploader_id)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          filename=excluded.filename,
          content_type=excluded.content_type,
          path=excluded.path,
          uploader_id=excluded.uploader_id
        """,
        (media_id, filename, content_type, path, uploader_id),
      )

  def get_media(self, media_id: str) -> Optional[Dict[str, Any]]:
    with self._conn() as conn:
      row = conn.execute(
        "SELECT media_id, filename, content_type, path, uploader_id FROM media WHERE media_id=?",
        (media_id,),
      ).fetchone()
      if not row:
        return None
      return {
        "media_id": str(row["media_id"]),
        "filename": str(row["filename"]),
        "content_type": str(row["content_type"]),
        "path": str(row["path"]),
        "uploader_id": int(row["uploader_id"]) if row["uploader_id"] is not None else None,
      }

  # Legacy rows stored absolute paths; the media dir may move, so keep only
  # the part relative to the media root (the file name) in the database.
  def relativize_media_paths(self) -> None:
    with self._conn() as conn:
      rows = conn.execute("SELECT media_id, path FROM media").fetchall()
      for row in rows:
        path = str(row["path"])
        if os.path.isabs(path):
          conn.execute(
            "UPDATE media SET path = ? WHERE media_id = ?",
            (os.path.basename(path), str(row["media_id"])),
          )

  def has_any_user(self) -> bool:
    with self._conn() as conn:
      row = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
      return row is not None

  def create_user(self, username: str, email: Optional[str], password_hash: str, created_at: int, role: str = "user") -> Dict[str, Any]:
    with self._conn() as conn:
      cur = conn.execute(
        """
        INSERT INTO users(username, email, password_hash, role, created_at)
        VALUES(?, ?, ?, ?, ?)
        """,
        (username, email, password_hash, role, created_at),
      )
      user_id = int(cur.lastrowid)
      return {"id": user_id, "username": username, "email": email, "role": role}

  def get_user_by_username_or_email(self, identifier: str) -> Optional[Dict[str, Any]]:
    with self._conn() as conn:
      row = conn.execute(
        """
        SELECT id, username, email, password_hash, role
        FROM users
        WHERE username = ? OR email = ?
        LIMIT 1
        """,
        (identifier, identifier),
      ).fetchone()
      if not row:
        return None
      return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "email": str(row["email"]) if row["email"] is not None else None,
        "password_hash": str(row["password_hash"]),
        "role": str(row["role"]),
      }

  def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
    with self._conn() as conn:
      row = conn.execute(
        """
        SELECT id, username, email, role
        FROM users
        WHERE id = ?
        """,
        (user_id,),
      ).fetchone()
      if not row:
        return None
      return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "email": str(row["email"]) if row["email"] is not None else None,
        "role": str(row["role"]),
      }

  def list_users(self) -> list:
    with self._conn() as conn:
      rows = conn.execute(
        """
        SELECT id, username, email, role, created_at
        FROM users
        ORDER BY id
        """
      ).fetchall()
    return [
      {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "email": str(row["email"]) if row["email"] is not None else None,
        "role": str(row["role"]),
        "created_at": int(row["created_at"]),
      }
      for row in rows
    ]

  def delete_user(self, user_id: int) -> bool:
    with self._conn() as conn:
      return conn.execute(
        "DELETE FROM users WHERE id = ?",
        (user_id,),
      ).rowcount > 0

