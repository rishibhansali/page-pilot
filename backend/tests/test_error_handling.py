# Tests for error handling in services/claude.py and routes/navigate.py.
# All external I/O (Anthropic API, Supabase) is mocked — no real network calls.

import sys
import os
import types
from unittest.mock import MagicMock, patch

import pytest
import httpx

# ---------------------------------------------------------------------------
# Path setup — add the backend root so imports resolve the same way as the app.
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# ---------------------------------------------------------------------------
# Stub out config before importing anything that reads it, so tests run
# without a .env file and without real credentials.
# ---------------------------------------------------------------------------

config_stub = types.ModuleType("config")
config_stub.ANTHROPIC_API_KEY = "test-key"
config_stub.SUPABASE_URL = ""
config_stub.SUPABASE_KEY = ""
config_stub.OLLAMA_MODEL = "llama3.2"
config_stub.OLLAMA_BASE_URL = "http://localhost:11434"
config_stub.ALLOWED_ORIGINS = ["*"]
sys.modules.setdefault("config", config_stub)

# Stub supabase module before it is imported by the route.
supabase_service_stub = types.ModuleType("services.supabase")
supabase_service_stub.get_messages = MagicMock(return_value=[])
supabase_service_stub.clear_messages = MagicMock()
supabase_service_stub.save_messages = MagicMock()
sys.modules.setdefault("services.supabase", supabase_service_stub)

# Stub the top-level supabase client library so import doesn't fail when
# SUPABASE_URL/KEY are empty.
supabase_lib_stub = types.ModuleType("supabase")
supabase_lib_stub.create_client = MagicMock()
sys.modules.setdefault("supabase", supabase_lib_stub)

import anthropic  # noqa: E402 — after sys.path setup

# ---------------------------------------------------------------------------
# Helpers — reusable httpx objects for constructing Anthropic error instances.
# ---------------------------------------------------------------------------

_DUMMY_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _make_rate_limit_error() -> anthropic.RateLimitError:
    """Creates an anthropic.RateLimitError with the minimum required kwargs."""
    return anthropic.RateLimitError(
        "rate limit exceeded",
        response=httpx.Response(429, request=_DUMMY_REQUEST),
        body={},
    )


def _make_connection_error() -> anthropic.APIConnectionError:
    """Creates an anthropic.APIConnectionError simulating a network failure."""
    return anthropic.APIConnectionError(request=_DUMMY_REQUEST)


def _make_status_error(status_code: int = 500) -> anthropic.APIStatusError:
    """Creates an anthropic.APIStatusError for the given HTTP status code."""
    return anthropic.APIStatusError(
        f"API error {status_code}",
        response=httpx.Response(status_code, request=_DUMMY_REQUEST),
        body={},
    )


# ---------------------------------------------------------------------------
# Tests for services/claude.py — get_navigation_action()
# ---------------------------------------------------------------------------

class TestGetNavigationAction:
    """Verifies that Anthropic API errors are caught and returned as fallback dicts."""

    def _call(self) -> dict:
        """Imports and calls get_navigation_action with minimal dummy inputs."""
        # Import inside the method so the module-level mock for _client is in place.
        from services.claude import get_navigation_action
        return get_navigation_action(
            user_message="go to settings",
            dom_skeleton="[link] Settings /settings",
            conversation_history=[],
            current_url="https://example.com",
        )

    def test_rate_limit_error_returns_fallback(self) -> None:
        """RateLimitError must not propagate; must return a respond action dict."""
        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.side_effect = _make_rate_limit_error()
            result = self._call()

        assert result["action"] == "respond"
        assert result["selector"] is None
        assert "rate-limited" in result["message"].lower() or "rate limit" in result["message"].lower()

    def test_connection_error_returns_fallback(self) -> None:
        """APIConnectionError must not propagate; must return a respond action dict."""
        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.side_effect = _make_connection_error()
            result = self._call()

        assert result["action"] == "respond"
        assert result["selector"] is None
        assert "internet" in result["message"].lower() or "reach" in result["message"].lower()

    def test_api_status_error_returns_fallback_with_code(self) -> None:
        """APIStatusError must not propagate; message must include the HTTP status code."""
        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.side_effect = _make_status_error(503)
            result = self._call()

        assert result["action"] == "respond"
        assert result["selector"] is None
        assert "503" in result["message"]

    def test_api_status_error_502_returns_fallback(self) -> None:
        """Any non-429 APIStatusError should also return a fallback dict."""
        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.side_effect = _make_status_error(502)
            result = self._call()

        assert result["action"] == "respond"
        assert "502" in result["message"]

    def test_successful_response_is_returned(self) -> None:
        """When the API succeeds, the parsed JSON action dict should be returned."""
        fake_response = MagicMock()
        fake_response.content = [MagicMock(text='{"action":"click","selector":"/settings","explanation":"clicking settings","message":null}')]

        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.return_value = fake_response
            result = self._call()

        assert result["action"] == "click"
        assert result["selector"] == "/settings"


