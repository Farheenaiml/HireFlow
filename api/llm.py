"""LLM access for HireFlow.

Providers: groq (default), anthropic, openai-compatible, or "local".
If no key is configured, or a call fails, HireFlow falls back to a deterministic
evidence engine so the product still works end to end. Every insight records
which engine produced it, so the audit trail never lies about its source.
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from typing import Any

import httpx

LOGGER = logging.getLogger(__name__)
PROMPT_VERSION = "v1.2"

PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()
GROQ_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

FAIRNESS_RULE = (
    "Never infer or use name, gender, age, nationality, religion, marital status, "
    "disability, employment gaps or institution prestige. Judge only the evidence "
    "against the listed requirements."
)

# --------------------------------------------------------------------------- prompts
# Prompts live in api/prompts/*.txt so they can be reviewed and versioned without
# touching code. The inline value below is the fallback if a file is missing or
# malformed, so the service never boots into a broken prompt.

PROMPT_DIR = os.path.join(os.path.dirname(__file__), "prompts")


def load_prompt(name: str, default: str, fmt: bool = True) -> str:
    path = os.path.join(PROMPT_DIR, f"{name}.txt")
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except Exception:
        return default
    if not raw.strip():
        return default
    if not fmt:
        return raw
    try:
        return raw.format(FAIRNESS_RULE=FAIRNESS_RULE)
    except Exception:
        return default



def configured() -> bool:
    if PROVIDER == "groq":
        return bool(GROQ_KEY)
    if PROVIDER == "anthropic":
        return bool(ANTHROPIC_KEY)
    if PROVIDER in ("openai", "openai-compatible"):
        return bool(OPENAI_KEY)
    return False


def engine_name() -> str:
    if not configured():
        return "local-evidence-engine"
    return {"groq": GROQ_MODEL, "anthropic": ANTHROPIC_MODEL}.get(PROVIDER, OPENAI_MODEL)


def status() -> dict:
    return {
        "provider": PROVIDER if configured() else "local",
        "model": engine_name(),
        "llm_configured": configured(),
        "prompt_version": PROMPT_VERSION,
    }


# --------------------------------------------------------------------------- raw call


def _extract_json(text: str) -> Any:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                continue
    raise ValueError("model did not return JSON")


MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
RETRY_BASE = float(os.getenv("LLM_RETRY_BASE", "1.5"))
RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 504}


def _sleep_for(attempt: int, resp: httpx.Response | None) -> float:
    """Exponential backoff with jitter. Honours Retry-After when the provider sends one."""
    if resp is not None:
        hdr = resp.headers.get("retry-after") or resp.headers.get("x-ratelimit-reset-requests")
        if hdr:
            try:
                return min(30.0, max(0.5, float(re.sub(r"[^0-9.]", "", hdr) or 0)))
            except Exception:
                pass
    return min(24.0, RETRY_BASE ** attempt) + random.uniform(0, 0.6)


def _post_with_retry(url: str, *, headers: dict, payload: dict,
                     timeout: httpx.Timeout) -> httpx.Response:
    """POST that survives 429s and 5xx. Raises the last error when retries run out."""
    last: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = httpx.post(url, headers=headers, json=payload, timeout=timeout)
            if r.status_code in RETRYABLE and attempt < MAX_RETRIES:
                time.sleep(_sleep_for(attempt, r))
                continue
            r.raise_for_status()
            return r
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(_sleep_for(attempt, None))
                continue
            raise
        except httpx.HTTPStatusError as exc:
            last = exc
            if exc.response.status_code in RETRYABLE and attempt < MAX_RETRIES:
                time.sleep(_sleep_for(attempt, exc.response))
                continue
            raise
    if last:
        raise last
    raise RuntimeError("LLM request failed after retries")


def call_json(system: str, user: str, max_tokens: int = 2400,
              temperature: float = 0.1, operation: str = "unspecified") -> Any:
    """One LLM call that must return JSON. Raises if the provider is unavailable.

    Transient provider failures (429 rate limit, 5xx, timeouts) are retried with
    exponential backoff and jitter before the caller falls back to the local engine.
    """
    if not configured():
        raise RuntimeError("no LLM provider configured")
    system = system + "\n\nReturn JSON only. No prose, no markdown fences."
    timeout = httpx.Timeout(90.0)

    if PROVIDER == "anthropic":
        r = _post_with_retry(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            payload={"model": ANTHROPIC_MODEL, "max_tokens": max_tokens,
                     "temperature": temperature, "system": system,
                     "messages": [{"role": "user", "content": user}]},
            timeout=timeout)
        blocks = r.json().get("content", [])
        return _extract_json("".join(b.get("text", "") for b in blocks))

    if PROVIDER == "groq":
        url, key, model = "https://api.groq.com/openai/v1/chat/completions", GROQ_KEY, GROQ_MODEL
    else:
        url, key, model = f"{OPENAI_BASE}/chat/completions", OPENAI_KEY, OPENAI_MODEL

    request_started = time.perf_counter()
    try:
        r = _post_with_retry(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            payload={"model": model, "temperature": temperature, "max_tokens": max_tokens,
                     "response_format": {"type": "json_object"},
                     "messages": [{"role": "system", "content": system},
                                  {"role": "user", "content": user}]},
            timeout=timeout)
        result = _extract_json(r.json()["choices"][0]["message"]["content"])
        LOGGER.info("llm_request provider=%s model=%s operation=%s success=true latency_ms=%.1f",
                PROVIDER, model, operation, (time.perf_counter() - request_started) * 1000)
        return result
    except Exception as exc:
        LOGGER.warning("llm_request provider=%s model=%s operation=%s success=false "
                   "error_type=%s latency_ms=%.1f", PROVIDER, model, operation,
                   type(exc).__name__, (time.perf_counter() - request_started) * 1000)
        raise


# --------------------------------------------------------------------------- helpers

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
STOP = set("""a an the and or of for to in on at with by from as is are was were be been
being that this these those it its their our your his her they them we you i will would
can could should have has had do does did not no yes using used use work working years
year team strong good great across over into than then also such via per must nice
ideally comfortable able including etc more most other others another every each who
what when where which while both either neither plus bonus preferred desirable""".split())


def stem(w: str) -> str:
    for suf in ("ing", "ers", "er", "ed", "es", "s"):
        if len(w) > 4 + len(suf) - 2 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokens(text: str) -> set[str]:
    return {stem(w) for w in re.findall(r"[a-z0-9+#.]{2,}", (text or "").lower())
            if w not in STOP}


def key_terms(req: dict) -> set[str]:
    """Distinctive terms that actually identify this requirement."""
    t = tokens(req.get("text", "")) | {stem(k) for k in (req.get("keywords") or [])}
    return {w for w in t if len(w) > 2}


def sentences(text: str) -> list[str]:
    out = []
    for raw in SENT_SPLIT.split(text or ""):
        s = raw.strip(" \t-•*·|")
        if 20 <= len(s) <= 260:
            out.append(s)
    return out


# --------------------------------------------------------------------------- JD analysis

JD_SYSTEM = load_prompt("jd", f"""You turn a job description into explicit, checkable hiring requirements.
Rules:
- Produce 6 to 10 requirements, at least 3 of them "must".
- Each requirement is one concrete, verifiable capability, not a sentence of fluff.
- category is one of: technical_skill, experience, domain, education, soft_skill, logistics.
- keywords: 3 to 6 lowercase terms a resume might use for this requirement.
- {FAIRNESS_RULE}
Schema: {{"requirements":[{{"text":str,"priority":"must"|"nice","category":str,"keywords":[str]}}]}}""", fmt=True)

MUST_HINTS = ("must", "required", "require", "minimum", "at least", "years", "strong",
              "proven", "essential", "should have", "expertise")
NICE_HINTS = ("nice to have", "nice-to-have", "bonus", "plus", "preferred",
              "good to have", "desirable", "advantage")
CATEGORY_HINTS = {
    "education": ("degree", "bachelor", "master", "b.tech", "phd", "graduate"),
    "domain": ("fintech", "healthcare", "saas", "e-commerce", "b2b", "marketplace", "domain"),
    "soft_skill": ("communication", "stakeholder", "mentor", "collaborat", "ownership",
                   "leadership", "written"),
    "logistics": ("onsite", "remote", "relocat", "shift", "travel", "notice period"),
    "experience": ("years", "experience", "led", "shipped", "owned", "scale"),
}


def analyze_jd(title: str, jd_text: str) -> tuple[list[dict], str]:
    if configured():
        try:
            data = call_json(JD_SYSTEM, f"Job title: {title}\n\nJob description:\n{jd_text[:8000]}")
            reqs = data["requirements"] if isinstance(data, dict) else data
            cleaned = []
            for r in reqs[:12]:
                cleaned.append({
                    "text": str(r.get("text", "")).strip(),
                    "priority": "nice" if str(r.get("priority", "must")).lower().startswith("n") else "must",
                    "category": r.get("category") or "experience",
                    "keywords": [str(k).lower() for k in (r.get("keywords") or [])][:6],
                })
            cleaned = [c for c in cleaned if c["text"]]
            if len(cleaned) >= 3:
                return cleaned, engine_name()
        except Exception:
            pass
    return _analyze_jd_local(jd_text), "local-evidence-engine"


def _analyze_jd_local(jd_text: str) -> list[dict]:
    raw_lines = [ln.rstrip() for ln in (jd_text or "").split("\n")]
    bullets, plain = [], []
    header_re = re.compile(
        r"^(about|we are|who we are|our mission|what you.ll do|what we need|"
        r"requirements?|responsibilities|qualifications?|benefits|perks|apply|"
        r"location|salary|compensation|the role|job title)\b", re.I)
    for ln in raw_lines:
        stripped = ln.strip()
        if not stripped or stripped.endswith(":") or header_re.match(stripped):
            continue
        if re.match(r"^[-*\u2022\u00b7\u25cf]\s+", stripped):
            bullets.append(re.sub(r"^[-*\u2022\u00b7\u25cf]\s+", "", stripped))
        elif 30 <= len(stripped) <= 240:
            plain.append(stripped)
    cands = bullets or plain or sentences(jd_text)

    prefix_re = re.compile(
        r"^(you (?:will |should |must )?(?:have|be)|must have|must be|must|should have|"
        r"nice to have|good to have|preferred|bonus|we (?:are looking for|need|want)|"
        r"looking for|the ideal candidate (?:has|will have)|experience (?:in|with))\s*[:\-]?\s*",
        re.I)
    out, seen = [], set()
    for c in cands[:14]:
        low = c.lower()
        if any(h in low for h in NICE_HINTS):
            priority = "nice"
        elif any(h in low for h in MUST_HINTS):
            priority = "must"
        else:
            priority = "must"
        text = prefix_re.sub("", c).strip(" .;,")
        if len(text) < 12:
            text = c.strip(" .;,")
        text = text[:1].upper() + text[1:]
        key = text.lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        category = "technical_skill"
        for cat, hints in CATEGORY_HINTS.items():
            if any(h in low for h in hints):
                category = cat
                break
        kws = sorted(tokens(text), key=lambda w: -len(w))[:6]
        out.append({"text": text, "priority": priority,
                    "category": category, "keywords": kws})
        if len(out) >= 10:
            break
    if not out:
        out = [{"text": "Relevant professional experience for this role",
                "priority": "must", "category": "experience", "keywords": ["experience"]}]
    if not any(o["priority"] == "must" for o in out):
        out[0]["priority"] = "must"
    return out


# --------------------------------------------------------------------------- screening

SCREEN_SYSTEM = load_prompt("screen", f"""You are a hiring screener that works only from quoted evidence.
The resume is anonymised: [CANDIDATE], [EMAIL], [INSTITUTION] are redaction markers.

