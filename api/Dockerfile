FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock pnpm-workspace.yaml ./
COPY api/package.json api/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/api/node_modules ./api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN cd packages/shared && bun run build
RUN cd api && bun run build

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/api/drizzle ./api/drizzle
COPY --from=builder /app/api/package.json ./api/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/api/node_modules ./api/node_modules
COPY package.json pnpm-workspace.yaml ./

EXPOSE 3001

CMD ["bun", "api/dist/server.js"]
