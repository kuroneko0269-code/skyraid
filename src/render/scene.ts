import { DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { SCENE_CONFIG } from '../data/scene';
import { SKY_CONFIG } from '../data/terrain';
import type { QualityPreset } from '../data/quality';
import type { Vec3 } from '../flight/math';
import { Ocean } from './ocean';
import { Sky } from './sky';
import { Terrain } from './terrain';

// 平行光源の位置 = 太陽の方向 × この距離（向きだけが効く）
const SUN_LIGHT_DISTANCE = 1000;

/** 空・海・島をまとめて、カメラ位置と画質設定に合わせて更新する */
export class World {
  readonly sky = new Sky();
  readonly terrain = new Terrain();
  readonly ocean: Ocean;

  constructor(scene: Scene, drawDistance: number) {
    this.ocean = new Ocean(this.sky.sunDirection, drawDistance);
    scene.add(this.sky.mesh, this.ocean.mesh, this.terrain.object);
  }

  applyQuality(preset: QualityPreset): void {
    this.ocean.setDrawDistance(preset.drawDistance);
    this.ocean.setSimple(preset.oceanSimple);
    this.terrain.setQuality(preset.drawDistance, preset.terrainMinLod);
  }

  /** 描画フレームごとに呼ぶ。time は秒 */
  update(camera: Readonly<Vec3>, time: number): void {
    this.sky.update(camera);
    this.ocean.update(camera, time);
    this.terrain.update(camera);
  }
}

export interface WorldScene {
  scene: Scene;
  camera: PerspectiveCamera;
  world: World;
}

/** 空・海・島と光源のシーンを作る。霧の色は地平線の色に合わせる */
export function createWorldScene(aspect: number): WorldScene {
  const cfg = SCENE_CONFIG;
  const scene = new Scene();
  const world = new World(scene, cfg.camera.far);
  const horizon = world.sky.horizonColor;
  scene.background = horizon;
  scene.fog = new Fog(horizon, cfg.fogNear, cfg.fogFar);

  const hemi = new HemisphereLight(
    cfg.hemiLight.skyColor,
    cfg.hemiLight.groundColor,
    cfg.hemiLight.intensity,
  );
  scene.add(hemi);

  const sun = new DirectionalLight(SKY_CONFIG.sun.color, SKY_CONFIG.sun.lightIntensity);
  const d = world.sky.sunDirection;
  sun.position.set(d.x * SUN_LIGHT_DISTANCE, d.y * SUN_LIGHT_DISTANCE, d.z * SUN_LIGHT_DISTANCE);
  scene.add(sun);

  const camera = new PerspectiveCamera(cfg.camera.fov, aspect, cfg.camera.near, cfg.camera.far);
  camera.position.set(cfg.camera.position.x, cfg.camera.position.y, cfg.camera.position.z);
  camera.lookAt(cfg.camera.lookAt.x, cfg.camera.lookAt.y, cfg.camera.lookAt.z);

  return { scene, camera, world };
}
