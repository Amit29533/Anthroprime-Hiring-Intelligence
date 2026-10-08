FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scanner/ocr/server.py scanner/ocr/smoke.py ./
USER 65534:65534
CMD ["python", "-B", "server.py"]
