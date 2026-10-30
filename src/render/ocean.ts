// 海面（4-2）。画質「中」以上はカメラ中心の同心リングにゲルストナー波 + さざ波の法線ノイズ、
// 水深による色・泡・太陽の照り返し（GGX）・水面下の散乱。「低」は平面 + うねり 1 本の簡易版。
// 見た目だけ波打たせ、衝突判定は「海面 = 高度 0」のまま
import {
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RedFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
  type IUniform,
} from 'three';
import { OCEAN_CONFIG } from '../data/ocean';
import type { QualityPreset } from '../data/quality';
import { SKY_CONFIG } from '../data/sky';
import { TERRAIN_CONFIG } from '../data/terrain';
import { WIND_CONFIG } from '../data/wind';
import type { Vec3 } from '../flight/math';
import type { Atmosphere } from './atmosphere';
import type { CloudField } from './cloud-field';
import { buildGerstnerWaves, maxWaveHeight } from './gerstner';
import { bakeDepthField } from './ocean-depth';
import {
  detailedFragmentShader,
  detailedVertexShader,
  simpleFragmentShader,
  simpleVertexShader,
} from './ocean-glsl';
import { createPlaneGeometry, createRingGeometry } from './ocean-mesh';
import { getHeight } from './terrain-height';

const DEG = Math.PI / 180;

