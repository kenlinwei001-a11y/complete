# DataCore — node:20-alpine multi-stage; build context is the repo root:
#   docker build -f apps/datacore/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/llm-adapters/package.json packages/llm-adapters/package.json
COPY apps/datacore/package.json apps/datacore/package.json
RUN pnpm install --frozen-lockfile --filter datacore... --filter @platform/contracts... --filter @platform/llm-adapters...
COPY packages/contracts packages/contracts
COPY packages/llm-adapters packages/llm-adapters
COPY apps/datacore apps/datacore
RUN pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build && pnpm --filter datacore build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
EXPOSE 4001
WORKDIR /repo/apps/datacore
CMD ["node", "dist/server.js"]
