# HireFlow × n8n

Three workflows. Import all three, create one credential, set two variables, activate.

| File | Workflow | Trigger | What it does |
|---|---|---|---|
| `0_hireflow_error_handler.json` | **W0 — Error Handler** | Error Trigger | Catches any HireFlow workflow failure, writes it into the HireFlow audit trail via `POST /n8n/error`, then routes a high- or low-severity alert |
| `1_hireflow_screening_orchestrator.json` | **W1 — Screening Orchestrator** | Webhook `POST /webhook/hireflow/screening` | Answers 202 immediately, pulls pending candidates, screens them one at a time with a rate-limit wait between each, then builds the pool digest |
| `2_hireflow_event_router.json` | **W2 — Event Router** | Webhook `POST /webhook/hireflow/events` | Receives lifecycle events (`job.created`, `candidates.ingested`, `screening.completed`, `interview.kit_ready`, `candidate.decided`) and routes each to the right notification branch |

The API is the source of truth for data; n8n owns orchestration, retries, fan-out and
failure handling. If n8n is unreachable, the API silently falls back to its built-in
runner — the product never hard-depends on the automation layer.

---

## 1. Import

Workflows → **Import from File** → pick each of the three JSON files.
Import `0_hireflow_error_handler.json` first, because the other two reference it.

## 2. Create the webhook credential (30 seconds)

Both webhooks use Header Auth so a stranger with the URL cannot trigger a screening run.

Credentials → **New** → **Header Auth**:

| Field | Value |
|---|---|
| Credential name | `HireFlow Webhook Key` |
| Name | `X-API-Key` |
| Value | any long random string, e.g. `openssl rand -hex 24` |

Put the same value in `api/.env` as `N8N_API_KEY=...` so the API signs its calls.

> The imported workflows already point at a credential named **HireFlow Webhook Key**.
> Name it exactly that and the binding resolves automatically.
>
> **In a hurry for a demo?** Open each webhook node and set Authentication to *None*.
> Everything else still works.

## 3. Set the variables

Settings → **Variables** (available on n8n Cloud paid plans and self-hosted):

| Variable | Value |
|---|---|
| `HIREFLOW_API_BASE` | where the API is reachable *from n8n* |
| `HIREFLOW_INTERNAL_KEY` | must match `INTERNAL_KEY` in `api/.env` (leave both empty to disable) |

Pick `HIREFLOW_API_BASE` by where n8n runs:

| n8n runs… | `HIREFLOW_API_BASE` |
|---|---|
| Same machine as the API (`npx n8n`) | `http://127.0.0.1:8000` |
| In Docker, API on the host | `http://host.docker.internal:8000` |
| n8n Cloud | your public API URL (see below) |

**No Variables feature on your plan?** Open the **Run context** node in W1 and the
**Normalise the failure** node in W0 and hardcode `api_base` instead.

## 4. Point W1 and W2 at the error handler

Each workflow → **⋯ menu → Settings → Error Workflow → `HireFlow — Error Handler (W0)`**.
This cannot be stored inside an exported JSON file because it references a workflow ID
that only exists once you import. It takes two clicks per workflow.

## 5. Activate

Toggle **Active** on W1 and W2. W0 needs no toggle — error workflows fire automatically.

Production webhook URLs:

```
POST  <your-n8n>/webhook/hireflow/screening   {"job_id": "job_..."}
POST  <your-n8n>/webhook/hireflow/events      {"event": "...", "payload": {...}}
```

## 6. Tell the API to use n8n

In `api/.env`:

```bash
USE_N8N=true
N8N_BASE_URL=http://127.0.0.1:5678       # or https://<you>.app.n8n.cloud
N8N_API_KEY=<the same value as the Header Auth credential>
INTERNAL_KEY=<the same value as HIREFLOW_INTERNAL_KEY>
```

Restart the API. The left rail in the web app should now read **Orchestration · n8n · live**.

---

## n8n Cloud specifics

n8n Cloud runs outside your machine, so it cannot reach `localhost`. Choose one:

### Option A — tunnel your local API (fastest, good for the demo)

```bash
# terminal 1
cd hireflow/api && uvicorn main:app --port 8000

# terminal 2 — pick either tool
npx localtunnel --port 8000
# or
cloudflared tunnel --url http://localhost:8000
# or
ngrok http 8000
```

Copy the public HTTPS URL into the `HIREFLOW_API_BASE` variable. Leave the trailing
slash off. Then set `N8N_BASE_URL=https://<you>.app.n8n.cloud` in `api/.env`.

### Option B — deploy the API

Deploy `api/` to Render (there is a `render.yaml` at the repo root — see the main
README) and use that HTTPS URL as `HIREFLOW_API_BASE`.

### Cloud checklist

- [ ] All three workflows imported
- [ ] `HireFlow Webhook Key` Header Auth credential created and bound to both webhook nodes
- [ ] `HIREFLOW_API_BASE` set to a URL n8n can actually reach (test it in a browser: `<base>/health` returns `{"status":"ok"}`)
- [ ] `HIREFLOW_INTERNAL_KEY` matches `INTERNAL_KEY` in `api/.env`
- [ ] Error Workflow set to W0 on both W1 and W2
- [ ] W1 and W2 toggled **Active**
- [ ] `api/.env` has `USE_N8N=true` plus `N8N_BASE_URL` and `N8N_API_KEY`, and the API was restarted

---

## Verify end to end

1. In the web app, load the demo pool, then open the **Candidate board**.
2. Click **Run screening** while candidates are pending.
3. In n8n → **Executions**, W1 should appear and step through the loop.
4. The HireFlow left rail should read `Orchestration · n8n · live`.
5. Decide on a candidate in the interview workspace — W2 should fire on `candidate.decided`.

### Prove the error handling works

Open W1, change the **Run context** node's `api_base` to `http://127.0.0.1:9`, save, and
trigger a run. W1 fails, W0 fires, and the failure shows up in the HireFlow **Audit
trail** page as an `orchestration_error` row with the failing node named. Change it back
afterwards.

---

## Design notes

**Why does FastAPI make the LLM calls instead of n8n?**
Quote verification, PII redaction and scoring must be deterministic and unit-testable —
they are code, in `textops.py`, with a golden-set test suite behind them. Putting an
unverified model quote straight into an n8n HTTP node would break the one guarantee
HireFlow makes: no evidence reaches the board that could not be located in the source.
n8n owns what n8n is genuinely good at — triggering, sequencing, rate-limit pacing,
retries, fan-out to notifications, and failure routing.

**Reliability built into the workflows**

- Every HTTP node retries 3 times with a 2.5 s pause (`retryOnFail`).
- The screening loop processes one candidate at a time with an explicit wait node, so a
  provider rate limit slows the run instead of failing it.
- `Screen candidate` is set to `continueRegularOutput`: one bad resume does not abort the
  batch, and the candidate is left in a retryable state.
- Failures land in the product's own audit trail, not just n8n's execution log.
- `saveExecutionProgress` is on, so a failed run can be resumed from the failing node.
