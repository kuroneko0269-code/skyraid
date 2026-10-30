// 物理ベースの空（4-1）: 大気散乱（Rayleigh + Mie）のスカイドーム、太陽の円盤と光芒、空気遠近の霧。
// 計算は atmosphere-model.ts（CPU）と atmosphere-glsl.ts（GPU）で同じ式
import {
  BackSide,
  Color,
  Fog,
  Mesh,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
} from 'three';
import { SKY_CONFIG } from '../data/sky';
import type { Vec3 } from '../flight/math';
import { ATMOSPHERE_GLSL, installAtmosphereChunks } from './atmosphere-glsl';
import { computeSkyLighting, sunDirection, type SkyLighting } from './atmosphere-model';

export { sunDirection };

const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSun;
  uniform float uSunE;
  uniform float uDiscCos;
  uniform float uDiscEdgeCos;
  uniform float uDiscRadiance;
  uniform vec4 uGlow;
  varying vec3 vDir;
  ${ATMOSPHERE_GLSL}
  #include <common>
  void main() {
    vec3 dir = normalize(vDir);
    float h = cameraPosition.y;
    // 地平線より下は描画距離の外の海面（atmoBackground）
    vec3 color = atmoBackground(dir, uSun, uSunE, h);
    // 太陽の円盤とまぶしさ（光芒）。地上に届く太陽の色で、地平線より下には描かない
    vec3 sunColor = ATMO_SUN_COLOR * uSunE * atmoSunTransmittance(uSun, h);
    float c = max(dot(dir, uSun), 0.0);
    float disc = smoothstep(uDiscEdgeCos, uDiscCos, c) * step(0.0, dir.y);
    color += sunColor * (disc * uDiscRadiance + uGlow.x * pow(c, uGlow.y) + uGlow.z * pow(c, uGlow.w));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 霧の uniform を大気散乱に読み替える Fog。color = 太陽の向き × 放射照度、near / far = 描画距離の果てで
 * 空の色に溶かしきる範囲（atmosphere-glsl.ts の installAtmosphereChunks）
 */
export class AtmosphereFog extends Fog {
  private readonly packed = new Vector3();
  private toScreen = false;

  constructor() {
    super(0x000000, 1, 2);
  }

  setSun(sun: Readonly<Vec3>, irradiance: number): void {
    this.packed.set(sun.x * irradiance, sun.y * irradiance, sun.z * irradiance);
    this.writeColor();
  }

  /**
   * 画面に直接描くか（ポストエフェクトなし = 画質「低」）。Three.js は画面に直接描くとき fogColor を
   * sRGB に変換して渡すので、その逆変換をしておく（どちらの変換も負の値を含めて正確に戻る）
   */
  setOutputToScreen(toScreen: boolean): void {
    if (toScreen === this.toScreen) return;
    this.toScreen = toScreen;
    this.writeColor();
  }

  private writeColor(): void {
    const p = this.packed;
    if (this.toScreen) this.color.setRGB(p.x, p.y, p.z, SRGBColorSpace);
    else this.color.setRGB(p.x, p.y, p.z);
  }
}

export type AtmosphereListener = (atmosphere: Atmosphere) => void;

/**
 * 空のドーム・空気遠近の霧・太陽の向きと、そこから求めた光（SkyLighting）をまとめる。
 * 太陽を動かす（7-5 の昼夜）ときは setSun を呼ぶと、購読者（ライト・海）に通知する
 */
export class Atmosphere {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  readonly fog = new AtmosphereFog();
  /** 太陽の向き（単位ベクトル、太陽へ向かう向き） */
  readonly sun: Vec3 = { x: 0, y: 1, z: 0 };
  private current: SkyLighting;
  private readonly listeners: AtmosphereListener[] = [];

  constructor() {
    installAtmosphereChunks();
    const cfg = SKY_CONFIG;
    const material = new ShaderMaterial({
      uniforms: {
        uSun: { value: new Vector3(0, 1, 0) },
        uSunE: { value: cfg.sun.irradiance },
        uDiscCos: { value: Math.cos(cfg.sun.discRadius * DEG) },
        // 円盤の縁を少しぼかす
        uDiscEdgeCos: { value: Math.cos(cfg.sun.discRadius * 1.15 * DEG) },
        uDiscRadiance: { value: cfg.sun.discRadiance },
        uGlow: { value: new Vector4() },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(
      new SphereGeometry(cfg.radius, cfg.domeSegments.width, cfg.domeSegments.height),
      material,
    );
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.current = computeSkyLighting(this.sun);
    this.setSun(cfg.sun.azimuth, cfg.sun.elevation);
    this.setGlow(true);
  }

  /** 太陽の向き（方位・仰角、度）を変えて、光と露出を計算し直す */
  setSun(azimuthDeg: number, elevationDeg: number): void {
    const d = sunDirection(azimuthDeg, elevationDeg);
    this.sun.x = d.x;
    this.sun.y = d.y;
    this.sun.z = d.z;
    const irradiance = SKY_CONFIG.sun.irradiance;
    this.current = computeSkyLighting(d);
    const u = this.mesh.material.uniforms;
    if (u.uSun) (u.uSun.value as Vector3).set(d.x, d.y, d.z);
    if (u.uSunE) u.uSunE.value = irradiance;
    this.fog.setSun(d, irradiance);
    for (const fn of this.listeners) fn(this);
  }

  /**
   * 太陽のまわりのまぶしさをスカイシェーダーで描くか（ブルームのない画質「中」「低」）。
   * ブルームがあるときは円盤だけにして、光芒はブルームに任せる
   */
  setGlow(enabled: boolean): void {
    const g = SKY_CONFIG.glow;
    const u = this.mesh.material.uniforms.uGlow;
    if (!u) return;
    const v = u.value as Vector4;
    if (enabled) v.set(g.strength, g.exponent, g.wideStrength, g.wideExponent);
    else v.set(0, 1, 0, 1);
  }

  /** ライトの色・強さと露出 */
  get lighting(): Readonly<SkyLighting> {
    return this.current;
  }

  /** 霧と背景に使う地平線の色（リニア） */
  get horizonColor(): Color {
    const h = this.current.horizon;
    return new Color().setRGB(h[0], h[1], h[2]);
  }

  /** 太陽を動かしたときの通知を購読する */
  onChange(fn: AtmosphereListener): void {
    this.listeners.push(fn);
  }

  update(camera: Readonly<Vec3>): void {
    this.mesh.position.set(camera.x, camera.y, camera.z);
  }
}
