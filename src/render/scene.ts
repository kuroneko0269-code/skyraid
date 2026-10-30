import { PerspectiveCamera, Scene } from 'three';
import { SCENE_CONFIG } from '../data/scene';
import type { QualityPreset } from '../data/quality';
import type { Vec3 } from '../flight/math';
import { Atmosphere } from './atmosphere';
import { CloudField } from './cloud-field';
import { Clouds } from './clouds';
import { SceneLights } from './lighting';
import { Ocean } from './ocean';
import { Terrain } from './terrain';
import { defaultHeightField } from './terrain-height';
import { Vegetation } from './vegetation';

/** 空（大気散乱）・海・島・雲・太陽光をまとめて、カメラ位置と画質設定に合わせて更新する */
export class World {
  readonly atmosphere = new Atmosphere();
  /** 雲の 3D ノイズと風（雲・地形・海の雲の影で共有） */
  readonly cloudField = new CloudField();
  readonly terrain = new Terrain(undefined, undefined, this.cloudField.uniforms);
  /** 木（4-6）。本数は画質で決まる（applyQuality） */
  readonly vegetation = new Vegetation(defaultHeightField.getHeight);
  readonly ocean: Ocean;
  readonly clouds: Clouds;
  readonly lights: SceneLights;

  constructor(scene: Scene, drawDistance: number) {
    this.ocean = new Ocean(this.atmosphere, drawDistance, this.cloudField);
    this.clouds = new Clouds(this.atmosphere, this.cloudField);
    scene.add(
      this.atmosphere.mesh,
      this.ocean.detailedMesh,
      this.ocean.simpleMesh,
      this.terrain.object,
      this.vegetation.object,
      this.clouds.object,
    );
    // 空気遠近（Three.js の霧を大気散乱に読み替えたもの）
    scene.fog = this.atmosphere.fog;
    scene.background = this.atmosphere.horizonColor;
    this.lights = new SceneLights(scene, this.atmosphere);
  }

  applyQuality(preset: QualityPreset): void {
    this.ocean.applyQuality(preset);
    this.clouds.applyQuality(preset);
    this.terrain.setQuality(preset.drawDistance, preset.terrainMinLod);
    this.terrain.setDetail(preset.terrainDetail);
    this.terrain.setShaderFlags({
      cloudShadow: preset.cloudShadows,
      normalDetail: preset.terrainNormalDetail,
      treeShade: preset.treeShade,
    });
    this.vegetation.setCount(preset.treeCount, preset.treeClumps);
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
    this.clouds.update(camera, time);
    this.terrain.update(camera);
    this.vegetation.update(camera, time);
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
