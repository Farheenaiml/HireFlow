# HireFlow

**Evidence-first candidate screening and interview intelligence.**
Agentic AI Hackathon '26 — Problem Statement 3.

HireFlow reads a job description, turns it into explicit requirements, then checks every
resume against them one requirement at a time — always with the quote that justifies the
verdict. If a quote cannot be located in the source text, the claim is downgraded
automatically and the reason is written into the record.

It does not rank people. It does not recommend a hire. It proves claims and leaves the
decision to a named human.

---

## Why this design

Hiring AI is regulated as high-risk. "The model scored them 62" is not an answer a
recruiter can give a rejected candidate, and in several jurisdictions it is not a legal
one either. So three things are true of every insight in this product:

| Principle | How it is enforced |
|---|---|
| **No verdict without evidence** | Every `met` / `partial` status carries a quote, and `textops.verify_quotes` proves that quote exists in the source before it reaches the UI. Unverifiable claims are auto-downgraded to `unclear` and flagged for validation |
| **Scoring is code, not opinion** | Strong / Potential / Weak comes from `textops.group_candidate`: must-have coverage ≥ 0.75 with nothing missing. The thresholds are served from `GET /config` and shown in the UI tooltip |
| **Screening is blind** | Names, emails, phone numbers and institutions are stripped by `textops.redact` before the model reads a single character. Screening only ever touches `redacted_text` |
| **Humans decide** | The AI leaves `interviewer_rating` and `recruiter_decision` null on purpose. The chat refuses "who should we hire" and refuses protected-attribute questions outright, logging the refusal |
| **Everything is traceable** | Every insight writes an audit row: source text, engine, prompt version, input hash, timestamp. Even n8n orchestration failures land there |

---

## Quick start (3 commands)

```bash
# 1 — backend
cd hireflow/api
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # optional — works with no key at all
uvicorn main:app --reload --port 8000

# 2 — frontend (new terminal)
cd hireflow/web
npm install
npm run dev

# 3 — open http://localhost:5173 and click "Load demo pool"
```

Or use the bundled script, which does both:

```bash
./run.sh          # macOS / Linux
run.bat           # Windows
```

**Requirements:** Python 3.10+ and Node 18+. Nothing else.

**With no API key**, HireFlow runs on its built-in deterministic evidence engine — a real
retrieval-and-match pipeline, not a mock. Every insight it produces is labelled
`local-evidence-engine` in the audit trail, so the trail never lies about its source. The
whole demo works offline.

---

## Adding a real model (optional)

Edit `api/.env`:

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-120b
```

Anthropic and any OpenAI-compatible endpoint are also supported — see `.env.example`.
Restart the API. The left rail shows the active engine.

Rate limits are handled: calls retry up to 3 times with exponential backoff and jitter,
honouring `Retry-After` when the provider sends one, and screening paces itself with a
`SCREEN_DELAY` pause between candidates.

---

## The 90-second demo path

1. **Dashboard → Load demo pool.** Seeds a payments-engineer role and six synthetic
   resumes, then screens them.
2. **Candidate board.** Three columns with the grouping rule printed above each. Watch the
   progress bar fill.
3. **Open any candidate → click a requirement.** The evidence drawer shows the quote, the
   reasoning, and the resume with the matched span highlighted.
4. **Find one that says "Unclear — evidence could not be located."** That is the model
   citing something that was not there, caught by code and downgraded automatically.
5. **Override a status.** Score and group recompute instantly; the override is audited and
   survives a re-screen.
6. **Interview workspace.** Generate a kit — questions only for unresolved requirements.
   Click **Load sample notes**, generate the report, see unanswered areas flagged and the
   rating field deliberately blank.
7. **Ask the pool** (⌘K). Try "who still needs validation?" — answers come back with
   `[C2:R3]` citations that are validated against the database before display. Then try
   "which candidates are female?" and watch the guardrail fire.
8. **Audit trail.** Every insight, in plain language, with its source, engine and prompt
   version. Exportable as CSV.

---

## n8n orchestration

Three workflows in `n8n/`. Full setup — including n8n Cloud — is in
**[`n8n/README.md`](n8n/README.md)**.

| File | Workflow | What it does |
|---|---|---|
| `0_hireflow_error_handler.json` | **W0 — Error Handler** | Catches any HireFlow workflow failure and writes it into the product's own audit trail via `POST /n8n/error` |
| `1_hireflow_screening_orchestrator.json` | **W1 — Screening Orchestrator** | Accepts a run with 202, pulls pending candidates, screens them one at a time with rate-limit pacing, builds the pool digest |
| `2_hireflow_event_router.json` | **W2 — Event Router** | Routes lifecycle events to notification branches |

The short version:

```bash
# 1. Import all three JSON files into n8n (Workflows → Import from File)
# 2. Create a Header Auth credential named "HireFlow Webhook Key", header name X-API-Key
# 3. Settings → Variables:  HIREFLOW_API_BASE = http://127.0.0.1:8000
# 4. On W1 and W2: ⋯ → Settings → Error Workflow → HireFlow — Error Handler (W0)
# 5. Toggle W1 and W2 Active
```

Then in `api/.env`:

```bash
USE_N8N=true
N8N_BASE_URL=http://127.0.0.1:5678
N8N_API_KEY=<same value as the Header Auth credential>
```

Restart the API. The left rail should read **Orchestration · n8n · live**. Click **Run
screening** with pending candidates and the execution appears in n8n.

**If n8n is down, nothing breaks** — the API falls back to its built-in runner. The
automation layer is useful, never load-bearing.

### Running both together

```bash
docker compose up --build     # API on :8000, n8n on :5678, wired to each other
```

---

## Deploying

| Target | How |
|---|---|
| **Render** (API + web + n8n) | Push to GitHub -> Render -> New -> Blueprint. `render.yaml` defines the same-origin HireFlow service and a separate persistent n8n service. Enter the generated public URLs and secrets in Render/n8n; do not commit them |
| **Docker anywhere** | `docker build -t hireflow . && docker run -p 8000:8000 hireflow` — one URL serves everything |
| **Vercel** (frontend only) | `vercel.json` handles the SPA rewrite so `/board` does not 404 on refresh. Build with `VITE_API_BASE=https://<your-api>` — the value is baked in at build time |

