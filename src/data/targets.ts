// 射撃練習用の的（2-1）。ロジックは src/entities/target-balloon.ts、描画は src/render/combat-view.ts

export interface TargetSpawnPoint {
  readonly x: number;
  readonly z: number;
  /** 地表（島の上は地形、海の上は海面）からの高さ（m）。出現するときに地形の高さを足す */
  readonly agl: number;
}

export const TARGET_CONFIG = {
  /** 同時に出ている的の数 */
  count: 10,
  maxHp: 120,
  /** 当たり判定の球の半径（m）。見た目（visualRadius）より少し大きくして当てやすくする */
  hitRadius: 8,
  visualRadius: 6,
  /** 上下に揺れる振幅（m）と周期（秒）。最大でも約 8 m/s */
  bob: { amplitude: 8, period: 6 },
  /** 撃墜から再出現までの時間（秒）。再出現は今いない別の地点 */
  respawnSeconds: 10,
  /** 被弾したとき白く光る時間（秒） */
  hitFlashSeconds: 0.08,
  color: 0xe8452c,
  /**
   * 出現候補の地点（島の中心が原点、海岸線は半径約 2.9km、起動位置は (0, 500, 4500) で -Z 向き）。
   * 起動直後に見えるよう南側（+Z）に多めに置く。最初は先頭から count 個を使う
   */
  spawnPoints: [
    { x: 0, z: 2600, agl: 250 },
    { x: -500, z: 2200, agl: 200 },
    { x: 450, z: 1800, agl: 300 },
    { x: -250, z: 1300, agl: 220 },
    { x: 700, z: 900, agl: 260 },
    { x: -900, z: 600, agl: 240 },
    { x: 150, z: 300, agl: 200 },
    { x: 1300, z: -200, agl: 220 },
    { x: -1400, z: -400, agl: 260 },
    { x: 300, z: -1200, agl: 240 },
    { x: -600, z: -1800, agl: 220 },
    { x: 1600, z: 1500, agl: 280 },
    { x: -1700, z: 1600, agl: 260 },
    { x: 2000, z: -1300, agl: 240 },
    { x: -2100, z: -1200, agl: 260 },
    { x: 900, z: 2500, agl: 220 },
  ] satisfies readonly TargetSpawnPoint[],
} as const;

export interface DroneOrbit {
  /** 周回の中心（島の中心が原点）と半径（m） */
  readonly centerX: number;
  readonly centerZ: number;
  readonly radius: number;
  /** 海面からの高度（m）。一定 */
  readonly altitude: number;
  /** 開始時の角度（rad）。x = cx + r cos θ、z = cz + r sin θ。π/2 が南（+Z、起動位置の側） */
  readonly phase: number;
}

// ロック練習用の周回ドローン（2-2）。ロジックは src/entities/target-drone.ts、描画は src/render/drone-view.ts
// AI は 2-3 なので固定の円軌道。上から見て反時計回り（θ が増える向き）
export const DRONE_CONFIG = {
  /** 速さ（m/s） */
  speed: 120,
  maxHp: 100,
  /** 当たり判定の球の半径（m）。見た目は翼幅 9m・長さ 7m */
  hitRadius: 7,
  visualRadius: 4.5,
  /** 撃墜から再出現までの時間（秒）。再出現は同じ軌道の、その時点の位置 */
  respawnSeconds: 15,
  hitFlashSeconds: 0.08,
  color: 0xe8452c,
  /** 島の山（最高 約 600m）より上。起動直後に 1 機が正面（約 2km 先）に見える */
  orbits: [
    { centerX: 0, centerZ: 0, radius: 2400, altitude: 800, phase: Math.PI / 2 },
    { centerX: 0, centerZ: 0, radius: 2000, altitude: 700, phase: Math.PI / 2 + (2 * Math.PI) / 3 },
    { centerX: 0, centerZ: 0, radius: 1700, altitude: 950, phase: Math.PI / 2 + (4 * Math.PI) / 3 },
  ] satisfies readonly DroneOrbit[],
} as const;
