// シーンのカメラ・光源のパラメータ。空・海・島の見た目は src/data/terrain.ts（1-3）
export const SCENE_CONFIG = {
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

// 敵機（2-3）の見た目。形はプレースホルダー機体と同じで、色だけ変える（src/render/enemy-view.ts）
export const ENEMY_VIEW_CONFIG = {
  /** 胴体の色（機首・垂直尾翼はこの 45% の明るさ） */
  color: 0xc8322a,
  /** 被弾で白く光るときの白の混ぜ具合 */
  hitFlash: 0.75,
} as const;
