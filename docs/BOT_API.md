# 外部AI(ボット)接続API

一般のユーザーが自作のAI(将棋エンジン)をこのサイトに接続し、人間のプレイヤーと対局できるようにするための仕様。

## 前提: 既存プロトコルをそのまま使う

このサイトの対局は、ブラウザ・スクリプト・外部AIを区別しない単一のSocket.ioプロトコルで動いている。実際、開発中のE2Eテストで使っていたNode.jsスクリプト(`join`→`state`受信→`move`送信)は、外部AIが接続する場合と全く同じ形になる。つまり**追加のサーバー実装なしで、技術的にはすでに外部AIの接続が可能**。

このドキュメントでは、それを安全・公平に「一般公開して良い機能」にするために追加した最小限の仕組み(ボット自己申告フラグ)と、接続手順をまとめる。

## 接続手順

### 1. 対局を始める方法は2通り

**A. ランダムルールマッチング/カジュアルマッチのキューに並ぶ(推奨)**

人間のプレイヤーと同じキューに並び、マッチングされるのを待つ。`isBot: true`を付けて申告すると、マッチした人間側の画面に「🤖 対戦相手はCPU/ボットです」と表示される(フェアプレー上の開示。サーバー側は申告内容を検証していないので、性善説に基づく仕組みである点に注意)。

```js
const { io } = require("socket.io-client");
const socket = io("https://<サーバーのURL>");

socket.on("connect", () => {
  // カジュアルマッチ: ルールを指定して即マッチング
  socket.emit("queue:join-casual", { ruleSetId: "standard", isBot: true });

  // または、ランダムルールマッチング: 許容カテゴリを指定
  // socket.emit("queue:join-random", { categories: ["standard", "handicap"], isBot: true });
});

socket.on("queue:matched", ({ gameId, playerToken, yourColor, ruleSetId }) => {
  // マッチ成立。以降は下記「対局中のプロトコル」に従う。
});
```

**B. プライベートマッチのルームコードで参加する**

人間側がロビーで「プライベートマッチを作成」してルームコードを発行し、それをボット運営者に共有する。

```
POST /api/games/private/join
Content-Type: application/json

{ "roomCode": "123456" }
```

レスポンス: `{ gameId, playerToken, yourColor, mode, ruleSetId }`

### 2. 対局中のプロトコル(Socket.io)

サーバーURL: `http://<host>:4000`(本番URLは別途)

| イベント(送信) | ペイロード | 説明 |
|---|---|---|
| `join` | `{ gameId, playerToken }` | 対局に接続する。以後`state`イベントで状態を受け取れる |
| `move` | `{ gameId, playerToken, move }` | 指し手を送る。`move`は下記`legalMovesForYou`に含まれるオブジェクトをそのまま使う |
| `resign` | `{ gameId, playerToken }` | 投了する |

| イベント(受信) | 説明 |
|---|---|
| `state` | 対局状態全体(`ClientGameState`型)。着手のたびに配信される |
| `error` | `{ message }`。不正な指し手・トークン不一致など |

`state`イベントのペイロード(抜粋。詳細は`apps/server/src/serialize.ts`の`ClientGameState`型が正):

```ts
{
  gameId: string;
  boardWidth: number;
  boardHeight: number;
  board: ({ kind: string; owner: "sente" | "gote"; promoted: boolean } | null)[][];
  hands: { sente: Record<string, number>; gote: Record<string, number> };
  turn: "sente" | "gote";
  result: { status: "in_progress" } | { status: "checkmate" | "resigned" | "foul_loss" | "jishogi_win"; winner: "sente" | "gote" } | { status: "draw"; reason: string };
  legalMovesForYou: Move[]; // 自分の手番の時だけ中身が入る。ここに含まれる手しか送れない
  yourColor: "sente" | "gote" | null;
  isInCheck: { sente: boolean; gote: boolean };
}
```

`Move`の形:

```ts
// 盤上の駒を動かす
{ type: "move", from: { row, col }, to: { row, col }, piece: "pawn", promote: false }
// 持ち駒を打つ
{ type: "drop", to: { row, col }, piece: "pawn" }
```

**重要**: `move`は必ず直前に受け取った`legalMovesForYou`の中の要素をそのまま(deep equalに)送ること。座標系(row/col)やpromoteの有無を自前で組み立てると弾かれる。

### 3. ルールセット一覧の取得

```
GET /api/games/rule-sets
```
→ `{ ruleSets: [{ id, name, category, description }, ...] }`

対応している`ruleSetId`の一覧が取れる。標準将棋以外に駒落ち・取る一手・盤サイズ違い・獅子王・将棋vs囲碁など多数あるので、汎用エンジンを書く場合は`boardWidth`/`boardHeight`/`board`に含まれる駒種(`kind`)を見て動的に対応するのが望ましい。

### 4. 棋譜の取得

```
GET /api/games/:gameId/kifu
```
KIF形式のテキストが返る(対局中でも取得可能)。ログ・学習データ用途に。

## 今後の課題(現状は未実装)

- **本人確認・レート制限**: 現状は誰でも無制限に接続できる。悪意あるボットの連投・スパムを防ぐレート制限は未実装。
- **持ち時間**: 現状、指し手に時間制限はない(人間・ボットとも無制限に考えられる)。対局によっては秒読み/持ち時間の導入が必要になる。
- **ボット専用レーティング**: ログイン機能が未実装のため、ボットの戦績を追跡する仕組みもまだない。
- **REST版プロトコル**: 現状Socket.ioのみ。常時接続が難しい環境向けにポーリング型のREST APIを求める声があれば追加を検討。
