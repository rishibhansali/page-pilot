# NOTE: Currently using Ollama (local) for development.
# Switch to Anthropic Claude before final demo.
# To switch: replace this file with the Claude implementation.
# The function signature and return format stay identical.
import json
import ollama
import config

_SYSTEM_PROMPT = """You are Page Pilot, a browser navigation agent. Your job is to help \
users navigate websites by clicking buttons and links on their behalf.

You will receive:
1. The user's navigation goal
2. A skeleton of the current page showing all interactive elements
3. The history of actions you have already taken

You must respond with ONLY a valid JSON object. No explanation, no \
markdown, no code fences. Just raw JSON.

The JSON must have this exact structure:

If you can see an element to click that moves toward the goal:
{"action": "click", "selector": "<exact selector from skeleton>", "explanation": "<what you are clicking and why>"}

If you need to scroll to reveal more content:
{"action": "scroll", "selector": null, "explanation": "<why you are scrolling>"}

If the goal is already achieved or you have arrived at the right place:
{"action": "done", "selector": null, "explanation": "<what was achieved>", "message": "<friendly message to show the user>"}

If you cannot find a path to the goal after reviewing the skeleton:
{"action": "respond", "selector": null, "explanation": "<what you tried>", "message": "<helpful message telling user where to look manually>"}

Rules:
- ONLY use selectors that appear exactly in the skeleton provided
- NEVER invent selectors that are not in the skeleton
- If you already clicked something in a previous step and it did not \
  help, do not click it again — try a different element
- Prefer more specific links/buttons over generic ones
- If you are unsure between two options, pick the one whose label most \
  closely matches the user's goal
- Maximum 10 steps — if conversation history shows 10 or more assistant \
  turns, return a "respond" action telling the user you could not \
  complete the navigation"""

_FALLBACK = {
    "action": "respond",
    "selector": None,
    "explanation": "Failed to parse model response",
    "message": "Something went wrong, please try again",
}


def get_navigation_action(
    user_message: str,
    dom_skeleton: str,
    conversation_history: list,
    current_url: str,
) -> dict:
    """
    Calls Ollama with the current goal, page skeleton, and conversation history.
    Returns a dict matching NavigateResponse fields.
    Uses a proper system message (Ollama supports the system role natively).
    """
    user_content = (
        f"Goal: {user_message}\n"
        f"Current URL: {current_url}\n\n"
        f"Current page elements:\n{dom_skeleton}"
    )

    messages = (
        [{"role": "system", "content": _SYSTEM_PROMPT}]
        + [{"role": "user", "content": user_content}]
        + conversation_history
    )

    response = ollama.chat(
        model=config.OLLAMA_MODEL,
        messages=messages,
        options={"temperature": 0},
    )

    text = response.message.content.strip()
    text = text.removeprefix("```json").removeprefix("```")
    text = text.removesuffix("```").strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return _FALLBACK