For every requirement you must return:
- status: "met" (clear direct evidence) | "partial" (related but incomplete)
  | "unclear" (claimed vaguely, cannot be confirmed) | "missing" (no evidence at all)
- quote: copied VERBATIM and contiguous from the resume, under 40 words.
  If status is "missing", quote must be "".
- reasoning: one neutral sentence about what the evidence does and does not show.
- needs_validation: true when an interviewer must confirm something.
- validation_note: what exactly to confirm (empty if needs_validation is false).

Never invent a quote. If you cannot find exact text, use "unclear" or "missing".
{FAIRNESS_RULE}

Schema:
{{"profile":{{"skills":[str],"roles":[{{"title":str,"duration":str,"highlights":[str]}}],
"projects":[str],"education":[{{"degree":str,"field":str}}],"certifications":[str],
"years_experience_claimed":number|null}},
"summary":"3-4 neutral sentences, no name, no recommendation",
"evaluations":[{{"req_id":str,"status":str,"quote":str,"reasoning":str,
"needs_validation":bool,"validation_note":str}}]}}""", fmt=True)


def screen_resume(requirements: list[dict], redacted_text: str) -> tuple[dict, str]:
    if configured():
        try:
            req_block = json.dumps(
                [{"req_id": r["req_id"], "text": r["text"], "priority": r["priority"]}
                 for r in requirements], ensure_ascii=False)
            user = (f"REQUIREMENTS:\n{req_block}\n\nANONYMISED RESUME:\n"
                    f"{redacted_text[:12000]}")
            data = call_json(SCREEN_SYSTEM, user, max_tokens=3500)
            if isinstance(data, dict) and data.get("evaluations"):
                return _normalise_screen(data, requirements), engine_name()
        except Exception:
            pass
    return local_screen(requirements, redacted_text), "local-evidence-engine"


def _normalise_screen(data: dict, requirements: list[dict]) -> dict:
    valid = {"met", "partial", "unclear", "missing"}
    by_id = {e.get("req_id"): e for e in data.get("evaluations", []) if isinstance(e, dict)}
    evals = []
    for r in requirements:
        e = by_id.get(r["req_id"], {})
        status = str(e.get("status", "missing")).lower()
        if status not in valid:
            status = "unclear"
        quote = str(e.get("quote") or "").strip()
        if status == "missing":
            quote = ""
        evals.append({
            "req_id": r["req_id"], "status": status, "quote": quote,
            "reasoning": str(e.get("reasoning") or "").strip() or "No reasoning returned.",
            "needs_validation": bool(e.get("needs_validation")) or status in ("partial", "unclear"),
            "validation_note": str(e.get("validation_note") or "").strip(),
        })
    profile = data.get("profile") or {}
    return {"profile": profile,
            "summary": str(data.get("summary") or "").strip(),
            "evaluations": evals}


REPAIR_SYSTEM = load_prompt("repair", """Some quotes you returned do not appear in the resume.
For each listed requirement, either copy an EXACT contiguous quote from the resume,
or set status to "unclear" (or "missing" with an empty quote).
Schema: {"evaluations":[{"req_id":str,"status":str,"quote":str,"reasoning":str,
"needs_validation":bool,"validation_note":str}]}""", fmt=False)


def repair_quotes(failed: list[dict], requirements: list[dict],
                  redacted_text: str) -> list[dict]:
    if not configured() or not failed:
        return []
    try:
        by_id = {r["req_id"]: r for r in requirements}
        listing = [{"req_id": f["req_id"], "requirement": by_id.get(f["req_id"], {}).get("text", ""),
                    "rejected_quote": f.get("quote", "")} for f in failed]
        data = call_json(REPAIR_SYSTEM,
                         f"FAILED ITEMS:\n{json.dumps(listing, ensure_ascii=False)}\n\n"
                         f"RESUME:\n{redacted_text[:12000]}", max_tokens=1600)
        return data.get("evaluations", []) if isinstance(data, dict) else []
    except Exception:
        return []


# ---- local evidence engine -------------------------------------------------

SECTION_RE = re.compile(
    r"^\s*(skills?|technical skills?|experience|work experience|projects?|education|"
    r"certifications?|summary|profile|achievements?)\s*[:\-]?\s*$", re.I)


def local_profile(text: str) -> dict:
    lines = text.split("\n")
    sections: dict[str, list[str]] = {}
    current = "other"
    for ln in lines:
        if SECTION_RE.match(ln.strip()):
            current = ln.strip().lower().strip(":- ")
            sections[current] = []
        else:
            sections.setdefault(current, []).append(ln)

    def grab(*names) -> str:
        for key in sections:
            if any(n in key for n in names):
                return "\n".join(sections[key])
        return ""

    skills_blob = grab("skill")
    skills = [s.strip() for s in re.split(r"[,;|•\n]", skills_blob) if 1 < len(s.strip()) <= 34][:24]
    projects = [ln.strip(" -•*") for ln in grab("project").split("\n") if len(ln.strip()) > 18][:6]
    roles = []
    for ln in grab("experience", "work").split("\n"):
        s = ln.strip(" -•*")
        if re.search(r"(20\d\d|19\d\d|present)", s, re.I) and len(s) < 160:
            roles.append({"title": s, "duration": "", "highlights": []})
    edu = []
    for m in re.finditer(r"(B\.?Tech|B\.?E\.?|B\.?Sc|M\.?Tech|M\.?Sc|MBA|MCA|BCA|Bachelor\w*|Master\w*|PhD)[^\n,]{0,60}",
                         text, re.I):
        edu.append({"degree": m.group(0).strip()[:70], "field": ""})
    years = None
    m = re.search(r"(\d{1,2})\+?\s*(?:years|yrs)", text, re.I)
    if m:
        years = int(m.group(1))
    return {"skills": skills, "roles": roles[:6], "projects": projects,
            "education": edu[:3], "certifications": [], "years_experience_claimed": years}


GENERIC_TERMS = {"system", "work", "design", "engine", "experience", "production", "team",
                 "driven", "small", "lead", "tun", "databa", "databas", "junior", "senior",
                 "engineer", "develop"}


def _match_requirement(req: dict, sents: list[str], sent_tokens: list[set],
                       doc_tokens: set) -> tuple[float, int | None, int]:
    """Coverage of the requirement's distinctive terms, plus the best supporting line."""
    terms = key_terms(req)
    if not terms:
        return 0.0, None, 0
    coverage = len(terms & doc_tokens) / len(terms)
    kw = {stem(k) for k in (req.get("keywords") or [])}

    def weight(term: str) -> float:
        if term in GENERIC_TERMS:
            return 0.3
        return 2.0 if term in kw else 1.0

    best_i, best_w = None, 0.0           # best prose sentence (shows real use)
    list_i, list_w = None, 0.0           # best skills-list line, only a fallback
    for i, st in enumerate(sent_tokens):
        common = terms & st
        w = sum(weight(t) for t in common)
        if sents[i].count(",") >= 4:
            if w > list_w:
                list_w, list_i = w, i
        elif w > best_w:
            best_w, best_i = w, i
    if best_i is None:
        best_i = list_i
    hits = 0
    if best_i is not None:
        # an explicit technology keyword (Kafka, RabbitMQ, PostgreSQL...) counts double
        hits = sum(2 if t in kw else 1 for t in terms & sent_tokens[best_i]
                   if t not in GENERIC_TERMS)
    return coverage, best_i, hits


