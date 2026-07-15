"""
Tests for gating the interactive API docs behind DEBUG (DEPLOYMENT.md §9.4).

Production must not publicly enumerate the full route surface, so
`docs_kwargs` hands FastAPI None for the docs urls unless debug is on.

The gate is exercised on throwaway FastAPI apps (not src.main, whose lifespan
connects to Postgres) so these stay DB-free.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config import docs_kwargs


# --- docs_kwargs ----------------------------------------------------------

def test_docs_kwargs_disables_every_url_when_debug_off():
    assert docs_kwargs(False) == {
        "docs_url": None,
        "redoc_url": None,
        "openapi_url": None,
    }


def test_docs_kwargs_restores_defaults_when_debug_on():
    assert docs_kwargs(True) == {
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "openapi_url": "/openapi.json",
    }


# --- the gate as FastAPI applies it ---------------------------------------

def test_prod_app_404s_docs_redoc_and_openapi():
    """The schema itself must be unreachable, not just the docs UI."""
    client = TestClient(FastAPI(**docs_kwargs(False)))
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_debug_app_serves_docs_and_openapi():
    client = TestClient(FastAPI(**docs_kwargs(True)))
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_gated_app_still_serves_real_routes():
    """Gating the docs must not affect ordinary routing."""
    app = FastAPI(**docs_kwargs(False))

    @app.get("/health")
    def health():
        return {"status": "healthy"}

    client = TestClient(app)
    assert client.get("/health").status_code == 200
