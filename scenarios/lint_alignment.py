"""Warn when a scenario's messages do not match its own tuple.

This is a supplement to scenarios/validate.py, not a replacement: it prints
warnings and always exits 0. It checks only what a script can decide. Whether
the language sounds like a real person, or whether the answer key fits the
record, still needs a critic pass and a human reviewer.

Usage, from the repository root:
    python3 scenarios/lint_alignment.py scenarios/pilot_scenarios.jsonl
"""

import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "cartwheel.db"
WORDS_PATH = Path("/usr/share/dict/words")

DATE_WORDS = re.compile(
    r"\bago\b|\byesterday\b|\blast (?:week|month|year)\b|\b(?:weeks?|months?)\b"
    r"|\b(?:\d+|an?|one|two|three|few|couple|several)\s+days?\b",
    re.I,
)
ORDER_PHRASE = re.compile(r"\border\s*(?:id|number|#)?\s*#?\s*\d+", re.I)
# Openers that only make sense if the agent just said something.
REPLY_DEPENDENT = re.compile(
    r"^\s*(?:thanks|thank you|yes|yeah|yep|ok|okay|sure|great|got it|that works|no,|"
    r"just to add|to add|sorry,? i should|as i said|like i said|oh sorry)",
    re.I,
)
HEDGES = re.compile(r"\b(?:um|i think|not sure|not totally sure|maybe|sorry|i guess|honestly|i don't know)\b", re.I)
PLAIN_ANSWER = re.compile(r"\b(?:short|plain|brief|simple|quick)\b", re.I)
TERSE_STYLES = {"terse_fragmentary", "operational_shorthand"}
TERSE_MAX_WORDS = 18
RAMBLING_MIN_WORDS = 20
SHARED_PHRASE_WORDS = 5


def store_patterns() -> list[tuple[str, re.Pattern]]:
    """Names a message might use for a store: the full name, its first two words, a long first word."""
    if not DB_PATH.exists():
        return []
    with sqlite3.connect(DB_PATH) as conn:
        names = [row[0] for row in conn.execute("select name from stores")]
    patterns = []
    for name in names:
        words = name.split()
        forms = {name, " ".join(words[:2])}
        if len(words[0]) >= 7:
            forms.add(words[0])
        patterns.append((name, re.compile("|".join(r"\b" + re.escape(f) + r"\b" for f in forms), re.I)))
    return patterns


def dictionary() -> set[str]:
    if not WORDS_PATH.exists():
        return set()
    return {w.strip().lower() for w in WORDS_PATH.read_text().splitlines()}


def user_text(scenario: dict) -> str:
    return " ".join([scenario["opening_message"], *scenario.get("followups", [])])


def check_precision(scenario: dict, text: str, stores: list) -> list[str]:
    tuple_ = scenario["tuple"]
    level = tuple_.get("request_precision")
    names_store = any(p.search(text) for _, p in stores)
    has_date = bool(DATE_WORDS.search(text))
    order_id = tuple_.get("order_id")
    has_order = bool(ORDER_PHRASE.search(text)) or (order_id is not None and re.search(rf"\b{order_id}\b", text))
    out = []
    if level == "order_id_given":
        if order_id is not None and not re.search(rf"\b{order_id}\b", text):
            out.append(f"precision is order_id_given but order {order_id} is not in the message")
        if names_store:
            out.append("precision is order_id_given but the message names a store")
        if has_date:
            out.append("precision is order_id_given but the message includes date wording")
    elif level == "product_name_only":
        if names_store:
            out.append("precision is product_name_only but the message names a store")
        if has_date:
            out.append("precision is product_name_only but the message includes date wording")
        if has_order:
            out.append("precision is product_name_only but the message includes an order number")
    elif level == "product_name_and_rough_date":
        if names_store:
            out.append("precision is product_name_and_rough_date but the message names a store")
        if not has_date:
            out.append("precision is product_name_and_rough_date but the message has no date wording")
        if has_order:
            out.append("precision includes no order number but the message has one")
    elif level == "product_name_and_store":
        if not names_store:
            out.append("precision is product_name_and_store but no store is named")
        if has_date:
            out.append("precision is product_name_and_store but the message includes date wording")
    elif level == "store_only":
        if not names_store:
            out.append("precision is store_only but no store is named")
        if has_order:
            out.append("precision is store_only but the message includes an order number")
    elif level in ("vague_description_only", "not_applicable"):
        if names_store:
            out.append(f"precision is {level} but the message names a store")
        if has_order:
            out.append(f"precision is {level} but the message includes an order number")
    return out


