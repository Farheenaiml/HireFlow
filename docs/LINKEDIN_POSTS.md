# LinkedIn posts — Agentic AI Hackathon '26

LinkedIn content and engagement is **25% of the score**, equal to AI integration. Both
days are mandatory, and both team members must post separately.

**Non-negotiables**
- Tag **Product Space** (the company page, not just text) in every post.
- Post on **19th Sept** and **20th Sept**. A missed day reduces your streak score.
- Use the caption template Product Space shares in the kickoff call / WhatsApp group if
  it conflicts with anything below — theirs wins.

**What actually drives engagement on LinkedIn**
- First two lines decide everything; everything after "…see more" is invisible until clicked.
- Post 9–11 AM or 6–8 PM IST. Reply to every comment within the first hour.
- Native image or video beats a link. Put external links in the first comment, not the post.
- 3–5 hashtags, no more.

---

## Day 1 — 19th Sept

**Suggested media:** a screenshot of the requirements screen with must/nice split, or a
photo of the whiteboarded problem. Not a wall of code.

```
Day 1 of the Agentic AI Hackathon, and I spent the first two hours not building anything.

The problem statement was candidate screening. The obvious build is "AI ranks resumes."
I think that's the wrong product.

Here's why. If a recruiter shortlists 5 people out of 200 and a rejected candidate asks
why, "the model scored you 62" is not an answer. In the EU it isn't even a legal one —
hiring AI is classified high-risk, and automated rejection without human review is
restricted. Any screening tool that can't show its work is unshippable the moment it
leaves a demo.

So I inverted the design. HireFlow doesn't rank people. It proves claims.

Three decisions I locked in today:

1. No verdict without a quote. Every "this candidate meets requirement 4" has to carry
the exact sentence from the resume that justifies it — and the code checks that sentence
actually exists in the source before it ever reaches the screen. A hallucinated quote
gets caught and the status is automatically downgraded to "unclear."

2. Scoring is code, not vibes. Strong / Potential / Weak isn't a model opinion. It's
must-have coverage above 0.75 with nothing missing. The thresholds are in the repo. A
recruiter can hover them in the UI.

3. Screening is blind. Names, emails, phone numbers and institution names get stripped
before the model reads a single word. You can't be biased by a school you never saw.

Tomorrow: the interview layer, the n8n orchestration, and the audit trail that ties
every insight back to its source.

Building in public, mistakes included.

@Product Space #AgenticAI #ProductManagement #AIProductManagement #BuildInPublic
```

---

## Day 2 — 20th Sept

**Suggested media:** a short screen recording of the evidence drawer — click a
requirement, watch the resume highlight the exact matched span. That single interaction
explains the whole product without narration.

```
Day 2 of the Agentic AI Hackathon. HireFlow is live, and the feature I'm proudest of is
the one that makes the AI look worse.

Here's what happens when the model cites something that isn't there.

During screening it returned a confident quote for "experience with double-entry
ledgers." The quote verification step went looking for that sentence in the resume.
Couldn't find it. So the system did this, automatically:

→ downgraded the status from "met" to "unclear"
→ flagged it for validation at interview
→ wrote the reason into the record: "Evidence could not be located in the resume text"
→ generated an interview question specifically to close that gap

The candidate's score went down. That's the point. A screening tool that only ever
flatters its own output is a liability.

What shipped in 2 days:

• JD → explicit, editable requirements (must vs nice-to-have)
• Resume ingest with PII stripped before the model sees anything
• Per-requirement verdicts, each carrying a verified quote
• Interview kits that target only the unresolved gaps
• Interview notes mapped back to requirements, with unanswered areas flagged
• A standardized report where the rating and decision fields are deliberately blank —
  only a human fills those
• Ask-the-pool chat that refuses protected-attribute questions outright
• A full audit trail: every insight, its source text, its engine, its prompt version

Orchestration runs on n8n — three workflows covering screening, lifecycle events, and a
dedicated error handler that routes failures back into the product's own audit trail. If
n8n goes down the app falls back to its built-in runner. The automation layer is
useful, never load-bearing.

The biggest lesson from 48 hours: the hard part of AI product work isn't getting a model
to produce an answer. It's deciding what the model is not allowed to do.

HireFlow won't rank candidates. Won't recommend a hire. Won't answer "which of these are
women." Won't show evidence it couldn't verify.

Constraints are the product.

Demo in the comments.

@Product Space #AgenticAI #ProductManagement #AIProductManagement #BuildInPublic
```

---

## Shorter alternates

If the long form doesn't suit your feed, these are punchier.

**Day 1 alternate**
```
Everyone's building "AI ranks resumes" today.

I think that's the wrong product. If a candidate asks why they were rejected, "the model
scored you 62" isn't an answer — and under EU AI Act rules for high-risk hiring systems,
it isn't a legal one either.

So HireFlow doesn't rank. It proves.

Every verdict carries the exact quote from the resume that justifies it. The code checks
that quote actually exists before it reaches the screen. If it can't be found, the claim
gets downgraded — automatically.

Day 1 of the Agentic AI Hackathon. Building the thing that argues with itself.

@Product Space #AgenticAI #BuildInPublic #AIProductManagement
```

**Day 2 alternate**
```
My AI screening tool caught its own hallucination today, and I shipped it as a feature.

The model cited a resume line that didn't exist. Verification failed. The system
downgraded its own confidence, flagged it for the interview, wrote the reason into the
audit trail, and generated a question to close the gap.

The candidate's score went down. Good.

2 days, 1 working product: JD → requirements → blind screening → interview kits →
standardized reports → natural-language pool queries → full audit trail. Orchestrated on
n8n with a dedicated error-handler workflow.

It will not rank candidates. It will not recommend a hire. It will not answer questions
about protected attributes.

The constraints are the product.

@Product Space #AgenticAI #BuildInPublic #AIProductManagement
```

---

## Comment replies worth having ready

**"Isn't this just RAG over resumes?"**
> Retrieval is one piece. The differentiator is the verification step after generation —
> every quote is matched back against the source text, and unverifiable claims are
> downgraded automatically rather than shown. That's the part that makes the output
> defensible.

**"Why not let it just rank candidates?"**
> Because a ranked list is an automated decision, and hiring is classified high-risk. The
> moment the tool decides, the recruiter is rubber-stamping. HireFlow grades evidence
> coverage and leaves advance / hold / reject to a named human — which is also what the
> audit trail records.

**"How do you handle bias?"**
> Three layers: names, contact details and institutions are redacted before the model
> reads anything; scoring is deterministic code, not a model score; and the chat refuses
> protected-attribute queries outright and logs the refusal. None of that makes it
> bias-free — it makes it inspectable.

**"What did you build it with?"**
> FastAPI + React + SQLite, n8n for orchestration. LLM provider is swappable (Groq /
> Anthropic / OpenAI) and it degrades to a deterministic local engine with no key at all,
> so the demo never depends on someone else's rate limit.
