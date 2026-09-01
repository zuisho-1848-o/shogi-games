// PM2用のプロセス定義。本番サーバー(ConoHa VPS等)で `pm2 start ecosystem.config.js` で起動する。
// Highstoの他サービス(rule.highsto.net等)と同じNginx + PM2 + MySQL + Redis構成に合わせている。
//
// 前提:
//   - packages/rule-engine, apps/server, apps/web はそれぞれ `npm run build` 済みであること
//   - packages/db は `npm run migrate:deploy -w packages/db` (prisma migrate deploy) 実行済みであること
//   - 環境変数は apps/server/.env, apps/web/.env.production, packages/db/.env に設定しておくこと
//     (詳細は docs/DEPLOYMENT.md を参照)

module.exports = {
  apps: [
    {
      name: "shogi-server",
      cwd: "./apps/server",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "500M",
      // socket.ioのステート(games Map)はプロセスローカルなので、複数インスタンスに増やす場合は
      // 対局状態の共有(docs/進捗.md参照)を別途実装するまでは instances: 1 のままにすること。
      instances: 1,
    },
    {
      name: "shogi-web",
      cwd: "./apps/web",
      script: "node_modules/.bin/next",
      args: "start -p 3100",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "500M",
      instances: 1,
    },
    {
      name: "shogi-self-play-daemon",
      cwd: "./apps/server",
      script: "dist/scripts/selfPlayDaemon.js",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "300M",
      // 既にniceでの低優先度起動をスクリプト側の意図として持たせているが、
      // PM2経由で起動する場合はOS標準の優先度になるため、必要ならexec_interpreter_args等でniceを付与するか、
      // PM2のcron_restart等と組み合わせて夜間のみ動かす運用も検討する。
      instances: 1,
      autorestart: true,
    },
  ],
};
