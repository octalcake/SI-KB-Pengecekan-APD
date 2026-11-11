FROM python:3.12-slim
WORKDIR /app
# opencv-python (pulled by ultralytics) needs these shared libs on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.lock .
# CPU-only torch wheels keep the image far smaller than the default CUDA build.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.lock
COPY app ./app
COPY config ./config
EXPOSE 8000
# One worker only: tracker state lives in process memory.
CMD ["sh", "-c", "exec uvicorn app.main:app --host ${AI_HOST:-0.0.0.0} --port ${AI_PORT:-8000} --workers 1"]
