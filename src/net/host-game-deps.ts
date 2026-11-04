// ホストのゲームの部品の型（9-6c で host-game.ts から分けた）: 参加者 1 人分の入れ物と、ホストのゲームが受け取るもの。Three.js 非依存
import type { BuildingField } from '../combat/buildings';
import type { Rng } from '../combat/gun';
import type { PvpFighter } from '../combat/pvp-fighter';
import type { Aircraft, GroundHeightFn } from '../entities/aircraft';
import type { Vec3 } from '../flight/math';
import type { InputBuffer } from './input-buffer';
import type { RemoteSample } from './net-game';

export interface HostRemote {
  readonly id: number;
  readonly fighter: PvpFighter;
  readonly input: InputBuffer;
  readonly sample: RemoteSample;
  /** 再接続した: 入力が届き直したら出現位置へ戻す */
  pendingResume: boolean;
}

export interface HostGameDeps {
  /** 自機（FlightSession の機体。HUD・カメラはこれを見る） */
  readonly own: Aircraft;
  readonly groundHeight?: GroundHeightFn;
  /** 高層の建物（6-4） */
  readonly obstacles?: (a: Readonly<Vec3>, b: Readonly<Vec3>) => boolean;
  readonly rng?: Rng;
  /** 開始前のカウントダウンの秒数（省略は PVP_CONFIG.countdownSeconds。テストで 0 にする） */
  readonly countdownSeconds?: number;
  /** 協力レイドのブリーフィングの秒数（6-6。省略は RAID_RULES.briefingSeconds。PvP は 0） */
  readonly briefingSeconds?: number;
  /** 街の建物（6-6。レイドはホストだけが壊し、壊れた番号を配る） */
  readonly buildings?: BuildingField | null;
  /** 9-6c: ネフィルガが避ける高さ（地表と建物の屋根。省略は groundHeight） */
  readonly kaijuGround?: (x: number, z: number) => number;
}
