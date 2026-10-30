// シーンのカメラのパラメータ。海・島は src/data/terrain.ts（1-3）、空・光・霧は src/data/sky.ts（4-1）
export const SCENE_CONFIG = {
  // camera.far は品質設定の描画距離で上書きされる（src/data/quality.ts）
  camera: {
    fov: 60,
    near: 0.5,
    far: 5000,
    position: { x: 0, y: 30, z: 80 },
    lookAt: { x: 0, y: 0, z: 0 },
  },
} as const;

// 敵機（2-3）の見た目。形と色は src/data/aircraft-shapes.ts の ENEMY_SHAPE（4-3）（src/render/enemy-view.ts）
export const ENEMY_VIEW_CONFIG = {
  /** 被弾で白く光るときの白の混ぜ具合（機体の色の明るさをこの割合だけ白へ。輸送機も同じ） */
  hitFlash: 0.75,
} as const;