---

## Tests

```bash
cd api
pip install pytest
pytest -q
```

| File | Covers |
|---|---|
| `test_textops.py` | Extraction, redaction, quote verification, scoring maths |
| `test_golden.py` | Golden-set regression: hand-labelled expectations for all six seed resumes |
| `test_chat.py` | Eight scripted conversations — guardrails, refusals, and that no citation is ever invented |
| `test_integration.py` | The full demo path end to end, with a 90-second dry-run budget |

Live quality metrics are also exposed at `GET /quality` and rendered on the Dashboard:
verified-quote share, auto-downgrade count, human overrides, and golden-set agreement.

---

## Architecture

```
React + Vite (5173)
      │  REST, polls while a run is in flight
      ▼
FastAPI (8000) ─────── SQLite (jobs, requirements, candidates, evaluations,
      │                        interview_kits, interviews, chat_messages, audit_log)
      │
      ├── textops.py   extraction · redaction · quote verification · scoring   [no LLM, ever]
      ├── llm.py       Groq / Anthropic / OpenAI, or the local evidence engine
      ├── prompts/     every prompt as a reviewable text file
      └── n8n          W0 error handler · W1 screening orchestrator · W2 event router
```

**Why does FastAPI make the LLM calls instead of n8n?** Quote verification, redaction and
scoring have to be deterministic and unit-testable — they are code, with a golden-set
suite behind them. Routing an unverified model quote through an HTTP node would break the
one guarantee the product makes. n8n keeps what it is genuinely best at: triggering,
sequencing, rate-limit pacing, retries, fan-out and failure routing.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Repo map

```
hireflow/
├── api/                  FastAPI service
│   ├── main.py           routes, screening pipeline, chat guardrails, audit
│   ├── llm.py            provider adapters, retries, local evidence engine
│   ├── textops.py        extraction, redaction, quote verification, scoring
│   ├── db.py             SQLite schema and helpers
│   ├── prompts/          every prompt as a text file  (see prompts/README.md)
│   ├── seed/             demo role, six synthetic resumes, notes, golden labels
│   └── tests/            unit, golden, chat and integration tests
├── web/                  React + Vite + Tailwind
│   └── src/
│       ├── App.tsx       shell, fairness banner, engine status rail
│       ├── pages/        Dashboard · NewRole · Board · CandidateDetail · Interview · Compare · Audit
│       └── components/   design system, evidence drawer, chat dock
├── n8n/                  three workflows + setup guide
├── docs/
│   ├── PRD_COVERAGE.md   every PRD/TRD requirement, where it lives, how to verify it
│   ├── ARCHITECTURE.md   responsibility split and data flow
│   ├── DEMO_SCRIPT.md    the 3-minute video script, beat by beat
│   └── LINKEDIN_POSTS.md ready-to-post Day 1 and Day 2 content
├── Dockerfile            multi-stage: builds the SPA, serves it from the API
├── docker-compose.yml    API + n8n together
├── render.yaml           one-click Render blueprint
└── vercel.json           SPA rewrite for frontend-only deploys
```

---

## API surface

| Route | Purpose |
|---|---|
| `POST /jd/analyze`, `/jd/analyze_file` | JD → requirements |
| `PUT /jd/requirements` | Human edits, marked as such |
| `POST /candidates/upload`, `/candidates/paste` | Ingest + redact |
| `POST /screening/run` | Start a run (hands to n8n when enabled) |
| `GET /screening/pending`, `POST /screening/candidate` | Loop primitives the n8n orchestrator drives |
| `POST /evaluation/override` | Recruiter overrules the model |
| `POST /interview/kit` | Targeted questions |
| `POST /interview/evaluate` | Notes → standardized report |
| `POST /interview/decision` | Human decision gate |
| `POST /chat`, `GET /chat/history` | Pool queries with validated citations |
| `GET /compare` | Side-by-side matrix |
| `GET /audit` | Full traceability |
| `GET /quality`, `GET /stats` | Self-evaluation metrics |
| `POST /n8n/error` | Orchestration failures → audit trail |
| `POST /admin/purge` | Delete everything |

Interactive docs at `http://localhost:8000/docs`.

---

## What HireFlow deliberately will not do

- Rank candidates into a single ordered list
- Recommend who to hire or reject
- Answer questions about gender, age, nationality, religion, marital status, disability or
  any other protected attribute — and it logs every time it refuses
- Display evidence it could not locate in the source text
- Fill in an interviewer rating or a hiring decision

Constraints are the product.
