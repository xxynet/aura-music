from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


def now_ms() -> int:
  return int(time.time() * 1000)


def compute_effective_time(state: Dict[str, Any], at_ms: Optional[int] = None) -> float:
  """
  State stores:
  - currentTime: seconds at timeUpdatedAt
  - timeUpdatedAt: epoch ms when currentTime was last updated
  - isPlaying: if true, effective time advances with wall clock
  """
  at = at_ms if at_ms is not None else now_ms()
  base_time = float(state.get("currentTime") or 0.0)
  updated_at = int(state.get("timeUpdatedAt") or at)
  if not state.get("isPlaying"):
    return max(0.0, base_time)
  delta = max(0, at - updated_at) / 1000.0
  return max(0.0, base_time + delta)


def default_permissions() -> Dict[str, Any]:
  # The host is never restricted; these flags cover everyone else.
  return {
    "guest": {"control": True, "edit": True},
    "member": {"control": True, "edit": True},
  }


def normalize_permissions(raw: Any) -> Optional[Dict[str, Any]]:
  if not isinstance(raw, dict):
    return None
  out: Dict[str, Any] = {}
  for role in ("guest", "member"):
    section = raw.get(role)
    if not isinstance(section, dict):
      return None
    out[role] = {
      "control": bool(section.get("control", True)),
      "edit": bool(section.get("edit", True)),
    }
  return out


def resolve_role(state: Dict[str, Any], user_id: Optional[int]) -> str:
  if user_id is not None and state.get("creatorUserId") == user_id:
    return "creator"
  return "member" if user_id is not None else "guest"


def allows(state: Dict[str, Any], role: str, category: str) -> bool:
  if role == "creator":
    return True
  perms = state.get("permissions")
  if not isinstance(perms, dict):
    return True
  section = perms.get(role)
  if not isinstance(section, dict):
    return True
  return bool(section.get(category, True))


# PROGRESS is already guarded by the clock-owner check and AUTO_NEXT by the
# end-of-song check in apply_command, so neither appears here.
CONTROL_COMMANDS = frozenset({
  "PLAY",
  "PAUSE",
  "TOGGLE_PLAY",
  "SEEK",
  "PLAY_INDEX",
  "SET_PLAYMODE",
  "NEXT",
  "PREV",
})
EDIT_COMMANDS = frozenset({"ADD_SONGS", "REMOVE_SONGS"})


def default_room_state() -> Dict[str, Any]:
  t = now_ms()
  return {
    "revision": 0,
    "queue": [],
    "originalQueue": [],
    "playMode": 0,  # 0 LOOP_ALL, 1 LOOP_ONE, 2 SHUFFLE
    "currentSongId": None,
    "isPlaying": False,
    "currentTime": 0.0,
    "timeUpdatedAt": t,
    "clockClientId": None,
    "creatorUserId": None,
    "creatorName": None,
    "duration": 0.0,
    "permissions": default_permissions(),
  }


def _find_index(queue: List[Dict[str, Any]], song_id: Optional[str]) -> int:
  if not song_id:
    return -1
  for i, s in enumerate(queue):
    if s.get("id") == song_id:
      return i
  return -1


def _sanitize_song(song: Dict[str, Any]) -> Dict[str, Any]:
  # Only persist + broadcast fields we want to sync strictly.
  # (lyrics/colors can be large and device-specific)
  allowed = {
    "id",
    "title",
    "artist",
    "fileUrl",
    "coverUrl",
    "isNetease",
    "neteaseId",
    "album",
  }
  out: Dict[str, Any] = {}
  for k in allowed:
    if k in song:
      out[k] = song[k]
  return out


def _shuffle_keep_current(queue: List[Dict[str, Any]], current_song_id: Optional[str]) -> List[Dict[str, Any]]:
  if not queue:
    return []
  current_idx = _find_index(queue, current_song_id)
  if current_idx == -1:
    pool = list(queue)
    random.shuffle(pool)
    return pool
  current = queue[current_idx]
  rest = [s for i, s in enumerate(queue) if i != current_idx]
  random.shuffle(rest)
  return [current, *rest]


