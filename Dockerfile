# VYRA API + browser runtime for Render (Docker).
# Chromium is installed from Debian packages because browser-use 1.0 drives a
# real Chrome/Chromium over CDP; a plain Python service has no browser.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CHROME_PATH=/usr/bin/chromium \
    VYRA_DATA_DIR=/data \
    PORT=10000

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        fonts-liberation \
        fonts-dejavu-core \
        fonts-noto-core \
        fonts-unifont \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/chromium /usr/bin/chromium-browser

WORKDIR /app

COPY upstream/browser-use /app/upstream/browser-use
COPY server /app/server
COPY web /app/web

RUN pip install --upgrade pip \
    && pip install /app/upstream/browser-use \
    && pip install -r /app/server/requirements.txt

# /data is the persistent disk mount on Render. Runs, events, screenshots and
# templates live there, so a redeploy does not erase history.
RUN mkdir -p /data

EXPOSE 10000

CMD ["sh", "-c", "uvicorn vyra.app:app --app-dir /app/server --host 0.0.0.0 --port ${PORT:-10000}"]
