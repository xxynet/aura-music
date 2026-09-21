from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict

# Runtime switches the admin toggles from the settings UI. They live in
# backend/data/config.json so they survive restarts and travel with the data
# volume; anything unknown in the file is ignored and falls back to defaults.
DEFAULTS: Dict[str, Any] = {
  "allowRegister": True,
  "allowUpload": True,
}


class AppConfig:
  def __init__(self, path: str) -> None:
    self.path = path
    self._lock = threading.Lock()
    self._data: Dict[str, Any] = dict(DEFAULTS)
    self.reload()

  def reload(self) -> None:
    data = dict(DEFAULTS)
    try:
      with open(self.path, "r", encoding="utf-8") as f:
        stored = json.load(f)
    except FileNotFoundError:
      stored = None
    except Exception as e:
      print(f"Failed to read config {self.path}: {e}")
      stored = None
    if isinstance(stored, dict):
      for key in DEFAULTS:
        if isinstance(stored.get(key), bool):
          data[key] = stored[key]
    self._data = data

  def get(self) -> Dict[str, Any]:
    return dict(self._data)

  def update(self, patch: Dict[str, Any]) -> Dict[str, Any]:
    with self._lock:
      for key, value in patch.items():
        if key in DEFAULTS and isinstance(value, bool):
          self._data[key] = value
      tmp_path = f"{self.path}.tmp"
      with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(self._data, f, ensure_ascii=False, indent=2)
      os.replace(tmp_path, self.path)
      return dict(self._data)
