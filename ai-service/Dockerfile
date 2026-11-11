FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY app ./app
COPY config ./config
EXPOSE 8000
# One worker only: tracker state lives in process memory.
CMD ["sh", "-c", "exec uvicorn app.main:app --host ${AI_HOST:-0.0.0.0} --port ${AI_PORT:-8000} --workers 1"]
