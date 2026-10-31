// 雲（4-2）。画質「中」以上は板 1 枚の疑似体積（層の中を一定の歩数で進む）、「低」はビルボード。
// カメラが雲の層の中にいるときは画面に薄い白い霧を掛ける。雲の影は cloud-field.ts の CLOUD_GLSL を
// 地形・海のシェーダーで使う
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  type Camera,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  DoubleSide,
} from 'three';
import { CLOUD_CONFIG } from '../data/clouds';
import type { CloudMode, QualityPreset } from '../data/quality';
import { createRandom } from '../core/random';
import type { Vec3 } from '../flight/math';
import type { Atmosphere } from './atmosphere';
import type { CloudField } from './cloud-field';
import {
  billboardFragmentShader,
  billboardVertexShader,
  insideFogFragmentShader,
  insideFogVertexShader,
  volumeFragmentShader,
  volumeVertexShader,
} from './cloud-glsl';

/** 下面（y = 0）と上面（y = 1）の 2 枚の正方形（xz は -1〜1）。どちらを描くかはシェーダーで選ぶ */
function createLayerGeometry(): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const y of [0, 1]) {
    const base = positions.length / 3;
    positions.push(-1, y, -1, 1, y, -1, 1, y, 1, -1, y, 1);
    // 下面は下から、上面は上から見て表（どちらも両面で描くので向きは目安）
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * カメラの高さに対する「層の中にいる度合い」（0〜1）。層の端から edge m かけて 0 → 1
 */
export function insideLayerAmount(y: number, base: number, top: number, edge: number): number {
  const k = Math.min(y - base, top - y) / edge;
  return Math.min(1, Math.max(0, k));
}

export class Clouds {
  readonly object = new Group();
  private readonly volume: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly billboards: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  private readonly fog: Mesh<PlaneGeometry, ShaderMaterial>;
  private mode: CloudMode = 'volume';
  private fogAlpha = 0;
  private lastTime: number | null = null;
  private readonly sunColor = new Color();
  private readonly ambient = new Color();
  /** 雨雲の暗さ（7-5。1 = 4-2 のまま） */
  private readonly shade = { value: 1 };

  constructor(
    atmosphere: Atmosphere,
    private readonly field: CloudField,
  ) {
    const lightUniforms = {
      uAmbient: { value: this.ambient },
      uSunColor: { value: this.sunColor },
      uCloudShade: this.shade,
    };
    this.volume = new Mesh(
      createLayerGeometry(),
      new ShaderMaterial({
        uniforms: {
          ...UniformsUtils.clone(UniformsLib.fog),
          ...field.uniforms,
          ...lightUniforms,
          uShow: { value: { x: 1, y: 0 } },
          uHalfSize: { value: 1 },
          uSteps: { value: 8 },
          uInside: { value: 0 },
          uSunDir: field.uniforms.uCloudSun,
          uCloudLight: { value: this.sunColor },
          uProjInv: { value: new Matrix4() },
          uCamWorld: { value: new Matrix4() },
        },
        vertexShader: volumeVertexShader,
        fragmentShader: volumeFragmentShader,
        fog: true,
        transparent: true,
        premultipliedAlpha: true,
        blending: NormalBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.volume.name = 'clouds';
    // 視線は描画するカメラの行列から世界座標で求める（ポストエフェクトの有無にかかわらず同じカメラ）
    const u = this.volume.material.uniforms;
    this.volume.onBeforeRender = (_renderer, _scene, camera: Camera) => {
      (u.uProjInv?.value as Matrix4).copy(camera.projectionMatrixInverse);
      (u.uCamWorld?.value as Matrix4).copy(camera.matrixWorld);
    };

    const b = CLOUD_CONFIG.billboards;
    this.billboards = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        uniforms: {
          ...UniformsUtils.clone(UniformsLib.fog),
          ...lightUniforms,
          uCloudOffset: field.uniforms.uCloudOffset,
          uRadius: { value: b.radius },
        },
        vertexShader: billboardVertexShader,
        fragmentShader: billboardFragmentShader,
        fog: true,
        transparent: true,
        depthWrite: false,
      }),
      b.count,
    );
    this.billboards.name = 'cloud-billboards';
    const random = createRandom(b.seed);
    const m = new Matrix4();
    for (let i = 0; i < b.count; i++) {
      const w = b.sizeMin + (b.sizeMax - b.sizeMin) * random();
      const y =
        CLOUD_CONFIG.base + (CLOUD_CONFIG.top - CLOUD_CONFIG.base) * (0.15 + 0.5 * random());
      m.makeScale(w, w * b.heightRatio, 1);
      m.setPosition((random() * 2 - 1) * b.radius, y, (random() * 2 - 1) * b.radius);
      this.billboards.setMatrixAt(i, m);
    }

    this.fog = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 } },
        vertexShader: insideFogVertexShader,
        fragmentShader: insideFogFragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.fog.name = 'cloud-fog';
    this.fog.renderOrder = 1000;
    this.fog.visible = false;

    for (const mesh of [this.volume, this.billboards, this.fog]) {
      // カメラに追従させるので、カリングで消えないようにする
      mesh.frustumCulled = false;
      this.object.add(mesh);
    }
    this.applyAtmosphere(atmosphere);
    atmosphere.onChange((a) => {
      this.applyAtmosphere(a);
    });
  }

  private applyAtmosphere(atmosphere: Atmosphere): void {
    const l = atmosphere.lighting;
    this.field.setSun(atmosphere.sun);
    // 雲は遮られる前の直射光（雲の層の高さ）で照らす（7-5。曇天でも雲の上面は明るい）
    const key = atmosphere.keyLightAt(CLOUD_CONFIG.base);
    this.sunColor.setRGB(key[0], key[1], key[2]);
    this.ambient.setRGB(l.skyIrradiance[0], l.skyIrradiance[1], l.skyIrradiance[2]);
    // 雲の中の霧の色: 雲の中で四方から散乱してくる光（白に近い灰色）
    const sin = Math.max(atmosphere.sun.y, 0);
    const k = 0.85 / Math.PI;
    (this.fog.material.uniforms.uColor?.value as Color).setRGB(
      (l.sun[0] * (0.4 + 0.3 * sin) + l.skyIrradiance[0]) * k,
      (l.sun[1] * (0.4 + 0.3 * sin) + l.skyIrradiance[1]) * k,
      (l.sun[2] * (0.4 + 0.3 * sin) + l.skyIrradiance[2]) * k,
    );
  }

  /** 雨雲の暗さ（0〜1）。雲の明るさを最大 55% 落とす（7-5） */
  setDarkness(dark: number): void {
    this.shade.value = 1 - 0.55 * Math.min(1, Math.max(0, dark));
  }

  /** 画質の切り替え（方式・歩数・描画距離） */
  applyQuality(preset: QualityPreset): void {
    this.mode = preset.cloudMode;
    const u = this.volume.material.uniforms;
    if (u.uSteps)
      u.uSteps.value = Math.min(Math.max(preset.cloudSteps, 1), CLOUD_CONFIG.volume.maxSteps);
    if (u.uHalfSize) u.uHalfSize.value = preset.drawDistance;
    this.volume.visible = this.mode === 'volume';
    this.billboards.visible = this.mode === 'billboard';
  }

  /** time は秒（ポーズ中は止まる）。カメラに合わせて面・霧を選ぶ */
  update(camera: Readonly<Vec3>, time: number): void {
    const c = CLOUD_CONFIG;
    const first = this.lastTime === null;
    const dt = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    this.field.update(time);
    const show = this.volume.material.uniforms.uShow?.value as { x: number; y: number };
    show.x = camera.y < c.top ? 1 : 0;
    show.y = camera.y > c.base ? 1 : 0;
    const uInside = this.volume.material.uniforms.uInside;
    if (uInside) uInside.value = show.x * show.y;

    // 雲の中の霧: 層の中にいるだけで薄く、雲の濃いところでは濃く
    const f = c.insideFog;
    const inside = insideLayerAmount(camera.y, c.base, c.top, f.edge);
    const density = inside > 0 ? this.field.densityAt(camera) : 0;
    const target =
      inside * f.layerAlpha + Math.min(1, density * 3) * (f.densityAlpha - f.layerAlpha);
    // 最初のフレームはすぐ合わせ、以後はなめらかに追従させる（雲の塊の出入りでちらつかない）
    this.fogAlpha = first
      ? target
      : this.fogAlpha + (target - this.fogAlpha) * (1 - Math.exp(-f.response * dt));
    const alpha = this.fogAlpha;
    const uAlpha = this.fog.material.uniforms.uAlpha;
    if (uAlpha) uAlpha.value = alpha;
    this.fog.visible = alpha > 0.005;
  }

  /** 雲の中の霧の濃さ（0〜1。テスト・デバッグ用） */
  get insideFogAlpha(): number {
    return this.fogAlpha;
  }
}
