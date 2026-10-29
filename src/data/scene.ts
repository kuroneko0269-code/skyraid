// 空のシーンの見た目パラメータ（フェーズ1-3で地形・スカイボックスに置き換える予定）
export const SCENE_CONFIG = {
  skyColor: 0x87b8e8,
  groundColor: 0x4a7a3a,
  groundSize: 4000,
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
  maxPixelRatio: 2,
} as const;
