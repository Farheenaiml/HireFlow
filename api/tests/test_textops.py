"""Unit tests for the deterministic core: redaction, quote verification, grouping."""
import textops as T

RESUME = """Jane Q Public
jane.public@mail.example | +91 98765 43210 | linkedin.com/in/janepublic | Pune

SUMMARY
Engineer with 5 years of experience. She built payment APIs.

EXPERIENCE
Senior Engineer, Acme Pay - 2020 to Present
Built REST APIs in Python and FastAPI serving 2M requests a day.

Date of birth: 12 March 1990
Marital status: Married

EDUCATION
B.Tech in Computer Science, Indian Institute of Technology Bombay, 2014
"""


# ---------------------------------------------------------------- redaction

def test_redaction_removes_contact_details():
    out = T.redact(RESUME)["redacted_text"]
    assert "jane.public@mail.example" not in out
    assert "98765" not in out
    assert "linkedin.com" not in out
    assert "[EMAIL]" in out and "[PHONE]" in out and "[LINK]" in out


def test_redaction_removes_name_everywhere():
    out = T.redact(RESUME)["redacted_text"]
    assert "Jane" not in out and "Public" not in out
    assert "[CANDIDATE]" in out


def test_redaction_removes_institution_but_keeps_degree():
    out = T.redact(RESUME)["redacted_text"]
    assert "Indian Institute of Technology" not in out
    assert "[INSTITUTION]" in out
    assert "B.Tech in Computer Science" in out


def test_redaction_drops_protected_lines():
    out = T.redact(RESUME)["redacted_text"]
    assert "Date of birth" not in out and "Marital" not in out


def test_redaction_neutralises_pronouns_and_keeps_skills():
    out = T.redact(RESUME)["redacted_text"]
    assert " She " not in out and "She built" not in out
    assert "REST APIs in Python and FastAPI" in out


def test_redaction_pii_map_is_returned_for_reveal_toggle():
    r = T.redact(RESUME)
    assert r["pii_map"]["name"] == ["Jane Q Public"]
    assert any(x["type"] == "email" for x in r["redactions"])


# ---------------------------------------------------------------- verification

SRC = "Built REST APIs in Python and FastAPI serving 2M requests a day.\nOwned the on-call rota."


def test_exact_quote_is_verified_with_offsets():
    v = T.verify_quotes(SRC, [{"id": "R1", "quote": "Built REST APIs in Python and FastAPI"}])[0]
    assert v["verified"] and v["method"] == "exact"
    assert v["start"] == 0 and v["end"] > 0


def test_quote_survives_whitespace_and_case_changes():
    v = T.verify_quotes(SRC, [{"id": "R1", "quote": "built  rest apis\nin python"}])[0]
    assert v["verified"] and v["method"] == "exact"


def test_fuzzy_quote_is_verified():
    q = "Built REST APIs in Python and FastAPI serving 2M requests per day."
    v = T.verify_quotes(SRC, [{"id": "R1", "quote": q}])[0]
    assert v["verified"] and v["method"] in ("fuzzy", "exact")


def test_invented_quote_is_rejected():
    v = T.verify_quotes(SRC, [{"id": "R9", "quote": "Led a team of forty engineers at Google"}])[0]
    assert not v["verified"]


def test_empty_and_overlong_quotes_fail():
    res = T.verify_quotes(SRC, [{"id": "a", "quote": ""}, {"id": "b", "quote": "x" * 301}])
    assert not res[0]["verified"] and not res[1]["verified"]
    assert res[1]["method"] == "too_long"


# ---------------------------------------------------------------- grouping

REQS = ([{"req_id": f"R{i}", "priority": "must"} for i in range(1, 5)]
        + [{"req_id": "R5", "priority": "nice"}])


def _ev(*statuses):
    return [{"req_id": f"R{i + 1}", "status": s} for i, s in enumerate(statuses)]


def test_strong_when_all_musts_met():
    g = T.group_candidate(REQS, _ev("met", "met", "met", "met", "missing"))
    assert g["group"] == "Strong" and g["score"] == 80.0


def test_score_formula_matches_spec():
    g = T.group_candidate(REQS, _ev("met", "met", "partial", "unclear", "met"))
    must = (1 + 1 + 0.5 + 0.25) / 4
    assert abs(g["score"] - round(100 * (0.8 * must + 0.2 * 1.0), 1)) < 0.11


def test_missing_must_blocks_strong_even_with_high_score():
    g = T.group_candidate(REQS, _ev("met", "met", "met", "missing", "met"))
    assert g["must_score"] == 0.75 and g["group"] == "Potential"


def test_weak_below_potential_threshold():
    g = T.group_candidate(REQS, _ev("unclear", "missing", "missing", "partial", "missing"))
    assert g["group"] == "Weak"


def test_rationale_is_code_generated_and_counts_validation():
    evs = _ev("met", "met", "unclear", "missing", "met")
    evs[2]["needs_validation"] = True
    g = T.group_candidate(REQS, evs)
    assert "Meets 2 of 4 must-haves" in g["rationale"]
    assert "1 item(s) need validation" in g["rationale"]


def test_thresholds_are_configurable():
    g = T.group_candidate(REQS, _ev("met", "met", "partial", "partial", "met"),
                          {"strong_must_score": 0.7})
    assert g["group"] == "Strong"
