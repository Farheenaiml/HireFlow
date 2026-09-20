# PRD / TRD coverage matrix

Every functional requirement, where it is implemented, and how to see it working.
`api/` paths are Python, `web/src/` paths are React.

## Problem statement 3 — the 13 asks, mapped

| The brief asks for | HireFlow feature | Where |
|---|---|---|
| Upload a job description and candidate resumes | JD paste/upload + drag-drop multi-resume ingest | `POST /jd/analyze`, `POST /jd/analyze_file`, `POST /candidates/upload` |
| Extract skills, experience, projects, qualifications | Structured candidate profile | `llm.screen_resume` → `profile` |
| Map candidate experience against specific job requirements | One verdict per requirement, quote-first | `evaluations` table, `web/src/pages/CandidateDetail.tsx` |
| Identify missing or unclear information needing validation | `needs_validation` flag + validation note | FR-05 |
| Group candidates by relevant experience | Strong / Potential / Weak, computed in code | `textops.group_candidate` |
| Generate structured candidate summaries | Summary card + rationale | FR-07 |
| Role-specific interview questions per candidate | Interview kit targeting unresolved requirements | `POST /interview/kit` |
| Follow-up questions when an answer needs validation | Follow-up probe panel | FR-09 |
| Summarize interview notes, map evidence to requirements | Requirement table with interview evidence | `POST /interview/evaluate` |
| Identify unanswered evaluation areas | Unanswered panel, must-haves called out | FR-11 |
| Standardized interview evaluation report | Printable report with blank human fields | FR-12, FR-20 |
| Natural-language query of the candidate pool | Ask-the-pool chat with validated citations | `POST /chat` |
| Audit trail of which information produced each insight | Plain-language audit trail + CSV export | `GET /audit` |

## Functional requirements

| ID | Requirement | Status | Implementation | How to verify |
|---|---|---|---|---|
| FR-01 | JD → editable requirements | ✅ | `POST /jd/analyze`, `PUT /jd/requirements`, `prompts/jd.txt` | Role page: edit a requirement, flip must↔nice, save. `edited_by_human` turns true |
| FR-02 | PDF / DOCX / TXT upload and text extraction | ✅ | `textops.extract_text` (PyMuPDF, python-docx) | Drop a PDF on the board. Scanned PDFs return an explicit "needs OCR" warning rather than silence |
| FR-03 | Structured candidate profile | ✅ | `llm.screen_resume` → `profile` | Candidate page, profile block |
| FR-04 | Status, quote and reasoning per requirement | ✅ | `evaluations` table | Candidate page, evidence drawer |
| FR-05 | Needs-validation flags | ✅ | `needs_validation`, `validation_note` | Board chip "n to validate" |
| FR-06 | Strong / Potential / Weak by code | ✅ | `textops.group_candidate`, thresholds exposed on `GET /config` | Hover the "Scoring rule" tooltip — the thresholds come from the API, not the copy |
| FR-07 | Candidate summary card | ✅ | `summary` + `rationale` | Board cards |
| FR-08 | Targeted interview questions | ✅ | `POST /interview/kit`, `prompts/kit.txt` | Interview workspace → Generate questions |
| FR-09 | Follow-up probes | ✅ | Dedicated "Follow-up probes" panel, copy-to-clipboard | `web/src/pages/Interview.tsx` — appears after a report is generated |
| FR-10 | Notes mapped to requirements | ✅ | `POST /interview/evaluate` | Report requirement table |
| FR-11 | Unanswered areas | ✅ | `unanswered` list, must-haves marked | Report, red panel |
| FR-12 | Standardized report with blank decision fields | ✅ | Report JSON sets `interviewer_rating: null`; UI has a 1–5 human-only rating control | Interview workspace → rating control sits next to the decision buttons; printed copy shows blank ruled fields |
| FR-13 | Pool chat with validated citations | ✅ | `POST /chat`, citation post-check drops anything that does not resolve | Chat dock; `tests/test_chat.py` asserts no invented citations |
| FR-14 | Audit trail and UI | ✅ | `GET /audit` + plain-language timeline, raw JSON behind a disclosure, CSV export | Audit page |
| FR-15 | PII redaction before the model | ✅ | `textops.redact`, screening only ever reads `redacted_text` | Integration test asserts the email and phone are gone |
| FR-16 | Quote verification and repair | ✅ | `textops.verify_quotes` + one repair pass; unverifiable claims auto-downgrade | Look for "Evidence could not be located…" on the board |
| FR-17 | Compare | ✅ | `GET /compare`, differing requirements highlighted | Tick 2–3 cards → Compare |
| FR-18 | Human decision gate | ✅ | `POST /interview/decision`, recorded against a named person | Interview workspace |
| FR-19 | Demo mode | ✅ | `POST /demo/load` one-click pool + `GET /demo/notes` "Load sample notes" button | Dashboard and Interview workspace |
| FR-20 | Print to PDF | ✅ | Print stylesheet in `web/src/index.css` hides nav, chat dock and inputs; report breaks cleanly across pages | Interview workspace → Print report |

