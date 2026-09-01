# shogi-games

将棋バリアント対戦サイト。標準ルールに加え、駒落ち・取る一手将棋・自由配置・特殊盤面(5x5/7x7)・獅子王・将棋vs囲碁など様々なルールを選んで対戦できる。CPU戦・プライベートマッチ・カジュアルマッチ・ランダムルールマッチングに対応し、内蔵AI(段階的に強化中)や外部USIエンジン(やねうら王、標準ルール限定)とも対局できる。

詳細な設計・実装の経緯は [docs/進捗.md](docs/進捗.md)、AI強化の計画は [docs/AI_ROADMAP.md](docs/AI_ROADMAP.md)、本番デプロイ手順は [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照。

## 構成

npm workspacesによるモノレポ。

| パッケージ | 内容 |
|---|---|
| `packages/rule-engine` | 純粋TypeScriptの将棋ルールエンジン(盤面表現・合法手生成・詰み判定等)。バリアントルールは`RuleSet`のパラメータで表現する |
| `packages/db` | Prismaスキーマ・マイグレーション |
| `apps/server` | Express + Socket.io。対局進行・マッチング・AI・認証・レーティング等のバックエンド |
| `apps/web` | Next.js (App Router)。ロビー・対局画面・詰将棋・振り返り等のフロントエンド |

技術スタック: Node.js / TypeScript / Express / Socket.io / Next.js / MySQL / Prisma / Redis。

## ローカル開発環境のセットアップ

### 前提ソフトウェア

- Node.js (v24系推奨)
- MySQL 8系
- Redis

```bash
brew install mysql redis   # macOSの場合
brew services start mysql
brew services start redis
```

### 手順

```bash
# 1. 依存関係をインストール(workspaces一括)
npm install

# 2. 環境変数を設定(それぞれ .env.example をコピーして値を調整する)
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
cp packages/db/.env.example packages/db/.env
# デフォルトのままでもローカルのMySQL(root、パスワードなし)・Redis(localhost:6379)を
# 想定した値が入っているので、多くの場合そのまま使える。
# apps/server/.env と packages/db/.env の両方に DATABASE_URL が必要な点に注意
# (prisma clientは実行時プロセス側の環境変数を見るため)。

# 3. MySQLにデータベースを作成
mysql -u root -e "CREATE DATABASE shogi_games_dev CHARACTER SET utf8mb4;"

# 4. Prisma Clientの生成 + マイグレーション適用
npm run prisma:generate
npm run prisma:migrate   # 開発用(migrate dev)。本番ではprisma:migrate:deployを使う
```

## サーバーの起動

開発時は `apps/server`(API/Socket.io, ポート4000)と `apps/web`(Next.js, ポート3000)を別々のターミナルで起動する。

```bash
# ターミナル1: バックエンド
npm run dev:server

# ターミナル2: フロントエンド
npm run dev:web
```

起動後、`http://localhost:3000` にアクセスするとロビー画面が開く。`http://localhost:4000/health` で `{"ok":true}` が返ればバックエンドは正常。

### AI自己対局デーモン(任意)

バックグラウンドで低負荷にAI同士を自己対局させ続け、学習データを蓄積するデーモン。動かさなくてもアプリ自体は問題なく動く。

```bash
npm run self-play:daemon -w apps/server
```

### その他の便利コマンド(すべて `apps/server` 内で実行)

```bash
npm run tune:weights -w apps/server      # 自己対局データからAIの評価関数の重みをチューニング
npm run puzzles:generate -w apps/server  # 自己対局データから詰将棋を自動生成
```

### 全体ビルド(本番相当の確認)

```bash
npm run build
```

## 本番デプロイ

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照(Nginx + PM2 + MySQL + Redis構成。Docker構成も補助的に用意)。
