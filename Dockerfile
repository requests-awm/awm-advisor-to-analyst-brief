# ── 1. Build stage ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Build-time args: ONLY values baked into the Vite client bundle belong here.
# Server-side secrets (SUPABASE_SERVICE_ROLE_KEY, ASANA_ACCESS_TOKEN, SSO
# secrets) are RUNTIME env vars set on Cloud Run — never bake them in.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG VITE_PUBLIC_APP_URL
ARG VITE_OPS_LOGIN_URL

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL
ENV VITE_OPS_LOGIN_URL=$VITE_OPS_LOGIN_URL

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 2. Production stage ───────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy the whole app incl. the freshly built dist/public
COPY --from=builder /app ./

USER node
# Cloud Run sets PORT (default 8080); server.ts reads process.env.PORT.
EXPOSE 8080

# Run the server with tsx (handles ESM/TS + top-level await) and serve the
# static client from dist/public.
CMD ["npx", "tsx", "server.ts"]
