from __future__ import annotations

import mimetypes
import hashlib
import os
import re
import secrets
import time
import uuid
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import aiofiles
import httpx
import jwt
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jwt import InvalidTokenError
from passlib.hash import bcrypt
from pydantic import BaseModel, EmailStr, Field

from .config import AppConfig
from .db import SQLiteStore
from .state import (
  CONTROL_COMMANDS,
  EDIT_COMMANDS,
  allows,
  apply_command,
  default_permissions,
  default_room_state,
  resolve_role,
)
from .ws import ConnectionManager


ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{3,64}$")
AUDIO_EXTENSIONS = frozenset({
  ".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm",
})
IMAGE_EXTENSIONS = frozenset({
  ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp",
})
MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024

# Custom websocket close codes surfaced to the frontend.
ROOM_MISSING_CLOSE_CODE = 4404
ROOM_DELETED_CLOSE_CODE = 4405


JWT_SECRET = os.environ.get("AURA_JWT_SECRET", "aura-dev-secret")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("AURA_ACCESS_TOKEN_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("AURA_REFRESH_TOKEN_DAYS", "30"))


def validate_room_id(room_id: str) -> str:
  if not ROOM_ID_RE.match(room_id):
    raise HTTPException(status_code=400, detail="Invalid room id")
  return room_id


def ensure_dir(path: str) -> None:
  os.makedirs(path, exist_ok=True)


def detect_media_type(data: bytes) -> Optional[str]:
  if data.startswith(b"\xff\xd8\xff"):
    return "image/jpeg"
  if data.startswith(b"\x89PNG\r\n\x1a\n"):
    return "image/png"
  if data.startswith((b"GIF87a", b"GIF89a")):
    return "image/gif"
  if data.startswith(b"BM"):
    return "image/bmp"
  if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
    return "image/webp"
  if len(data) >= 12 and data[4:12] in (b"ftypavif", b"ftypavis"):
    return "image/avif"
  if data.startswith(b"fLaC"):
    return "audio/flac"
  if data.startswith(b"OggS"):
    return "audio/ogg"
  if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
    return "audio/wav"
  if data.startswith(b"\x1a\x45\xdf\xa3"):
    return "audio/webm"
  if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xff and data[1] & 0xe0 == 0xe0):
    return "audio/mpeg"
  if len(data) >= 12 and data[4:8] == b"ftyp":
    return "audio/mp4"
  return None


def is_allowed_media(filename: str, media_type: Optional[str]) -> bool:
  extension = os.path.splitext(filename.lower())[1]
  if extension in AUDIO_EXTENSIONS:
    return bool(media_type and media_type.startswith("audio/"))
  if extension in IMAGE_EXTENSIONS or extension == ".cover":
    return bool(media_type and media_type.startswith("image/"))
  return False


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
MEDIA_DIR = os.path.join(DATA_DIR, "media")
DB_PATH = os.path.join(DATA_DIR, "data.db")

# One-time relocation from the legacy layout (backend/data.sqlite3 +
# backend/media/) into backend/data/ so existing deployments keep their data.
LEGACY_DB_PATH = os.path.join(BASE_DIR, "data.sqlite3")
LEGACY_MEDIA_DIR = os.path.join(BASE_DIR, "media")
os.makedirs(DATA_DIR, exist_ok=True)
if not os.path.exists(DB_PATH) and os.path.exists(LEGACY_DB_PATH):
  os.replace(LEGACY_DB_PATH, DB_PATH)
if not os.path.exists(MEDIA_DIR) and os.path.exists(LEGACY_MEDIA_DIR):
  os.replace(LEGACY_MEDIA_DIR, MEDIA_DIR)
ensure_dir(MEDIA_DIR)

store = SQLiteStore(DB_PATH)
store.relativize_media_paths()
config = AppConfig(os.path.join(DATA_DIR, "config.json"))
manager = ConnectionManager()


class UserOut(BaseModel):
  id: int
  username: str
  email: Optional[EmailStr] = None
  role: str = "user"


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


def _hash_token(token: str) -> str:
  return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_refresh_token(user_id: int) -> str:
  token = secrets.token_urlsafe(48)
  now = int(time.time())
  store.create_refresh_token(
    _hash_token(token),
    user_id,
    now + REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    now,
  )
  return token


