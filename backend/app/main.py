from __future__ import annotations

import os
import re
import uuid
from typing import Any, Dict, Optional

import aiofiles
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .db import SQLiteStore
from .state import apply_command, default_room_state
from .ws import ConnectionManager


ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{3,64}$")


def validate_room_id(room_id: str) -> str:
  if not ROOM_ID_RE.match(room_id):
    raise HTTPException(status_code=400, detail="Invalid room id")
  return room_id


def ensure_dir(path: str) -> None:
  os.makedirs(path, exist_ok=True)


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_DIR = os.path.join(BASE_DIR, "media")
ensure_dir(MEDIA_DIR)

store = SQLiteStore()
manager = ConnectionManager()

app = FastAPI(title="Aura Music Sync Backend", version="0.1.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


def _load_or_create_room(room_id: str) -> Dict[str, Any]:
  existing = store.get_room(room_id)
  if existing:
    revision, state = existing
    # Ensure persisted revision matches
    state["revision"] = revision
    return state
  state = default_room_state()
  store.upsert_room(room_id, int(state["revision"]), state)
  return state


@app.get("/api/rooms/{room_id}")
def get_room_state(room_id: str) -> Dict[str, Any]:
  room_id = validate_room_id(room_id)
  return _load_or_create_room(room_id)


@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)) -> Dict[str, Any]:
  if not file.filename:
    raise HTTPException(status_code=400, detail="Missing filename")

  content_type = file.content_type or "application/octet-stream"
  media_id = uuid.uuid4().hex
  safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", file.filename)
  disk_name = f"{media_id}_{safe_name}"
  disk_path = os.path.join(MEDIA_DIR, disk_name)

  # Stream to disk
  try:
    async with aiofiles.open(disk_path, "wb") as f:
      while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
          break
        await f.write(chunk)
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Upload failed: {e}") from e

  store.put_media(media_id, file.filename, content_type, disk_path)
  return {
    "mediaId": media_id,
    "url": f"/media/{disk_name}",
    "contentType": content_type,
    "filename": file.filename,
  }


@app.websocket("/ws/rooms/{room_id}")
async def ws_room(room_id: str, ws: WebSocket) -> None:
  room_id = validate_room_id(room_id)
  await manager.connect(room_id, ws)

  try:
    # Send snapshot immediately
    state = _load_or_create_room(room_id)
    await ws.send_json({"type": "SNAPSHOT", "state": state})

    while True:
      msg = await ws.receive_json()
      if not isinstance(msg, dict):
        continue
      if msg.get("type") != "COMMAND":
        continue

      client_id = str(msg.get("clientId") or "")
      command_type = str(msg.get("command") or "")
      payload = msg.get("payload") or {}
      if not client_id or not command_type:
        continue

      lock = manager.room_lock(room_id)
      async with lock:
        current = _load_or_create_room(room_id)
        # Apply command (server is authoritative)
        next_state = apply_command(
          current,
          command_type=command_type,
          payload=payload if isinstance(payload, dict) else {},
          client_id=client_id,
        )
        # Persist + broadcast latest full state (simple + robust)
        store.upsert_room(room_id, int(next_state.get("revision") or 0), next_state)

      await manager.broadcast(room_id, {"type": "STATE", "state": next_state})

  except WebSocketDisconnect:
    manager.disconnect(room_id, ws)
  except Exception:
    manager.disconnect(room_id, ws)
    # Let FastAPI close the connection
    return

