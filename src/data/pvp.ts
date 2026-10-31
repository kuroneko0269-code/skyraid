// PvP の戦闘（5-3）の数値。仕組みは src/combat/pvp-arena.ts（ホストの判定）と src/net/pvp-mirror.ts（表示）。
// 決定は docs/decisions.md
import { WORLD_CONFIG } from './terrain';

/** 撃墜数の上限の選択肢（ロビーでホストが選ぶ） */
export const PVP_SCORE_LIMITS = [10, 15, 20] as const;
/** 制限時間の選択肢（秒。5 分 / 10 分） */
export const PVP_TIME_LIMITS = [300, 600] as const;

/** 出現位置の数（島を囲む輪の上に等間隔） */
const SPAWN_COUNT = 8;
/** 輪の半径（m）。開始位置（島の沖合 4500m）と同じ距離 */
const SPAWN_RADIUS = Math.hypot(WORLD_CONFIG.start.x, WORLD_CONFIG.start.z);
/** 復帰の高度（m）。機首は島の中心なので、山頂（約 600m）より上にする（開始の 500m だと操作しないと山にぶつかる） */
const SPAWN_ALTITUDE = 800;

export interface PvpSpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 機首の方位（-Z から右回り、度）。島の中心を向く */
  readonly headingDeg: number;
}

/** 復帰の出現位置: 島を囲む輪の 8 か所、高度 800m、機首は島の中心 */
export const PVP_SPAWN_POINTS: readonly PvpSpawnPoint[] = Array.from(
  { length: SPAWN_COUNT },
  (_, i) => {
    const a = (i / SPAWN_COUNT) * Math.PI * 2;
    return {
      x: Math.round(SPAWN_RADIUS * Math.sin(a)),
      y: SPAWN_ALTITUDE,
      z: Math.round(SPAWN_RADIUS * Math.cos(a)),
      headingDeg: (-a * 180) / Math.PI,
    };
  },
);

export const PVP_CONFIG = {
  /** 撃墜（墜落）されてからホストが復帰させるまでの秒数 */
  respawnSeconds: 3,
  /** 復帰後の無敵の秒数（ダメージ 0、半透明で表示） */
  invulnerableSeconds: 3,
  /** 無敵中の機体の不透明度 */
  invulnerableOpacity: 0.4,
  /** 遅延補償で巻き戻せる最大の秒数（各機の位置の履歴の長さ） */
  historySeconds: 0.5,
  /** ホストがミサイルの発射時に円錐条件を見直すときの余裕（度。量子化・補間の差を許す） */
  lockConeToleranceDeg: 2,
  /** 同時に飛ぶミサイルの上限（state に全部入れる） */
  maxMissiles: 16,
  /** ミサイルの位置の量子化（m。int16 で ±16km） */
  missilePositionStep: 0.5,
  /** クライアントの自機が墜落を先に計算したとき、ホストの撃墜の知らせを待つ秒数（来なければ飛行に戻る） */
  crashHoldSeconds: 1,
  /** スコアをホストが配る間隔（秒。残り時間の同期。撃墜のときはすぐ送る） */
  scoreIntervalSeconds: 1,
  feed: {
    /** 撃墜のフィードの最大件数（右上） */
    maxItems: 4,
    /** 1 件を出しておく秒数 */
    seconds: 5,
  },
  /** スコアボードを出す Tab の長押しの秒数 */
  scoreboardHoldSeconds: 0.25,
} as const;
