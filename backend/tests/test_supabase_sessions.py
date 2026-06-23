# Unit tests for services/supabase_sessions.py — all Supabase I/O is mocked.
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers — build a minimal mock supabase client
# ---------------------------------------------------------------------------

def _make_client(insert_data: list | None = None) -> MagicMock:
    """Builds a mock Supabase client whose table/insert/update/execute chain
    returns predictable data without hitting the network.

    Args:
        insert_data: The list to return as .execute().data for insert calls.

    Returns:
        A MagicMock that satisfies the chained call pattern used in
        supabase_sessions.
    """
    client = MagicMock()
    execute_result = MagicMock()
    execute_result.data = insert_data if insert_data is not None else []

    # Make every chain (.table().insert().execute(), .table().update().eq().execute(), etc.)
    # return the same execute_result so we don't need to configure each path separately.
    chain = MagicMock()
    chain.execute.return_value = execute_result
    chain.insert.return_value = chain
    chain.update.return_value = chain
    chain.eq.return_value = chain

    client.table.return_value = chain
    return client


# ---------------------------------------------------------------------------
# create_session tests
# ---------------------------------------------------------------------------

class TestCreateSession:
    """Tests for supabase_sessions.create_session."""

    def test_returns_uuid_on_success(self) -> None:
        """create_session should return the UUID from the inserted row."""
        fake_uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        mock_client = _make_client(insert_data=[{"id": fake_uuid}])

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            result = supabase_sessions.create_session("tab-1", "find cheap flights")

        assert result == fake_uuid

    def test_returns_none_when_not_configured(self) -> None:
        """create_session should return None and not call Supabase when unconfigured."""
        with patch("services.supabase_sessions._is_configured", return_value=False):
            from services import supabase_sessions
            result = supabase_sessions.create_session("tab-1", "any goal")

        assert result is None

    def test_returns_none_when_insert_returns_no_data(self) -> None:
        """create_session should return None gracefully when the insert yields no rows."""
        mock_client = _make_client(insert_data=[])

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            result = supabase_sessions.create_session("tab-1", "goal")

        assert result is None

    def test_returns_none_on_exception(self) -> None:
        """create_session should swallow exceptions and return None."""
        mock_client = MagicMock()
        mock_client.table.side_effect = RuntimeError("network error")

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            result = supabase_sessions.create_session("tab-1", "goal")

        assert result is None


# ---------------------------------------------------------------------------
# add_step tests
# ---------------------------------------------------------------------------

class TestAddStep:
    """Tests for supabase_sessions.add_step."""

    def test_happy_path_inserts_row(self) -> None:
        """add_step should call table('navigation_steps').insert(...).execute()."""
        mock_client = _make_client()

        action = {
            "action": "click",
            "selector": "#buy-button",
            "explanation": "Click the buy button",
        }

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            supabase_sessions.add_step("session-uuid", 0, action, "https://example.com")

        mock_client.table.assert_called_with("navigation_steps")
        table_chain = mock_client.table.return_value
        table_chain.insert.assert_called_once()
        inserted = table_chain.insert.call_args[0][0]
        assert inserted["session_id"] == "session-uuid"
        assert inserted["step_num"] == 0
        assert inserted["action"] == "click"
        assert inserted["selector"] == "#buy-button"
        assert inserted["explanation"] == "Click the buy button"
        assert inserted["url"] == "https://example.com"

    def test_nullable_selector(self) -> None:
        """add_step should pass None for selector when it is absent from the action."""
        mock_client = _make_client()
        action = {"action": "scroll", "explanation": "Scroll down"}

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            supabase_sessions.add_step("session-uuid", 1, action, "https://example.com")

        inserted = mock_client.table.return_value.insert.call_args[0][0]
        assert inserted["selector"] is None

    def test_skips_when_not_configured(self) -> None:
        """add_step should do nothing when Supabase is not configured."""
        with patch("services.supabase_sessions._is_configured", return_value=False):
            from services import supabase_sessions
            # Should complete without raising
            supabase_sessions.add_step("session-uuid", 0, {"action": "click"}, "https://x.com")

    def test_swallows_exception(self) -> None:
        """add_step should swallow any exception from Supabase without re-raising."""
        mock_client = MagicMock()
        mock_client.table.side_effect = RuntimeError("timeout")

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            # Must not raise
            supabase_sessions.add_step("session-uuid", 0, {}, "https://x.com")


# ---------------------------------------------------------------------------
# close_session tests
# ---------------------------------------------------------------------------

class TestCloseSession:
    """Tests for supabase_sessions.close_session."""

    def test_happy_path_updates_status(self) -> None:
        """close_session should call update({'status': status}).eq('id', ...).execute()."""
        mock_client = _make_client()

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            supabase_sessions.close_session("session-uuid", "done")

        mock_client.table.assert_called_with("navigation_sessions")
        chain = mock_client.table.return_value
        chain.update.assert_called_once_with({"status": "done"})
        chain.eq.assert_called_once_with("id", "session-uuid")
        chain.execute.assert_called()

    def test_failed_status(self) -> None:
        """close_session should accept 'failed' as a valid status."""
        mock_client = _make_client()

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            supabase_sessions.close_session("session-uuid", "failed")

        chain = mock_client.table.return_value
        chain.update.assert_called_once_with({"status": "failed"})

    def test_skips_when_not_configured(self) -> None:
        """close_session should do nothing when Supabase is not configured."""
        with patch("services.supabase_sessions._is_configured", return_value=False):
            from services import supabase_sessions
            supabase_sessions.close_session("session-uuid", "done")

    def test_swallows_exception(self) -> None:
        """close_session should swallow any exception without re-raising."""
        mock_client = MagicMock()
        mock_client.table.side_effect = ConnectionError("lost connection")

        with (
            patch("services.supabase_sessions._is_configured", return_value=True),
            patch("services.supabase_sessions._get_client", return_value=mock_client),
        ):
            from services import supabase_sessions
            supabase_sessions.close_session("session-uuid", "done")
