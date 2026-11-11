from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env contract from SRS §14.2."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=())

    ai_host: str = "127.0.0.1"
    ai_port: int = 8000
    ai_internal_token: str
    ai_mode: Literal["real", "simulated", "manual"] = "real"
    model_path: str = "./models/best.pt"
    model_manifest_path: str = "./models/model_manifest.json"
    device: str = "cpu"
    imgsz: int = 640
    predict_conf_floor: float = 0.10
    person_conf: float = 0.35
    violation_conf: float = 0.50
    tracker_config: str = "./config/bytetrack-k3.yaml"
    max_image_bytes: int = 1_048_576
    max_image_pixels: int = 1_000_000

    @field_validator("ai_internal_token")
    @classmethod
    def _not_placeholder(cls, v: str) -> str:
        if not v.strip() or v.startswith("isi-"):
            raise ValueError("AI_INTERNAL_TOKEN must be set (not the .env.example placeholder)")
        return v
