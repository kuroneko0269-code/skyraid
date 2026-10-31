// PvpArena の操作・判定の結果の型と ID の定数（6-6。pvp-arena.ts から分けた。pvp-arena.ts からも再エクスポート）。Three.js 非依存
import type { AircraftControls } from '../entities/aircraft';

/** 1 ステップ分の操作（NetControls と同じ形。飛行 + 戦闘） */
export interface PvpControls extends AircraftControls {
  readonly autoLevel: boolean;
  readonly invertPitch: boolean;
  readonly fire: boolean;
  readonly missile: boolean;
  readonly flare: boolean;
  readonly locked: boolean;
  /** 選んでいる対象の ID（なしは 0〜3 以外） */
  readonly targetId: number;
}

/** 判定の結果（ホストが event で全員に送る）。a・b・n の意味は protocol.ts の EventMsg と同じ */
export interface ArenaEvent {
  kind: 'fire' | 'hit' | 'explode' | 'kill' | 'flare' | 'respawn' | 'stun';
  a: number;
  b: number;
  n: number;
  x: number;
  y: number;
  z: number;
}

/** 撃墜した人・当たった人が「いない」（墜落・地面での起爆） */
export const NOBODY = 255;
/** 怪獣の部位を表す ID（hit の b・入力の targetId。6-2）: KAIJU_ID_BASE + 部位の番号 */
export const KAIJU_ID_BASE = 16;
/** 防衛戦（7-2）の敵を表す ID（hit の b・入力の targetId）: DEFENSE_ID_BASE + 敵の通し番号（戦闘機・爆撃機・巡航ミサイルの順） */
export const DEFENSE_ID_BASE = 32;

/** respawn の b（出現位置の番号）に足す印: 初心者保護つき（protocol.ts の RESPAWN_ROOKIE と同じ） */
export const RESPAWN_BOOST = 0x80;
