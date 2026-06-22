from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import db
from .logging_config import configure_logging
from .routers import api_clients, auth, categories, help, jobs, knowledge, lightrag, search, system, tenants, users


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    if settings.auto_migrate:
        await db.migrate()
    yield
    await db.close()


def create_app() -> FastAPI:
    settings.validate_for_startup()
    configure_logging()
    app = FastAPI(
        title="Integrated KMS Admin",
        description="Admin UI and integrated search gateway for LightRAG",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(tenants.router)
    app.include_router(users.router)
    app.include_router(categories.router)
    app.include_router(api_clients.router)
    app.include_router(knowledge.router)
    app.include_router(lightrag.router)
    app.include_router(jobs.router)
    app.include_router(search.router)
    app.include_router(system.router)
    app.include_router(help.router)

    prototype_assets = Path(__file__).resolve().parents[2] / "user-admin-prototype" / "assets"
    if prototype_assets.exists():
        app.mount(
            "/prototype/assets",
            StaticFiles(directory=prototype_assets),
            name="prototype-assets",
        )
        app.mount(
            "/admin/prototype/assets",
            StaticFiles(directory=prototype_assets),
            name="admin-prototype-assets",
        )

    help_assets = Path(__file__).resolve().parents[2] / "docs" / "help"
    if help_assets.exists():
        app.mount("/help", StaticFiles(directory=help_assets), name="help-assets")

    web_dist = Path(__file__).resolve().parents[2] / "web" / "dist"
    if web_dist.exists():
        app.mount("/admin", StaticFiles(directory=web_dist, html=True), name="admin")

        @app.get("/", include_in_schema=False)
        async def root_redirect():
            return RedirectResponse(url="/admin")

    return app


app = create_app()


def main() -> None:
    uvicorn.run(
        "kms_admin.app:app",
        host=settings.host,
        port=settings.port,
        reload=os.getenv("KMS_ADMIN_RELOAD", "false").lower() == "true",
    )


if __name__ == "__main__":
    main()
