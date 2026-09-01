# apps/server用Dockerイメージ。モノレポ構成(npm workspaces)なので、ビルドコンテキストは
# リポジトリのルートを指定すること: `docker build -f apps/server/Dockerfile .`
# (docker-compose.ymlではこの前提で context: . を指定している)

FROM node:24-slim AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/rule-engine/package.json packages/rule-engine/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w packages/rule-engine
RUN npm run generate -w packages/db
RUN npm run build -w apps/server

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/rule-engine ./packages/rule-engine
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/apps/server ./apps/server

WORKDIR /repo/apps/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
