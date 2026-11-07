// 9-6a: フリーフライトに足す物（開発中の機能。?dev=<名前> の遅延チャンクだけが付ける）の差し込み口。
// GamePlay に値を持たせず WeakMap に置くので、付けていないときは状態の走査（リプレイのハッシュ・キーフレーム）も
// 挙動も今までと同じ。付けたときは stateRoot を走査の根に足す（src/replay/sim.ts の simRoots）。
// 10-3a: 複数付けられる（ネフィルガと ?dev=albion のアルビオン）。付けた順に呼ぶ。1 つだけなら今までと同じ
import type { MissionDef } from './types';
import type { MissionWorld } from './world';

export interface FreeExtra {
  /** 状態の走査の根（ハッシュ・キーフレームに入れる。関数・描画の物を持たないこと） */
  readonly stateRoot: object;
  /** 9-6c: 動かしているか（false の間は状態の走査に入れない） */
  readonly active: boolean;
  /** 飛行の始めのシード（GamePlay.reseed と同じ値） */
  reseed(seed: number): void;
  /** フリーフライトを始めた（やり直しも） */
  start(): void;
  /** ほかのモード（ミッション・レース・防衛戦・練習場・PvP）を始めた */
  stop(): void;
  /** 固定ステップ 1 回分（自機・敵・ミッションの後。動かしていないときは何もしない） */
  step(dt: number): void;
  /**
   * 9-6b: ミッションを始める（session.startMission の後）。自分のミッション（?dev のレイドの怪獣）なら引き受けて動かし、
   * ランナーが読む世界（怪獣の体力・街への到達）を返す。ほかのミッションは null
   */
  startMission?(def: MissionDef): MissionWorld | null;
}

/** 付けた物を順に呼ぶ（GamePlay が使う形） */
export interface FreeExtraHub {
  reseed(seed: number): void;
  start(): void;
  stop(): void;
  step(dt: number): void;
  /** 引き受けた最初の物の世界（どれも引き受けなければ null。全部に知らせる） */
  startMission(def: MissionDef): MissionWorld | null;
}

const extras = new WeakMap<object, FreeExtra[]>();
const hubs = new WeakMap<object, FreeExtraHub>();

/** play（GamePlay）に付ける（同じ物は 1 回だけ）。null で全部外す */
export function attachFreeExtra(play: object, extra: FreeExtra | null): void {
  if (!extra) {
    extras.delete(play);
    hubs.delete(play);
    return;
  }
  const list = extras.get(play) ?? [];
  if (!list.includes(extra)) list.push(extra);
  extras.set(play, list);
  if (!hubs.has(play)) hubs.set(play, createHub(list));
}

function createHub(list: readonly FreeExtra[]): FreeExtraHub {
  return {
    reseed: (seed) => {
      for (const e of list) e.reseed(seed);
    },
    start: () => {
      for (const e of list) e.start();
    },
    stop: () => {
      for (const e of list) e.stop();
    },
    step: (dt) => {
      for (const e of list) e.step(dt);
    },
    startMission: (def) => {
      let world: MissionWorld | null = null;
      for (const e of list) {
        const w = e.startMission?.(def) ?? null;
        world ??= w;
      }
      return world;
    },
  };
}

/** 付けた物をまとめて呼ぶ口（付けていなければ undefined） */
export function freeExtraOf(play: object): FreeExtraHub | undefined {
  return hubs.get(play);
}

/** 付けた物の一覧（付けた順） */
export function freeExtrasOf(play: object): readonly FreeExtra[] {
  return extras.get(play) ?? [];
}
