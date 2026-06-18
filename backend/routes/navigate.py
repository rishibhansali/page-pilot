# POST /navigate — receives a page snapshot from the extension and returns the next action.
import json
from fastapi import APIRouter, HTTPException

from models import NavigateRequest, NavigateResponse
from services import claude, supabase

router = APIRouter()


@router.post("/navigate", response_model=NavigateResponse)
def navigate(request: NavigateRequest) -> NavigateResponse:
    """
    Core navigation loop endpoint.
    Loads per-tab conversation history, asks Claude for the next action,
    persists the updated history, then returns the action to the extension.
    """
    history = supabase.get_messages(request.tab_id)

    action = claude.get_navigation_action(
        user_message=request.user_message,
        dom_skeleton=request.dom_skeleton,
        conversation_history=history,
        current_url=request.url,
    )

    new_user_content = (
        f"Goal: {request.user_message}\n"
        f"Current URL: {request.url}\n\n"
        f"Current page elements:\n{request.dom_skeleton}"
    )
    updated_history = history + [
        {"role": "user", "content": new_user_content},
        {"role": "assistant", "content": json.dumps(action)},
    ]

    supabase.save_messages(request.tab_id, request.url, updated_history)

    try:
        return NavigateResponse(**action)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Malformed action from Claude: {exc}") from exc
