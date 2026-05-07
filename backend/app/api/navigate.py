# Navigate router — the primary API endpoint consumed by the Chrome extension.
# Accepts a DOM snapshot + goal, returns the next action for the extension to execute.

import logging

from fastapi import APIRouter, HTTPException

from app.models.navigate import NavigateRequest, NavigateResponse
from app.services.navigation import get_next_action

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/navigate", response_model=NavigateResponse)
async def navigate(request: NavigateRequest) -> NavigateResponse:
    """
    Core endpoint for the Page Pilot navigation loop.
    Delegates all AI logic to the navigation service — this handler only
    validates input, calls the service, and maps exceptions to HTTP errors.
    """
    try:
        action = await get_next_action(request)
        return NavigateResponse(action=action)
    except ValueError as e:
        # Raised when Claude returns malformed JSON or an unknown action type.
        logger.error("Navigation service error: %s", e)
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        # Catch-all for unexpected errors (network failures, Anthropic API errors).
        logger.exception("Unexpected error in navigate endpoint")
        raise HTTPException(status_code=500, detail="Internal server error") from e
