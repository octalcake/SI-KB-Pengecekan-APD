"""/internal/v1 endpoints called only by Go (SRS §10). Sync handlers run in the threadpool,
so the threading lock in Sessions serialises inference."""
import hashlib
import hmac
from typing import Literal

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile
from pydantic import BaseModel

from app.session_state import SessionError


def require_token(request: Request, x_internal_token: str = Header(default="")):
    expected = request.app.state.settings.ai_internal_token
    if not hmac.compare_digest(x_internal_token.encode(), expected.encode()):
        raise SessionError(403, "FORBIDDEN", "Internal token salah.")


router = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_token)])


class StartBody(BaseModel):
    session_key: str
    mode: Literal["real", "simulated", "manual"]


class StopBody(BaseModel):
    session_key: str


@router.get("/model-info")
def model_info(request: Request) -> dict:
    return request.app.state.detector.info()


@router.post("/sessions/start")
def start(body: StartBody, request: Request) -> dict:
    request.app.state.sessions.start(body.session_key, body.mode)
    return {"session_key": body.session_key, "active": True}


@router.post("/sessions/stop")
def stop(body: StopBody, request: Request) -> dict:
    request.app.state.sessions.stop(body.session_key)
    return {"session_key": body.session_key, "active": False}


@router.post("/infer")
def infer(
    request: Request,
    session_key: str = Form(),
    frame_sequence: int = Form(gt=0),
    captured_at: str = Form(),
    sample_elapsed_ms: int = Form(ge=0),
    sha256: str = Form(),
    frame: UploadFile = File(),
) -> dict:
    s = request.app.state.settings
    data = frame.file.read(s.max_image_bytes + 1)

    def decode():
        if len(data) > s.max_image_bytes:
            raise SessionError(422, "IMAGE_TOO_LARGE", "Frame melebihi MAX_IMAGE_BYTES.")
        if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), sha256.lower()):
            raise SessionError(422, "SHA256_MISMATCH", "sha256 tidak cocok dengan frame.")
        if data[:3] != b"\xff\xd8\xff":
            raise SessionError(422, "INVALID_IMAGE", "Frame harus JPEG.")
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise SessionError(422, "INVALID_IMAGE", "JPEG rusak.")
        if img.shape[0] * img.shape[1] > s.max_image_pixels:
            raise SessionError(422, "IMAGE_TOO_LARGE", "Resolusi melebihi MAX_IMAGE_PIXELS.")
        return img

    result = request.app.state.sessions.infer(session_key, frame_sequence, sha256.lower(), decode)
    return {**result, "engine_instance_id": request.app.state.engine_instance_id}