def _set_auth_cookies(response: Response, user_id: int) -> None:
  response.set_cookie(
    "access_token",
    _create_access_token(user_id),
    max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    httponly=True,
    samesite="lax",
  )
  # Scoped to the auth endpoints so the long-lived credential is not attached
  # to every API call; refresh/logout below must delete with the same path.
  response.set_cookie(
    "refresh_token",
    _issue_refresh_token(user_id),
    max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    httponly=True,
    samesite="lax",
    path="/api/auth",
  )


def _login_user(response: Response, user: UserOut) -> Dict[str, Any]:
  _set_auth_cookies(response, user.id)
  return {"user": user.model_dump()}


def _user_from_record(record: Dict[str, Any]) -> UserOut:
  return UserOut(
    id=int(record["id"]),
    username=str(record["username"]),
    email=record.get("email"),
    role=str(record.get("role") or "user"),
  )


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


async def get_current_admin(user: UserOut = Depends(get_current_user)) -> UserOut:
  if user.role != "admin":
    raise HTTPException(status_code=403, detail="Admin privileges required")
  return user


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


def is_allowed_proxy_url(url: str) -> bool:
  parsed = urlparse(url)
  try:
    port = parsed.port
  except ValueError:
    return False
  return (
    parsed.scheme == "https"
    and parsed.hostname is not None
    and parsed.hostname.lower() in _PROXY_ALLOWED_HOSTS
    and parsed.username is None
    and parsed.password is None
    and port in (None, 443)
  )


@app.get("/api/proxy")
async def proxy_get(
  url: str = Query(..., min_length=1, max_length=2048, description="Target URL to forward the request to"),
) -> Response:
  if not is_allowed_proxy_url(url):
    raise HTTPException(status_code=403, detail="Only approved HTTPS hosts are allowed")
  try:
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
      async with client.stream("GET", url) as resp:
        if resp.is_redirect:
          raise HTTPException(status_code=502, detail="Upstream redirects are not allowed")
        data = bytearray()
        async for chunk in resp.aiter_bytes():
          data.extend(chunk)
          if len(data) > MAX_PROXY_RESPONSE_BYTES:
            raise HTTPException(status_code=502, detail="Upstream response is too large")
        return Response(content=bytes(data), status_code=resp.status_code, media_type="application/json")
  except HTTPException:
    raise
  except httpx.ConnectError as err:
    raise HTTPException(status_code=502, detail=f"Upstream connection failed: {err}") from err
  except httpx.TimeoutException as err:
    raise HTTPException(status_code=504, detail="Upstream request timed out") from err
  except httpx.HTTPError as err:
    raise HTTPException(status_code=502, detail="Upstream request failed") from err


