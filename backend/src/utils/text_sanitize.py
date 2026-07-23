"""
Text sanitization for values on their way into Postgres.

Postgres `text` cannot store a NUL byte (0x00) — the insert fails with
`22021: invalid byte sequence for encoding "UTF8": 0x00`. Script sources
occasionally hand us text carrying NULs or other C0 control bytes, which makes
that film a poison pill: the write raises, the fetch is classified transient,
and the job burns its whole retry budget failing identically every time
(issue #88, 'The Switch (2010)').

Strip the bytes once, at the point of persistence, so every source is covered.
"""
from __future__ import annotations

import re
from typing import Any

# All C0 controls plus DEL, except the whitespace Postgres stores happily:
# tab (\x09), newline (\x0A), carriage return (\x0D).
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")


def strip_control_chars(text: str) -> str:
    """Remove NUL and other control bytes from a string, keeping \\t \\n \\r."""
    return CONTROL_CHARS_RE.sub("", text)


def sanitize_for_db(value: Any) -> Any:
    """Recursively strip control bytes from every string in `value`.

    Handles the shapes we persist: plain strings, and the nested dict/list
    metadata payloads that get JSON-dumped into a text column. Non-string
    scalars (ints, bools, None) pass through untouched.
    """
    if isinstance(value, str):
        return strip_control_chars(value)
    if isinstance(value, dict):
        return {strip_control_chars(k) if isinstance(k, str) else k: sanitize_for_db(v)
                for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        sanitized = [sanitize_for_db(v) for v in value]
        return type(value)(sanitized) if isinstance(value, tuple) else sanitized
    return value
