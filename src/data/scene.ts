// 空のシーンの見た目パラメータ（フェーズ1-3で地形・スカイボックスに置き換える予定）
export const SCENE_CONFIG = {
  skyColor: 0x87b8e8,
  groundColor: 0x4a7a3a,
  // 地面とグリッドは機体に追従して動かし、無限に続いて見えるようにする（1-1）
  groundSize: 20000,
  // 霧の範囲と camera.far は品質設定の描画距離で上書きされる（src/data/quality.ts）
  fogNear: 500,
  fogFar: 3500,
  camera: {
    fov: 60,
    near: 0.5,
    far: 5000,
    position: { x: 0, y: 30, z: 80 },
    lookAt: { x: 0, y: 0, z: 0 },
  },
  hemiLight: { skyColor: 0xcfe6ff, groundColor: 0x3a4a2a, intensity: 1.2 },
  sunLight: { color: 0xffffff, intensity: 2.0, position: { x: 300, y: 500, z: 200 } },
} as const;

// 速度感・高度感のための補助表示（1-1）。地形が入る 1-3 で見直す
export const WORLD_HELPERS_CONFIG = {
  grid: {
    /** グリッド線の間隔（m） */
    spacing: 100,
    /** グリッドの一辺（m）。霧の先は見えないので描画距離ほどは要らない */
    size: 8000,
    color: 0xb5d89a,
    /** 地面とのちらつき防止で少し浮かせる（m） */
    height: 0.5,
  },
  boxes: {
    /** 箱の配置を繰り返すタイルの一辺（m）。機体の周りに折り返して常に見えるようにする */
    tileSize: 4000,
    color: 0xd9d2c3,
    /** タイル内の位置（中心）と一辺の長さ（m） */
    items: [
      { x: 0, y: 400, z: -1200, size: 120 },
      { x: 700, y: 900, z: -400, size: 160 },
      { x: -900, y: 250, z: -700, size: 90 },
      { x: -400, y: 1500, z: 600, size: 200 },
      { x: 1100, y: 600, z: 900, size: 120 },
      { x: -1200, y: 1100, z: 1300, size: 150 },
    ],
  },
} as const;

// プレースホルダー機体の寸法（m）。前方は -Z。フェーズ4でモデルに差し替える
export const PLACEHOLDER_AIRCRAFT_CONFIG = {
  bodyColor: 0x9aa4ad,
  accentColor: 0xd04a2a,
  fuselage: { width: 1.6, height: 1.4, length: 9 },
  nose: { radius: 0.8, length: 3.5 },
  wing: { span: 10, chord: 2.8, thickness: 0.15, z: 0.5 },
  tailplane: { span: 4.4, chord: 1.6, thickness: 0.12, z: 3.8 },
  fin: { height: 2.6, chord: 2, thickness: 0.12, z: 3.7 },
} as const;
