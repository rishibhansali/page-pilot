# NOTE: Currently using Ollama (local) for development.
# Switch to Anthropic Claude before final demo.
# To switch: replace this file with the Claude implementation.
# The function signature and return format stay identical.
import json
import re
import ollama
import config

_SYSTEM_PROMPT = """You are Page Pilot, a browser navigation agent. You navigate web pages \
to help users reach their destination.

You will receive:
- The user's navigation goal
- The current page URL
- A list of interactive elements on the page

RESPOND WITH ONLY A SINGLE JSON OBJECT. No text before or after.
No markdown. No explanation. Just the JSON.

Choose ONE of these four response formats:

1. To click an element:
{"action":"click","selector":"<exact selector from list>","explanation":"<what you are clicking>","message":null}

2. To scroll down to find goal-relevant content not yet visible:
{"action":"scroll","selector":null,"explanation":"<why scrolling>","message":null}

3. If you cannot find any path to the goal:
{"action":"respond","selector":null,"explanation":"<what you tried>","message":"<helpful message for user>"}

4. For greetings, questions, or non-navigation messages:
{"action":"chat","selector":null,"explanation":"chat","message":"<friendly response>"}

STRICT RULES:
1. The selector MUST be copied EXACTLY from the element list below.
   Copy it character for character. Never construct your own selector.

2. NEVER click a link that points to the same page you are already on.
   Check the current URL before clicking any navigation link.

3. If the current URL already matches the goal destination, respond with
   {"action":"done","selector":null,"explanation":"Already on the goal page","message":null}
   IMMEDIATELY. Do not click anything else.

4. If the goal asks for specific content on a page (prices, a section, a form),
   use scroll to find that content rather than clicking navigation links.

5. NEVER scroll if there is already a clickable element related to
   the goal visible in the list. Only scroll if nothing relevant is visible.

6. If the message is a greeting like "hi", "hello", "thanks", or
   a question about what you can do, use the "chat" action.

7. If you cannot find the destination after scrolling, use "respond"
   to tell the user where to look manually.

8. Always pick the element whose label most directly matches the
   goal. Prefer nav links over footer links.

CRITICAL: Your response must start with { and end with }.
Nothing else.

Example of correct response:
{"action":"click","selector":"/premium","explanation":"Clicking Premium link in navigation","message":null}"""

_FALLBACK = {
    "action": "respond",
    "selector": None,
    "explanation": "Failed to parse model response",
    "message": "Something went wrong, please try again",
}

# Maximum skeleton lines sent to the model. llama3.2 produces malformed JSON
# when the context is too large; viewport elements are already sorted first by
# the extractor so the most actionable elements are always in the first N lines.
_MAX_SKELETON_LINES = 40


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
) -> dict:
    """
    Calls Ollama with the current goal, page skeleton, and conversation history.
    Returns a dict matching NavigateResponse fields.
    Uses a proper system message (Ollama supports the system role natively).
    """
    # Trim to the most important elements so llama3.2 doesn't lose the JSON
    # format under a long context. Viewport elements are sorted first by the
    # extractor so the top 40 lines are the ones the user can actually see.
    lines = dom_skeleton.strip().split("\n")
    trimmed_skeleton = "\n".join(lines[:_MAX_SKELETON_LINES])

    user_content = (
        f"Goal: {user_message}\n"
        f"Current URL: {current_url}\n\n"
        f"Page elements:\n{trimmed_skeleton}\n\n"
        "REMINDER: Copy selectors exactly from the list above. Do not invent selectors."
    )

    messages = (
        [{"role": "system", "content": _SYSTEM_PROMPT}]
        + conversation_history
        + [{"role": "user", "content": user_content}]
    )

    response = ollama.chat(
        model=config.OLLAMA_MODEL,
        messages=messages,
        options={"temperature": 0},
    )

    text = response.message.content.strip()
    return _extract_json(text)