def local_screen(requirements: list[dict], text: str) -> dict:
    sents = sentences(text)
    sent_tokens = [tokens(s) for s in sents]
    doc_tokens = tokens(text)
    evals = []
    strengths, gaps = [], []

    for r in requirements:
        coverage, best_i, hits = _match_requirement(r, sents, sent_tokens, doc_tokens)
        quote = sents[best_i] if best_i is not None else ""

        if best_i is None or (coverage < 0.16 and hits < 2):
            status, quote = "missing", ""
            reason = "Nothing in the resume addresses this requirement."
            need, note = True, f"Ask the candidate directly about: {r['text']}."
            gaps.append(r["text"])
        elif quote.count(",") >= 4 and not re.search(r"\b(built|led|designed|owned|worked|"
                                                    r"developed|managed|wrote|ran)\b", quote, re.I):
            status = "unclear"
            reason = ("This only appears in a skills list, with no project or role showing it "
                      "used in practice.")
            need = True
            note = f"Ask for a concrete example of: {r['text']}."
            gaps.append(r["text"])
        elif coverage >= 0.45 and hits >= 2:
            status = "met"
            reason = (f"The quoted line covers {int(coverage * 100)}% of the terms in this "
                      f"requirement, stated directly.")
            need, note = False, ""
            strengths.append(r["text"])
        elif hits >= 2 or (coverage >= 0.34 and hits >= 1):
            status = "partial"
            reason = ("Related work is described, but depth, duration or the exact "
                      "technology is not confirmed.")
            need = True
            note = f"Confirm scope, ownership and duration for: {r['text']}."
        else:
            status = "unclear"
            reason = "Only a loose keyword association; the claim is not substantiated."
            need = True
            note = f"Verify real hands-on experience with: {r['text']}."
            gaps.append(r["text"])

        evals.append({"req_id": r["req_id"], "status": status, "quote": quote,
                      "reasoning": reason, "needs_validation": need,
                      "validation_note": note})

    profile = local_profile(text)
    met = [e for e in evals if e["status"] == "met"]
    summary = (
        f"Direct evidence was found for {len(met)} of {len(evals)} requirements. "
        + (f"Clearest strengths: {'; '.join(s[:70] for s in strengths[:2])}. " if strengths else "")
        + (f"Open areas: {'; '.join(g[:70] for g in gaps[:2])}. " if gaps else "")
        + (f"The resume claims about {profile['years_experience_claimed']} years of experience. "
           if profile.get("years_experience_claimed") else "")
        + "Every status below is backed by a quote taken from the resume."
    )
    return {"profile": profile, "summary": summary, "evaluations": evals}