def check_structure(scenario: dict) -> list[str]:
    tuple_ = scenario["tuple"]
    out = []
    turns = 1 + len(scenario.get("followups", []))
    if tuple_.get("turn_count") != turns:
        out.append(f"turn_count is {tuple_.get('turn_count')} but the scenario has {turns} user messages")
    intent, precision, tools = tuple_.get("intent"), tuple_.get("request_precision"), tuple_.get("tools_needed")
    if intent == "out_of_scope":
        if precision != "not_applicable":
            out.append("out_of_scope intent should have request_precision not_applicable")
        if tools not in ("none", "lookup_then_escalate"):
            out.append("out_of_scope intent should have tools_needed none or lookup_then_escalate")
    elif precision == "not_applicable":
        out.append("request_precision is not_applicable but the intent is not out_of_scope")
    return out


def check_followups(scenario: dict) -> list[str]:
    return [
        f"followup {n} opens with wording that depends on an agent reply: {text[:50]!r}"
        for n, text in enumerate(scenario.get("followups", []), start=2)
        if REPLY_DEPENDENT.search(text)
    ]


def check_style(scenario: dict, words: set[str]) -> list[str]:
    style = scenario["tuple"].get("user_style")
    opening = scenario["opening_message"]
    count = len(opening.split())
    out = []
    if style in TERSE_STYLES and count > TERSE_MAX_WORDS:
        out.append(f"style is {style} but the opening has {count} words (limit {TERSE_MAX_WORDS})")
    if style == "confused_rambling":
        if count < RAMBLING_MIN_WORDS:
            out.append(f"style is confused_rambling but the opening has only {count} words")
        if not HEDGES.search(user_text(scenario)):
            out.append("style is confused_rambling but no hedging wording appears")
    if style == "requests_short_plain_answer" and not PLAIN_ANSWER.search(opening):
        out.append("style is requests_short_plain_answer but the message never asks for a short or plain answer")
    if style == "typo_heavy" and words:
        unknown = [t for t in re.findall(r"[a-z]+", opening.lower()) if len(t) > 1 and t not in words]
        if len(unknown) < 2:
            out.append("style is typo_heavy but fewer than two misspelled words were found")
    return out


def shared_phrases(scenarios: list[dict]) -> dict[str, list[str]]:
    seen = defaultdict(set)
    for scenario in scenarios:
        tokens = re.findall(r"[a-z0-9']+", user_text(scenario).lower())
        for i in range(len(tokens) - SHARED_PHRASE_WORDS + 1):
            seen[" ".join(tokens[i : i + SHARED_PHRASE_WORDS])].add(scenario["id"])
    return {phrase: sorted(ids) for phrase, ids in seen.items() if len(ids) > 1}


def main(path: str) -> None:
    scenarios = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    stores, words = store_patterns(), dictionary()
    if not stores:
        print("note: data/cartwheel.db not found, store checks skipped")
    flagged = 0
    for scenario in scenarios:
        text = user_text(scenario)
        warnings = (
            check_precision(scenario, text, stores)
            + check_structure(scenario)
            + check_followups(scenario)
            + check_style(scenario, words)
        )
        if warnings:
            flagged += 1
            print(f"{scenario['id']}")
            for warning in warnings:
                print(f"  - {warning}")
    repeats = shared_phrases(scenarios)
    if repeats:
        print(f"phrases of {SHARED_PHRASE_WORDS}+ words shared by several scenarios")
        for phrase, ids in sorted(repeats.items()):
            print(f"  - {phrase!r}: {', '.join(ids)}")
    print(f"{flagged} of {len(scenarios)} scenarios have warnings")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "scenarios/pilot_scenarios.jsonl")
