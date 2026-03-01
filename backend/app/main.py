from __future__ import annotations

import os
import re
import time
import uuid
from typing import Any, Dict, Optional

import aiofiles
import jwt
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jwt import InvalidTokenError
from passlib.hash import bcrypt
from pydantic import BaseModel, EmailStr, Field

from .db import SQLiteStore
from .state import apply_command, default_room_state
from .ws import ConnectionManager


ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{3,64}$")


JWT_SECRET = os.environ.get("AURA_JWT_SECRET", "aura-dev-secret")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


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


class UserOut(BaseModel):
  id: int
  username: str
  email: Optional[EmailStr] = None


class RegisterRequest(BaseModel):
  username: str = Field(min_length=3, max_length=50)
  email: Optional[EmailStr] = None
  password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
  usernameOrEmail: str = Field(min_length=1, max_length=255)
  password: str = Field(min_length=1, max_length=128)


def _hash_password(password: str) -> str:
  return bcrypt.hash(password)


def _verify_password(password: str, password_hash: str) -> bool:
  try:
    return bcrypt.verify(password, password_hash)
  except Exception:
    return False


def _create_access_token(user_id: int) -> str:
  now = int(time.time())
  exp = now + ACCESS_TOKEN_EXPIRE_MINUTES * 60
  payload = {"sub": str(user_id), "exp": exp}
  return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> Optional[int]:
  try:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
  except InvalidTokenError:
    return None
  sub = payload.get("sub")
  try:
    return int(sub)
  except Exception:
    return None


def _user_from_record(record: Dict[str, Any]) -> UserOut:
  return UserOut(id=int(record["id"]), username=str(record["username"]), email=record.get("email"))


async def get_current_user(request: Request) -> UserOut:
  user = await get_current_user_optional(request)
  if not user:
    raise HTTPException(status_code=401, detail="Not authenticated")
  return user


async def get_current_user_optional(request: Request) -> Optional[UserOut]:
  auth = request.headers.get("authorization") or ""
  token: Optional[str] = None
  if auth.lower().startswith("bearer "):
    token = auth.split(" ", 1)[1].strip() or None
  if not token:
    token = request.cookies.get("access_token")
  if not token:
    return None
  user_id = _decode_token(token)
  if not user_id:
    return None
  record = store.get_user_by_id(user_id)
  if not record:
    return None
  return _user_from_record(record)


async def get_current_user_from_ws(ws: WebSocket) -> Optional[UserOut]:
  auth = ws.headers.get("authorization") or ""
  token: Optional[str] = None
  if auth.lower().startswith("bearer "):
    token = auth.split(" ", 1)[1].strip() or None
  if not token:
    token = ws.cookies.get("access_token")
  if not token:
    return None
  user_id = _decode_token(token)
  if not user_id:
    return None
  record = store.get_user_by_id(user_id)
  if not record:
    return None
  return _user_from_record(record)


app = FastAPI(title="Aura Music Sync Backend", version="0.1.0")

cors_origins_env = os.environ.get("AURA_CORS_ORIGINS") or ""
if cors_origins_env:
  allow_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
  allow_credentials = True
else:
  allow_origins = ["*"]
  allow_credentials = False

