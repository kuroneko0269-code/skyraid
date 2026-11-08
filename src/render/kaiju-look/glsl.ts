// 10-7b: 怪獣のマテリアルのシェーダーの部品（10-7a のネフィルガの material-glsl.ts から共通にした）: 縁の光と稲光・凹凸・
// 頂点の差し込み（呼吸のふくらみ・静止姿勢の位置と法線）・uniform の宣言・日と稲光の向きをカメラの向きへ直す
import { Color, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import type { KaijuRimColors, KaijuRimSpec } from '../../data/kaiju-look';

export const vec = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
export const f = (n: number): string => n.toFixed(4);

export type U = Record<string, { value: unknown }>;

export const num = (value: number): { value: number } => ({ value });

/** 怪獣のマテリアルで共通に使う uniform（日・空・稲光・嵐・倒れた・時計・呼吸） */
export function sharedUniforms(): {
  uSunDirV: { value: Vector3 };
  uSunColor: { value: Color };
  uSkyColor: { value: Color };
  uLightDirV: { value: Vector3 };
  uLightning: { value: number };
  uStorm: { value: number };
  uDead: { value: number };
  uTime: { value: number };
  uBreath: { value: number };
} {
  return {
    uSunDirV: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color(1, 1, 1) },
    uSkyColor: { value: new Color(0.5, 0.6, 0.8) },
    uLightDirV: { value: new Vector3(0, 1, 0) },
    uLightning: { value: 0 },
    uStorm: { value: 0 },
    uDead: { value: 0 },
    uTime: { value: 0 },
    uBreath: { value: 0 },
  };
}

/** 縁の光と稲光（どの画質も。normal と vViewPosition が決まった後。uSunDirV などの共通の uniform を使う） */
export function rimGlsl(rim: KaijuRimSpec, colors: KaijuRimColors): string {
  return /* glsl */ `
  {
    vec3 vdir = normalize(vViewPosition);
    float fres = pow(1.0 - saturate(dot(normal, vdir)), ${f(rim.power)});
    float back = saturate(dot(-vdir, uSunDirV));
    // 日の色は明るさを 1 までにそろえる（日の強さで白く飛ばない）
    vec3 sunN = uSunColor / max(1.0, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
    vec3 skyN = uSkyColor / max(1.0, max(uSkyColor.r, max(uSkyColor.g, uSkyColor.b)));
    vec3 rimC = (sunN * (0.15 + back * back * 2.0) + skyN * ${f(rim.ambient)}) * fres;
    totalEmissiveRadiance += rimC * ${f(rim.strength)} * (0.35 + diffuseColor.rgb) * (1.0 - 0.6 * uDead);
    totalEmissiveRadiance += ${vec(colors.rim)} * fres * uStorm * 0.35 * (1.0 - uDead);
    float lit = saturate(dot(normal, uLightDirV)) * 0.85 + fres * 0.7;
    totalEmissiveRadiance += ${vec(colors.lightning)} * uLightning * lit * (diffuseColor.rgb + 0.12);
  }
`;
}

/** 凹凸（高さ kh の画面の傾きで法線を曲げる。接線の要らない方法） */
export const BUMP = /* glsl */ `
  {
    vec3 dpdx = dFdx(-vViewPosition);
    vec3 dpdy = dFdy(-vViewPosition);
    float dhx = dFdx(kh);
    float dhy = dFdy(kh);
    vec3 r1 = cross(dpdy, normal);
    vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - grad);
  }
`;

/** 三方向から貼る（静止姿勢の位置・法線で。tileMeters の大きさで繰り返す）: vec4 kTex を作る */
export function triplanarGlsl(sampler: string, tileMeters: number): string {
  return /* glsl */ `
      vec3 kw = pow(abs(vRestNrm), vec3(4.0));
      kw /= (kw.x + kw.y + kw.z + 1e-4);
      float kt = ${f(1 / tileMeters)};
      vec4 kTex = texture2D(${sampler}, vRestPos.zy * kt) * kw.x + texture2D(${sampler}, vRestPos.xz * kt) * kw.y
        + texture2D(${sampler}, vRestPos.xy * kt) * kw.z;`;
}

/** フラグメントの先頭の宣言（共通の varying と uniform。型は値から） */
export function common(u: U, extra: string): string {
  const decl = Object.entries(u)
    .map(([k, v]) => {
      const val = v.value;
      const type =
        typeof val === 'number'
          ? 'float'
          : val instanceof Vector3 || val instanceof Color
            ? 'vec3'
            : 'sampler2D';
      return `uniform ${type} ${k};`;
    })
    .join('\n');
  return `#include <common>\nvarying float vGlow;\nvarying vec3 vRestPos;\nvarying vec3 vRestNrm;\n${extra}\n${decl}`;
}

/**
 * 頂点の差し込み: aGlow・静止姿勢の位置と法線を渡し、呼吸で belly（静止姿勢の position・normal から 0〜1 の式）の所を
 * 法線の向きへ uBreath m ふくらませる。uv は絵の座標 vKUv を渡す。extraDecl・extraBody は怪獣ごとの足し
 */
export function vertexPatch(
  shader: WebGLProgramParametersWithUniforms,
  opts: {
    readonly uv: boolean;
    readonly belly: string;
    readonly extraDecl?: string;
    readonly extraBody?: string;
  },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vRestPos;\nvarying vec3 vRestNrm;\nuniform float uBreath;${opts.uv ? '\nvarying vec2 vKUv;' : ''}\n${opts.extraDecl ?? ''}`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vGlow = aGlow;
      vRestPos = position;
      vRestNrm = normal;
      ${opts.uv ? 'vKUv = uv;' : ''}
      float kBelly = ${opts.belly};
      transformed += normal * uBreath * kBelly;
      ${opts.extraBody ?? ''}`,
    );
}

/** 向き（ワールド）をカメラの向き（view 行列の回転）へ直して単位にする */
export function toViewDir(src: Readonly<Vector3>, dst: unknown, e: ArrayLike<number>): void {
  if (!(dst instanceof Vector3)) return;
  const x = src.x;
  const y = src.y;
  const z = src.z;
  dst
    .set(
      (e[0] ?? 0) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z,
      (e[1] ?? 0) * x + (e[5] ?? 0) * y + (e[9] ?? 0) * z,
      (e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 0) * z,
    )
    .normalize();
}
