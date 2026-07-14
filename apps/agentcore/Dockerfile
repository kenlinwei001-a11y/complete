# AgentCore — build from repo root context: docker build -f apps/agentcore/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/llm-adapters/package.json packages/llm-adapters/
COPY apps/agentcore/package.json apps/agentcore/
# 不锁 lockfile：workspace 包在 monorepo 中可能未完整锁定，先确保全部安装
RUN pnpm install
COPY packages/contracts packages/contracts
COPY packages/llm-adapters packages/llm-adapters
COPY apps/agentcore apps/agentcore
RUN pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build && pnpm --filter agentcore build
RUN pnpm --filter agentcore --prod deploy /out

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /repo/apps/agentcore/dist /app/dist
COPY --from=build /repo/apps/agentcore/migrations /app/migrations
EXPOSE 4002
CMD ["node", "dist/main.js"]
