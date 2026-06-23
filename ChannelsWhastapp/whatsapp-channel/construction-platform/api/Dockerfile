# Construction platform API
FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching. Use the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY src ./src
COPY migrations ./migrations
COPY public ./public

ENV PORT=4000 HOST=0.0.0.0
EXPOSE 4000

# Run migrations, then start the server. Postgres readiness is guaranteed by
# docker-compose's depends_on healthcheck.
CMD ["sh", "-c", "node migrations/run.js && node src/server.js"]
