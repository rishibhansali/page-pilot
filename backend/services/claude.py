# NOTE: Currently using Ollama (local) for development.
# Switch to Anthropic Claude before final demo.
# To switch: replace this file with the Claude implementation.
# The function signature and return format stay identical.
import json
import re
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

FIRST: Determine the type of message before deciding what to do.

If the user's message is:
- A greeting ("hi", "hello", "hey", "what's up")
- A question about what you are or what you can do ("what can you do?", "how does this work?", "who are you?")
- A thank you or acknowledgment ("thanks", "ok", "cool", "got it")
- Too vague to be a navigation goal ("um", "test", "asdf", single random words with no clear destination or action)
- General conversation not describing a task on this page

Then respond with:
{"action":"chat","selector":null,"explanation":"conversational message","message":"<a brief, friendly, natural response>"}

Examples:
User: "hi"
Response: {"action":"chat","selector":null,"explanation":"greeting","message":"Hey! Tell me what you'd like to do on this page and I'll navigate there for you."}

User: "what can you do?"
Response: {"action":"chat","selector":null,"explanation":"capability question","message":"I can click around this page for you. Just tell me what you're looking for, like 'go to settings' or 'find pricing page', and I'll navigate there automatically."}

User: "thanks"
Response: {"action":"chat","selector":null,"explanation":"acknowledgment","message":"You're welcome! Let me know if you need anything else."}

ONLY if the message clearly describes a destination, action, or goal on the page (e.g. "go to pricing", "find my orders", "open settings", "change my password") should you use the navigation actions below.

If you can see an element to click that moves toward the goal:
{"action": "click", "selector": "<exact selector from skeleton>", "explanation": "<what you are clicking and why>", "message": null}

If you need to scroll to reveal more content:
{"action": "scroll", "selector": null, "explanation": "<why you are scrolling>", "message": null}

If the goal is already achieved or you have arrived at the right place:
{"action": "done", "selector": null, "explanation": "<what was achieved>", "message": "<friendly message to show the user>"}

If you cannot find a path to the goal after reviewing the skeleton:
{"action": "respond", "selector": null, "explanation": "<what you tried>", "message": "<helpful message telling user where to look manually>"}

---RULES START---
CRITICAL RULES — FOLLOW EXACTLY:

1. SELECTOR RULE — THIS IS THE MOST IMPORTANT RULE:
   You MUST copy the selector EXACTLY as it appears in the skeleton.
   Character for character. No modifications.

   The skeleton lines look like:
   [link] "Pricing" /pricing
   [button] "Sign In" #signin-btn
   [button] "Platform" [data-pagepilot-id='pp-3']

   The selector is the LAST part of each line:
   /pricing
   #signin-btn
   [data-pagepilot-id='pp-3']

   CORRECT example:
   Skeleton has: [link] "Pricing" /pricing
   You return: {"action": "click", "selector": "/pricing", ...}

   WRONG examples — NEVER do these:
   {"selector": "#header-nav a[href*='/pricing']"}  <- INVENTED
   {"selector": ".pricing-link"}                     <- INVENTED
   {"selector": "a[href='/pricing']"}                <- INVENTED

   If you cannot find an exact selector from the skeleton that
   moves toward the goal, return a "respond" action instead.
   NEVER invent a selector that is not in the skeleton.

2. If you already clicked something in a previous step and it did
   not help, do not click it again — try a different element.

3. Prefer elements whose label most closely matches the user's goal.

4. Maximum 10 steps — if conversation history shows 10 or more
   assistant turns, return a "respond" action.

5. If you cannot find a path to the goal, return "respond" with a
   helpful message telling the user where to look manually.
---RULES END---

CRITICAL: Your entire response must be a single JSON object.
Start your response with { and end with }.
Do not write anything before or after the JSON.
Do not use markdown. Do not explain. Just JSON.

Example of correct response:
{"action":"click","selector":"/premium","explanation":"Clicking Premium link","message":null}"""

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
        f"Current page elements:\n{trimmed_skeleton}\n\n"
        "---\n"
        "REMINDER: Your selector MUST be copied exactly from the skeleton above. "
        "Do not construct CSS selectors yourself. "
        "Only use what appears after the label in each skeleton line.\n"
        "---"
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
    return _extract_json(text)
