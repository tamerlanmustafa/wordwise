"""
Measure the lemma purity guard (src/services/lemma_guard.py) against a
labelled evaluation set, and score candidate rule changes (issue #96).

Why this script exists
----------------------
The guard's thresholds were originally set by looking at hand-picked example
words. That is how it ended up miscalibrated in both directions at once --
deleting real vocabulary ("waveform", "landmine") while keeping junk ("ning",
graded C1). Picking new constants the same way would reproduce the same
mistake, so every threshold here has to be justified against a *random*
sample that was drawn before anyone looked at it.

Two traps this script is built to avoid
---------------------------------------
1. **Circular ground truth.** `hidden_words` looks like a curated list of
   known-bad words, but every row's reason is "auto: <guard reason>" -- it is
   the guard's own output, written by hide_garbage_lemmas.py. Scoring the
   guard against it would only prove the guard agrees with itself. It is
   never used as truth here.

2. **A sample drawn from survivors only.** Sampling today's `lemmas` table
   measures precision (junk we kept) but cannot measure recall (real words we
   deleted), because the deleted rows are gone -- the pre-cleanup backup the
   issue refers to no longer exists on disk or in prod. The population here is
   `word_classifications` instead: 56k distinct words observed in real
   scripts, dating back to 2026-03-29, which predates the guard. It contains
   both the words the guard keeps and the words it rejects, so one sample
   measures both directions.

   The population is the `lemma` column, not `word`. The guard is invoked as
   evaluate_lemma(token.lemma_) -- it never sees a surface form -- so
   sampling `word` measures it on input it is never given and invents a huge
   false failure rate out of ordinary English inflections ("raccoons",
   "vomited", "freckles"), none of which ever reach the guard. 99% of these
   rows (4.77M of 4.83M) were written before the guard shipped on 2026-07-22,
   and the lemma stored on each is the one spaCy produced in context, which
   is exactly the string the guard would have judged.

Usage (needs wordfreq + the NLTK words corpus -- on this machine that is
/opt/homebrew/bin/python3.11, not the .venv-test interpreter):

    python3.11 evaluate_lemma_guard.py population   # dump prod -> CSV
    python3.11 evaluate_lemma_guard.py sample       # stratified draw -> CSV
    python3.11 evaluate_lemma_guard.py score        # rule table from labels
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import os
import random
import string
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.services import lemma_guard as lg  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
POPULATION_CSV = os.path.join(DATA_DIR, "lemma_guard_population.csv")
LABELS_CSV = os.path.join(DATA_DIR, "lemma_guard_eval_labels.csv")

# Fixed so a re-run reproduces the same draw. Changing it invalidates every
# label already recorded in LABELS_CSV.
SAMPLE_SEED = 96
PER_STRATUM = 34

# Zipf bands. The guard's live floor (MIN_FREQ_NOT_IN_DICT = 2e-6) is Zipf
# ~3.3, so the bands bracket it: the interesting disagreements are in
# "rare" and "borderline", where real rare words and common typos overlap.
BANDS = [
    ("zero", 0.0, 0.0),
    ("veryrare", 0.0, 2.0),
    ("rare", 2.0, 2.75),
    ("borderline", 2.75, 3.3),
    ("common", 3.3, 99.0),
]


def zipf(freq: float) -> float:
    """Zipf scale: log10(freq per billion). 0.0 for an unseen word."""
    import math

    return 0.0 if freq <= 0 else math.log10(freq * 1e9)


def band_of(freq: float) -> str:
    z = zipf(freq)
    if freq <= 0:
        return "zero"
    for name, lo, hi in BANDS[1:]:
        if lo <= z < hi:
            return name
    return "common"


# ---------------------------------------------------------------------------
# Candidate rules
#
# Each takes (word, context) and returns (keep, reason). Context carries the
# signals available at decision time; `scripts` is how many distinct movie
# scripts the word was observed in.
# ---------------------------------------------------------------------------

@dataclass
class Ctx:
    scripts: int
    modal_pos: str
    in_registry: bool


def _freq(w: str, lang: str = "en") -> float:
    from wordfreq import word_frequency

    return word_frequency(w, lang)


def rule_current(w: str, ctx: Ctx) -> tuple[bool, str]:
    """Today's guard, with no curated-wordlist rescue (we score the gate)."""
    d = lg.evaluate_lemma(w)
    return d.keep, d.reason


