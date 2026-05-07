# Navigation service — the only place that calls Claude.
# Translates a (goal, snapshot, history) tuple into a single PilotAction
# by constructing a prompt and parsing Claude's JSON response.

from __future__ import annotations

import json
import logging

from app.core.claude_client import claude
from app.core.config import settings
from app.models.navigate import (
    DomSnapshot,
    NavigateRequest,
    PilotAction,
    ClickAction,
    TypeAction,
    ScrollAction,
    NavigateAction,
    DoneAction,
    AskAction,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt — defines Claude's role and output contract.
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are Page Pilot, an AI browser navigation agent.

Your job is to help users accomplish goals on websites. You receive:
1. The user's goal (plain English)
2. A JSON snapshot of all interactive elements currently visible on the page
3. A history of actions you've already taken

You must respond with EXACTLY ONE JSON action object — nothing else, no markdown, no explanation.

The valid action types are:
- {"action": "click", "targetId": "<pilot-id>"}
- {"action": "type", "targetId": "<pilot-id>", "text": "<text to type>"}
- {"action": "scroll", "direction": "up"|"down", "px": <pixels>}
- {"action": "navigate", "url": "<full URL>"}
- {"action": "done", "message": "<summary of what you accomplished>"}
- {"action": "ask", "question": "<question for the user>"}

Rules:
- Only reference elements by their pilotId from the snapshot.
- Prefer in-viewport elements over off-screen ones.
- Use "ask" sparingly — only when you genuinely cannot proceed without user input.
- Use "done" when the goal is fully accomplished.
- Never fabricate pilotIds that are not in the snapshot.
- Respond with ONLY the JSON object. No prose, no markdown fences.
"""


def build_user_message(request: NavigateRequest) -> str:
    """
    Constructs the user turn for Claude from the navigate request.
    Keeps the snapshot compact by serialising only necessary fields.
    """
    history_text = (
        "\n".join(json.dumps(h.model_dump()) for h in request.history)
        if request.history
        else "None"
    )

    elements_json = json.dumps(
        [e.model_dump(exclude_none=True) for e in request.snapshot.elements],
        indent=2,
    )

    return f"""Goal: {request.goal}

Current page: {request.snapshot.title} ({request.snapshot.url})

Interactive elements on the page:
{elements_json}

Actions taken so far:
{history_text}

What is the single next action to take?"""


async def get_next_action(request: NavigateRequest) -> PilotAction:
    """
    Calls Claude with the current goal + snapshot and returns the next action.
    This is the core AI call — all Claude interaction is isolated here so it's
    easy to mock in tests and easy to add retry / fallback logic later.
    """
    user_message = build_user_message(request)

    logger.info(
        "Calling Claude | goal=%r | elements=%d | history_len=%d",
        request.goal,
        len(request.snapshot.elements),
        len(request.history),
    )

    response = claude.messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=256,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    logger.debug("Claude raw response: %s", raw)

    return _parse_action(raw)


def _parse_action(raw: str) -> PilotAction:
    """
    Parses Claude's raw JSON string into a typed PilotAction.
    Raises ValueError if the JSON is invalid or the action type is unknown.
    Using a discriminated union here means Pydantic validates the shape fully.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned invalid JSON: {raw!r}") from e

    action_type = data.get("action")
    match action_type:
        case "click":
            return ClickAction(**data)
        case "type":
            return TypeAction(**data)
        case "scroll":
            return ScrollAction(**data)
        case "navigate":
            return NavigateAction(**data)
        case "done":
            return DoneAction(**data)
        case "ask":
            return AskAction(**data)
        case _:
            raise ValueError(f"Unknown action type from Claude: {action_type!r}")
