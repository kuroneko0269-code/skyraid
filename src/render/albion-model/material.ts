// 10-3a: 白鯨アルビオンのマテリアル: PBR（色は頂点の色）に発光を足す。目（aGlow 1）は淡い青、噴気孔（2）は潮吹きの予兆で白く、
// 腹の巣（3・4・5）は赤くゆっくり脈打つ（壊れた巣は光が消えて黒ずむ）。被弾で白く光る。
// 10-7b: 共通の部品（kaiju-look/glsl.ts）で、どの画質も縁の光・稲光の照り返し・呼吸（胴のふくらみ）・登場の雲の幕・巣のまわりの
// 赤い脈と、白い体の照り（日の側のあたたかい透け・腹の海の照り返し）。画質「中」「高」は起動時に作った皮の絵（textures.ts）で
// 深いしわ・フジツボ・古傷のむら・つや・凹凸（三方向から貼る）と腹のうね
import { Color, MeshStandardMaterial, Vector3, type DataTexture } from 'three';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import { ALBION_VISUAL, type AlbionTierSpec } from '../../data/albion-visual';
import {
  BUMP,
  common,
  f,
  num,
  rimGlsl,
  sharedUniforms,
  toViewDir,
  triplanarGlsl,
  vec,
  vertexPatch,
  type U,
} from '../kaiju-look/glsl';

const M = ALBION_MODEL_CONFIG;
const V = ALBION_VISUAL;

/** 描画フレームごとに入れる値（10-7b） */
export interface AlbionLook {
  /** 噴気孔 0〜1・巣ごとの光 0〜1・目 0〜（頭が壊れると暗い）・被弾 0〜1 */
  spout: number;
  readonly nests: number[];
  eye: number;
  flash: number;
  /** 嵐（雨）0〜1・倒れた 0〜1・稲光の明るさと向き（ワールド。体から光へ）・呼吸のふくらみ m・登場の雲の幕 0〜1 */
  storm: number;
  dead: number;
  lightning: number;
  readonly lightningDir: Vector3;
  breath: number;
  veil: number;
  /** 口の線の赤い光（吠える 0〜1） */
  mouth: number;
}

export function createAlbionLook(): AlbionLook {
  return {
    spout: 0,
    nests: [1, 1, 1],
    eye: 1,
    flash: 0,
    storm: 0,
    dead: 0,
    lightning: 0,
    lightningDir: new Vector3(0, 1, 0),
    breath: 0,
    veil: 0,
    mouth: 0,
  };
}

export interface AlbionMaterial {
  readonly skin: MeshStandardMaterial;
  /** 描画フレームごと（time は見た目の時計） */
  set(look: Readonly<AlbionLook>, time: number): void;
  /** 日の向き・色（ワールド）と空の色 */
  setSun(dirWorld: Readonly<Vector3>, sun: Readonly<Color>, sky: Readonly<Color>): void;
  /** カメラの向き（view 行列）で日・稲光の向きを直す（onBeforeRender から） */
  toView(viewMatrix: { readonly elements: ArrayLike<number> }): void;
  dispose(): void;
}

/** 巣の中心（静止姿勢。parts.ts の巣と同じ） */
const NEST_Z: readonly number[] = [-120, 0, 110];
const NEST_Y: readonly number[] = [-55, -52, -39];