_ALPHABET = string.ascii_lowercase


def _near_miss(w: str, ratio: float = 20.0) -> Optional[str]:
    """
    Issue #96 option 1: is `w` one edit from a much more frequent word?

    Only insertions and substitutions are considered. Deletions are excluded
    on purpose -- a real compound often contains a shorter real word by
    deleting one letter ("bookend" -> "booked"), which would make the rule
    reject exactly the vocabulary it is supposed to protect.
    """
    if len(w) < 3:
        return None
    base = _freq(w)
    threshold = max(base * ratio, 1e-7)

    best, best_freq = None, threshold
    for i in range(len(w) + 1):  # insertions
        for c in _ALPHABET:
            cand = w[:i] + c + w[i:]
            f = _freq(cand)
            if f > best_freq:
                best, best_freq = cand, f
    for i in range(len(w)):  # substitutions
        for c in _ALPHABET:
            if c == w[i]:
                continue
            cand = w[:i] + c + w[i + 1:]
            f = _freq(cand)
            if f > best_freq:
                best, best_freq = cand, f
    return best


def rule_nearmiss(w: str, ctx: Ctx) -> tuple[bool, str]:
    """Current guard, plus the near-miss typo test."""
    keep, reason = rule_current(w, ctx)
    if not keep:
        return keep, reason
    hit = _near_miss(w)
    if hit:
        return False, f"near_miss:{hit}"
    return True, ""


def rule_lower_floor(w: str, ctx: Ctx) -> tuple[bool, str]:
    """Issue #96 option 5: keep the shape, drop the frequency floor to 2e-7."""
    original = lg.MIN_FREQ_NOT_IN_DICT
    lg.MIN_FREQ_NOT_IN_DICT = 2e-7
    lg._dictionary_gate.cache_clear()
    try:
        return rule_current(w, ctx)
    finally:
        lg.MIN_FREQ_NOT_IN_DICT = original
        lg._dictionary_gate.cache_clear()


def rule_propn(w: str, ctx: Ctx) -> tuple[bool, str]:
    """
    Issue #96 option 2: drop anything tagged PROPN.

    Scored to show why it must not ship, not because it is a candidate. The
    stored tag comes from whichever token happened to be seen first
    (lemmatization_service.py: "Keep the first occurrence as representative"),
    so it reflects one arbitrary occurrence rather than how the word is
    normally used.
    """
    keep, reason = rule_current(w, ctx)
    if not keep:
        return keep, reason
    if ctx.modal_pos == "PROPN":
        return False, "propn"
    return True, ""


def rule_british(w: str, ctx: Ctx) -> tuple[bool, str]:
    """
    Current guard, plus: accept a token whose American spelling is a real
    word.

    Not one of the issue's five options. It comes out of the labelled sample,
    where British spellings turned out to be a whole rejected class the issue
    never names -- the dictionary is Webster's 2nd (American) and wordfreq's
    English corpus under-counts British forms, so "odour", "colourless",
    "equalise", "civilisation", "metre" and "gruelling" all read as
    low-frequency non-words.
    """
    keep, reason = rule_current(w, ctx)
    if keep:
        return True, ""
    if reason not in ("not_in_dict_low_freq", "unknown_english") \
            and not reason.startswith("foreign_"):
        return keep, reason
    for brit, amer in _BRITISH_SUFFIXES:
        if w.endswith(brit):
            cand = w[: -len(brit)] + amer
            sub, _ = rule_current(cand, ctx)
            if sub:
                return True, f"british:{cand}"
    return keep, reason