# ---------------------------------------------------------------------------
# Tests for routes/navigate.py — /api/navigate endpoint
# ---------------------------------------------------------------------------

class TestNavigateEndpoint:
    """Verifies HTTP-level behaviour of the /navigate route."""

    @pytest.fixture()
    def client(self):
        """Creates a FastAPI TestClient with supabase and claude services mocked."""
        from fastapi.testclient import TestClient

        # Patch supabase helpers so the route doesn't try to open a real connection.
        with (
            patch("services.supabase.get_messages", return_value=[]),
            patch("services.supabase.clear_messages"),
            patch("services.supabase.save_messages"),
            patch("services.supabase_sessions.create_session", return_value=None),
            patch("services.supabase_sessions.get_active_session", return_value=None),
            patch("services.supabase_sessions.add_step"),
            patch("services.supabase_sessions.close_session"),
        ):
            from main import app
            yield TestClient(app)

    def _valid_payload(self) -> dict:
        """Returns a minimal valid request payload for the /api/navigate endpoint."""
        return {
            "tab_id": "tab-1",
            "url": "https://example.com",
            "user_message": "go to settings",
            "dom_skeleton": "[link] Settings /settings",
            "new_conversation": True,
            "step_history": "None",
        }

    def test_valid_request_with_mocked_claude_returns_200(self, client) -> None:
        """A well-formed request that gets a valid Claude action returns 200."""
        fake_response = MagicMock()
        fake_response.content = [MagicMock(text='{"action":"click","selector":"/settings","explanation":"clicking","message":null}')]

        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.return_value = fake_response
            res = client.post("/api/navigate", json=self._valid_payload())

        assert res.status_code == 200
        body = res.json()
        assert body["action"] == "click"

    def test_malformed_action_returns_422(self, client) -> None:
        """When Claude returns an action dict missing required fields, route returns 422."""
        # Return a dict without the required 'explanation' field.
        fake_response = MagicMock()
        fake_response.content = [MagicMock(text='{"action":"click","selector":null}')]

        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.return_value = fake_response
            res = client.post("/api/navigate", json=self._valid_payload())

        assert res.status_code == 422
        assert "detail" in res.json()

    def test_claude_rate_limit_is_handled_gracefully(self, client) -> None:
        """Rate-limit errors are caught inside claude.py and return a 200 respond action."""
        with patch("services.claude._client") as mock_client:
            mock_client.messages.create.side_effect = _make_rate_limit_error()
            res = client.post("/api/navigate", json=self._valid_payload())

        # claude.py converts rate limit to a fallback respond dict, which maps to 200.
        assert res.status_code == 200
        body = res.json()
        assert body["action"] == "respond"

    def test_missing_required_field_returns_422(self, client) -> None:
        """Sending a request body without user_message yields a 422 validation error."""
        payload = self._valid_payload()
        del payload["user_message"]
        res = client.post("/api/navigate", json=payload)
        assert res.status_code == 422
