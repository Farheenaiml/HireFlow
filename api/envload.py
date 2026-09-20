"""Tiny .env loader so `uvicorn main:app` just works (no python-dotenv needed).

Real environment variables always win over the file.
"""
import os

_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_path):
    with open(_path, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            _k, _v = _k.strip(), _v.strip().strip('"').strip("'")
            if _k and _k not in os.environ:
                os.environ[_k] = _v
