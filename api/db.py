"""SQLite storage for HireFlow. Single file DB, no migrations needed."""
import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

DB_PATH = os.getenv("HIREFLOW_DB", os.path.join(os.path.dirname(__file__), "hireflow.db"))
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY, title TEXT, jd_text TEXT, status TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS requirements (
  req_id TEXT, job_id TEXT, text TEXT, priority TEXT, category TEXT,
  keywords TEXT, edited_by_human INTEGER DEFAULT 0, sort_order INTEGER,
  PRIMARY KEY (job_id, req_id)
);
CREATE TABLE IF NOT EXISTS candidates (
  candidate_id TEXT PRIMARY KEY, job_id TEXT, label TEXT, display_name TEXT,
  file_name TEXT, raw_text TEXT, redacted_text TEXT, pii_map TEXT,
  status TEXT, grp TEXT, score REAL, must_score REAL, nice_score REAL,
  profile TEXT, summary TEXT, rationale TEXT, error TEXT, warnings TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS evaluations (
  eval_id TEXT PRIMARY KEY, candidate_id TEXT, req_id TEXT, status TEXT,
  quote TEXT, quote_verified INTEGER, verify_method TEXT,
  span_start INTEGER, span_end INTEGER, reasoning TEXT,
  needs_validation INTEGER, validation_note TEXT, model TEXT,
  prompt_version TEXT, overridden_by_human INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS interview_kits (
  kit_id TEXT PRIMARY KEY, candidate_id TEXT, questions TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS interviews (
  interview_id TEXT PRIMARY KEY, candidate_id TEXT, notes_raw TEXT,
  mapping TEXT, unanswered TEXT, followups TEXT, report TEXT,
  decision TEXT, decision_note TEXT, decided_by TEXT, decided_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  log_id TEXT PRIMARY KEY, job_id TEXT, candidate_id TEXT, insight_type TEXT,
  insight_ref TEXT, sources TEXT, model TEXT, prompt_version TEXT,
  input_hash TEXT, engine TEXT, timestamp TEXT
);
CREATE TABLE IF NOT EXISTS chat_messages (
  msg_id TEXT PRIMARY KEY, job_id TEXT, session_id TEXT, role TEXT,
  content TEXT, citations TEXT, created_at TEXT
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def nid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init() -> None:
    with _lock:
        conn = connect()
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()


def q(sql: str, args=()) -> list:
    with _lock:
        conn = connect()
        rows = conn.execute(sql, args).fetchall()
        conn.close()
    return [dict(r) for r in rows]


def one(sql: str, args=()):
    rows = q(sql, args)
    return rows[0] if rows else None


def ex(sql: str, args=()) -> None:
    with _lock:
        conn = connect()
        conn.execute(sql, args)
        conn.commit()
        conn.close()


def exmany(sql: str, seq) -> None:
    with _lock:
        conn = connect()
        conn.executemany(sql, seq)
        conn.commit()
        conn.close()


def js(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def unjs(value, default=None):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def log_audit(job_id, candidate_id, insight_type, insight_ref, sources,
              model, prompt_version, input_hash="", engine="") -> None:
    ex(
        """INSERT INTO audit_log (log_id, job_id, candidate_id, insight_type, insight_ref,
           sources, model, prompt_version, input_hash, engine, timestamp)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (nid("log"), job_id, candidate_id, insight_type, insight_ref, js(sources),
         model, prompt_version, input_hash, engine, now()),
    )


def purge() -> None:
    for t in ["jobs", "requirements", "candidates", "evaluations",
              "interview_kits", "interviews", "audit_log", "chat_messages"]:
        ex(f"DELETE FROM {t}")
