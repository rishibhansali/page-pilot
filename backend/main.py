# Entry point for the Page Pilot FastAPI backend.
# Starts the app, registers routers, and configures CORS so the extension can reach the API.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, navigate
from app.core.config import settings

app = FastAPI(
    title="Page Pilot API",
    description="Backend service that calls Claude to determine the next navigation action.",
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS — allow requests from Chrome extensions (chrome-extension://*) and
# localhost during development.
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(health.router, tags=["health"])
app.include_router(navigate.router, prefix="/api", tags=["navigate"])
