// 雲の場（4-2）: 3D ノイズのテクスチャ・風で流れる量・太陽の向きを、雲・地形・海のシェーダーで共有する。
// 密度の式は cloud-noise.ts（CPU）と CLOUD_GLSL（GPU）で同じ
import {
  Data3DTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three';
import { CLOUD_CONFIG } from '../data/clouds';
import { WIND_CONFIG } from '../data/wind';
import type { Vec3 } from '../flight/math';
import { cloudDensityAt, createCloudNoise, type CloudNoise } from './cloud-noise';

const f = (x: number): string => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

function cloudGlsl(): string {
  const c = CLOUD_CONFIG;
  const n = c.noise;
  const s = c.shadow;
  return /* glsl */ `
#ifndef CLOUD_COMMON
#define CLOUD_COMMON
uniform highp sampler3D uCloudNoise;
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform vec3 uCloudSun;
const float CLOUD_BASE = ${f(c.base)};
const float CLOUD_TOP = ${f(c.top)};
const float CLOUD_THICK = ${f(c.top - c.base)};
const float CLOUD_EXT = ${f(c.extinction)};

// cloud-noise.ts の cloudHeightProfile と同じ
float cloudProfile(float hf) {
  return smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(0.4, 1.0, hf));
}

// 被覆率（場所ごとに大きな模様で揺らす）と形の重み。withDetail が false なら縁を削らない（光の計算用）
float cloudDensityAt(vec3 p, bool withDetail) {
  float hf = (p.y - CLOUD_BASE) / CLOUD_THICK;
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec3 q = vec3(p.x - uCloudOffset.x, p.y, p.z - uCloudOffset.y);
  float weather = texture(uCloudNoise, vec3(q.x / ${f(n.weatherScale)}, 0.5, q.z / ${f(n.weatherScale)})).r;
  float cov = clamp(uCloudCoverage + (weather - 0.5) * ${f(n.weatherAmount)}, 1e-3, 1.0);
  float shape = texture(uCloudNoise, q / ${f(n.shapeScale)}).r;
  float d = (shape * cloudProfile(hf) - (1.0 - cov)) / cov;
  if (d <= 0.0 || !withDetail) return clamp(d, 0.0, 1.0);
  float detail = texture(uCloudNoise, q / ${f(n.detailScale)} + 0.37).r;
  return clamp(d - ${f(n.detailWeight)} * detail * (1.0 - d), 0.0, 1.0);
}

// 雲の影: 点 p から太陽の方へ層の中の高さまで伸ばした点の密度で暗くする倍率（1 = 影なし）
float cloudShadow(vec3 p) {
  float hy = CLOUD_BASE + CLOUD_THICK * ${f(s.shadowHeight)};
  vec3 q = p + uCloudSun * ((hy - p.y) / max(uCloudSun.y, 0.1));
  float d = cloudDensityAt(q, false);
  return 1.0 - ${f(s.strength)} * clamp(d * ${f(s.densityToShadow)}, 0.0, 1.0);
}
#endif
`;
}

/** 雲の密度・影の GLSL（CloudField.uniforms と一緒に使う） */
export const CLOUD_GLSL = cloudGlsl();

export interface CloudUniforms {
  [name: string]: { value: unknown };
  uCloudNoise: { value: Data3DTexture };
  uCloudOffset: { value: Vector2 };
  uCloudCoverage: { value: number };
  uCloudSun: { value: Vector3 };
}

export class CloudField {
  readonly noise: CloudNoise;
  readonly texture: Data3DTexture;
  /** シェーダーに渡す uniform（値のオブジェクトは共有するので、書き換えると全部に効く） */
  readonly uniforms: CloudUniforms;
  /** 風で流れた量（m） */
  readonly offset = new Vector2();
  private readonly wind: { x: number; z: number };

  constructor() {
    this.noise = createCloudNoise();
    const n = this.noise.size;
    const texture = new Data3DTexture(this.noise.data, n, n, n);
    texture.format = RedFormat;
    texture.type = UnsignedByteType;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.wrapR = RepeatWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    this.texture = texture;
    const a = (WIND_CONFIG.direction * Math.PI) / 180;
    this.wind = {
      x: Math.cos(a) * WIND_CONFIG.cloudSpeed,
      z: Math.sin(a) * WIND_CONFIG.cloudSpeed,
    };
    this.uniforms = {
      uCloudNoise: { value: texture },
      uCloudOffset: { value: this.offset },
      uCloudCoverage: { value: CLOUD_CONFIG.coverage },
      uCloudSun: { value: new Vector3(0, 1, 0) },
    };
  }

  setSun(sun: Readonly<Vec3>): void {
    this.uniforms.uCloudSun.value.set(sun.x, sun.y, sun.z);
  }

  /** time は秒（ポーズ中は止まる時間）。風で雲を流す */
  update(time: number): void {
    this.offset.set(this.wind.x * time, this.wind.z * time);
  }

  /** ワールド座標の雲の密度（0〜1。GPU と同じ式） */
  densityAt(p: Readonly<Vec3>): number {
    return cloudDensityAt(this.noise, p.x, p.y, p.z, this.offset.x, this.offset.y, {
      base: CLOUD_CONFIG.base,
      top: CLOUD_CONFIG.top,
      coverage: this.uniforms.uCloudCoverage.value,
    });
  }
}
