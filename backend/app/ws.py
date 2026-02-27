from __future__ import annotations

import asyncio
from typing import Any, Dict, Set

from fastapi import WebSocket


class ConnectionManager:
  def __init__(self) -> None:
    self._rooms: Dict[str, Set[WebSocket]] = {}
    self._locks: Dict[str, asyncio.Lock] = {}

  def room_lock(self, room_id: str) -> asyncio.Lock:
    if room_id not in self._locks:
      self._locks[room_id] = asyncio.Lock()
    return self._locks[room_id]

  async def connect(self, room_id: str, ws: WebSocket) -> None:
    await ws.accept()
    self._rooms.setdefault(room_id, set()).add(ws)

  def disconnect(self, room_id: str, ws: WebSocket) -> None:
    if room_id in self._rooms:
      self._rooms[room_id].discard(ws)
      if not self._rooms[room_id]:
        self._rooms.pop(room_id, None)

  async def broadcast(self, room_id: str, message: Dict[str, Any]) -> None:
    conns = list(self._rooms.get(room_id) or [])
    if not conns:
      return
    dead: list[WebSocket] = []
    for ws in conns:
      try:
        await ws.send_json(message)
      except Exception:
        dead.append(ws)
    for ws in dead:
      self.disconnect(room_id, ws)

