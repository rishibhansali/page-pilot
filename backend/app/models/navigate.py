# Pydantic schemas for the /api/navigate endpoint.
# These mirror the TypeScript types in extension/src/types/index.ts.
# If you update one, update the other.

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# DOM Snapshot schemas
# ---------------------------------------------------------------------------

class ElementRect(BaseModel):
    """Bounding rectangle of an interactive element on the page."""
    top: int
    left: int
    width: int
    height: int


class SnapshotElement(BaseModel):
    """A single interactive element extracted by the content script."""
    pilotId: str
    tag: str
    label: str
    inputType: str | None = None
    value: str | None = None
    href: str | None = None
    inViewport: bool
    rect: ElementRect


class DomSnapshot(BaseModel):
    """Full page snapshot sent to the backend on each navigation step."""
    url: str
    title: str
    elements: list[SnapshotElement]
    tokenEstimate: int


# ---------------------------------------------------------------------------
# Action schemas (returned by Claude, relayed to the extension)
# ---------------------------------------------------------------------------

class ClickAction(BaseModel):
    action: Literal["click"]
    targetId: str


class TypeAction(BaseModel):
    action: Literal["type"]
    targetId: str
    text: str


class ScrollAction(BaseModel):
    action: Literal["scroll"]
    direction: Literal["up", "down"]
    px: int


class NavigateAction(BaseModel):
    action: Literal["navigate"]
    url: str


class DoneAction(BaseModel):
    action: Literal["done"]
    message: str


class AskAction(BaseModel):
    action: Literal["ask"]
    question: str


# Discriminated union — Pydantic picks the right model based on the "action" field.
PilotAction = Annotated[
    Union[ClickAction, TypeAction, ScrollAction, NavigateAction, DoneAction, AskAction],
    Field(discriminator="action"),
]


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class NavigateRequest(BaseModel):
    """Request body for POST /api/navigate."""
    goal: str = Field(..., max_length=500)
    snapshot: DomSnapshot
    history: list[PilotAction] = Field(default_factory=list)


class NavigateResponse(BaseModel):
    """Response body from POST /api/navigate."""
    action: PilotAction