# --------------------------------------------------------------------------- interview kit

KIT_SYSTEM = load_prompt("kit", f"""You prepare an interview kit. You only target requirements where the
resume evidence was partial, unclear, missing, or flagged for validation.
Each question must be answerable with a concrete example and must reference the gap.
No questions about protected topics. {FAIRNESS_RULE}
Schema: {{"questions":[{{"req_id":str,"question":str,"why_asked":str,
"probes":[str],"good_answer_signals":[str]}}],
"general_questions":[{{"question":str,"why_asked":str,"probes":[str],
"good_answer_signals":[str]}}]}}""", fmt=True)


def interview_kit(requirements: list[dict], evaluations: list[dict],
                  summary: str, resume_text: str = "") -> tuple[dict, str]:
    targets = [e for e in evaluations
               if e["status"] in ("partial", "unclear", "missing") or e.get("needs_validation")]
    targets = targets[:6] or evaluations[:4]
    by_id = {r["req_id"]: r for r in requirements}
    if configured():
        try:
            payload = [{"req_id": t["req_id"], "requirement": by_id.get(t["req_id"], {}).get("text", ""),
                        "status": t["status"], "evidence": t.get("quote", ""),
                        "validation_note": t.get("validation_note", "")} for t in targets]
            data = call_json(KIT_SYSTEM,
                             f"CANDIDATE SUMMARY:\n{summary}\n\n"
                             f"ANONYMISED RESUME CONTEXT:\n{resume_text[:12000]}\n\n"
                             f"GAPS TO PROBE:\n{json.dumps(payload, ensure_ascii=False)}", max_tokens=2200,
                             operation="interview_kit")
            if isinstance(data, dict) and data.get("questions"):
                normalised = _normalise_kit(data, targets, by_id)
                if normalised["questions"]:
                    return normalised, engine_name()
        except Exception:
            pass
    return _local_kit(targets, by_id), "local-evidence-engine"


