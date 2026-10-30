import { PerspectiveCamera, Scene } from 'three';
import { SCENE_CONFIG } from '../data/scene';
import type { QualityPreset } from '../data/quality';
import type { Vec3 } from '../flight/math';
import { Atmosphere } from './atmosphere';
import { SceneLights } from './lighting';
import { Ocean } from './ocean';
import { Terrain } from './terrain';

/** 空（大気散乱）・海・島・太陽光をまとめて、カメラ位置と画質設定に合わせて更新する */
export class World {
  readonly atmosphere = new Atmosphere();
  readonly terrain = new Terrain();
  readonly ocean: Ocean;
  readonly lights: SceneLights;

  constructor(scene: Scene, drawDistance: number) {
    this.ocean = new Ocean(this.atmosphere, drawDistance);
    scene.add(this.atmosphere.mesh, this.ocean.mesh, this.terrain.object);
    // 空気遠近（Three.js の霧を大気散乱に読み替えたもの）
    scene.fog = this.atmosphere.fog;
    scene.background = this.atmosphere.horizonColor;
    this.lights = new SceneLights(scene, this.atmosphere);
  }

  applyQuality(preset: QualityPreset): void {
    this.ocean.setDrawDistance(preset.drawDistance);
    this.ocean.setSimple(preset.oceanSimple);
    this.terrain.setQuality(preset.drawDistance, preset.terrainMinLod);
    this.terrain.setDetail(preset.terrainDetail);
    this.lights.setShadows(preset.shadows, preset.shadowMapSize);
    // ブルームがあれば太陽のまぶしさはブルームに任せる
    this.atmosphere.setGlow(!(preset.postEffects && preset.bloom));
  }

  /** 露出（大気の明るさから計算）。RenderPipeline.setExposure に渡す */
  get exposure(): number {
    return this.atmosphere.lighting.exposure;
  }

  /**
   * 描画フレームごとに呼ぶ。time は秒。shadowCenter は影を計算する範囲の中心（機体の位置。
   * タイトル画面ではカメラ）
   */
  update(camera: Readonly<Vec3>, time: number, shadowCenter: Readonly<Vec3> = camera): void {
    this.atmosphere.update(camera);
    this.ocean.update(camera, time);
    this.terrain.update(camera);
    this.lights.follow(shadowCenter);
  }
}

export interface WorldScene {
  scene: Scene;
  camera: PerspectiveCamera;
  world: World;
}

/** 空・海・島と光源のシーンを作る */
export function createWorldScene(aspect: number): WorldScene {
  const cfg = SCENE_CONFIG;
  const scene = new Scene();
  const world = new World(scene, cfg.camera.far);

  const camera = new PerspectiveCamera(cfg.camera.fov, aspect, cfg.camera.near, cfg.camera.far);
  camera.position.set(cfg.camera.position.x, cfg.camera.position.y, cfg.camera.position.z);
  camera.lookAt(cfg.camera.lookAt.x, cfg.camera.lookAt.y, cfg.camera.lookAt.z);

  return { scene, camera, world };
}
