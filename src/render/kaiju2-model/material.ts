// 9-6a: ネフィルガのマテリアル: PBR（色は頂点の色）に発光を足す。皮膚は目（aGlow 1）と喉の袋（2。雷球の予兆で光る）、
// 翼の膜（両面）は筋が紫白に脈打ち、雷球の予兆で強くなる（ブルームに乗る）。
// 10-7a: 画質「中」「高」は起動時に作った絵（textures.ts）で、皮膚はうろこの明るさ・つや・凹凸（三方向から貼る）と嵐の発光の筋、
// 膜は指の骨と細い筋・傷・透け（日を透かす）・壊れた翼の裂け目。どの画質も縁の光（逆光で強い）・稲光の照り返し・呼吸（腹のふくらみ）
import { Color, DoubleSide, MeshStandardMaterial, Vector3, type DataTexture } from 'three';
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';
import { KAIJU2_VISUAL, type Kaiju2Tier } from '../../data/kaiju2-visual';

const M = KAIJU2_MODEL_CONFIG;
const V = KAIJU2_VISUAL;

/** 描画フレームごとに入れる値 */
export interface Kaiju2Look {
  /** 喉の袋 0〜1・膜の筋の強まり 0〜1（9-6a） */
  throat: number;
  vein: number;
  /** 嵐の強さ（段階 3・雨）0〜1・倒れた（光が消える）0〜1 */
  storm: number;
  dead: number;
  /** 稲光の明るさ（0〜）と向き（ワールド。体から光へ） */
  lightning: number;
  readonly lightningDir: Vector3;
  /** 呼吸のふくらみ（m） */
  breath: number;
  /** 壊れた翼（裂け目） */
  tornL: boolean;
  tornR: boolean;
}

export interface Kaiju2Materials {
  readonly skin: MeshStandardMaterial;
  readonly membrane: MeshStandardMaterial;
  /** 描画フレームごと（time は見た目の時計） */
  setLook(look: Readonly<Kaiju2Look>, time: number): void;
  /** 9-6b: 被弾で白く光る（0〜1）・喉の袋が壊れて光が消える */
  setFlash(flash: number, throatBroken: boolean): void;
  /** 日の向き・色（ワールド）と空の色（描く前にカメラの向きへ直す） */
  setSun(dirWorld: Readonly<Vector3>, sun: Readonly<Color>, sky: Readonly<Color>): void;
  /** カメラの向き（view 行列）で日・稲光の向きを直す（onBeforeRender から） */
  toView(viewMatrix: { readonly elements: ArrayLike<number> }): void;
  dispose(): void;
}

import { BUMP, RIM, common, f, num, vec, vertexPatch, type U } from './material-glsl';

