# Loads environment variables from .env and exposes them as module-level constants.
import os
from dotenv import load_dotenv

load_dotenv()

# Intentionally not required at startup — validated in services/claude.py before use.
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
OLLAMA_MODEL: str = os.environ.get("OLLAMA_MODEL", "llama3.2")
OLLAMA_BASE_URL: str = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",")]