_BRITISH_SUFFIXES = (
    ("isation", "ization"), ("ising", "izing"), ("ised", "ized"),
    ("ises", "izes"), ("ise", "ize"), ("yse", "yze"),
    ("ours", "ors"), ("our", "or"),
    ("tres", "ters"), ("tre", "ter"), ("bre", "ber"),
    ("logue", "log"), ("lling", "ling"), ("lled", "led"),
)


RULES: Dict[str, Callable[[str, Ctx], tuple[bool, str]]] = {
    "current": rule_current,
    "option2_propn": rule_propn,
    "option5_lower_floor": rule_lower_floor,
    "option1_nearmiss": rule_nearmiss,
    "british_variants": rule_british,
}


# ---------------------------------------------------------------------------
# population: dump the pre-guard word population out of prod
# ---------------------------------------------------------------------------

async def _fetch_population() -> List[dict]:
    """Read the population out of prod. No file I/O: writing the CSV from
    inside the coroutine trips ruff's ASYNC230 (issue #148), and the split
    keeps the awaited database work separate from the blocking write."""
    from prisma import Prisma

    db = Prisma()
    await db.connect()
    try:
        return await db.query_raw(
            """
            SELECT LOWER(wc.lemma) AS word,
                   count(DISTINCT wc.script_id)::int AS scripts,
                   mode() WITHIN GROUP (ORDER BY wc.pos) AS modal_pos,
                   (l.id IS NOT NULL) AS in_registry
            FROM word_classifications wc
            LEFT JOIN lemmas l ON l.lemma = LOWER(wc.lemma)
            WHERE wc.created_at < '2026-07-22'
            GROUP BY LOWER(wc.lemma), (l.id IS NOT NULL)
            """
        )
    finally:
        await db.disconnect()


def cmd_population(args) -> None:
    rows = asyncio.run(_fetch_population())
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(POPULATION_CSV, "w", newline="") as fh:
        wtr = csv.DictWriter(
            fh, fieldnames=["word", "scripts", "modal_pos", "in_registry"]
        )
        wtr.writeheader()
        for r in rows:
            wtr.writerow(r)
    print(f"wrote {len(rows)} rows -> {POPULATION_CSV}")


def load_population() -> List[dict]:
    if not os.path.exists(POPULATION_CSV):
        sys.exit(f"missing {POPULATION_CSV} -- run the `population` command first")
    with open(POPULATION_CSV) as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        r["scripts"] = int(r["scripts"] or 0)
        r["in_registry"] = str(r["in_registry"]).lower() in ("t", "true")
        r["modal_pos"] = r["modal_pos"] or ""
    return rows


# ---------------------------------------------------------------------------
# sample: stratified random draw, written out for labelling
# ---------------------------------------------------------------------------

