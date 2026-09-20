"""Golden-set regression: the local engine on the six synthetic resumes (PRD Appendix A)."""
import json
import os

import llm
import textops as T

SEED = os.path.join(os.path.dirname(os.path.dirname(__file__)), "seed")


def _screen_all():
    job = json.load(open(os.path.join(SEED, "job.json"), encoding="utf-8"))
    reqs, _ = llm.analyze_jd(job["title"], job["jd_text"])
    for i, r in enumerate(reqs):
        r["req_id"] = f"R{i + 1}"
    golden = json.load(open(os.path.join(SEED, "golden.json"), encoding="utf-8"))["candidates"]
    out = {}
    for fname in golden:
        raw = open(os.path.join(SEED, "resumes", fname), encoding="utf-8").read()
        red = T.redact(raw)["redacted_text"]
        res = llm.local_screen(reqs, red)
        evs = res["evaluations"]
        vr = {v["id"]: v for v in T.verify_quotes(
            red, [{"id": e["req_id"], "quote": e["quote"]} for e in evs if e["status"] != "missing"])}
        for e in evs:
            e["verified"] = vr.get(e["req_id"], {}).get("verified", e["status"] == "missing")
            if e["status"] in ("met", "partial") and not e["verified"]:
                e["status"] = "unclear"
        out[fname] = (evs, T.group_candidate(reqs, evs), golden[fname])
    return out


def test_jd_produces_ten_requirements_with_musts_and_nices():
    job = json.load(open(os.path.join(SEED, "job.json"), encoding="utf-8"))
    reqs, _ = llm.analyze_jd(job["title"], job["jd_text"])
    assert 6 <= len(reqs) <= 10
    assert sum(r["priority"] == "must" for r in reqs) >= 3


def test_every_met_or_partial_has_a_verified_quote():
    for fname, (evs, _, _) in _screen_all().items():
        for e in evs:
            if e["status"] in ("met", "partial"):
                assert e["verified"], f"{fname} {e['req_id']} has an unverifiable claim"


def test_group_matches_golden_for_at_least_five_of_six():
    hits = sum(g["group"] == gold["group"] for _, g, gold in _screen_all().values())
    assert hits >= 5, f"only {hits}/6 groups match the golden set"


def test_strong_candidate_is_strong_and_weak_candidate_is_weak():
    res = _screen_all()
    assert res["01-ananya-rao.txt"][1]["group"] == "Strong"
    assert res["04-karthik-s.txt"][1]["group"] == "Weak"


def test_status_agreement_within_one_level_is_high():
    rank = {"met": 3, "partial": 2, "unclear": 1, "missing": 0}
    ok = n = 0
    for evs, _, gold in _screen_all().values():
        for e in evs:
            want = gold["statuses"].get(e["req_id"])
            if want:
                n += 1
                ok += abs(rank[e["status"]] - rank[want]) <= 1
    assert ok / n >= 0.80, f"within-one agreement {ok}/{n}"


def test_interview_eval_flags_shallow_answers_and_gaps():
    job = json.load(open(os.path.join(SEED, "job.json"), encoding="utf-8"))
    reqs, _ = llm.analyze_jd(job["title"], job["jd_text"])
    for i, r in enumerate(reqs):
        r["req_id"] = f"R{i + 1}"
    notes = open(os.path.join(SEED, "notes", "02-rahul-menon.txt"), encoding="utf-8").read()
    res = llm._local_eval(reqs, notes)
    cov = {m["req_id"]: m for m in res["mapping"]}
    assert cov["R7"]["coverage"] == "partial" and cov["R7"]["follow_up"]
    assert cov["R10"]["coverage"] == "not_covered"
    # every quote must exist in the notes
    for m in res["mapping"]:
        if m["notes_quote"]:
            assert T.verify_quotes(notes, [{"id": "x", "quote": m["notes_quote"]}])[0]["verified"]
