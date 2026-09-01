# 本番デプロイ構成

Highstoの他サービス(rule.highsto.net、tournament.highsto.net等)と同じ構成に合わせている: **Nginx(リバースプロキシ) + PM2(プロセス管理) + MySQL + Redis**、ConoHa VPS 1台での運用を想定。

## 構成図

```
インターネット
  │
  ▼
Nginx (80/443, SSL終端)
  ├─ shogi.highsto.net       → localhost:3100 (Next.js, apps/web)
  └─ shogi-api.highsto.net   → localhost:4000 (Express+Socket.io, apps/server)
                                    │
                                    ├─ MySQL (対局・ユーザー・レーティング等の永続化)
                                    └─ Redis (マッチング待機列・socket.io Redis adapter)

PM2が管理するプロセス:
  - shogi-server            (apps/server, 常駐)
  - shogi-web                (apps/web, 常駐)
  - shogi-self-play-daemon   (自己対局によるAIデータ収集、常駐・低優先度)
```

## 前提ソフトウェア(VPS側に事前インストール)

- Node.js (プロジェクトと同じバージョン系統。`.nvmrc`は用意していないので、開発機と合わせてv24系を推奨)
- MySQL 8系
- Redis
- PM2 (`npm i -g pm2`)
- Nginx
- Certbot ( `sudo apt install certbot python3-certbot-nginx` 等 )

## 初回セットアップ手順

```bash
# 1. リポジトリを配置
cd /path/to/apps
git clone <repository-url> shogi-games
cd shogi-games

# 2. 依存関係をインストール(workspaces一括)
npm ci

# 3. 環境変数を設定(それぞれ .env.example をコピーして実際の値を入れる)
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.production
cp packages/db/.env.example packages/db/.env
# エディタで開いて DATABASE_URL, JWT_SECRET, WEB_ORIGIN, NEXT_PUBLIC_SERVER_URL 等を実際の値に変更する

# 4. MySQLにデータベースを作成しておく(ユーザー・権限も含めて事前に用意)
mysql -u root -p -e "CREATE DATABASE shogi_games CHARACTER SET utf8mb4;"

# 5. Prisma Clientの生成 + マイグレーション適用(本番用。migrate devではなくmigrate deployを使う)
npm run prisma:generate
npm run prisma:migrate:deploy

# 6. 各パッケージをビルド
npm run build

# 7. PM2で起動
npm run pm2:start
pm2 save        # サーバー再起動後もPM2が自動復旧できるよう保存
pm2 startup     # OS起動時にPM2自体を自動起動する設定(初回のみ、表示されるコマンドを実行)

# 8. Nginx設定を配置
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/shogi
# ドメイン名を実際のものに書き換えてから↓
sudo ln -s /etc/nginx/sites-available/shogi /etc/nginx/sites-enabled/shogi
sudo nginx -t && sudo systemctl restart nginx

# 9. SSL証明書取得
sudo certbot --nginx -d shogi.highsto.net -d shogi-api.highsto.net
```

## 通常の更新デプロイ手順(2回目以降)

Highstoの他プロジェクトと同じ流れ。

```bash
cd /path/to/apps/shogi-games
git pull
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy   # スキーマ変更があれば適用(無ければ何もしない)
npm run build
pm2 reload ecosystem.config.js --update-env   # ダウンタイムを抑えつつ再起動
pm2 status
```

自己対局デーモンだけ再起動したい場合:
```bash
pm2 restart shogi-self-play-daemon
```

## 環境変数チェックリスト(本番で必ず変更するもの)

| 変数 | 場所 | 備考 |
|---|---|---|
| `JWT_SECRET` | apps/server/.env | 推測不可能な長いランダム文字列に必ず変更(ログイン機能のセキュリティに直結) |
| `DATABASE_URL` | packages/db/.env **と** apps/server/.env の両方 | 本番MySQLの実際の接続情報(rootではなく専用ユーザーを推奨)。prisma clientは実行時プロセス(apps/server)側の環境変数を見るため、packages/db/.envだけでは不十分(2026-09-01: 詰将棋機能追加時にこの抜け漏れに気づいて両方に記載するよう修正) |
| `WEB_ORIGIN` | apps/server/.env | フロントの本番URL(CORS・socket.io許可オリジン) |
| `NEXT_PUBLIC_SERVER_URL` | apps/web/.env.production | APIサーバーの本番URL(ビルド時に埋め込まれるため、値を変えたら再ビルドが必要) |
| `REDIS_URL` | apps/server/.env | 本番Redisの接続先(localhostでない場合は変更) |

## 既知の制約(本番運用前に把握しておくこと)

- **マルチプロセス/水平スケール非対応**: 対局そのものの状態(`ServerGame`)はプロセスローカルのメモリ上にしかない。`ecosystem.config.js`で`instances: 1`にしているのはこのため。複数インスタンスにスケールする場合は対局状態の共有機構を別途実装する必要がある(`docs/進捗.md`の「マルチプロセス対応」の記録を参照)。マッチング待機列自体はRedis化済みなので、その部分だけは複数プロセスでも動く。
- **Socket.ioのレート制限もプロセスローカル**: 同上の理由で、複数インスタンス運用時は迂回されうる。
- **自己対局デーモンの負荷**: `SELF_PLAY_LOAD_THRESHOLD`(既定0.7)でシステム負荷を見ながら自動的に一時停止する設計になっているが、本番のVPSは他のHighstoサービスとリソースを共有する可能性があるため、初回は必ず`pm2 monit`等でCPU使用率を確認しながら様子を見ること。心配であれば`pm2 stop shogi-self-play-daemon`で常時は止めておき、手動で必要な時だけ動かす運用でもよい。
- **Redisの永続化**: マッチング待機列は揮発性データなので消えても実害は小さいが、Redisサーバー自体の永続化設定(RDB/AOF)は運用ポリシーに応じて別途検討すること。

## Docker(補足・任意)

現状のHighstoの運用はDocker非使用(PM2直接運用)のため、上記がメインの手順。ただし「VPS移行を検討中」という状況を踏まえ、将来的な移行の選択肢を残す目的で最小限のDocker構成も用意している(`docker-compose.yml`参照)。ローカルでの動作確認や、将来Dockerベースの環境(例: 他クラウドのコンテナサービス)に移行する際の土台として使える。本番のPM2運用と並行してメンテナンスする前提ではないため、内容が古くなっている可能性がある点に留意。
