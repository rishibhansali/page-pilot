# Pydantic request/response models for the /navigate endpoint.
from __future__ import annotations
from pydantic import BaseModel


class NavigateRequest(BaseModel):
    """Payload the Chrome extension sends on each navigation step."""
    tab_id: str
    url: str
    user_message: str
    dom_skeleton: str


class NavigateResponse(BaseModel):
    """Action returned to the extension after Claude decides the next step."""
    action: str
    selector: str | None = None
    explanation: str
    message: str | None = None
