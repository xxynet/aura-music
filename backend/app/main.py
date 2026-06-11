from __future__ import annotations

import os
import re
import time
import uuid
from typing import Any, Dict, Optional

import aiofiles
import httpx
import jwt
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
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

# Domains allowed for the proxy endpoint (security: prevent open proxy abuse)
_PROXY_ALLOWED_HOSTS = {
    "163api.qijieya.cn",
    "api.qijieya.cn",
    "music.163.com",
}


@app.get("/api/proxy")
async def proxy_get(url: str = Query(..., description="Target URL to forward the request to")):
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.hostname not in _PROXY_ALLOWED_HOSTS:
        raise HTTPException(status_code=403, detail="Domain not allowed")
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(url)
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    except httpx.ConnectError as e:
        raise HTTPException(status_code=502, detail=f"Upstream connection failed: {e}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Upstream request timed out")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")


# ---------------------------------------------------------------------------
# Official Netease Cloud Music API proxy
# Translates between the official API response format and what the frontend expects.
# ---------------------------------------------------------------------------

_NETEASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    "Origin": "https://music.163.com/",
    "Referer": "https://music.163.com/",
}


def _transform_song(song: dict) -> dict:
    """Map official Netease API song fields to the format the frontend uses."""
    artists = [{"name": a.get("name", "")} for a in song.get("artists", [])]
    album_raw = song.get("album", {})
    album = {
        "name": album_raw.get("name", ""),
        "picUrl": (album_raw.get("picUrl") or "").replace("http://", "https://"),
    }
    return {
        "id": song["id"],
        "name": song.get("name", ""),
        "ar": artists,
        "al": album,
        "dt": song.get("duration"),
    }


@app.get("/api/netease/{action}")
async def netease_api(
    action: str,
    id: Optional[str] = None,
    ids: Optional[str] = None,
    keywords: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
):
    """Proxy to official music.163.com API with response format normalization."""
    async with httpx.AsyncClient(
        timeout=15.0, follow_redirects=True, verify=False, headers=_NETEASE_HEADERS,
    ) as client:
        if action == "search":
            if not keywords:
                raise HTTPException(400, "keywords required")
            resp = await client.post(
                "https://music.163.com/api/search/get",
                data={"s": keywords, "limit": limit, "offset": offset, "type": 1},
            )
            data = resp.json()
            songs = data.get("result", {}).get("songs", [])
            # Backfill album cover URLs (search API may omit picUrl)
            missing_pic_ids = [
                str(s["id"]) for s in songs
                if not (s.get("album") or {}).get("picUrl")
            ]
            if missing_pic_ids:
                detail_resp = await client.get(
                    f"https://music.163.com/api/song/detail/?ids=[{','.join(missing_pic_ids)}]"
                )
                detail_map = {
                    s["id"]: s for s in detail_resp.json().get("songs", [])
                }
                for song in songs:
                    if not (song.get("album") or {}).get("picUrl"):
                        detail = detail_map.get(song["id"])
                        if detail and detail.get("album", {}).get("picUrl"):
                            song.setdefault("album", {})["picUrl"] = detail["album"]["picUrl"]
            for song in songs:
                transformed = _transform_song(song)
                song.update(transformed)
            return data

        elif action == "playlist":
            if not id:
                raise HTTPException(400, "id required")
            resp = await client.get(
                f"https://music.163.com/api/v6/playlist/detail?id={id}"
            )
            data = resp.json()
            for track in data.get("playlist", {}).get("tracks", []):
                transformed = _transform_song(track)
                track.update(transformed)
            return data

        elif action == "song":
            song_ids = ids or id
            if not song_ids:
                raise HTTPException(400, "id or ids required")
            resp = await client.get(
                f"https://music.163.com/api/song/detail/?ids=[{song_ids}]"
            )
            data = resp.json()
            data["songs"] = [_transform_song(s) for s in data.get("songs", [])]
            return data

        elif action == "lyric":
            if not id:
                raise HTTPException(400, "id required")
            resp = await client.get(
                f"https://music.163.com/api/song/lyric?id={id}&lv=1&kv=1&tv=-1"
            )
            return resp.json()

        else:
            raise HTTPException(404, f"Unknown action: {action}")


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
