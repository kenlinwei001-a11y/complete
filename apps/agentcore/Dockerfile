# AgentCore — build from repo root context: docker build -f apps/agentcore/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/agentcore/package.json apps/agentcore/
RUN pnpm install --frozen-lockfile --filter agentcore... --filter @platform/contracts...
COPY packages/contracts packages/contracts
COPY apps/agentcore apps/agentcore
RUN pnpm --filter @platform/contracts build && pnpm --filter agentcore build
RUN pnpm --filter agentcore --prod deploy /out

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /repo/apps/agentcore/dist /app/dist
COPY --from=build /repo/apps/agentcore/migrations /app/migrations
EXPOSE 4002
CMD ["node", "dist/main.js"]
