FROM node:20-alpine AS deps
WORKDIR /app
COPY web/package.json web/package.json
RUN corepack enable && pnpm install --dir web --frozen-lockfile=false

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web ./web
RUN corepack enable && pnpm --dir web build

FROM node:20-alpine AS runner
WORKDIR /app/web
ENV NODE_ENV=production
COPY --from=builder /app/web ./
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
