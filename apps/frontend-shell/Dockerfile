# frontend-shell — 全域数字化智能决策支撑系统 SPA
# Build from repo root context: docker build -f apps/frontend-shell/Dockerfile .
# 真连模式：VITE_DATACORE_URL / VITE_AGENTCORE_URL 留空 → 同源相对路径，
# 由 gateway (deploy/nginx.conf) 把 /a/v1、/b/v1、/api/v1 反代到两个后端。
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/frontend-shell/package.json apps/frontend-shell/package.json
RUN pnpm install --frozen-lockfile --filter frontend-shell... --filter @platform/contracts...
COPY packages/contracts packages/contracts
COPY apps/frontend-shell apps/frontend-shell
ARG VITE_DATACORE_URL=""
ARG VITE_AGENTCORE_URL=""
ARG VITE_MOCK="0"
ENV VITE_DATACORE_URL=$VITE_DATACORE_URL \
    VITE_AGENTCORE_URL=$VITE_AGENTCORE_URL \
    VITE_MOCK=$VITE_MOCK
RUN pnpm --filter @platform/contracts build && pnpm --filter frontend-shell build

FROM nginx:alpine
COPY apps/frontend-shell/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend-shell/dist /usr/share/nginx/html
EXPOSE 80
