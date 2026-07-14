"""
Unit tests for structured logging + request-correlation ids (issue #79).

No DB. The middleware is exercised on a throwaway FastAPI app (not src.main,
whose lifespan connects to Postgres) so these stay pure-unit and DB-free.
"""
import json
import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.logging_config import (
    JsonFormatter,
    RequestIdFilter,
    configure_logging,
    get_request_id,
    request_id_ctx,
)
from src.middleware.request_id import RequestIDMiddleware


def _format(record: logging.LogRecord) -> dict:
    """Run a record through the filter + JSON formatter and parse the result."""
    RequestIdFilter().filter(record)
    return json.loads(JsonFormatter(service="test").format(record))


def _make_record(msg="hello", level=logging.INFO, **extra) -> logging.LogRecord:
    record = logging.getLogger("wordwise.test").makeRecord(
        "wordwise.test", level, __file__, 10, msg, None, None
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


# --- JsonFormatter / RequestIdFilter -------------------------------------

def test_formatter_emits_valid_json_with_expected_fields():
    out = _format(_make_record("processing movie"))
    assert out["message"] == "processing movie"
    assert out["level"] == "INFO"
    assert out["logger"] == "wordwise.test"
    assert out["service"] == "test"
    assert "timestamp" in out
    # No correlation id bound -> stable placeholder, not a crash.
    assert out["request_id"] == "-"


def test_filter_stamps_current_correlation_id():
    token = request_id_ctx.set("abc123def456")
    try:
        out = _format(_make_record())
    finally:
        request_id_ctx.reset(token)
    assert out["request_id"] == "abc123def456"


def test_formatter_includes_structured_extras():
    out = _format(_make_record("request", method="GET", path="/health", status=200))
    assert out["method"] == "GET"
    assert out["path"] == "/health"
    assert out["status"] == 200


def test_formatter_serializes_exception():
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.getLogger("wordwise.test").makeRecord(
            "wordwise.test", logging.ERROR, __file__, 1, "failed", None,
            __import__("sys").exc_info(),
        )
    out = _format(record)
    assert "ValueError: boom" in out["exception"]


# --- RequestIDMiddleware --------------------------------------------------

def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/whoami")
    def whoami():
        # The id set by the middleware must be visible inside the handler.
        return {"request_id": get_request_id()}

    return app


def test_middleware_generates_request_id_when_absent():
    client = TestClient(_app())
    resp = client.get("/whoami")
    header_id = resp.headers.get("X-Request-ID")
    assert header_id, "response must carry an X-Request-ID header"
    # Handler saw the same id the response advertised.
    assert resp.json()["request_id"] == header_id


def test_middleware_honours_valid_inbound_id():
    client = TestClient(_app())
    resp = client.get("/whoami", headers={"X-Request-ID": "client-supplied-1234"})
    assert resp.headers["X-Request-ID"] == "client-supplied-1234"
    assert resp.json()["request_id"] == "client-supplied-1234"


def test_middleware_rejects_malformed_inbound_id():
    client = TestClient(_app())
    # Contains characters outside the safe charset -> discarded, id regenerated.
    resp = client.get("/whoami", headers={"X-Request-ID": "bad id\nwith injection"})
    assert resp.headers["X-Request-ID"] != "bad id\nwith injection"
    assert len(resp.headers["X-Request-ID"]) == 32  # uuid4().hex


def test_correlation_id_does_not_leak_between_requests():
    client = TestClient(_app())
    first = client.get("/whoami").json()["request_id"]
    second = client.get("/whoami").json()["request_id"]
    assert first != second
    # And the context is cleared once the request is done.
    assert get_request_id() is None


# --- configure_logging ----------------------------------------------------

def test_configure_logging_installs_filter_and_quiets_noisy_libs():
    configure_logging(service="test")
    root = logging.getLogger()
    assert root.handlers, "root logger should have handlers"
    assert any(
        isinstance(f, RequestIdFilter)
        for h in root.handlers
        for f in h.filters
    )
    assert logging.getLogger("httpx").level == logging.WARNING