def _normalise_kit(data: dict, targets: list[dict], by_id: dict) -> dict:
    """Keep only candidate-specific questions tied to a real evidence gap."""
    target_by_id = {t["req_id"]: t for t in targets}
    questions = []
    for item in data.get("questions", []):
        if not isinstance(item, dict):
            continue
        req_id = str(item.get("req_id") or "")
        target = target_by_id.get(req_id)
        question = str(item.get("question") or "").strip()
        if not target or not question:
            continue
        questions.append({
            "req_id": req_id,
            "question": question,
            "why_asked": str(item.get("why_asked") or
                               f"Validates the evidence gap for {by_id[req_id]['text']}.").strip(),
            "evidence_quote": target.get("quote", ""),
            "evidence_status": target.get("status", "missing"),
            "probes": [str(p) for p in (item.get("probes") or []) if str(p).strip()][:5],
            "good_answer_signals": [str(s) for s in (item.get("good_answer_signals") or [])
                                    if str(s).strip()][:5],
        })
    general = [q for q in (data.get("general_questions") or [])
               if isinstance(q, dict) and str(q.get("question") or "").strip()]
    return {"questions": questions, "general_questions": general[:4]}


def _local_kit(targets: list[dict], by_id: dict) -> dict:
    qs = []
    for t in targets:
        req = by_id.get(t["req_id"], {}).get("text", "this requirement")
        if t["status"] == "missing":
            question = (f"The resume does not cover {req.lower()}. Walk me through the closest "
                        f"experience you have and what you would need to get up to speed.")
            why = "No evidence for this requirement was found in the resume."
        elif t["status"] == "unclear":
            question = (f"Describe one specific project where you personally handled {req.lower()}. "
                        f"What was your own contribution?")
            why = "The resume mentions this only loosely, with no substantiating detail."
        else:
            question = (f"Take one example that shows {req.lower()}. What was the scale, "
                        f"how long did you own it, and what did you decide yourself?")
            why = "Partial evidence found; depth and ownership are unconfirmed."
        qs.append({
            "req_id": t["req_id"], "question": question, "why_asked": why,
            "evidence_quote": t.get("quote", ""),
            "probes": ["What was your specific role versus the team's?",
                       "What broke, and how did you find out?",
                       "What would you do differently now?"],
            "good_answer_signals": ["Names a concrete system, metric or timeline",
                                    "Explains a trade-off they chose and why",
                                    "Distinguishes their work from the team's"],
        })
    general = [
        {"question": "Describe the piece of work you are most proud of from the last year "
                     "and why it mattered to the business.",
         "why_asked": "Calibrates impact thinking beyond the requirement list.",
         "probes": ["How was success measured?", "Who disagreed with you?"],
         "good_answer_signals": ["Outcome stated in numbers", "Owns the trade-offs"]},
        {"question": "Tell me about a time your first approach failed. What did you change?",
         "why_asked": "Tests learning loop and honesty about failure.",
         "probes": ["What was the earliest signal you missed?"],
         "good_answer_signals": ["Specific, non-defensive, names the correction"]},
    ]
    return {"questions": qs, "general_questions": general}


