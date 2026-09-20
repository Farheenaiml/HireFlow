# Prompts

Every LLM instruction HireFlow sends lives here as a plain text file, so a
reviewer can read and change a prompt without touching Python.

| File | Used by | What it does |
|---|---|---|
| `jd.txt` | `POST /jd/analyze` | Turns a job description into explicit, checkable requirements |
| `screen.txt` | screening pipeline | Judges one resume against every requirement, quote-first |
| `repair.txt` | screening pipeline | Second pass when a quote could not be located in the source |
| `kit.txt` | `POST /interview/kit` | Writes targeted interview questions for the open gaps |
| `eval.txt` | `POST /interview/evaluate` | Maps interview notes back onto the requirements |
| `chat.txt` | `POST /chat` | Answers pool questions using only stored evidence |

## Rules

- `{FAIRNESS_RULE}` is substituted at load time with the shared anti-bias clause
  defined in `llm.py`. Keep it in every prompt that reads candidate text.
- Literal JSON braces must be doubled (`{{` and `}}`) in every file except
  `repair.txt`, which is loaded without formatting.
- If a file is missing, empty or malformed, `llm.py` falls back to the inline
  default, so a bad edit degrades gracefully instead of crashing the service.
- Bump `PROMPT_VERSION` in `llm.py` after any change. That string is written into
  every audit row, so the trail always says which prompt produced which insight.