## Non-functional

| Requirement | Status | Where |
|---|---|---|
| Protected-attribute refusal in chat | ✅ | `main.PROTECTED_RE`, `chat_guard`; refusals are themselves audited |
| No hiring recommendation from the AI | ✅ | `main.DECISION_RE` redirects to evidence |
| Fairness banner and scoring tooltip | ✅ | `web/src/App.tsx` |
| Keyboard-accessible evidence drawer | ✅ | `components/ui.tsx` — focus trap on open, Esc to close |
| Golden set and unit tests | ✅ | `tests/test_textops.py`, `tests/test_golden.py` (23 tests) |
| 8+ scripted chat tests | ✅ | `tests/test_chat.py` |
| Integration test and timed dry run | ✅ | `tests/test_integration.py`, 90 s budget assertion |
| Quality metrics endpoint | ✅ | `GET /quality` |
| Quality metrics panel in the UI | ✅ | Dashboard → "Evidence quality" |
| Purge data | ✅ | `POST /admin/purge` + Dashboard button |
| Retries with backoff on 429 / 5xx | ✅ | `llm._post_with_retry` — honours `Retry-After`, exponential + jitter |
| Prompts externalized and versioned | ✅ | `api/prompts/*.txt`, `PROMPT_VERSION` written into every audit row |
| Orchestration failures are visible | ✅ | `POST /n8n/error` writes `orchestration_error` audit rows |

## Architecture: where this deviates from the TRD, and why

| TRD says | Built as | Reasoning |
|---|---|---|
| n8n owns all LLM calls (W1–W6) | FastAPI owns LLM calls; n8n owns orchestration (W0 error handler, W1 screening orchestrator, W2 event router) | Quote verification, redaction and scoring have to be deterministic and unit-testable. Routing an unverified model quote through an HTTP node would break the one guarantee the product makes. n8n keeps what it is genuinely best at: triggering, sequencing, rate-limit pacing, retries, fan-out and failure routing |
| Header Auth on webhooks | ✅ implemented | Both webhooks use a Header Auth credential; the API signs its calls with `N8N_API_KEY` |
| Error-handler workflow (W0) | ✅ implemented | `n8n/0_hireflow_error_handler.json` — routes failures back into the product's own audit trail |
| n8n Data Tables for storage | SQLite | Single-file, zero-config, queryable, and the audit trail needs relational joins. Also keeps the app runnable with n8n switched off entirely |
| TanStack Query on the client | Native fetch + polling | Three polling surfaces did not justify the dependency for a two-day build |

## Graceful degradation, by design

| If this is missing | What happens |
|---|---|
| No LLM API key | The local evidence engine takes over. Every insight is labelled `local-evidence-engine` in the audit trail — the trail never lies about its source |
| n8n unreachable | `POST /screening/run` falls back to the built-in in-process runner |
| A candidate's screening throws | That candidate goes to `error` state with a retry button; the batch continues |
| A model quote cannot be located | Status is downgraded to `unclear`, flagged for validation, and the reason is written into the reasoning field |
| A prompt file is missing or malformed | `llm.load_prompt` falls back to the inline default |