def cmd_sample(args) -> None:
    rows = load_population()
    strata: Dict[tuple, List[dict]] = defaultdict(list)

    for r in rows:
        w = r["word"]
        if not w or " " in w:
            continue
        keep, reason = rule_current(
            w, Ctx(r["scripts"], r["modal_pos"], r["in_registry"])
        )
        r["reason"] = reason
        strata[(band_of(_freq(w)), "keep" if keep else "reject")].append(r)

    # Re-running the draw must never destroy labelling work: the seed makes
    # the draw deterministic, but the rules being scored change which stratum
    # a word lands in, so carry every existing label across by word.
    existing: Dict[str, str] = {}
    if os.path.exists(LABELS_CSV):
        with open(LABELS_CSV) as fh:
            existing = {r["word"]: r.get("label", "") for r in csv.DictReader(fh)}

    rng = random.Random(SAMPLE_SEED)
    picked: List[dict] = []
    for key in sorted(strata):
        pool = sorted(strata[key], key=lambda r: r["word"])
        take = rng.sample(pool, min(PER_STRATUM, len(pool)))
        for r in take:
            r = dict(r)
            r["band"], r["guard"] = key
            # Stratum size, carried on every row so `score` can weight the
            # sample back up to the population. Without it the reject side --
            # 34 drawn from a pool of 8 in one stratum and 170 in another --
            # would count for as much as the keep side's 12,218.
            r["pool"] = len(pool)
            r["label"] = existing.get(r["word"], "")
            picked.append(r)
        print(f"  {key[0]:12s} {key[1]:6s} pool={len(pool):6d} took={len(take)}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LABELS_CSV, "w", newline="") as fh:
        wtr = csv.DictWriter(
            fh,
            fieldnames=["word", "scripts", "modal_pos", "in_registry",
                        "band", "guard", "reason", "pool", "label"],
        )
        wtr.writeheader()
        wtr.writerows(picked)
    print(f"\nwrote {len(picked)} unlabelled rows -> {LABELS_CSV}")
    print("label the `label` column: real | junk")


# ---------------------------------------------------------------------------
# score: precision/recall per rule against the labels
# ---------------------------------------------------------------------------

def cmd_score(args) -> None:
    if not os.path.exists(LABELS_CSV):
        sys.exit(f"missing {LABELS_CSV} -- run `sample` and label it first")
    with open(LABELS_CSV) as fh:
        rows = [r for r in csv.DictReader(fh) if r["label"].strip()]
    if not rows:
        sys.exit("no labelled rows yet")

    for r in rows:
        r["scripts"] = int(r["scripts"] or 0)
        r["in_registry"] = str(r["in_registry"]).lower() in ("t", "true")
        r["modal_pos"] = r["modal_pos"] or ""

    from collections import Counter
    counts = Counter(r["label"] for r in rows)
    print(f"labelled sample: {len(rows)} words " +
          ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) + "\n")

    # Each sampled row stands for pool/taken words in the population, so a
    # row from a 12,218-word stratum must outweigh one from an 8-word
    # stratum by that ratio. Unweighted numbers here would read far better
    # than reality, because rejects are only 1.6% of the population but half
    # the sample.
    taken: Dict[tuple, int] = Counter((r["band"], r["guard"]) for r in rows)
    for r in rows:
        r["weight"] = int(r["pool"]) / taken[(r["band"], r["guard"])]

    # What each layer is supposed to do with each label.
    #   storable  = is this a real English word at all (write-time, destructive)
    #   teachable = should a learner be shown it (read-time, reversible)
    WANT = {
        "real":    {"storable": True,  "teachable": True},
        "obscure": {"storable": True,  "teachable": False},
        "policy":  {"storable": True,  "teachable": False},
        "junk":    {"storable": False, "teachable": False},
    }

    hdr = (f"{'rule':22s} {'layer':10s} {'junk kept':>10s} {'real dropped':>13s} "
           f"{'accuracy':>9s}")
    print(hdr)
    print("-" * len(hdr))

    for name, fn in RULES.items():
        layer = "storable"
        junk_kept = junk_tot = real_dropped = real_tot = 0.0
        correct = total = 0.0
        for r in rows:
            ctx = Ctx(r["scripts"], r["modal_pos"], r["in_registry"])
            keep, _ = fn(r["word"], ctx)
            w = r["weight"]
            want = WANT[r["label"]][layer]
            total += w
            if keep == want:
                correct += w
            if r["label"] == "junk":
                junk_tot += w
                if keep:
                    junk_kept += w
            elif want:  # a word this layer is supposed to keep
                real_tot += w
                if not keep:
                    real_dropped += w
        print(f"{name:22s} {layer:10s} "
              f"{junk_kept / junk_tot if junk_tot else 0:10.1%} "
              f"{real_dropped / real_tot if real_tot else 0:13.1%} "
              f"{correct / total if total else 0:9.1%}")

    print("\n'junk kept' = of words that are not English vocabulary, the share "
          "this rule lets through.")
    print("'real dropped' = of words this layer should keep, the share it "
          "rejects. Both population-weighted.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("population", help="dump the prod word population to CSV")
    sub.add_parser("sample", help="draw a stratified random sample to label")
    sub.add_parser("score", help="score every rule against the labelled sample")
    args = ap.parse_args()

    if args.cmd == "population":
        cmd_population(args)
    elif args.cmd == "sample":
        cmd_sample(args)
    else:
        cmd_score(args)


if __name__ == "__main__":
    main()
