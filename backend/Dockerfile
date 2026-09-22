# ---------- Stage 1 : deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

# ---------- Stage 2 : runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/uploads /app/reports \
    && addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('net').connect(3001,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" || exit 1

CMD ["node", "server.js"]
