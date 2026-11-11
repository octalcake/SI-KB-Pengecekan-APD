import uuid

from fastapi import FastAPI

from app.config import Settings

settings = Settings()
# Changes on every process start so Go can detect a restarted tracker (SRS §10).
ENGINE_INSTANCE_ID = str(uuid.uuid4())

app = FastAPI(title="K3 AI service")


@app.get("/internal/health")
def health() -> dict:
    return {"status": "ok", "engine_instance_id": ENGINE_INSTANCE_ID}
