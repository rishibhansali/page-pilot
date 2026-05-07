# Application configuration loaded from environment variables.
# Uses pydantic-settings so all values are validated at startup rather than at first use.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central config object. Values are read from environment variables or a .env file.
    All required secrets will raise a ValidationError on startup if missing.
    """

    # Anthropic
    ANTHROPIC_API_KEY: str

    # Claude model — always reference this constant, never hardcode the model string.
    CLAUDE_MODEL: str = "claude-sonnet-4-20250514"

    # Supabase (schema only for now — connection not wired up yet)
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # CORS — comma-separated list of allowed origins.
    # Includes chrome-extension://* for the production extension and localhost for dev.
    ALLOWED_ORIGINS: list[str] = [
        "chrome-extension://*",
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()  # type: ignore[call-arg]
