from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional, Tuple


def _default_db_path() -> str:
  # Store DB alongside backend folder
  base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
  return os.path.join(base_dir, "data.sqlite3")


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
          path TEXT NOT NULL
        )
        """,
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

  def put_media(self, media_id: str, filename: str, content_type: str, path: str) -> None:
    with self._conn() as conn:
      conn.execute(
        """
        INSERT INTO media(media_id, filename, content_type, path)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          filename=excluded.filename,
          content_type=excluded.content_type,
          path=excluded.path
        """,
        (media_id, filename, content_type, path),
      )

  def get_media(self, media_id: str) -> Optional[Dict[str, str]]:
    with self._conn() as conn:
      row = conn.execute(
        "SELECT media_id, filename, content_type, path FROM media WHERE media_id=?",
        (media_id,),
      ).fetchone()
      if not row:
        return None
      return {
        "media_id": str(row["media_id"]),
        "filename": str(row["filename"]),
        "content_type": str(row["content_type"]),
        "path": str(row["path"]),
      }

