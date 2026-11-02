# Optimized multi-stage build for API with minimal latency
# Stage 1: Dependencies (cached)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/contracts/package*.json ./apps/contracts/
RUN npm ci --prefer-offline --no-audit --omit=dev

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/contracts/package*.json ./apps/contracts/
RUN npm ci --prefer-offline --no-audit
COPY . .
RUN npm run build --workspace=api
RUN cd apps/api && npx prisma generate

# Stage 3: Runtime (minimal, ~200MB)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Only copy production dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/contracts/node_modules ./apps/contracts/node_modules

# Copy built app and schema
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/package*.json ./apps/api/

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/v1/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
