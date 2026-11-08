// 10-7a: ネフィルガのマテリアルのシェーダーの部品（material.ts から分けた）: 縁の光と稲光・凹凸・頂点の差し込み（呼吸）
import { Color, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import { KAIJU2_VISUAL } from '../../data/kaiju2-visual';

const V = KAIJU2_VISUAL;

export const vec = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
export const f = (n: number): string => n.toFixed(4);

export type U = Record<string, { value: unknown }>;

export const num = (value: number): { value: number } => ({ value });

/** 縁の光と稲光（どの画質も。normal と vViewPosition が決まった後） */
export const RIM = /* glsl */ `
  {
    vec3 vdir = normalize(vViewPosition);
    float fres = pow(1.0 - saturate(dot(normal, vdir)), ${f(V.rim.power)});
    float back = saturate(dot(-vdir, uSunDirV));
    // 日の色は明るさを 1 までにそろえる（日の強さで白く飛ばない）
    vec3 sunN = uSunColor / max(1.0, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
    vec3 skyN = uSkyColor / max(1.0, max(uSkyColor.r, max(uSkyColor.g, uSkyColor.b)));
    vec3 rimC = (sunN * (0.15 + back * back * 2.0) + skyN * ${f(V.rim.ambient)}) * fres;
    totalEmissiveRadiance += rimC * ${f(V.rim.strength)} * (0.35 + diffuseColor.rgb) * (1.0 - 0.6 * uDead);
    totalEmissiveRadiance += ${vec(V.colors.rim)} * fres * uStorm * 0.35 * (1.0 - uDead);
    float lit = saturate(dot(normal, uLightDirV)) * 0.85 + fres * 0.7;
    totalEmissiveRadiance += ${vec(V.colors.lightning)} * uLightning * lit * (diffuseColor.rgb + 0.12);
  }
`;

/** 凹凸（高さ h の画面の傾きで法線を曲げる。接線の要らない方法） */
export const BUMP = /* glsl */ `
  {
    vec3 dpdx = dFdx(-vViewPosition);
    vec3 dpdy = dFdy(-vViewPosition);
    float dhx = dFdx(k2h);
    float dhy = dFdy(k2h);
    vec3 r1 = cross(dpdy, normal);
    vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - grad);
  }
`;

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

export function vertexPatch(shader: WebGLProgramParametersWithUniforms, uv: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vRestPos;\nvarying vec3 vRestNrm;\nuniform float uBreath;${uv ? '\nvarying vec2 vK2Uv;' : ''}`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vGlow = aGlow;
      vRestPos = position;
      vRestNrm = normal;
      ${uv ? 'vK2Uv = uv;' : ''}
      // 呼吸: 胴の下側がふくらむ（翼・首・尾は動かさない）
      float k2belly = smoothstep(2.0, -8.0, position.y) * smoothstep(34.0, 8.0, abs(position.z + 2.0))
        * smoothstep(18.0, 10.0, abs(position.x));
      transformed += normal * uBreath * k2belly;`,
    );
}
