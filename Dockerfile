# syntax=docker/dockerfile:1

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- builder: generate the ERP Prisma client + Next.js build ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Factory price charts (JSON) — read and replaced at runtime by upload; mount
# a volume here (docker-compose.yml) so uploads and backups survive rebuilds.
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
# Ask MIS settings (encrypted Claude API key, usage log) — its own volume;
# created here so the volume is writable by the app user.
RUN mkdir -p ./data/settings && chown nextjs:nodejs ./data/settings

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown nextjs:nodejs ./entrypoint.sh

USER nextjs
EXPOSE 3000

# entrypoint.sh runs no migrations — the ERP is never changed by MIS.
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
