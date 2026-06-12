FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false
EXPOSE 8081 8082
CMD ["pnpm","dev"]
