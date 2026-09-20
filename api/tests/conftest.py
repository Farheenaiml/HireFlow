import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Tests must never touch a developer's real hireflow.db. Point the storage layer at a
# throwaway file before anything imports db.py.
_TEST_DB = os.path.join(tempfile.gettempdir(), "hireflow_pytest.db")
os.environ["HIREFLOW_DB"] = _TEST_DB
os.environ.setdefault("USE_N8N", "false")
os.environ.setdefault("N8N_BASE_URL", "")
os.environ.setdefault("SCREEN_DELAY", "0")
if os.path.exists(_TEST_DB):
    os.remove(_TEST_DB)

# The deterministic modules never need httpx; stub it so unit tests run anywhere.
try:  # pragma: no cover
    import httpx  # noqa: F401
except Exception:  # pragma: no cover
    sys.modules["httpx"] = types.ModuleType("httpx")
