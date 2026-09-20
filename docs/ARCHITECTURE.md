# Architecture

```
React + Vite (5173)
      │  REST, polling while a run is in flight
      ▼
FastAPI (8000) ──────────── SQLite (jobs, requirements, candidates,
      │                              evaluations, kits, interviews, audit_log)
      │
      ├── textops.py   extraction · redaction · quote verification · scoring   [no LLM, ever]
      ├── llm.py       Groq / Anthropic / OpenAI, or the local evidence engine
      └── n8n          POST /webhook/hireflow/screening   (orchestrated run)
                       POST /webhook/hireflow/events      (lifecycle notifications)
```

## Responsibility split, kept strict

| Component | Owns | Never does |
|---|---|---|
| React app | UI, polling, evidence drawer | Holds LLM keys |
| FastAPI | Orchestration, persistence, audit | Guesses at evidence |
| textops.py | Deterministic text work and all scoring | Calls a model |
| LLM | Language understanding: extraction, evidence finding, question writing | Decides groups or hires |

## The four agent roles

1. **Screener** — evaluates one anonymised resume against every requirement, returns a status,
   a verbatim quote, reasoning and a validation flag per requirement. Output passes through quote
   verification; failures get one repair pass, then downgrade.
2. **Interview planner** — reads only the evaluations that came back partial, unclear, missing or
   flagged, and writes questions aimed at those gaps.
3. **Interview evaluator** — maps raw notes to requirements, reports coverage and evidence strength,
   identifies unanswered areas, assembles the standardized report. Quotes are verified against the
   notes; unverifiable evidence is dropped to not-covered.
4. **Pool chat** — answers questions over the pool with citations, which are validated against the
   database before they reach the screen.

## Safeguards, in code not in prompts

- **Blind screening** — PII redacted before any model call.
- **Quote verification** — exact then fuzzy match with recorded offsets.
- **Automatic downgrade** — unverifiable evidence cannot support a met or partial status.
- **Deterministic grouping** — thresholds in one config object, displayed in the UI.
- **Citation validation** — invented citations are dropped from chat answers.
- **Blank decision fields** — the report ships with rating and decision empty by design.
- **Full audit log** — source, engine, prompt version and timestamp for every insight, including
  human overrides and decisions.
