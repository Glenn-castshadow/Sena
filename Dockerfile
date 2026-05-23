# ---- Build stage: compile native modules ----
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 requires these to compile from source on Alpine
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# ---- Production stage ----
FROM node:20-alpine
WORKDIR /app

# Copy compiled node_modules from builder (no build tools in final image)
COPY --from=builder /app/node_modules ./node_modules

# Copy app source
COPY . .

# Persistent data directory (mount a volume here)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/jobs.db

EXPOSE 3000
CMD ["node", "server.js"]
