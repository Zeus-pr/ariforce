# Optimized multi-stage build for minimal latency
# Stage 1: Dependencies (cached layer)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/ui/package*.json ./apps/ui/
COPY apps/contracts/package*.json ./apps/contracts/
RUN npm ci --prefer-offline --no-audit --omit=dev

# Stage 2: Build (only what's needed)
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/ui/package*.json ./apps/ui/
COPY apps/contracts/package*.json ./apps/contracts/
RUN npm ci --prefer-offline --no-audit
COPY . .
RUN npm run build --workspace=web

# Stage 3: Runtime (minimal, ~150MB)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_MODE=real

# Only copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/ui/node_modules ./apps/ui/node_modules
COPY --from=deps /app/apps/contracts/node_modules ./apps/contracts/node_modules

# Copy built app
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=builder /app/apps/web/package*.json ./apps/web/

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

WORKDIR /app/apps/web
CMD ["npm", "start", "--", "--port", "3000"]
