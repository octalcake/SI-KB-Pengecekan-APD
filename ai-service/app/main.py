import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import router
from app.config import Settings
from app.detector import Detector
from app.session_state import Sessions, SessionError


def create_app(settings: Settings | None = None, detector=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings or Settings()
        # Weights load once per process (SRS §10); tests inject a fake detector.
        app.state.detector = detector or Detector(app.state.settings)
        app.state.sessions = Sessions(app.state.detector)
        yield

    app = FastAPI(title="K3 AI service", lifespan=lifespan)
    # Changes on every process start so Go can detect a restarted tracker (SRS §10).
    app.state.engine_instance_id = str(uuid.uuid4())

    @app.exception_handler(SessionError)
    def session_error(_: Request, e: SessionError):
        return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    def validation_error(_: Request, e: RequestValidationError):
        return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": str(e.errors())[:500]}}, status_code=422)

    @app.get("/internal/health")
    def health() -> dict:
        return {"status": "ok", "engine_instance_id": app.state.engine_instance_id}

    app.include_router(router)
    return app


app = create_app()
