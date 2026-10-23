# syntax=docker/dockerfile:1
# Build:   docker build -t kita-plus .
# Run:     docker run --env-file .env -p 3000:3000 kita-plus
# Migrate: docker build --target tools -t kita-plus-tools . && docker run --env-file .env kita-plus-tools db:migrate

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
# Google Maps settings are baked into the browser code at build time, so they come in as build args.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
COPY . .
RUN npm run build

# The full source tree with dev tools: for migrations, the demo seed and scheduled jobs.
FROM build AS tools
ENTRYPOINT ["npm", "run"]
CMD ["db:migrate"]

# The image that serves traffic: only the traced production files, as a non-root user.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0
RUN addgroup -S kita && adduser -S kita -G kita
COPY --from=build --chown=kita:kita /app/.next/standalone ./
COPY --from=build --chown=kita:kita /app/.next/static ./.next/static
USER kita
# The server listens on $PORT (3000 if unset). EXPOSE only documents the default.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/v1/health" || exit 1
CMD ["node", "server.js"]
