"""
Structured (JSON) logging with per-request correlation IDs.

One place configures logging for every entrypoint (the FastAPI app and the
background worker) so logs are shaped identically wherever they come from.

The correlation id lives in a ContextVar (`request_id_ctx`), set by the
request-id middleware on the API side and by the worker loop per job. A
logging filter copies it onto every LogRecord, so any `logging.getLogger(...)`
call anywhere in the codebase is automatically tagged — callers don't have to
thread an id through their signatures.

No secrets/PII are logged here: the formatter emits only the log message, the
correlation id, and whatever fields a caller explicitly passes via
`logger.info(msg, extra={...})`. It never introspects request headers/bodies.
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import logging.handlers
import os
from contextvars import ContextVar
from pathlib import Path
from typing import Optional, Union

# The active correlation id for the current request/job, or None outside one.
request_id_ctx: ContextVar[Optional[str]] = ContextVar("request_id", default=None)

# When no id is set (startup logs, ad-hoc scripts) we still want a stable,
# greppable placeholder rather than a missing field.
_NO_REQUEST_ID = "-"


def get_request_id() -> Optional[str]:
    """Current correlation id, or None outside a request/job.

    Exposed so an error tracker (or any future integration) can attach the
    same id to its events without importing the ContextVar directly.
    """
    return request_id_ctx.get()


def set_request_id(request_id: str):
    """Bind a correlation id to the current context. Returns the reset token."""
    return request_id_ctx.set(request_id)


# LogRecord attributes that are always present; anything else a caller stuffs
# onto a record (via `extra=`) is treated as a structured field to emit.
_RESERVED_RECORD_KEYS = frozenset(
    logging.makeLogRecord({}).__dict__.keys()
) | {"request_id", "message", "asctime", "taskName"}


class RequestIdFilter(logging.Filter):
    """Stamp every record with the current correlation id."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get() or _NO_REQUEST_ID
        return True


class JsonFormatter(logging.Formatter):
    """Render a LogRecord as a single-line JSON object."""

    def __init__(self, *, service: str = "api"):
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "timestamp": _dt.datetime.fromtimestamp(
                record.created, tz=_dt.timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "service": self.service,
            "logger": record.name,
            "request_id": getattr(record, "request_id", _NO_REQUEST_ID),
            "message": record.getMessage(),
        }

        # Structured extras passed via logger.info(msg, extra={...}).
        for key, value in record.__dict__.items():
            if key in _RESERVED_RECORD_KEYS or key.startswith("_"):
                continue
            payload[key] = _json_safe(value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


class TextFormatter(logging.Formatter):
    """Human-readable formatter for local dev (LOG_FORMAT=text)."""

    def __init__(self, *, service: str = "api"):
        super().__init__(
            fmt="%(asctime)s %(levelname)s [%(request_id)s] %(name)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        self.service = service


def _json_safe(value):
    """Best-effort conversion of an extra value to something JSON-serializable."""
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def _make_formatter(service: str) -> logging.Formatter:
    if os.environ.get("LOG_FORMAT", "json").lower() == "text":
        return TextFormatter(service=service)
    return JsonFormatter(service=service)


# Verbose third-party loggers we always want pinned to WARNING.
_NOISY_LOGGERS = (
    "httpx",
    "httpcore",
    "prisma",
    "subliminal",
    "subliminal.core",
    "subliminal.score",
    "subliminal.providers",
)


def configure_logging(
    *,
    debug: bool = False,
    level: Optional[Union[str, int]] = None,
    service: str = "api",
    log_file: Optional[Path] = None,
    force: bool = True,
) -> None:
    """Configure the root logger with structured output and a correlation-id filter.

    Args:
        debug: when True the console emits DEBUG; otherwise INFO (prod default).
        level: explicit console level; overrides ``debug`` when provided.
        service: value stamped into the ``service`` field of every log line.
        log_file: optional path for a rotating DEBUG file handler.
        force: replace any handlers already attached to the root logger.
    """
    console_level = level if level is not None else (logging.DEBUG if debug else logging.INFO)

    formatter = _make_formatter(service)
    request_filter = RequestIdFilter()

    handlers: list[logging.Handler] = []

    console_handler = logging.StreamHandler()
    console_handler.setLevel(console_level)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(request_filter)
    handlers.append(console_handler)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(request_filter)
        handlers.append(file_handler)

    root = logging.getLogger()
    if force:
        for existing in list(root.handlers):
            root.removeHandler(existing)
    for handler in handlers:
        root.addHandler(handler)
    # Root passes everything through to the handlers; each handler gates its
    # own level (DEBUG to file, console_level to console).
    root.setLevel(logging.DEBUG if log_file is not None else console_level)

    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
