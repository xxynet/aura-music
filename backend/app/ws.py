from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket


class ConnectionManager:
  def __init__(self) -> None:
    self._rooms: Dict[str, Set[WebSocket]] = {}
    self._locks: Dict[str, asyncio.Lock] = {}
    self._viewers: Dict[str, Dict[WebSocket, Dict[str, Any]]] = {}

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
    if room_id in self._viewers:
      self._viewers[room_id].pop(ws, None)
      if not self._viewers[room_id]:
        self._viewers.pop(room_id, None)

  def set_viewer(self, room_id: str, ws: WebSocket, viewer: Dict[str, Any]) -> None:
    self._viewers.setdefault(room_id, {})[ws] = viewer

  def get_viewers_snapshot(self, room_id: str) -> Dict[str, Any]:
    room_viewers = list(self._viewers.get(room_id, {}).values())
    creator: Optional[Dict[str, Any]] = None
    viewers: List[Dict[str, Any]] = []
    for v in room_viewers:
      if v.get("isCreator"):
        if creator is None:
          creator = v
      else:
        viewers.append(v)
    return {
      "type": "VIEWERS",
      "creator": creator,
      "viewers": viewers,
    }

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

  async def broadcast_viewers(self, room_id: str) -> None:
    snapshot = self.get_viewers_snapshot(room_id)
    await self.broadcast(room_id, snapshot)

