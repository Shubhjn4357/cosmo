FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WHISPER_SPACE_SAFE_MODE=true \
    PORT=7860 \
    HOST=0.0.0.0

WORKDIR /app

COPY app.py space_safe_server.py ./

EXPOSE 7860

CMD ["python", "app.py"]
