import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

/**
 * USI(Universal Shogi Interface)プロトコルで外部エンジン(やねうら王など)を子プロセスとして
 * 起動し、標準入出力でやり取りするための薄いラッパー。
 *
 * 別プロセス通信のみで、エンジンのソース/バイナリを本リポジトリに同梱しないため、
 * GPL等のライセンス上の「リンク」に該当しない構成を意図している(協議はdocs/AI_ROADMAP.md参照)。
 * ただし評価関数ファイル(例: 水匠5の評価ファイル)は別途ライセンス確認が必須。未確認の間は
 * 本番/商用での使用を避け、検証目的のローカル利用に限定すること。
 */
export interface UsiEngineOptions {
  /** エンジン実行ファイルへの絶対パス */
  enginePath: string;
  /** USIのsetoptionで渡す追加オプション(例: EvalDir, Threads, USI_Hash) */
  options?: Record<string, string>;
  /** エンジン起動〜readyokまでのタイムアウト(ms) */
  readyTimeoutMs?: number;
}

export class UsiEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private pendingLineHandlers: ((line: string) => boolean)[] = [];
  /** 直近の"info ... score cp/mate ..."行から読み取った評価値(常に手番側から見た値、centipawn換算)。
   * 教師データ生成(ai-training)で「指し手」だけでなく「評価値」も欲しい場合に使う。 */
  private lastScoreCp: number | null = null;

  constructor(private readonly opts: UsiEngineOptions) {}

  /** エンジンを起動し、usi/isready/usinewgameのハンドシェイクを行う。 */
  async start(): Promise<void> {
    const proc = spawn(this.opts.enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => this.onLine(line));
    proc.stderr.on("data", (d) => console.error(`[usiEngine stderr] ${d.toString().trim()}`));
    proc.on("exit", (code) => console.log(`[usiEngine] process exited (code=${code})`));

    await this.waitForLine("usiok", () => this.send("usi"));
    for (const [key, value] of Object.entries(this.opts.options ?? {})) {
      this.send(`setoption name ${key} value ${value}`);
    }
    await this.waitForLine("readyok", () => this.send("isready"), this.opts.readyTimeoutMs ?? 30000);
    this.send("usinewgame");
  }

  /** 局面(SFEN)を渡して思考させ、bestmoveの指し手文字列(例: "7g7f", "P*5e", "resign")を返す。 */
  async goSfen(sfen: string, params: { byoyomiMs?: number; depth?: number } = {}): Promise<string> {
    this.send(`position sfen ${sfen}`);
    const goCmd = params.depth
      ? `go depth ${params.depth}`
      : `go byoyomi ${params.byoyomiMs ?? 2000}`;
    const line = await this.waitForLine("bestmove", () => this.send(goCmd), 60000);
    const parts = line.split(" ");
    return parts[1] ?? "resign";
  }

  /** goSfenと同じだが、指し手と一緒に手番側から見た評価値(centipawn)も返す。
   * 詰みを検出した場合はscoreCpをmate相当の大きな値(±30000)にクランプする。
   * 学習データの教師ラベル生成(ai-training)用。 */
  async evalSfen(sfen: string, params: { byoyomiMs?: number; depth?: number } = {}): Promise<{ move: string; scoreCp: number | null }> {
    this.lastScoreCp = null;
    const move = await this.goSfen(sfen, params);
    return { move, scoreCp: this.lastScoreCp };
  }

  stop(): void {
    if (!this.proc) return;
    this.send("quit");
    this.proc.kill();
    this.rl?.close();
    this.proc = null;
    this.rl = null;
  }

  private send(cmd: string): void {
    this.proc?.stdin.write(cmd + "\n");
  }

  private onLine(line: string): void {
    if (line.startsWith("info ") && line.includes(" score ")) {
      const cpMatch = line.match(/ score cp (-?\d+)/);
      const mateMatch = line.match(/ score mate (-?\d+)/);
      if (cpMatch) {
        this.lastScoreCp = Number(cpMatch[1]);
      } else if (mateMatch) {
        // 詰み: 手数の符号で有利/不利を判定し、centipawnスケールとして十分大きな値にクランプする。
        this.lastScoreCp = Number(mateMatch[1]) >= 0 ? 30000 : -30000;
      }
    }
    for (let i = this.pendingLineHandlers.length - 1; i >= 0; i--) {
      if (this.pendingLineHandlers[i](line)) {
        this.pendingLineHandlers.splice(i, 1);
      }
    }
  }

  /** startsWithが一致する行が来るまで待つ。beforeSendでコマンド送信をトリガーする。 */
  private waitForLine(startsWith: string, beforeSend: () => void, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`usi engine timed out waiting for "${startsWith}"`));
      }, timeoutMs);
      this.pendingLineHandlers.push((line) => {
        if (line.startsWith(startsWith)) {
          clearTimeout(timer);
          resolve(line);
          return true;
        }
        return false;
      });
      beforeSend();
    });
  }
}
