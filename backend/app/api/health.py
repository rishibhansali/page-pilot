# Health check router — used by CI, load balancers, and the extension to verify
# the backend is reachable before starting a navigation session.

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    """Response body for GET /health."""
    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Returns 200 OK with a status string.
    No auth required — this endpoint must be publicly reachable for infra checks.
    """
    return HealthResponse(status="ok", version="0.1.0")
