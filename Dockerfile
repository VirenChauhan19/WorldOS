FROM node:24-bookworm-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.12-slim AS app
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt && useradd --create-home --uid 10001 worldos && mkdir /data && chown worldos:worldos /data
COPY backend ./backend
COPY scripts/backup_workspace.py ./scripts/backup_workspace.py
RUN python -c "import cv2, PIL, fastapi; print('Backend runtime imports ready')"
COPY --from=web /build/dist ./dist
ENV WORLDOS_DATA_DIR=/data PYTHONUNBUFFERED=1
USER worldos
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "172.30.0.2", "--no-access-log", "--limit-concurrency", "32"]

# Render defaults to Free with ephemeral /tmp storage. The separate paid
# Blueprint selects a mounted disk. launch_render initializes only the selected
# app subdirectory, then drops to uid/gid 10001 before opening a network socket.
FROM app AS render
USER root
CMD ["python", "-m", "backend.launch_render"]
