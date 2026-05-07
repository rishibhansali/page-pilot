# Singleton Anthropic client used by all service layer code.
# Centralising the client here means API key config is in one place
# and we can swap the client in tests without patching multiple modules.

import anthropic
from app.core.config import settings


def get_claude_client() -> anthropic.Anthropic:
    """
    Returns a configured Anthropic client.
    Called once at startup and reused across requests.
    """
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


# Module-level singleton — instantiated once when the module is first imported.
claude = get_claude_client()
