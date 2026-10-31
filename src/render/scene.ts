import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { SCENE_CONFIG } from '../data/scene';
import type { QualityPreset } from '../data/quality';
import type { Vec3 } from '../flight/math';
import { setAircraftEnvironment } from './aircraft-model/material';
import { Atmosphere } from './atmosphere';
import { CloudField } from './cloud-field';
import { Clouds } from './clouds';
import { SceneLights } from './lighting';
import { createSkyEnvironment } from './sky-environment';
import { Ocean } from './ocean';
import { Terrain } from './terrain';
import { defaultHeightField } from './terrain-height';
import { Vegetation } from './vegetation';
import { ISLAND_MAP } from '../data/maps';
import type { LoadedMap } from '../missions/active-map';
import { CityView } from './city/city-view';
import {
  bakeCoastTextures,
  createCoastDistanceTexture,
  createDepthTexture,
} from './coast-textures';
import { treeArea } from './terrain-gen/forest';
import type { Texture } from 'three';

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
  /** 街（6-4。港湾都市だけ） */
  city: CityView | null = null;
  private cityCount = 2000;
  private readonly scene: Scene;
  private mapId = ISLAND_MAP.id;
  private time = 0;

  constructor(scene: Scene, drawDistance: number) {
    this.scene = scene;
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
    this.cityCount = preset.cityBuildings;
    this.city?.setCount(preset.cityBuildings);
    this.lights.setShadows(preset.shadows, preset.shadowMapSize);
    // ブルームがあれば太陽のまぶしさはブルームに任せる
    this.atmosphere.setGlow(!(preset.postEffects && preset.bloom));
  }

  /**
   * マップを切り替える（6-4）: 地形のチャンク・水深と海岸線のテクスチャ・木・街を捨てて作り直す。
   * 同じマップなら何もしない（建物の建て直しは BuildingField の reset で描画が追う）
   */
  setMap(m: LoadedMap): void {
    if (m.def.id === this.mapId && (this.city !== null) === (m.buildings !== null)) return;
    this.mapId = m.def.id;
    const island = m.def.id === ISLAND_MAP.id;
    const size = m.def.terrain.size;
    let depth: Texture;
    let coast: Texture;
    if (island) {
      // 島の格子は起動時に焼いたものを使い回す（テクスチャだけ作る）
      depth = createDepthTexture();
      coast = createCoastDistanceTexture();
    } else {
      const baked = bakeCoastTextures(m.field.getHeight, size, m.def.terrain.seaLevel);
      depth = baked.depth;
      coast = baked.coast;
    }
    const oldCoast = this.terrain.coastTexture;
    this.terrain.setField(m.field, m.def.terrain, coast, m.def.vegetation);
    oldCoast.dispose();
    this.ocean.setDepthTexture(depth, size).dispose();
    this.vegetation.setTerrain(m.field.getHeight, treeArea(m.def.vegetation));
    if (this.city) {
      this.scene.remove(this.city.object);
      this.city.dispose();
      this.city = null;
    }
    if (m.buildings) {
      this.city = new CityView(m.buildings, this.cityCount);
      this.scene.add(this.city.object);
    }
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
    const dt = Math.min(0.1, Math.max(0, time - this.time));
    this.time = time;
    this.city?.update(camera, dt);
    this.lights.follow(shadowCenter);
  }
}

export interface WorldScene {
  scene: Scene;
  camera: PerspectiveCamera;
  world: World;
}

/** 空・海・島と光源のシーンを作る。機体・木の環境マップ（4-10 事前修正・4-9）もここで 1 回だけ焼く */
export function createWorldScene(renderer: WebGLRenderer, aspect: number): WorldScene {
  const cfg = SCENE_CONFIG;
  const scene = new Scene();
  const world = new World(scene, cfg.camera.far);
  // 4-9: 同じ環境マップを木にも付ける（影側が黒くつぶれないように）
  const environment = createSkyEnvironment(renderer, world.atmosphere);
  setAircraftEnvironment(environment);
  world.vegetation.setEnvironment(environment);

  const camera = new PerspectiveCamera(cfg.camera.fov, aspect, cfg.camera.near, cfg.camera.far);
  camera.position.set(cfg.camera.position.x, cfg.camera.position.y, cfg.camera.position.z);
  camera.lookAt(cfg.camera.lookAt.x, cfg.camera.lookAt.y, cfg.camera.lookAt.z);

  return { scene, camera, world };
}
