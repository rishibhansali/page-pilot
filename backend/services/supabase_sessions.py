# Supabase helpers for persisting navigation sessions and per-step action history.
#
# Run this SQL in the Supabase SQL editor before using this service:
#
#   CREATE TABLE navigation_sessions (
#     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#     tab_id      TEXT NOT NULL,
#     goal        TEXT NOT NULL,
#     status      TEXT NOT NULL DEFAULT 'running',
#     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
#   );
#
#   CREATE TABLE navigation_steps (
#     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#     session_id  UUID NOT NULL REFERENCES navigation_sessions(id) ON DELETE CASCADE,
#     step_num    INT NOT NULL,
#     action      TEXT NOT NULL,
#     selector    TEXT,
#     explanation TEXT NOT NULL,
#     url         TEXT NOT NULL,
#     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
#   );

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import config

if TYPE_CHECKING:
    # Only imported for type checking; the actual import is deferred to _get_client()
    # so module load never triggers supabase network setup or import-time side effects.
    from supabase import Client

logger = logging.getLogger(__name__)

_client: "Client | None" = None


def _is_configured() -> bool:
    """Returns True only when both Supabase credentials are present in config."""
    return bool(config.SUPABASE_URL and config.SUPABASE_KEY)


def _get_client() -> "Client":
    """Returns a lazy-initialized Supabase client.

    Imports supabase here (not at module level) so importing supabase_sessions
    never triggers supabase's module-level network setup or causes import errors
    in test environments where supabase credentials aren't configured.

    Raises RuntimeError if credentials are missing — callers should guard
    with _is_configured() before calling this.
    """
    from supabase import create_client, Client as _Client  # noqa: PLC0415
    global _client
    if _client is None:
        if not _is_configured():
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY must be set before calling Supabase."
            )
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
    return _client  # type: ignore[return-value]


def create_session(tab_id: str, goal: str) -> str | None:
    """Inserts a new navigation_sessions row and returns the generated UUID.

    Returns None (and logs a warning) when Supabase is not configured so that
    callers can skip step/close calls gracefully in dev mode.

    Args:
        tab_id: The Chrome tab identifier for this navigation session.
        goal:   The plain-English user goal that triggered the session.

    Returns:
        The session UUID string, or None if Supabase is not configured or
        the insert fails.
    """
    if not _is_configured():
        logger.warning("supabase_sessions: Supabase not configured — skipping create_session.")
        return None
    try:
        client = _get_client()
        result = (
            client.table("navigation_sessions")
            .insert({"tab_id": tab_id, "goal": goal, "status": "running"})
            .execute()
        )
        if result.data:
            return result.data[0]["id"]
        logger.warning("supabase_sessions: create_session returned no data.")
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("supabase_sessions: create_session failed: %s", exc)
        return None


def add_step(session_id: str, step_num: int, action: dict[str, Any], url: str) -> None:
    """Inserts a row into navigation_steps for a single AI action.

    Silently skips (with a warning) when Supabase is not configured or an
    error occurs so the navigation loop is never blocked by persistence failures.

    Args:
        session_id: UUID of the parent navigation_sessions row.
        step_num:   Zero-based index of this step within the session.
        action:     The raw action dict returned by Claude (must contain
                    at least 'action' and 'explanation' keys).
        url:        The page URL at the time this action was taken.
    """
    if not _is_configured():
        logger.warning("supabase_sessions: Supabase not configured — skipping add_step.")
        return
    try:
        client = _get_client()
        client.table("navigation_steps").insert(
            {
                "session_id": session_id,
                "step_num": step_num,
                "action": action.get("action", ""),
                "selector": action.get("selector"),
                "explanation": action.get("explanation", ""),
                "url": url,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("supabase_sessions: add_step failed: %s", exc)


def get_active_session(tab_id: str) -> str | None:
    """Returns the UUID of the most recent 'running' session for this tab.

    Called on every non-new-conversation request so that steps 2-N of a
    multi-step navigation loop are persisted under the same session row
    that was created on step 1.

    Returns None (and logs a warning) when Supabase is not configured or
    no running session exists for the tab.

    Args:
        tab_id: The Chrome tab identifier to look up.
    """
    if not _is_configured():
        return None
    try:
        client = _get_client()
        result = (
            client.table("navigation_sessions")
            .select("id")
            .eq("tab_id", tab_id)
            .eq("status", "running")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("supabase_sessions: get_active_session failed: %s", exc)
        return None


def close_session(session_id: str, status: str) -> None:
    """Updates the status of a navigation_sessions row to 'done' or 'failed'.

    Silently skips (with a warning) when Supabase is not configured or an
    error occurs.

    Args:
        session_id: UUID of the session to close.
        status:     Final status — should be 'done' or 'failed'.
    """
    if not _is_configured():
        logger.warning("supabase_sessions: Supabase not configured — skipping close_session.")
        return
    try:
        client = _get_client()
        client.table("navigation_sessions").update({"status": status}).eq(
            "id", session_id
        ).execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("supabase_sessions: close_session failed: %s", exc)
