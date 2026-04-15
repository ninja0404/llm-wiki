FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/shared/python

RUN apt-get update && apt-get install -y --no-install-recommends libreoffice && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/pyproject.toml
COPY shared/python /app/shared/python
COPY services /app/services

RUN pip install --no-cache-dir .

CMD ["uvicorn", "services.converter_service.app.main:app", "--host", "0.0.0.0", "--port", "8090"]