export function createAlbionMaterial(
  spec: AlbionTierSpec,
  tex: DataTexture | null,
): AlbionMaterial {
  const detail = tex !== null && spec.surfaceDetail;
  const shared = sharedUniforms();
  const sunWorld = new Vector3(0, 1, 0);
  const lightWorld = new Vector3(0, 1, 0);
  const u = {
    ...shared,
    uSpout: num(0),
    uNest0: num(1),
    uNest1: num(1),
    uNest2: num(1),
    uEye: num(1),
    uFlash: num(0),
    uVeil: num(0),
    uMouth: num(0),
  };
  const texU: U = detail ? { tSkin: { value: tex } } : {};
  const nestW = (i: number) => `(1.0 - clamp(abs(vGlow - ${f(3 + i)}) * 2.0, 0.0, 1.0))`;
  const skin = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, texU);
    // 呼吸: 胴（胸びれの前から尾の付け根まで）がふくらむ。ひれ・頭の先・尾は動かさない
    vertexPatch(shader, {
      uv: false,
      belly:
        'smoothstep(200.0, -20.0, position.z) * smoothstep(-320.0, -190.0, position.z) * (1.0 - smoothstep(55.0, 72.0, length(position.xy)))',
    });
    const sample = detail
      ? `${triplanarGlsl('tSkin', V.skin.tileMeters)}
      // 遠くでは細かい凹凸とむらを弱める（ちらつかないように）
      float kNear = 1.0 - smoothstep(0.08, 0.4, length(fwidth(vRestPos)) * ${f(8 / V.skin.tileMeters)});
      // 遠くでも大きなむら（明るさ）は残す
      kTex = mix(vec4(0.24 + kTex.r * 0.6, 0.55, 0.6, kTex.a * 0.5), kTex, kNear);`
      : 'vec4 kTex = vec4(0.6, 0.55, 0.6, 0.0);';
    // 腹のうね（胸びれの前から前の巣の前まで。体の軸の周りの角度で溝）
    const pleats = /* glsl */ `
      float kAng = atan(vRestPos.x, -vRestPos.y);
      float kBellyM = smoothstep(-0.15, -0.6, vRestNrm.y) * smoothstep(-305.0, -250.0, vRestPos.z)
        * smoothstep(-40.0, -110.0, vRestPos.z) * kBody;
      float kPleat = pow(abs(sin(kAng * ${f(V.pleats.count / 2)})), 0.35) * kBellyM;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', common({ ...u, ...texU }, ''))
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float kBody = 1.0 - step(0.5, vGlow);
        ${sample}
        ${pleats}
        // むら・古傷・フジツボ（皮だけ）
        diffuseColor.rgb *= mix(1.0, 0.78 + kTex.r * 0.36, kBody);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(V.colors.barnacle)}, kTex.a * 0.75 * kBody);
        diffuseColor.rgb *= 1.0 - (1.0 - kPleat) * kBellyM * 0.12;
        float nb = ${nestW(0)} * (1.0 - step(0.01, uNest0)) + ${nestW(1)} * (1.0 - step(0.01, uNest1))
          + ${nestW(2)} * (1.0 - step(0.01, uNest2));
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(M.colors.nestDark)}, clamp(nb, 0.0, 1.0));
        // 登場の雲の幕: 頭から尾へ晴れていく（幕の端はむらで揺らす）
        float kCut = mix(420.0, -360.0, uVeil);
        float kVeil = smoothstep(kCut - 70.0, kCut + 70.0, vRestPos.z + (kTex.r - 0.5) * 120.0
          + sin(vRestPos.x * 0.05 + uTime) * 25.0) * step(0.001, uVeil);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(V.colors.cloud)}, kVeil * 0.95);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(roughnessFactor, 0.45 + kTex.g * 0.6, kBody), 0.25, 1.0);\nroughnessFactor = mix(roughnessFactor, 1.0, kVeil);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${detail ? `float kh = ((kTex.b - 0.6) * ${f(V.skin.bump)} - (1.0 - kPleat) * kBellyM * ${f(V.pleats.depth)}) * kBody * (1.0 - kVeil);\n${BUMP}` : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float wEye = 1.0 - clamp(abs(vGlow - 1.0) * 2.0, 0.0, 1.0);
        float wHole = 1.0 - clamp(abs(vGlow - 2.0) * 2.0, 0.0, 1.0);
        float wNest = ${nestW(0)} * uNest0 + ${nestW(1)} * uNest1 + ${nestW(2)} * uNest2;
        float wMouth = 1.0 - clamp(abs(vGlow - 6.0) * 2.0, 0.0, 1.0);
        float kLive = 1.0 - uDead;
        totalEmissiveRadiance += (${vec(M.colors.eye)} * ${f(M.glow.eye)} * uEye * wEye
          + ${vec(M.colors.spout)} * uSpout * wHole + ${vec(M.colors.nest)} * wNest
          + ${vec(M.colors.nest)} * uMouth * wMouth * 1.6) * kLive + vec3(uFlash);
        // 腹の巣のまわりの赤い脈（巣から外へ脈が流れる。壊れた巣は消える）
        {
          float kv = 0.0;
          ${[0, 1, 2]
            .map(
              (i) => `{
            float d = length(vec2(vRestPos.z - ${f(NEST_Z[i] ?? 0)}, (vRestPos.y - ${f(NEST_Y[i] ?? 0)}) * 1.6 + abs(vRestPos.x) * 0.9));
            float reach = 1.0 - smoothstep(10.0, ${f(V.nestVeins.reach)}, d);
            float wave = 0.5 + 0.5 * sin(uTime * ${f(V.nestVeins.pulseHz * Math.PI * 2)} - d * 0.12);
            kv += reach * wave * uNest${i};
          }`,
            )
            .join('\n')}
          float kLine = ${detail ? '0.25 + smoothstep(0.55, 0.35, kTex.b) * 0.75' : '0.4'};
          totalEmissiveRadiance += ${vec(V.colors.vein)} * kv * kLine * kBody * ${f(V.nestVeins.strength)} * kLive;
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `${rimGlsl(V.rim, V.colors)}
        {
          // 白い体の照り: 日の側はあたたかく透け（縁ほど）、腹は海の照り返しで青く
          vec3 vdir = normalize(vViewPosition);
          vec3 sunT = uSunColor / max(1.0, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
          float ndl = dot(normal, uSunDirV);
          float wrap = saturate((ndl + ${f(V.subsurface.wrap)}) / (1.0 + ${f(V.subsurface.wrap)})) - saturate(ndl);
          float fres = pow(1.0 - saturate(dot(normal, vdir)), 2.0);
          totalEmissiveRadiance += ${vec(V.colors.subsurface)} * sunT * (wrap * 0.8 + fres * saturate(dot(-vdir, uSunDirV)) * 0.6)
            * ${f(V.subsurface.strength)} * diffuseColor.rgb * (1.0 - uDead * 0.6);
          vec3 skyT = uSkyColor / max(1.0, max(uSkyColor.r, max(uSkyColor.g, uSkyColor.b)));
          totalEmissiveRadiance += skyT * vec3(0.55, 0.72, 0.9) * smoothstep(0.1, -0.8, vRestNrm.y) * 0.1 * diffuseColor.rgb;
          // 影の側も白い体が沈みきらないように、空の光を少し（夕方の逆光で真っ黒な穴に見えない）
          totalEmissiveRadiance += skyT * 0.08 * (1.0 - saturate(ndl)) * diffuseColor.rgb;
          totalEmissiveRadiance += ${vec(V.colors.cloud)} * kVeil * (skyT * 0.35 + sunT * 0.15);
        }
        #include <aomap_fragment>`,
      );
  };
  skin.customProgramCacheKey = () => `albion-skin-${detail ? 'd' : 'p'}`;
  return {
    skin,
    set(look, time) {
      u.uSpout.value = look.spout * M.glow.blowholeMax;
      u.uNest0.value = look.nests[0] ?? 0;
      u.uNest1.value = look.nests[1] ?? 0;
      u.uNest2.value = look.nests[2] ?? 0;
      u.uEye.value = look.eye;
      u.uFlash.value = look.flash * 0.6;
      u.uVeil.value = look.veil;
      u.uMouth.value = look.mouth;
      shared.uTime.value = time;
      shared.uStorm.value = look.storm;
      shared.uDead.value = look.dead;
      shared.uLightning.value = look.lightning;
      shared.uBreath.value = look.breath;
      lightWorld.copy(look.lightningDir);
    },
    setSun(dir, sun, sky) {
      sunWorld.copy(dir).normalize();
      shared.uSunColor.value.copy(sun);
      shared.uSkyColor.value.copy(sky);
    },
    toView(m) {
      toViewDir(sunWorld, shared.uSunDirV.value, m.elements);
      toViewDir(lightWorld, shared.uLightDirV.value, m.elements);
    },
    dispose() {
      skin.dispose();
    },
  };
}
