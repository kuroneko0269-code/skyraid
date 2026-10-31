// フォトモード（7-A）の画面の調整を仕上げのパス（post.ts）に足す部分: uniform と GLSL。
// 露出はレンダラーの露出（pipeline.ts）に掛けるので、ここはトーンマッピング後（表示の色）の
// 色温度・彩度・コントラスト・フィルター・グレイン。uGrade が 0 の間は何もしない（いつもの画面と同じ）
import { Vector3 } from 'three';
import type { GradeUniforms } from '../core/photo-grade';

export function createGradeShaderUniforms(): Record<string, { value: unknown }> {
  return {
    uGrade: { value: 0 },
    uTint: { value: new Vector3(1, 1, 1) },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uGrain: { value: 0 },
    uFilter: { value: 0 },
    uResolution: { value: new Vector3(1, 1, 0) },
  };
}

/** 仕上げのパスの uniform に入れる（null で上書きなし） */
export function applyGradeUniforms(
  u: Record<string, { value: unknown } | undefined>,
  g: Readonly<GradeUniforms> | null,
): void {
  set(u, 'uGrade', g ? 1 : 0);
  if (!g) return;
  const tint = u.uTint?.value;
  if (tint instanceof Vector3) tint.set(g.tint[0], g.tint[1], g.tint[2]);
  set(u, 'uContrast', g.contrast);
  set(u, 'uSaturation', g.saturation);
  set(u, 'uGrain', g.grain);
  set(u, 'uFilter', g.filter);
}

function set(u: Record<string, { value: unknown } | undefined>, name: string, v: number): void {
  const x = u[name];
  if (x) x.value = v;
}

export const GRADE_GLSL_UNIFORMS = /* glsl */ `
  uniform float uGrade;
  uniform vec3 uTint;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uGrain;
  uniform float uFilter;
  uniform vec3 uResolution;

  float gradeHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // 表示の色（0〜1）での調整。フィルター: 1 フィルム / 2 モノクロ / 3 セピア / 4 高コントラスト
  vec3 photoGrade(vec3 c, vec2 uv) {
    c *= uTint;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    c = (c - 0.5) * uContrast + 0.5;
    c = clamp(c, 0.0, 1.0);
    l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if (uFilter > 0.5 && uFilter < 1.5) {
      // フィルム: 黒を少し持ち上げ、影を青緑・明るい所を暖色へ、ゆるい S 字
      c = mix(c * vec3(0.94, 1.0, 1.04), c * vec3(1.06, 1.0, 0.9), smoothstep(0.2, 0.8, l));
      c = c * c * (3.0 - 2.0 * c) * 0.6 + c * 0.4;
      c = c * 0.9 + 0.05;
    } else if (uFilter > 1.5 && uFilter < 2.5) {
      c = vec3(l);
    } else if (uFilter > 2.5 && uFilter < 3.5) {
      c = vec3(l) * vec3(1.12, 0.94, 0.72);
    } else if (uFilter > 3.5) {
      c = c * c * (3.0 - 2.0 * c);
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.25);
    }
    if (uGrain > 0.0) c += (gradeHash(uv * uResolution.xy) - 0.5) * uGrain;
    return clamp(c, 0.0, 1.0);
  }
`;

/** colorspace_fragment の後に入れる（gl_FragColor は表示の色） */
export const GRADE_GLSL_APPLY = /* glsl */ `
  if (uGrade > 0.5) gl_FragColor.rgb = photoGrade(gl_FragColor.rgb, vUv);
`;
