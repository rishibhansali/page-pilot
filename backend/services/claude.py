# Navigation service — calls Anthropic Claude API to decide the next browser action.
# Drop-in replacement for the previous Ollama implementation; all function signatures
# and return shapes are identical so the rest of the backend needs no changes.

import json
import re

import anthropic
import config

_client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

_SYSTEM_PROMPT = """You are Page Pilot, a browser navigation agent. You navigate web pages \
to help users reach their destination.

You will receive:
- The user's navigation goal
- The current page URL
- Steps already taken this session
- A list of interactive elements currently visible on the page

RESPOND WITH ONLY A SINGLE JSON OBJECT. No text before or after.
No markdown. No explanation. Just the JSON.

Choose ONE of these FIVE response formats:

1. To click an element:
{"action":"click","selector":"<exact selector from list>","explanation":"<what you are clicking>","message":null}

2. To scroll down to find goal-relevant content not yet visible:
{"action":"scroll","selector":null,"explanation":"<why scrolling>","message":null}

3. When the goal is fully complete (you are on the right page or scrolled to the target section):
{"action":"done","selector":null,"explanation":"<what was accomplished>","message":"<one sentence summary for user>"}

4. If you cannot find any path to the goal after trying:
{"action":"respond","selector":null,"explanation":"<what you tried>","message":"<helpful message for user>"}

5. For greetings or questions about what you can do:
{"action":"chat","selector":null,"explanation":"chat","message":"<friendly response>"}

STRICT RULES:
1. ONLY use selectors copied EXACTLY character-for-character from the element list.
   NEVER invent or guess a selector. If a selector is not in the list, do not use it.

2. Return "done" as soon as the goal is met. Do not click or scroll further after arriving.

3. NEVER click a link that navigates to the page you are already on.

4. If the goal mentions prices or a pricing section and you see subscription plan
   buttons (e.g. "Individual", "Duo", "Family", "Student", "Try free", "Get Premium",
   "Get started") in the element list, you are already on the pricing page — return
   "done" immediately. Do NOT scroll further.

5. Only scroll if you have already navigated to the right page and the specific
   content (a heading, form, or CTA) is not yet visible in the element list.

CRITICAL: Your response must start with { and end with }. Nothing else.

Examples:
{"action":"click","selector":"/premium","explanation":"Clicking Premium link in navigation","message":null}
{"action":"done","selector":null,"explanation":"Scrolled to the pricing section on the Premium page","message":"Done! The pricing plans are now visible on the page."}"""

_FALLBACK = {
    "action": "respond",
    "selector": None,
    "explanation": "Failed to parse model response",
    "message": "Something went wrong, please try again",
}


def _extract_json(text: str) -> dict:
    """
    Parses a JSON object out of the model's raw response text.

    Tries in order:
      1. Direct parse after stripping markdown fences.
      2. Regex extraction of the first {...} block in case the model
         prefixed or suffixed the JSON with prose.
      3. Returns _FALLBACK if both strategies fail.
    """
    text = text.strip()
    text = text.removeprefix("```json").removeprefix("```")
    text = text.removesuffix("```").strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return _FALLBACK


def get_navigation_action(
    user_message: str,
    dom_skeleton: str,
    conversation_history: list,
    current_url: str,
    step_history: str = "None",
) -> dict:
    """
    Calls Claude with the current goal, page skeleton, in-loop step history, and URL.
    Returns a dict matching NavigateResponse fields.
    conversation_history carries prior turns so Claude remembers what it already tried.
    step_history is built in-memory by the extension's navigation loop as a plain-text
    summary of actions taken, giving Claude a compact recap even across page navigations.

    Catches Anthropic API errors (rate limit, connection, status) and returns a
    user-friendly fallback dict instead of raising — keeps the HTTP layer clean.
    """
    user_content = (
        f"Goal: {user_message}\n"
        f"Current URL: {current_url}\n"
        f"Steps taken so far: {step_history}\n\n"
        f"Page elements:\n{dom_skeleton}\n\n"
        "REMINDER: Copy selectors exactly from the list above. Do not invent selectors."
    )

    # Build the messages array: system is passed separately; history carries prior
    # user/assistant turns so Claude has full context across multi-step navigation.
    messages = conversation_history + [{"role": "user", "content": user_content}]

    try:
        response = _client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=256,
            system=_SYSTEM_PROMPT,
            messages=messages,
        )
    except anthropic.RateLimitError:
        return {
            "action": "respond",
            "selector": None,
            "explanation": "Rate limit hit",
            "message": "The AI is temporarily rate-limited. Please wait a moment and try again.",
        }
    except anthropic.APIConnectionError:
        return {
            "action": "respond",
            "selector": None,
            "explanation": "API connection error",
            "message": "Cannot reach the AI service. Check your internet connection.",
        }
    except anthropic.APIStatusError as e:
        return {
            "action": "respond",
            "selector": None,
            "explanation": f"API status error: {e.status_code}",
            "message": f"AI service error ({e.status_code}). Please try again.",
        }

    text = response.content[0].text.strip()
    return _extract_json(text)