# --------------------------------------------------------------------------- interview eval

EVAL_SYSTEM = load_prompt("eval", f"""You validate interview answers against one requirement at a time.
The resume evidence and question are context only; interview notes are the ONLY source
of new interview evidence. Never invent a quote and never recommend hire or reject.
Return exactly one item per supplied requirement. evidence_status must be one of:
"demonstrated", "partially_demonstrated", "still_unverified".
supporting_quote must be a VERBATIM contiguous quote from the interview notes, or empty.
reasoning explains why the answer does or does not close the listed evidence gap.
missing_evidence states what is still absent. follow_up_question is empty when no follow-up is needed.
{FAIRNESS_RULE}
Schema: {{"mapping":[{{"req_id":str,"evidence_status":str,"reasoning":str,
"supporting_quote":str,"missing_evidence":str,"follow_up_question":str}}],
"strengths":[str],"concerns":[str],"next_validation":[str]}}""", fmt=True)


def evaluate_interview(requirements: list[dict], evaluations: list[dict],
                       notes: str, resume_text: str = "", kit: dict | None = None) -> tuple[dict, str]:
    if configured():
        try:
            reqs = [{"req_id": r["req_id"], "text": r["text"], "priority": r["priority"]}
                    for r in requirements]
            evidence = [{"req_id": e["req_id"], "status": e.get("status", "missing"),
                         "resume_quote": e.get("quote", ""),
                         "validation_note": e.get("validation_note", ""),
                         "question": next((q.get("question", "") for q in
                                           (kit or {}).get("questions", [])
                                           if q.get("req_id") == e["req_id"]), "")}
                        for e in evaluations]
            data = call_json(EVAL_SYSTEM,
                             f"REQUIREMENTS:\n{json.dumps(reqs, ensure_ascii=False)}\n\n"
                             f"RESUME EVIDENCE AND QUESTIONS:\n{json.dumps(evidence, ensure_ascii=False)}\n\n"
                             f"ANONYMISED RESUME CONTEXT:\n{resume_text[:12000]}\n\n"
                             f"INTERVIEW NOTES:\n{notes[:10000]}", max_tokens=2600,
                             operation="interview_evaluation")
            if isinstance(data, dict) and data.get("mapping"):
                normalised = _normalise_interview(data, requirements)
                if normalised["mapping"]:
                    return normalised, engine_name()
        except Exception:
            pass
    return _local_eval(requirements, notes), "local-evidence-engine"