def _ensure_current_valid(state: Dict[str, Any]) -> None:
  queue = state.get("queue") or []
  current_song_id = state.get("currentSongId")
  if not queue:
    state["currentSongId"] = None
    state["isPlaying"] = False
    state["currentTime"] = 0.0
    state["timeUpdatedAt"] = now_ms()
    state["clockClientId"] = None
    return
  if _find_index(queue, current_song_id) == -1:
    state["currentSongId"] = queue[0].get("id")
    state["currentTime"] = 0.0
    state["timeUpdatedAt"] = now_ms()


def apply_command(
  state: Dict[str, Any],
  *,
  command_type: str,
  payload: Dict[str, Any],
  client_id: str,
) -> Dict[str, Any]:
  """
  Mutates and returns state. Increments revision.
  Role-based permissions are enforced by the caller (main.py); this function
  stays the single writer of room state. "Last write wins" on arrival order
  (the server serializes per room).
  """
  t = now_ms()
  effective_time = compute_effective_time(state, t)

  def bump():
    state["revision"] = int(state.get("revision") or 0) + 1

  if command_type == "SET_PERMISSIONS":
    perms = normalize_permissions(payload.get("permissions"))
    if perms is not None:
      state["permissions"] = perms
      bump()
    return state

  if command_type == "ADD_SONGS":
    songs = payload.get("songs") or []
    sanitized = [_sanitize_song(s) for s in songs if isinstance(s, dict)]
    prev_len = len(list(state.get("queue") or []))
    state["queue"] = list(state.get("queue") or []) + sanitized
    state["originalQueue"] = list(state.get("originalQueue") or []) + sanitized
    play_song_id = payload.get("playSongId")
    autoplay_if_empty = bool(payload.get("autoplayIfEmpty"))

    if play_song_id:
      idx = _find_index(state["queue"], str(play_song_id))
      if idx != -1:
        state["currentSongId"] = state["queue"][idx].get("id")
        state["currentTime"] = 0.0
        state["timeUpdatedAt"] = t
        state["isPlaying"] = True
        state["clockClientId"] = client_id
    elif (not state.get("currentSongId")) and sanitized:
      state["currentSongId"] = sanitized[0].get("id")
      state["currentTime"] = 0.0
      state["timeUpdatedAt"] = t
      if autoplay_if_empty and prev_len == 0:
        state["isPlaying"] = True
        state["clockClientId"] = client_id
    bump()
    _ensure_current_valid(state)
    return state

  if command_type == "REMOVE_SONGS":
    ids = set(payload.get("ids") or [])
    state["queue"] = [s for s in (state.get("queue") or []) if s.get("id") not in ids]
    state["originalQueue"] = [s for s in (state.get("originalQueue") or []) if s.get("id") not in ids]
    bump()
    _ensure_current_valid(state)
    return state

  if command_type == "PLAY_INDEX":
    idx = int(payload.get("index") or 0)
    queue = list(state.get("queue") or [])
    if 0 <= idx < len(queue):
      state["currentSongId"] = queue[idx].get("id")
      state["isPlaying"] = True
      state["currentTime"] = 0.0
      state["timeUpdatedAt"] = t
      state["duration"] = 0.0
      state["clockClientId"] = client_id
      bump()
    return state

  if command_type == "PLAY":
    state["isPlaying"] = True
    state["currentTime"] = float(payload.get("currentTime") or effective_time or 0.0)
    state["timeUpdatedAt"] = t
    state["clockClientId"] = client_id
    bump()
    return state

  if command_type == "PAUSE":
    state["isPlaying"] = False
    state["currentTime"] = float(payload.get("currentTime") or effective_time or 0.0)
    state["timeUpdatedAt"] = t
    state["clockClientId"] = client_id
    bump()
    return state

  if command_type == "TOGGLE_PLAY":
    next_is_playing = not bool(state.get("isPlaying"))
    state["isPlaying"] = next_is_playing
    state["currentTime"] = float(payload.get("currentTime") or effective_time or 0.0)
    state["timeUpdatedAt"] = t
    state["clockClientId"] = client_id
    bump()
    return state

  if command_type == "SEEK":
    state["currentTime"] = float(payload.get("time") or 0.0)
    state["timeUpdatedAt"] = t
    state["clockClientId"] = client_id
    bump()
    return state

  if command_type == "PROGRESS":
    # Only accept progress from the current clock owner (or if not set)
    clock = state.get("clockClientId")
    if clock is None or clock == client_id:
      state["currentTime"] = float(payload.get("time") or effective_time or 0.0)
      state["timeUpdatedAt"] = t
      state["clockClientId"] = client_id
      track_duration = float(payload.get("duration") or 0.0)
      if track_duration > 0:
        state["duration"] = track_duration
      bump()
    return state

  if command_type == "SET_PLAYMODE":
    mode = int(payload.get("playMode") or 0)
    prev_mode = int(state.get("playMode") or 0)
    queue = list(state.get("queue") or [])
    original = list(state.get("originalQueue") or [])
    current_song_id = state.get("currentSongId")

    if mode == prev_mode:
      return state

    if mode == 2:  # SHUFFLE
      if prev_mode != 2:
        # ensure originalQueue represents canonical order when entering shuffle
        if not original:
          original = list(queue)
          state["originalQueue"] = original
      state["queue"] = _shuffle_keep_current(queue, current_song_id)
    else:
      # leaving shuffle: restore canonical order
      if prev_mode == 2 and original:
        state["queue"] = list(original)
        # keep current song if possible
        if current_song_id and _find_index(state["queue"], current_song_id) == -1:
          state["currentSongId"] = state["queue"][0].get("id") if state["queue"] else None

    state["playMode"] = mode
    bump()
    _ensure_current_valid(state)
    return state

  if command_type in ("NEXT", "PREV"):
    queue = list(state.get("queue") or [])
    if not queue:
      return state
    play_mode = int(state.get("playMode") or 0)
    current_idx = _find_index(queue, state.get("currentSongId"))
    if current_idx == -1:
      current_idx = 0

    if play_mode == 1:  # LOOP_ONE
      # restart same track
      state["currentTime"] = 0.0
      state["timeUpdatedAt"] = t
      state["isPlaying"] = True
      state["clockClientId"] = client_id
      bump()
      return state

    if command_type == "NEXT":
      next_idx = (current_idx + 1) % len(queue)
    else:
      next_idx = (current_idx - 1 + len(queue)) % len(queue)

    state["currentSongId"] = queue[next_idx].get("id")
    state["currentTime"] = 0.0
    state["timeUpdatedAt"] = t
    state["isPlaying"] = True
    state["duration"] = 0.0
    state["clockClientId"] = client_id
    bump()
    return state

  if command_type == "AUTO_NEXT":
    # Fired by clients when their audio ended. The server validates it against
    # the playback clock so nobody can skip ahead early; invalid ones are
    # silently ignored (several clients fire at once, the first wins).
    track_duration = float(state.get("duration") or 0.0)
    if not state.get("isPlaying") or track_duration <= 0:
      return state
    if effective_time < track_duration - 2.0:
      return state
    queue = list(state.get("queue") or [])
    if not queue:
      return state
    if int(state.get("playMode") or 0) == 1:  # LOOP_ONE restarts in place
      state["currentTime"] = 0.0
      state["timeUpdatedAt"] = t
      bump()
      return state
    current_idx = _find_index(queue, state.get("currentSongId"))
    if current_idx == -1:
      current_idx = 0
    next_idx = (current_idx + 1) % len(queue)
    state["currentSongId"] = queue[next_idx].get("id")
    state["currentTime"] = 0.0
    state["timeUpdatedAt"] = t
    state["isPlaying"] = True
    state["duration"] = 0.0
    # The clock owner is left untouched: only control-capable users claim it.
    bump()
    return state

  # Unknown command -> ignore
  return state


@dataclass
class RoomSnapshot:
  room_id: str
  revision: int
  state: Dict[str, Any]

