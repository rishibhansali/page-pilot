# POST /navigate — receives a page snapshot from the extension and returns the next action.
import json
import logging

from fastapi import APIRouter, HTTPException

from models import NavigateRequest, NavigateResponse
from services import claude, supabase, supabase_sessions

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/navigate", response_model=NavigateResponse)
def navigate(request: NavigateRequest) -> NavigateResponse:
    """
    Core navigation loop endpoint.

    Loads per-tab conversation history, asks Claude for the next action,
    persists the updated history, then returns the action to the extension.

    On new conversations a session row is created in navigation_sessions;
    on subsequent steps the existing running session is looked up by tab_id.
    Each step is recorded in navigation_steps; the session is closed when
    Claude signals 'done' or 'respond'.

    claude.get_navigation_action handles Anthropic-specific errors internally and
    always returns a fallback dict, so unexpected exceptions here are true bugs
    (e.g. supabase failures) — surfaced as 503 so the extension shows a clear message.
    """
    # --- Session lifecycle ---
    # On step 1 (new_conversation) create a fresh session row; on steps 2-N
    # retrieve the existing running session so all steps land in the same record.
    if request.new_conversation:
        supabase.clear_messages(request.tab_id)
        session_id: str | None = supabase_sessions.create_session(
            tab_id=request.tab_id,
            goal=request.user_message,
        )
    else:
        session_id = supabase_sessions.get_active_session(request.tab_id)

    history = supabase.get_messages(request.tab_id)

    try:
        action = claude.get_navigation_action(
            user_message=request.user_message,
            dom_skeleton=request.dom_skeleton,
            conversation_history=history,
            current_url=request.url,
            step_history=request.step_history,
        )
    except Exception as exc:
        logger.error("Unexpected error calling claude.get_navigation_action: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"AI service unavailable: {exc}",
        ) from exc

    new_user_content_for_history = (
        f"Goal: {request.user_message}\n"
        f"Current URL: {request.url}"
    )
    updated_history = history + [
        {"role": "user", "content": new_user_content_for_history},
        {"role": "assistant", "content": json.dumps(action)},
    ]

    supabase.save_messages(request.tab_id, request.url, updated_history)

    # --- Persist step and, if terminal, close session ---
    # step_num is derived from updated_history length: each round-trip appends
    # 2 messages, so (len - 2) // 2 gives the 0-based index of this step.
    if session_id is not None:
        step_num = (len(updated_history) - 2) // 2
        supabase_sessions.add_step(
            session_id=session_id,
            step_num=step_num,
            action=action,
            url=request.url,
        )
        action_name = action.get("action", "")
        if action_name in ("done", "respond"):
            supabase_sessions.close_session(session_id, "done")

    try:
        return NavigateResponse(**action)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Malformed action from Claude: {exc}") from exc