async def netease_request(
  client: httpx.AsyncClient,
  method: str,
  url: str,
  **kwargs: Any,
) -> httpx.Response:
  try:
    resp = await client.request(method, url, **kwargs)
    if resp.is_redirect:
      raise HTTPException(status_code=502, detail="Upstream redirects are not allowed")
    resp.raise_for_status()
    return resp
  except HTTPException:
    raise
  except httpx.TimeoutException as err:
    raise HTTPException(status_code=504, detail="Music service timed out") from err
  except httpx.HTTPError as err:
    raise HTTPException(status_code=502, detail="Music service request failed") from err


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
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
):
    """Proxy to official music.163.com API with response format normalization."""
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False, headers=_NETEASE_HEADERS) as client:
        if action == "search":
            if not keywords:
                raise HTTPException(400, "keywords required")
            resp = await netease_request(
                client,
                "POST",
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
                detail_resp = await netease_request(
                    client,
                    "GET",
                    f"https://music.163.com/api/song/detail/?ids=[{','.join(missing_pic_ids)}]",
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
            resp = await netease_request(
                client,
                "GET",
                f"https://music.163.com/api/v6/playlist/detail?id={id}",
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
            # Clients may send bare ids or a bracketed list; unwrap before wrapping again.
            song_ids = song_ids.strip().strip("[]")
            resp = await netease_request(
                client,
                "GET",
                f"https://music.163.com/api/song/detail/?ids=[{song_ids}]",
            )
            data = resp.json()
            data["songs"] = [_transform_song(s) for s in data.get("songs", [])]
            return data

        elif action == "lyric":
            if not id:
                raise HTTPException(400, "id required")
            resp = await netease_request(
                client,
                "GET",
                f"https://music.163.com/api/song/lyric?id={id}&lv=1&kv=1&tv=-1",
            )
            return resp.json()

        else:
            raise HTTPException(404, f"Unknown action: {action}")


def _load_room(room_id: str) -> Optional[Dict[str, Any]]:
  existing = store.get_room(room_id)
  if not existing:
    return None
  revision, state = existing
  state["revision"] = revision
  # Rooms stored before permissions existed keep their open behavior.
  state.setdefault("permissions", default_permissions())
  state.setdefault("duration", 0.0)
  return state


@app.post("/api/auth/register")
def register(body: RegisterRequest, response: Response) -> Dict[str, Any]:
  if not store.has_any_user():
    # The very first account must be the admin created via /api/auth/init-admin
    # so a random visitor cannot claim it before the operator does.
    raise HTTPException(status_code=403, detail="Admin account must be initialized first")
  if not config.get()["allowRegister"]:
    raise HTTPException(status_code=403, detail="Registration is disabled")
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
  return _login_user(response, _user_from_record(record))


@app.post("/api/auth/login")
def login(body: LoginRequest, response: Response) -> Dict[str, Any]:
  identifier = body.usernameOrEmail.strip()
  record = store.get_user_by_username_or_email(identifier)
  if not record:
    raise HTTPException(status_code=400, detail="Invalid credentials")
  if not _verify_password(body.password, record["password_hash"]):
    raise HTTPException(status_code=400, detail="Invalid credentials")
  store.purge_expired_tokens(int(time.time()))
  return _login_user(response, _user_from_record(record))


@app.post("/api/auth/refresh")
def refresh(request: Request, response: Response) -> Dict[str, Any]:
  token = request.cookies.get("refresh_token") or ""
  hashed = _hash_token(token) if token else ""
  record = store.get_refresh_token(hashed) if hashed else None
  if record and record["expires_at"] < int(time.time()):
    store.delete_refresh_token(hashed)
    record = None
  if not record:
    raise HTTPException(status_code=401, detail="Session expired")
  user_record = store.get_user_by_id(record["user_id"])
  if not user_record:
    store.delete_refresh_token(hashed)
    raise HTTPException(status_code=401, detail="Session expired")
  # Rotation: the presented token is consumed and a fresh pair is issued, so
  # a stolen token stops working on the next refresh.
  store.delete_refresh_token(hashed)
  return _login_user(response, _user_from_record(user_record))


@app.post("/api/auth/logout")
def logout(request: Request, response: Response) -> Dict[str, Any]:
  token = request.cookies.get("refresh_token")
  if token:
    store.delete_refresh_token(_hash_token(token))
  response.delete_cookie("access_token")
  response.delete_cookie("refresh_token", path="/api/auth")
  return {"ok": True}


@app.get("/api/auth/me")
async def me(user: UserOut = Depends(get_current_user)) -> Dict[str, Any]:
  return {"user": user.model_dump()}


@app.get("/api/auth/status")
async def auth_status(request: Request) -> Dict[str, Any]:
  user = await get_current_user_optional(request)
  return {"initialized": store.has_any_user(), "user": user.model_dump() if user else None}


@app.post("/api/auth/init-admin")
def init_admin(body: RegisterRequest, response: Response) -> Dict[str, Any]:
  if store.has_any_user():
    raise HTTPException(status_code=409, detail="Admin account already initialized")
  username = body.username.strip()
  email = body.email.strip() if body.email else None
  password_hash = _hash_password(body.password)
  created_at = int(time.time() * 1000)
  record = store.create_user(username=username, email=email, password_hash=password_hash, created_at=created_at, role="admin")
  return _login_user(response, _user_from_record(record))


class CreateRoomRequest(BaseModel):
  roomId: Optional[str] = None


@app.post("/api/rooms")
async def create_room(
  body: CreateRoomRequest,
  user: UserOut = Depends(get_current_user),
) -> Dict[str, Any]:
  if user.role != "admin" and not config.get()["allowRoomCreate"]:
    raise HTTPException(status_code=403, detail="Room creation is disabled")
  room_id = (body.roomId or "").strip() or uuid.uuid4().hex[:8]
  room_id = validate_room_id(room_id)
  if _load_room(room_id) is not None:
    raise HTTPException(status_code=409, detail="Room already exists")
  state = default_room_state()
  state["creatorUserId"] = user.id
  state["creatorName"] = user.username
  store.upsert_room(room_id, int(state["revision"]), state)
  return {"ok": True, "roomId": room_id}


@app.get("/api/rooms/{room_id}")
async def get_room_state(room_id: str, request: Request) -> Dict[str, Any]:
  room_id = validate_room_id(room_id)
  state = _load_room(room_id)
  if state is None:
    raise HTTPException(status_code=404, detail="Room not found")
  user = await get_current_user_optional(request)
  if user and state.get("creatorUserId") is None:
    state["creatorUserId"] = user.id
    state["creatorName"] = user.username
    store.upsert_room(room_id, int(state.get("revision") or 0), state)
  return state


@app.delete("/api/rooms/{room_id}")
async def delete_room_endpoint(room_id: str, user: UserOut = Depends(get_current_user)) -> Dict[str, Any]:
  room_id = validate_room_id(room_id)
  state = _load_room(room_id)
  if state is None:
    raise HTTPException(status_code=404, detail="Room not found")
  if state.get("creatorUserId") != user.id:
    raise HTTPException(status_code=403, detail="Only the room host can delete this room")
  store.delete_room(room_id)
  await manager.close_room(
    room_id,
    code=ROOM_DELETED_CLOSE_CODE,
    message={"type": "ERROR", "code": "ROOM_DELETED"},
  )
  return {"ok": True}


@app.post("/api/upload")
async def upload_media(
  file: UploadFile = File(...),
  user: Optional[UserOut] = Depends(get_current_user_optional),
) -> Dict[str, Any]:
  cfg = config.get()
  if user is None and not cfg["allowGuestUpload"]:
    raise HTTPException(status_code=401, detail="Sign in to upload media")
  if not cfg["allowUpload"] and (user is None or user.role != "admin"):
    raise HTTPException(status_code=403, detail="Uploads are disabled")
  if not file.filename:
    raise HTTPException(status_code=400, detail="Missing filename")

  head = await file.read(32)
  await file.seek(0)
  content_type = detect_media_type(head)
  if not is_allowed_media(file.filename, content_type):
    raise HTTPException(status_code=415, detail="Only supported audio and image files can be uploaded")
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

  # Store the path relative to the media dir so the database stays portable.
  store.put_media(media_id, file.filename, content_type, disk_name, uploader_id=user.id if user else None)
  return {
    "mediaId": media_id,
    "url": f"/media/{disk_name}",
    "contentType": content_type,
    "filename": file.filename,
  }


# ---------------------------------------------------------------------------
# Admin-only management: runtime config, users, rooms.
# ---------------------------------------------------------------------------

class AdminConfigUpdate(BaseModel):
  allowRegister: Optional[bool] = None
  allowUpload: Optional[bool] = None
  allowGuestUpload: Optional[bool] = None
  allowRoomCreate: Optional[bool] = None


@app.get("/api/admin/config")
async def admin_get_config(admin: UserOut = Depends(get_current_admin)) -> Dict[str, Any]:
  return config.get()


@app.put("/api/admin/config")
async def admin_update_config(
  body: AdminConfigUpdate,
  admin: UserOut = Depends(get_current_admin),
) -> Dict[str, Any]:
  patch = body.model_dump(exclude_none=True)
  if not patch:
    raise HTTPException(status_code=400, detail="Nothing to update")
  return config.update(patch)


@app.get("/api/admin/users")
async def admin_list_users(admin: UserOut = Depends(get_current_admin)) -> Dict[str, Any]:
  return {"users": store.list_users()}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(
  user_id: int,
  admin: UserOut = Depends(get_current_admin),
) -> Dict[str, Any]:
  if user_id == admin.id:
    raise HTTPException(status_code=400, detail="Cannot delete your own account")
  if not store.delete_user(user_id):
    raise HTTPException(status_code=404, detail="User not found")
  return {"ok": True}


@app.get("/api/admin/rooms")
async def admin_list_rooms(admin: UserOut = Depends(get_current_admin)) -> Dict[str, Any]:
  return {"rooms": store.list_rooms()}


@app.delete("/api/admin/rooms/{room_id}")
async def admin_delete_room(
  room_id: str,
  admin: UserOut = Depends(get_current_admin),
) -> Dict[str, Any]:
  room_id = validate_room_id(room_id)
  if not store.delete_room(room_id):
    raise HTTPException(status_code=404, detail="Room not found")
  await manager.close_room(
    room_id,
    code=ROOM_DELETED_CLOSE_CODE,
    message={"type": "ERROR", "code": "ROOM_DELETED"},
  )
  return {"ok": True}


@app.websocket("/ws/rooms/{room_id}")
async def ws_room(room_id: str, ws: WebSocket) -> None:
  room_id = validate_room_id(room_id)
  await manager.connect(room_id, ws)
  try:
    if _load_room(room_id) is None:
      await ws.send_json({"type": "ERROR", "code": "ROOM_NOT_FOUND"})
      await ws.close(code=ROOM_MISSING_CLOSE_CODE)
      return
  except Exception:
    manager.disconnect(room_id, ws)
    return
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
      state = _load_room(room_id)
      if user and state and state.get("creatorUserId") is None:
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
        "isCreator": bool(user and state and state.get("creatorUserId") == user.id),
      },
    )
    await manager.broadcast_viewers(room_id)
    state = _load_room(room_id)
    if state is None:
      # Deleted between the initial check and the snapshot.
      await ws.send_json({"type": "ERROR", "code": "ROOM_NOT_FOUND"})
      await ws.close(code=ROOM_MISSING_CLOSE_CODE)
      return
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

      allowed = True
      next_state = None
      lock = manager.room_lock(room_id)
      async with lock:
        current = _load_room(room_id)
        if current is None:
          # The room was deleted while this client was connected.
          await ws.send_json({"type": "ERROR", "code": "ROOM_DELETED"})
          await ws.close(code=ROOM_DELETED_CLOSE_CODE)
          break
        role = resolve_role(current, viewer_user_id)
        payload = payload if isinstance(payload, dict) else {}
        if command_type == "SET_PERMISSIONS":
          allowed = role == "creator"
        elif command_type in ("PROGRESS", "AUTO_NEXT"):
          allowed = True
        elif command_type in CONTROL_COMMANDS:
          allowed = allows(current, role, "control")
        elif command_type in EDIT_COMMANDS:
          allowed = allows(current, role, "edit")
        if allowed and command_type == "ADD_SONGS" and not allows(current, role, "control"):
          # May edit but not control: adding must not jump or start playback.
          payload = {
            k: v for k, v in payload.items()
            if k not in ("playSongId", "autoplayIfEmpty")
          }
        if allowed:
          next_state = apply_command(
            current,
            command_type=command_type,
            payload=payload,
            client_id=client_id,
          )
          store.upsert_room(room_id, int(next_state.get("revision") or 0), next_state)

      if next_state is not None:
        await manager.broadcast(room_id, {"type": "STATE", "state": next_state})
      else:
        await ws.send_json({"type": "ERROR", "code": "PERMISSION_DENIED"})

  except WebSocketDisconnect:
    pass
  except Exception:
    pass
  finally:
    manager.disconnect(room_id, ws)
    await manager.broadcast_viewers(room_id)


# ---------------------------------------------------------------------------
# Built frontend hosting (production). When a Vite build is present, the
# backend serves the SPA itself so one process hosts the API and the app.
# AURA_STATIC_DIR overrides the location (a missing dir disables hosting).
# ---------------------------------------------------------------------------

STATIC_DIR = os.path.realpath(
  os.environ.get("AURA_STATIC_DIR") or os.path.join(os.path.dirname(BASE_DIR), "dist")
)
STATIC_INDEX = os.path.join(STATIC_DIR, "index.html")

# Windows registries map .js to text/plain, which browsers may refuse to run.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")

if os.path.isfile(STATIC_INDEX):
  print(f"Serving built frontend from {STATIC_DIR}")

  @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
  async def spa(path: str) -> Response:
    # Registered after every API route, so real endpoints still match first;
    # this only keeps unknown /api, /ws and /media paths returning 404 JSON.
    if path.startswith(("api/", "ws/", "media/")) or path in ("api", "ws", "media"):
      raise HTTPException(status_code=404, detail="Not found")
    candidate = os.path.realpath(os.path.join(STATIC_DIR, path))
    if candidate.startswith(STATIC_DIR + os.sep) and os.path.isfile(candidate):
      # Vite fingerprints everything under assets/, so those files are safe
      # to cache forever; index.html and the PWA entry must revalidate.
      cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
      return FileResponse(candidate, headers={"Cache-Control": cache})
    return FileResponse(STATIC_INDEX, headers={"Cache-Control": "no-cache"})