def _normalise_interview(data: dict, requirements: list[dict]) -> dict:
    """Normalize model output without accepting scores or uncontrolled statuses."""
    valid = {"demonstrated", "partially_demonstrated", "still_unverified"}
    coverage_map = {"covered": "demonstrated", "partial": "partially_demonstrated",
                    "not_covered": "still_unverified"}
    by_id = {r["req_id"] for r in requirements}
    mapping = []
    for item in data.get("mapping", []):
        if not isinstance(item, dict) or str(item.get("req_id") or "") not in by_id:
            continue
        status = str(item.get("evidence_status") or "").lower().strip()
        status = status if status in valid else coverage_map.get(str(item.get("coverage") or "").lower())
        if status not in valid:
            continue
        coverage = {"demonstrated": "covered", "partially_demonstrated": "partial",
                    "still_unverified": "not_covered"}[status]
        quote = str(item.get("supporting_quote") or item.get("notes_quote") or "").strip()
        follow_up = str(item.get("follow_up_question") or item.get("follow_up") or "").strip()
        mapping.append({
            "req_id": str(item["req_id"]), "evidence_status": status,
            "coverage": coverage, "reasoning": str(item.get("reasoning") or "").strip(),
            "supporting_quote": quote, "notes_quote": quote,
            "missing_evidence": str(item.get("missing_evidence") or "").strip(),
            "follow_up_question": follow_up, "evidence_strength": (
                "strong" if status == "demonstrated" else
                "moderate" if status == "partially_demonstrated" else "none"),
            "follow_up": follow_up,
        })
    return {"mapping": mapping, "strengths": [str(x) for x in (data.get("strengths") or [])][:5],
            "concerns": [str(x) for x in (data.get("concerns") or [])][:5],
            "next_validation": [str(x) for x in (data.get("next_validation") or [])][:5]}