/** 地形の高さを水深の格子に焼いて、浮動小数点のテクスチャ（線形補間）にする */
function createDepthTexture(): DataTexture {
  const res = OCEAN_CONFIG.depthMap.resolution;
  const field = bakeDepthField(getHeight, TERRAIN_CONFIG.size, res, TERRAIN_CONFIG.seaLevel);
  const half = new Uint16Array(field.data.length);
  for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat(field.data[i] ?? 0);
  const texture = new DataTexture(half, res, res, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** さざ波の層の uniform（流れる速度・1 / 大きさ・傾き、消える距離） */
function normalLayerUniforms(): { layers: Vector4[]; fades: Vector2[] } {
  const layers = OCEAN_CONFIG.normalLayers.map((l) => {
    const a = (WIND_CONFIG.direction + l.angle) * DEG;
    return new Vector4(Math.cos(a) * l.speed, Math.sin(a) * l.speed, 1 / l.cell, l.slope);
  });
  const fades = OCEAN_CONFIG.normalLayers.map((l) => new Vector2(l.fade.start, l.fade.end));
  return { layers, fades };
}

export class Ocean {
  /** 画質「中」以上（同心リング） */
  readonly detailedMesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** 画質「低」（平面） */
  readonly simpleMesh: Mesh<BufferGeometry, ShaderMaterial>;
  private simple = false;
  private spacing = 1;
  private drawDistance = 0;

  // 大気から入れる値（太陽を動かしたら書き換える。両方のマテリアルで共有）
  private readonly shared: Record<string, IUniform> = {
    uTime: { value: 0 },
    uSunDirection: { value: new Vector3() },
    uSunE: { value: 0 },
    uSunColor: { value: new Color() },
    uSunIrr: { value: new Color() },
    uSkyIrr: { value: new Color() },
    uReflectivity: { value: OCEAN_CONFIG.reflectivity },
    uDeepColor: { value: new Color(OCEAN_CONFIG.deepColor) },
  };

  constructor(atmosphere: Atmosphere, drawDistance: number, clouds: CloudField) {
    const cfg = OCEAN_CONFIG;
    const waves = buildGerstnerWaves();
    const { layers, fades } = normalLayerUniforms();
    const ripples = { uLayers: { value: layers }, uLayerFade: { value: fades } };
    const depthTex = createDepthTexture();

    const detailed = new ShaderMaterial({
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...this.shared,
        ...ripples,
        ...clouds.uniforms,
        uWaves: { value: waves.map((w) => new Vector4(w.dirX, w.dirZ, w.k, w.amplitude)) },
        uWaveB: { value: waves.map((w) => new Vector2(w.omega, w.steepness / w.k)) },
        uSpacingK: { value: (2 * Math.PI) / cfg.rings.angularSegments },
        uMinSpacing: { value: (2 * Math.PI * cfg.rings.innerRadius) / cfg.rings.angularSegments },
        uDepthTex: { value: depthTex },
        uDepthSize: { value: TERRAIN_CONFIG.size },
        uShoal: { value: new Vector2(cfg.shoal.minDepth, cfg.shoal.fullDepth) },
        uLayerCount: { value: 2 },
        uShallowColor: { value: new Color(cfg.shallowColor) },
        uDepthScale: { value: cfg.depthScale },
        uGlint: {
          value: new Vector3(
            cfg.sunGlint.roughnessNear,
            cfg.sunGlint.roughnessFar,
            cfg.sunGlint.strength,
          ),
        },
        uSss: {
          value: new Vector4(...new Color(cfg.subsurface.color).toArray(), cfg.subsurface.strength),
        },
        uMaxAmp: { value: maxWaveHeight(waves) },
        uFoam: {
          value: new Vector4(
            cfg.foam.width,
            cfg.foam.swing,
            (2 * Math.PI) / cfg.foam.period,
            1 / cfg.foam.cell,
          ),
        },
        uFoamAlbedo: { value: cfg.foam.albedo },
        uFoamMaxDepth: { value: cfg.foam.maxDepth },
        uWind: { value: new Vector2(layers[0]?.x ?? 0, layers[0]?.y ?? 0) },
      },
      vertexShader: detailedVertexShader,
      fragmentShader: detailedFragmentShader,
      fog: true,
    });

    const swell = waves[0];
    const simple = new ShaderMaterial({
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...this.shared,
        ...ripples,
        uSimpleWave: {
          value: new Vector4(swell?.dirX ?? 1, swell?.dirZ ?? 0, swell?.k ?? 0, swell?.amplitude),
        },
        uSimpleOmega: { value: swell?.omega ?? 0 },
        uSunShininess: { value: cfg.simple.sunShininess },
        uSunSpecular: { value: cfg.simple.sunSpecular },
      },
      vertexShader: simpleVertexShader,
      fragmentShader: simpleFragmentShader,
      fog: true,
    });

    this.detailedMesh = new Mesh(createRingGeometry(1, 2, 8), detailed);
    this.simpleMesh = new Mesh(createPlaneGeometry(1, 1), simple);
    for (const mesh of [this.detailedMesh, this.simpleMesh]) {
      mesh.name = 'ocean';
      // カメラの真下に置き直すので、カリングで消えないようにする
      mesh.frustumCulled = false;
    }
    this.setDrawDistance(drawDistance);
    this.setSimple(false);
    this.applyAtmosphere(atmosphere);
    atmosphere.onChange((a) => {
      this.applyAtmosphere(a);
    });
  }

  /** 太陽の向き・空の光を uniform に入れる（太陽を動かしたときも） */
  private applyAtmosphere(atmosphere: Atmosphere): void {
    const d = atmosphere.sun;
    const l = atmosphere.lighting;
    const u = this.shared;
    (u.uSunDirection?.value as Vector3).set(d.x, d.y, d.z);
    if (u.uSunE) u.uSunE.value = SKY_CONFIG.sun.irradiance;
    // 照り返しは地上に届く太陽光の色
    (u.uSunColor?.value as Color).setRGB(l.sun[0], l.sun[1], l.sun[2]);
    // 水平面の放射照度（太陽と空を分けて渡す。雲の影は太陽だけを暗くする）
    const sin = Math.max(d.y, 0);
    (u.uSunIrr?.value as Color).setRGB(l.sun[0] * sin, l.sun[1] * sin, l.sun[2] * sin);
    (u.uSkyIrr?.value as Color).setRGB(l.skyIrradiance[0], l.skyIrradiance[1], l.skyIrradiance[2]);
  }

  /** 描画距離に合わせてメッシュを作り直す */
  setDrawDistance(drawDistance: number): void {
    if (drawDistance === this.drawDistance) return;
    this.drawDistance = drawDistance;
    const r = OCEAN_CONFIG.rings;
    this.detailedMesh.geometry.dispose();
    this.detailedMesh.geometry = createRingGeometry(
      r.innerRadius,
      drawDistance * r.outerRatio,
      r.angularSegments,
    );
    const s = OCEAN_CONFIG.simple;
    const size = drawDistance * s.planeSizeRatio;
    this.simpleMesh.geometry.dispose();
    this.simpleMesh.geometry = createPlaneGeometry(size, s.segments);
    this.spacing = size / s.segments;
  }

  /** 画質の切り替え（簡易版か・さざ波の層数・反射の強化・雲の影） */
  applyQuality(preset: QualityPreset): void {
    this.setDrawDistance(preset.drawDistance);
    this.setSimple(preset.oceanSimple);
    const material = this.detailedMesh.material;
    const u = material.uniforms;
    if (u.uLayerCount) u.uLayerCount.value = Math.max(1, preset.oceanLayers);
    const boost = OCEAN_CONFIG.highBoost;
    if (this.shared.uReflectivity)
      this.shared.uReflectivity.value =
        OCEAN_CONFIG.reflectivity * (preset.oceanBoost ? boost.reflectivity : 1);
    (u.uGlint?.value as Vector3).z =
      OCEAN_CONFIG.sunGlint.strength * (preset.oceanBoost ? boost.sunGlint : 1);
    const hasShadow = 'CLOUD_SHADOW' in material.defines;
    if (hasShadow !== preset.cloudShadows) {
      if (preset.cloudShadows) material.defines.CLOUD_SHADOW = '';
      else delete material.defines.CLOUD_SHADOW;
      material.needsUpdate = true;
    }
  }

  private setSimple(simple: boolean): void {
    this.simple = simple;
    this.simpleMesh.visible = simple;
    this.detailedMesh.visible = !simple;
  }

  /** time は秒（ポーズ中は止まる） */
  update(camera: Readonly<Vec3>, time: number): void {
    const seaLevel = TERRAIN_CONFIG.seaLevel;
    if (this.simple) {
      // 平面は格子間隔単位で動かす（頂点の位置がずれて波が揺れないように）
      const s = this.spacing;
      this.simpleMesh.position.set(
        Math.round(camera.x / s) * s,
        seaLevel,
        Math.round(camera.z / s) * s,
      );
    } else {
      // リングはカメラの真下。遠くの頂点の間隔は波長の 1/4 より広く、その波はシェーダーで消している
      this.detailedMesh.position.set(camera.x, seaLevel, camera.z);
    }
    if (this.shared.uTime) this.shared.uTime.value = time;
  }
}
