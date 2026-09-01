# apps/web用Dockerイメージ。モノレポ構成なので、ビルドコンテキストはリポジトリのルートを指定すること:
# `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SERVER_URL=https://... .`
# NEXT_PUBLIC_SERVER_URLはNext.jsのビルド時に埋め込まれる値なので、実行時ではなくビルド時に渡す必要がある。

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
ARG NEXT_PUBLIC_SERVER_URL=http://localhost:4000
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL
COPY . .
RUN npm run build -w packages/rule-engine
RUN npm run build -w apps/web

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/rule-engine ./packages/rule-engine
COPY --from=build /repo/apps/web ./apps/web

WORKDIR /repo/apps/web
EXPOSE 3100
CMD ["node_modules/.bin/next", "start", "-p", "3100"]
