# Supabase read/write helpers for persisting per-tab conversation history.
#
# Run this SQL in the Supabase SQL editor before using the service:
#
#   CREATE TABLE sessions (
#     tab_id TEXT PRIMARY KEY,
#     url TEXT,
#     messages JSONB DEFAULT '[]'::jsonb,
#     created_at TIMESTAMPTZ DEFAULT NOW(),
#     updated_at TIMESTAMPTZ DEFAULT NOW()
#   );

from supabase import create_client, Client
import config

_client: Client | None = None


def _get_client() -> Client:
    """Returns a lazy-initialized Supabase client (skipped when URL/KEY are empty)."""
    global _client
    if _client is None:
        if not config.SUPABASE_URL or not config.SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY must be set before calling Supabase."
            )
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
    return _client


def _is_configured() -> bool:
    """Returns True only when both Supabase credentials are present."""
    return bool(config.SUPABASE_URL and config.SUPABASE_KEY)


def get_messages(tab_id: str) -> list:
    """
    Fetches the conversation message array for the given tab.
    Returns an empty list if Supabase is not configured or no session exists yet.
    """
    if not _is_configured():
        return []
    try:
        client = _get_client()
        result = client.table("sessions").select("messages").eq("tab_id", tab_id).execute()
        if result.data:
            return result.data[0]["messages"]
        return []
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("supabase.get_messages failed: %s", exc)
        return []


def clear_messages(tab_id: str) -> None:
    """
    Deletes the session row for the given tab, wiping its conversation history.
    Called at the start of each new user goal so old navigation context never
    bleeds into a fresh request.
    """
    if not _is_configured():
        return
    try:
        client = _get_client()
        client.table("sessions").delete().eq("tab_id", tab_id).execute()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("supabase.clear_messages failed: %s", exc)


def save_messages(tab_id: str, url: str, messages: list) -> None:
    """
    Upserts the session row for this tab, writing the full message history.
    Silently skips when Supabase is not configured (dev mode without DB).
    """
    if not _is_configured():
        return
    try:
        client = _get_client()
        client.table("sessions").upsert(
            {
                "tab_id": tab_id,
                "url": url,
                "messages": messages,
                "updated_at": "now()",
            }
        ).execute()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("supabase.save_messages failed: %s", exc)
