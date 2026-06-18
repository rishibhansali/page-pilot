# FastAPI app entry point — registers CORS, routers, and the health check.
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from routes import navigate

app = FastAPI(title="Page Pilot API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(navigate.router, prefix="/api", tags=["navigate"])


@app.get("/")
def health_check() -> dict:
    """Returns 200 OK so load balancers and CI can verify the server is up."""
    return {"status": "ok"}