export function createKaiju2Materials(
  tier: Kaiju2Tier,
  tex: { skin: DataTexture; membrane: DataTexture } | null,
): Kaiju2Materials {
  const detail = tex !== null && V.tiers[tier].surfaceDetail;
  const shared = {
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
  const sunWorld = new Vector3(0, 1, 0);
  const lightWorld = new Vector3(0, 1, 0);
  const skinU = {
    ...shared,
    uThroat: num(M.glow.throatIdle),
    uVeinGlow: num(V.veins.idle),
  };
  const memU = {
    ...shared,
    uVein: num(M.glow.veinIdle),
    uTornL: num(0),
    uTornR: num(0),
  };
  const skinTex: U = detail ? { tSkin: { value: tex.skin } } : {};
  const memTex: U = detail ? { tMem: { value: tex.membrane } } : {};
  const pulse = `(0.55 + 0.45 * sin(uTime * ${f(V.veins.pulseHz * Math.PI * 2)} - k2wave))`;
  const skin = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skinU, skinTex);
    vertexPatch(shader, false);
    const sample = detail
      ? /* glsl */ `
      vec3 k2w = pow(abs(vRestNrm), vec3(4.0));
      k2w /= (k2w.x + k2w.y + k2w.z + 1e-4);
      float k2t = ${f(1 / V.skin.tileMeters)};
      vec4 k2s = texture2D(tSkin, vRestPos.zy * k2t) * k2w.x + texture2D(tSkin, vRestPos.xz * k2t) * k2w.y
        + texture2D(tSkin, vRestPos.xy * k2t) * k2w.z;
      float k2body = 1.0 - step(0.5, vGlow);
      // 遠くでは細かい凹凸とむらを弱める（1 画素がうろこの大きさに近いとちらつく）
      float k2near = 1.0 - smoothstep(0.12, 0.5, length(fwidth(vRestPos)) * ${f(V.skin.scalesPerTile / V.skin.tileMeters)});
      k2s = mix(vec4(0.5, 0.5, 0.5, k2s.a), k2s, k2near);`
      : 'vec4 k2s = vec4(0.5, 0.5, 0.0, 0.0); float k2body = 1.0 - step(0.5, vGlow);';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', common({ ...skinU, ...skinTex }, ''))
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${sample}\ndiffuseColor.rgb *= mix(1.0, 0.72 + k2s.r * 0.56, k2body);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * mix(1.0, 0.6 + k2s.g * 0.8, k2body), 0.2, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${detail ? `float k2h = k2s.b * ${f(V.skin.bump)} * k2body;\n${BUMP}` : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
      float eyeW = 1.0 - clamp(abs(vGlow - 1.0) * 2.0, 0.0, 1.0);
      float throatW = 1.0 - clamp(abs(vGlow - 2.0) * 2.0, 0.0, 1.0);
      float k2live = 1.0 - uDead;
      totalEmissiveRadiance += (${vec(M.colors.eye)} * ${f(M.glow.eye)} * eyeW + ${vec(M.colors.storm)} * uThroat * throatW) * k2live;
      // 嵐の力が走る筋: 背の側（上を向く面）と首・翼の腕に。付け根から先へ脈が流れる
      float k2wave = vRestPos.z * 0.07 + abs(vRestPos.x) * 0.05;
      float k2dorsal = smoothstep(-0.1, 0.5, vRestNrm.y);
      totalEmissiveRadiance += ${vec(M.colors.storm)} * k2s.a * k2body * k2dorsal * uVeinGlow * ${pulse} * k2live;`,
      )
      .replace('#include <aomap_fragment>', `${RIM}\n#include <aomap_fragment>`);
  };
  const membrane = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    side: DoubleSide,
  });
  membrane.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, memU, memTex);
    vertexPatch(shader, true);
    const sample = detail
      ? 'vec4 k2m = texture2D(tMem, vK2Uv);'
      : 'vec4 k2m = vec4(vGlow * 0.6, 0.6, 0.0, vGlow);';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', common({ ...memU, ...memTex }, 'varying vec2 vK2Uv;'))
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
      ${sample}
      // 壊れた翼の裂け目（先の方・後縁寄りに、ぎざぎざの穴）
      float k2torn = vRestPos.x < 0.0 ? uTornL : uTornR;
      if (k2torn > 0.5) {
        vec2 c = floor(vK2Uv * vec2(9.0, 5.0));
        float n = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
        float edge = vK2Uv.y - (0.35 + 0.45 * n) + k2m.r * 0.25;
        if (vK2Uv.x > 0.32 && n > 0.35 && edge > 0.0) discard;
      }
      ${detail ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.38, 0.5), k2m.r * 0.55) * (1.0 - 0.45 * k2m.b);' : ''}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${detail ? 'roughnessFactor = clamp(0.35 + 0.45 * k2m.r + 0.2 * k2m.b, 0.15, 1.0);' : ''}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${detail ? `float k2h = (k2m.r - k2m.b * 0.6) * ${f(V.membrane.bump)};\n${BUMP}` : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
      float k2wave = vK2Uv.x * 5.0 + vK2Uv.y * 2.0;
      totalEmissiveRadiance += ${vec(M.colors.storm)} * uVein * k2m.a * ${pulse} * (1.0 - uDead);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `${RIM}\n${
          detail
            ? /* glsl */ `{
        // 透け: 日が膜の向こう側にあるとき、薄い所が赤橙に透ける
        vec3 vdir = normalize(vViewPosition);
        float through = saturate(-dot(normal, uSunDirV));
        float scatter = pow(saturate(dot(-vdir, uSunDirV)), ${f(V.translucency.power)});
        vec3 sunT = uSunColor / max(1.0, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
        totalEmissiveRadiance += ${vec(V.colors.translucent)} * sunT * k2m.g * (through * 0.4 + scatter)
          * ${f(V.translucency.strength)} * 0.3;
      }`
            : ''
        }\n#include <aomap_fragment>`,
      );
  };
  skin.customProgramCacheKey = () => `kaiju2-skin-${detail ? 'd' : 'p'}`;
  membrane.customProgramCacheKey = () => `kaiju2-membrane-${detail ? 'd' : 'p'}`;
  const toV = (src: Vector3, dst: unknown, e: ArrayLike<number>): void => {
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
  };
  return {
    skin,
    membrane,
    setLook(look, time) {
      const g = M.glow;
      skinU.uThroat.value = g.throatIdle + (g.throatMax - g.throatIdle) * look.throat;
      const pulse = 0.75 + 0.25 * Math.sin(time * 1.7);
      memU.uVein.value =
        (g.veinIdle + (g.veinMax - g.veinIdle) * Math.max(look.vein, look.storm * 0.4)) * pulse;
      skinU.uVeinGlow.value =
        V.veins.idle + V.veins.windup * look.vein + V.veins.storm * look.storm;
      shared.uTime.value = time;
      shared.uStorm.value = look.storm;
      shared.uDead.value = look.dead;
      shared.uLightning.value = look.lightning;
      shared.uBreath.value = look.breath;
      lightWorld.copy(look.lightningDir);
      memU.uTornL.value = look.tornL ? 1 : 0;
      memU.uTornR.value = look.tornR ? 1 : 0;
    },
    setFlash(flash, throatBroken) {
      skin.emissive.setScalar(flash * M.hitFlash);
      membrane.emissive.setScalar(flash * M.hitFlash * 0.6);
      if (throatBroken) skinU.uThroat.value = 0;
    },
    setSun(dir, sun, sky) {
      sunWorld.copy(dir).normalize();
      shared.uSunColor.value.copy(sun);
      shared.uSkyColor.value.copy(sky);
    },
    toView(m) {
      toV(sunWorld, shared.uSunDirV.value, m.elements);
      toV(lightWorld, shared.uLightDirV.value, m.elements);
    },
    dispose() {
      skin.dispose();
      membrane.dispose();
    },
  };
}
