# UltraSquad в облаке. Node + Chromium (для камеры эфира).
FROM node:20-bookworm-slim

# Chromium нужен только для прямой трансляции (камеры). Без него всё остальное работает в текстовом режиме.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV BROWSER_BIN=/usr/bin/chromium

WORKDIR /app
COPY . .
RUN rm -rf data logs .git node_modules

# Удалённый режим: сервер слушает 0.0.0.0 и требует REMOTE_TOKEN (задать в настройках хостинга)
ENV PORT=7777 ALLOW_REMOTE=1
EXPOSE 7777
CMD ["node", "server.js"]
