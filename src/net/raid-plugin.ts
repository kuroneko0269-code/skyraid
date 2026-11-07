// 10-2: 協力レイドの怪獣ごとの同期の差し込み口。新しい怪獣（10-3〜10-5）は、ヴォルガス（raid-host.ts・codec-kaiju.ts）や
// ネフィルガ（kaiju2-host.ts・codec-kaiju2.ts）のように host-game.ts・protocol.ts へ欄を足さず、ここに 1 つ登録する:
// - ホスト（判定の正）: 固定ステップで進め、state の間隔ごとに小さな状態（bytes）を返し、確実に届けたいできごと（子分の生まれと撃墜・
//   一斉発射の始まりなど）を溜めて返す。HostGame が state の raidExtra と 'kx' のメッセージで配る
// - クライアント（写し）: 届いた state とできごとから写しを作り、表示（遅延チャンク）に渡す
// 通信を重くしない工夫（docs/kaiju-roster.md の「協力の同期」）: 決まった動き（子分の飛び方・弾のまっすぐな飛び）は位置を毎回送らず、
// 生まれた時刻・場所・種だけをできごとで送ってクライアントで同じ計算をする。位置を送る物は数を絞り、怪獣の位置からの相対で
// int16 に詰める（net/raid-kit-codec.ts）。判定（当たり・撃墜・部位の破壊）はホストだけ。Three.js・DOM 非依存
import type { PvpArena } from '../combat/pvp-arena';
import type { CombatTarget } from '../combat/target';
import type { GroundHeightFn } from '../entities/aircraft';
import type { GameSettings, ScoreEntry } from './protocol';

/** ホストの怪獣（1 回の協力レイド） */
export interface RaidPluginHost {
  step(dt: number): void;
  /** 終わり（RAID_OUTCOME の値。none は続く） */
  readonly outcome: number;
  /** 狙っている人（攻撃の対象の HUD。いなければ null） */
  readonly targetId: number | null;
  /** 成績の残り秒（制限時間） */
  readonly remaining: number;
  /** 成績の 1 人分（部位ごとの与ダメージと部位を壊した数） */
  fields(id: number): Pick<ScoreEntry, 'partDamage' | 'breaks'>;
  /** state に載せる中身（state の間隔ごと。小さく。上限 RAID_EXTRA_MAX_BYTES） */
  state(): Uint8Array;
  /** 確実な経路で送るできごと（溜まった分を 1 つにまとめて返し、空にする。無ければ null） */
  takeEvents(): Uint8Array | null;
}

/** クライアントの写し */
export interface RaidPluginMirror {
  /** 新しい state（tick はホストの tick） */
  receiveState(bytes: Uint8Array, tick: number): void;
  /** できごと（届いた順。確実な経路なので順番どおり） */
  receiveEvents(bytes: Uint8Array, tick: number): void;
  step(dt: number): void;
}

export interface RaidPluginHostContext {
  readonly arena: PvpArena;
  readonly players: number;
  readonly settings: Readonly<GameSettings>;
  readonly groundHeight?: GroundHeightFn;
  readonly kaijuGround?: (x: number, z: number) => number;
  /** 種（ホストが決める。写しへは state で配る） */
  readonly seed: number;
}

/**
 * 10-3b: 協力の飛行の表示の口（ui/raid-flight.ts が作って渡す）: ホストは本体、クライアントは写しを怪獣の遅延チャンクの表示
 * （形・HUD）に出し、部位と子分をロックの対象にする
 */
export interface RaidPluginView {
  /** ホストの本体（クライアントは null） */
  readonly host: RaidPluginHost | null;
  /** クライアントの写し（ホストは null） */
  readonly mirror: RaidPluginMirror | null;
  /** 自分が攻撃の対象か（HUD の「TARGET」） */
  targeted(): boolean;
  /** 他の人がロックしている部位（ロックの番号 → 色。自分は入れない） */
  lockMarks(): ReadonlyMap<number, readonly string[]>;
  /** ロックの対象: 部位（入力の targetId は KAIJU_ID_BASE + kaijuIndex）と子分（DEFENSE_ID_BASE + 添字） */
  setLockTargets(parts: readonly LockablePart[], minions: readonly CombatTarget[]): void;
}

/** ロックできる部位（PvpMirror の KaijuLockable と同じ形） */
export interface LockablePart extends CombatTarget {
  readonly kaijuIndex: number;
}

export interface RaidPlugin {
  /** 登録簿（src/data/raid-kaiju.ts）の id */
  readonly kaiju: string;
  createHost(ctx: RaidPluginHostContext): RaidPluginHost;
  createMirror(ground: (x: number, z: number) => number): RaidPluginMirror;
  /** 10-3b: 協力の飛行の表示（null で外す） */
  attachView?(view: RaidPluginView | null): void;
  /** 10-3b: 協力の開始前のブリーフィングの題と文（今の言語。無ければヴォルガスの文） */
  briefing?(): { readonly title: string; readonly lines: readonly string[] };
}

/** state の怪獣ごとの欄の上限（バイト。state 全体を 1 つの送り先に収める） */
export const RAID_EXTRA_MAX_BYTES = 1024;
/** できごとの 1 回のまとまりの上限（バイト） */
export const RAID_EVENT_MAX_BYTES = 4096;

const plugins = new Map<string, RaidPlugin>();

/** 怪獣の遅延チャンク（またはテスト）が登録する */
export function registerRaidPlugin(p: RaidPlugin): void {
  plugins.set(p.kaiju, p);
}

export function findRaidPlugin(kaiju: string): RaidPlugin | null {
  return plugins.get(kaiju) ?? null;
}

/** テスト用: 登録を消す */
export function unregisterRaidPlugin(kaiju: string): void {
  plugins.delete(kaiju);
}
