// 9-6a: フリーフライトに足す物（開発中の機能。?dev=<名前> の遅延チャンクだけが付ける）の差し込み口。
// GamePlay に値を持たせず WeakMap に置くので、付けていないときは状態の走査（リプレイのハッシュ・キーフレーム）も
// 挙動も今までと同じ。付けたときは stateRoot を走査の根に足す（src/replay/sim.ts の simRoots）
export interface FreeExtra {
  /** 状態の走査の根（ハッシュ・キーフレームに入れる。関数・描画の物を持たないこと） */
  readonly stateRoot: object;
  /** 飛行の始めのシード（GamePlay.reseed と同じ値） */
  reseed(seed: number): void;
  /** フリーフライトを始めた（やり直しも） */
  start(): void;
  /** ほかのモード（ミッション・レース・防衛戦・練習場・PvP）を始めた */
  stop(): void;
  /** フリーフライトの固定ステップ 1 回分（自機・敵の後） */
  step(dt: number): void;
}

const extras = new WeakMap<object, FreeExtra>();

/** play（GamePlay）に付ける。null で外す */
export function attachFreeExtra(play: object, extra: FreeExtra | null): void {
  if (extra) extras.set(play, extra);
  else extras.delete(play);
}

export function freeExtraOf(play: object): FreeExtra | undefined {
  return extras.get(play);
}