app.add_middleware(
  CORSMiddleware,
  allow_origins=allow_origins,
  allow_credentials=allow_credentials,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


def _load_or_create_room(room_id: str) -> Dict[str, Any]:
  existing = store.get_room(room_id)
  if existing:
    revision, state = existing
    state["revision"] = revision
    return state
  state = default_room_state()
  store.upsert_room(room_id, int(state["revision"]), state)
  return state


@app.post("/api/auth/register")
def register(body: RegisterRequest) -> Dict[str, Any]:
  username = body.username.strip()
  email = body.email.strip() if body.email else None
  existing = store.get_user_by_username_or_email(username)
  if existing:
    raise HTTPException(status_code=400, detail="Username already taken")
  if email:
    existing_email = store.get_user_by_username_or_email(email)
    if existing_email:
      raise HTTPException(status_code=400, detail="Email already registered")
  password_hash = _hash_password(body.password)
  created_at = int(time.time() * 1000)
  record = store.create_user(username=username, email=email, password_hash=password_hash, created_at=created_at)
  user = _user_from_record(record)
  return {"user": user.model_dump()}


@app.post("/api/auth/login")
def login(body: LoginRequest, response: Response) -> Dict[str, Any]:
  identifier = body.usernameOrEmail.strip()
  record = store.get_user_by_username_or_email(identifier)
  if not record:
    raise HTTPException(status_code=400, detail="Invalid credentials")
  if not _verify_password(body.password, record["password_hash"]):
    raise HTTPException(status_code=400, detail="Invalid credentials")
  user = _user_from_record(record)
  token = _create_access_token(user.id)
  response.set_cookie(
    "access_token",
    token,
    httponly=True,
    samesite="lax",
  )
  return {"user": user.model_dump()}


@app.post("/api/auth/logout")
def logout(response: Response) -> Dict[str, Any]:
  response.delete_cookie("access_token")
  return {"ok": True}


@app.get("/api/auth/me")
async def me(user: UserOut = Depends(get_current_user)) -> Dict[str, Any]:
  return {"user": user.model_dump()}


@app.get("/api/rooms/{room_id}")
async def get_room_state(room_id: str, request: Request) -> Dict[str, Any]:
  room_id = validate_room_id(room_id)
  state = _load_or_create_room(room_id)
  user = await get_current_user_optional(request)
  if user and state.get("creatorUserId") is None:
    state["creatorUserId"] = user.id
    state["creatorName"] = user.username
    store.upsert_room(room_id, int(state.get("revision") or 0), state)
  return state


@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)) -> Dict[str, Any]:
  if not file.filename:
    raise HTTPException(status_code=400, detail="Missing filename")

  content_type = file.content_type or "application/octet-stream"
  media_id = uuid.uuid4().hex
  safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", file.filename)
  disk_name = f"{media_id}_{safe_name}"
  disk_path = os.path.join(MEDIA_DIR, disk_name)

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
  user = await get_current_user_from_ws(ws)
  viewer_display_name: str
  viewer_user_id: Optional[int]
  is_guest = user is None
  if user:
    viewer_display_name = user.username
    viewer_user_id = user.id
  else:
    raw_name = ws.query_params.get("displayName")
    safe_name = (raw_name or "").strip()
    if safe_name:
      viewer_display_name = safe_name[:64]
    else:
      suffix = uuid.uuid4().hex[:4].upper()
      viewer_display_name = f"Guest {suffix}"
    viewer_user_id = None

  try:
    lock = manager.room_lock(room_id)
    async with lock:
      state = _load_or_create_room(room_id)
      if user and state.get("creatorUserId") is None:
        state["creatorUserId"] = user.id
        state["creatorName"] = user.username
        store.upsert_room(room_id, int(state.get("revision") or 0), state)
    manager.set_viewer(
      room_id,
      ws,
      {
        "userId": viewer_user_id,
        "displayName": viewer_display_name,
        "isGuest": is_guest,
        "isCreator": bool(user and state.get("creatorUserId") == user.id),
      },
    )
    await manager.broadcast_viewers(room_id)
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
        next_state = apply_command(
          current,
          command_type=command_type,
          payload=payload if isinstance(payload, dict) else {},
          client_id=client_id,
        )
        store.upsert_room(room_id, int(next_state.get("revision") or 0), next_state)

      await manager.broadcast(room_id, {"type": "STATE", "state": next_state})

  except WebSocketDisconnect:
    manager.disconnect(room_id, ws)
    await manager.broadcast_viewers(room_id)
  except Exception:
    manager.disconnect(room_id, ws)
    await manager.broadcast_viewers(room_id)
    return