HEDGE_RE = re.compile(
    r"\b(did not|didn't|could not|couldn't|has not|hasn't|have not|not done|no specific|"
    r"short|vague|would need|few years old|not recent|little detail|unable to|without detail|"
    r"no issues|worked fine|some )\b", re.I)


def _local_eval(requirements: list[dict], notes: str) -> dict:
    """Deterministic notes -> requirement mapping used when no LLM is configured.

    Lines that start with "Not discussed" are treated as explicit gaps and never used as
    evidence. A matched sentence followed by (or containing) hedging language such as
    "could not explain" is downgraded to partial and turned into a follow-up question.
    """
    sents = sentences(notes)
    sent_tokens = [set() if s.lower().startswith("not discussed") else tokens(s) for s in sents]
    mapping, strengths, concerns, nxt = [], [], [], []
    for r in requirements:
        req_tok = key_terms(r)
        best_i, best = None, 0.0
        for i, st in enumerate(sent_tokens):
            if not req_tok:
                continue
            ov = len(req_tok & st)
            if ov:
                sc = ov / len(req_tok) + 0.1 * min(ov, 3)
                if sc > best:
                    best, best_i = sc, i
        if best_i is None or best < 0.3:
            mapping.append({"req_id": r["req_id"], "coverage": "not_covered",
                            "notes_quote": "", "evidence_strength": "none",
                            "follow_up": f"Not discussed in this interview: {r['text']}."})
            if r["priority"] == "must":
                concerns.append(f"{r['req_id']} was not covered in the interview.")
                nxt.append(f"Schedule a short follow-up on {r['text']}.")
            continue
        quote = sents[best_i]
        neighbour = sents[best_i + 1] if best_i + 1 < len(sents) else ""
        hedged = bool(HEDGE_RE.search(quote)) or (
            bool(HEDGE_RE.search(neighbour)) and not (key_terms(r) & tokens(neighbour)
                                                       and best_i + 1 < len(sents)
                                                       and len(key_terms(r) & tokens(neighbour)) > 2))
        if best >= 0.5 and not hedged:
            mapping.append({"req_id": r["req_id"], "coverage": "covered",
                            "notes_quote": quote, "evidence_strength": "strong",
                            "follow_up": ""})
            strengths.append(f"{r['req_id']}: {quote[:120]}")
        else:
            gap = (neighbour if HEDGE_RE.search(neighbour) else quote)[:140]
            mapping.append({"req_id": r["req_id"], "coverage": "partial",
                            "notes_quote": quote, "evidence_strength": "moderate" if best >= 0.5 else "weak",
                            "follow_up": f"Answer lacked depth on {r['text']} ({gap.rstrip('.')}). "
                                         f"Ask for a concrete example with numbers."})
            concerns.append(f"{r['req_id']}: evidence in the interview was shallow.")
            nxt.append(f"Probe {r['req_id']} further with a worked example.")
    return {"mapping": mapping, "strengths": strengths[:5],
            "concerns": concerns[:5], "next_validation": nxt[:5]}


# --------------------------------------------------------------------------- chat

CHAT_SYSTEM = load_prompt("chat", f"""You answer recruiter questions about a candidate pool.
Use ONLY the supplied context. Cite evidence inline as [C2:R3] (candidate label :
requirement id) or [C2] for a whole candidate. If the context does not support an
answer, say you do not have evidence for it. Never recommend hire or reject, never
rank by protected attributes - describe evidence and let the recruiter decide.
{FAIRNESS_RULE}
Schema: {{"answer":str,"citations":[{{"candidate_label":str,"req_id":str,"why":str}}]}}""", fmt=True)


def chat_answer(context: str, history: list[dict], message: str) -> tuple[dict, str]:
    if configured():
        try:
            hist = "\n".join(f"{h['role']}: {h['content']}" for h in history[-6:])
            data = call_json(CHAT_SYSTEM,
                             f"POOL CONTEXT:\n{context[:14000]}\n\nCONVERSATION:\n{hist}\n\n"
                             f"RECRUITER QUESTION: {message}", max_tokens=1400)
            if isinstance(data, dict) and data.get("answer"):
                return data, engine_name()
        except Exception:
            pass
    return {}, "local-evidence-engine"
