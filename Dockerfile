# PaperPilot AI server (and web app) as one container.
#   docker build -t paperpilot .
#   docker run -p 3000:3000 --env-file .env.server -v paperpilot-data:/data paperpilot
# Keys and usage live in /data (PAPERPILOT_SERVER_DIR). Create keys with:
#   docker exec -it <container> node scripts/pp-keys.mjs create "name" --daily 200

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 PAPERPILOT_STANDALONE=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 PAPERPILOT_SERVER_DIR=/data
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/scripts/pp-keys.mjs ./scripts/pp-keys.mjs
USER app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
