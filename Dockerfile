# --- Stage 1: build the frontend SPA ---
FROM node:22-alpine AS web

WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The backend serves the SPA at the site root, so the build must use "/".
ENV VITE_BASE_PATH=/
RUN npm run build

# --- Stage 2: FastAPI runtime serving the API and the built SPA ---
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/aura
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

COPY backend/app /srv/aura/backend/app
COPY --from=web /web/dist /srv/aura/dist

RUN useradd --uid 10001 aura \
  && mkdir -p /srv/aura/backend/data \
  && chown -R aura:aura /srv/aura
USER aura

VOLUME /srv/aura/backend/data
EXPOSE 5237

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5237/api/auth/status', timeout=4)" || exit 1

WORKDIR /srv/aura/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5237"]
