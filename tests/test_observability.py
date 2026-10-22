"""Authentication tests for the session endpoints.

Offline: no Langfuse, Docker, or model key needed.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from server import app as server_app


@pytest.fixture(autouse=True)
def clean_sessions(tmp_path, monkeypatch):
    """Give each test an empty session store and a throwaway history file."""
    monkeypatch.setattr(server_app, "SESSIONS_DB", tmp_path / "sessions.db")
    server_app._SESSIONS.clear()
    yield
    server_app._SESSIONS.clear()


def test_create_session_rejects_role_that_differs_from_database(world):
    with pytest.raises(HTTPException) as err:
        server_app.create_session(server_app.SessionCreate(user_id=1, role="support"))
    assert err.value.status_code == 403
    assert server_app._SESSIONS == {}


def test_token_for_one_session_cannot_authorize_another(world):
    first = server_app.create_session(server_app.SessionCreate(user_id=1, role="shopper"))
    second = server_app.create_session(server_app.SessionCreate(user_id=2, role="shopper"))
    header = f"Bearer {first['token']}"

    assert server_app._authorize(first["session_id"], header).user_id == 1
    with pytest.raises(HTTPException) as err:
        server_app._authorize(second["session_id"], header)
    assert err.value.status_code == 403
