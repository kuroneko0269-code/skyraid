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
