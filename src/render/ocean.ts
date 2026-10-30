import {
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
} from 'three';
import { OCEAN_CONFIG, TERRAIN_CONFIG } from '../data/terrain';
import { SKY_CONFIG } from '../data/sky';
import type { Vec3 } from '../flight/math';
import type { Atmosphere } from './atmosphere';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl';

// 平面の一辺 = 描画距離 × この値。画面の端（視線から斜め）でも縁が霧の外に出るように
const SIZE_PER_DRAW_DISTANCE = 2.5;

// 頂点・フラグメントの両方で使う色の計算（水の色 + フレネルで空の反射）。
// 空の反射は空のドームと同じ大気散乱（atmoSky）、水の色は反射率 × 地形と同じ光（太陽 + 空）
const shadeChunk = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSunDirection;
  uniform float uSunE;
  uniform vec3 uWaterLight;
  uniform float uReflectivity;
  ${ATMOSPHERE_GLSL}

  vec3 skyColor(vec3 dir) {
    return atmoSky(dir, uSunDirection, uSunE, cameraPosition.y);
  }

  // n: 法線、toEye: 目への向き（どちらも単位ベクトル）
  vec3 waterShade(vec3 n, vec3 toEye) {
    float facing = clamp(dot(n, toEye), 0.0, 1.0);
    // Schlick 近似のフレネル: 浅い角度ほど空を映す
    float f = 1.0 - facing;
    float f2 = f * f;
    float fresnel = 0.02 + 0.98 * f2 * f2 * f;
    vec3 r = reflect(-toEye, n);
    r.y = abs(r.y);
    vec3 water = mix(uShallowColor, uDeepColor, facing) * uWaterLight;
    return mix(water, skyColor(r), fresnel * uReflectivity);
  }
`;

// OCEAN_SIMPLE（画質「低」）: 頂点の波を減らし、さざ波なし・水の色とフレネルを頂点で計算する
const vertexShader = /* glsl */ `
  #define WAVE_COUNT ${OCEAN_CONFIG.waves.length}
  #ifdef OCEAN_SIMPLE
    #define ACTIVE_WAVES ${OCEAN_CONFIG.simple.waveCount}
  #else
    #define ACTIVE_WAVES WAVE_COUNT
  #endif
  uniform float uTime;
  // xy = 進行方向（単位ベクトル）、z = 波数 2π/波長、w = 振幅
  uniform vec4 uWaves[WAVE_COUNT];
  // 角振動数（波数 × 速さ）
  uniform float uOmega[WAVE_COUNT];
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #ifdef OCEAN_SIMPLE
    varying vec3 vShade;
    ${shadeChunk}
  #endif
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float h = 0.0;
    vec2 grad = vec2(0.0);
    for (int i = 0; i < ACTIVE_WAVES; i++) {
      vec4 w = uWaves[i];
      float phase = dot(w.xy, wp.xz) * w.z - uTime * uOmega[i];
      h += w.w * sin(phase);
      grad += w.w * w.z * cos(phase) * w.xy;
    }
    wp.y += h;
    vWorldPos = wp.xyz;
    vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
    #ifdef OCEAN_SIMPLE
      vShade = waterShade(vNormal, normalize(cameraPosition - wp.xyz));
    #endif
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #define RIPPLE_COUNT ${OCEAN_CONFIG.rippleWavelengths.length}
  uniform float uTime;
  uniform float uRippleK[RIPPLE_COUNT];
  uniform float uRippleStrength;
  uniform float uRippleFadeStart;
  uniform float uRippleFadeEnd;
  uniform vec3 uSunColor;
  uniform float uSunShininess;
  uniform float uSunSpecular;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #ifdef OCEAN_SIMPLE
    uniform vec3 uSunDirection;
    varying vec3 vShade;
  #else
    ${shadeChunk}
  #endif
  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec3 eyeVec = cameraPosition - vWorldPos;
    vec3 toEye = normalize(eyeVec);
    #ifdef OCEAN_SIMPLE
      vec3 n = normalize(vNormal);
      vec3 color = vShade;
    #else
      // さざ波: 頂点は動かさず、向きの違う細かい波で法線だけ揺らす
      vec2 g = vec2(0.0);
      for (int i = 0; i < RIPPLE_COUNT; i++) {
        float a = float(i) * 2.1 + 0.4;
        vec2 dir = vec2(cos(a), sin(a));
        float k = uRippleK[i];
        g += cos(dot(dir, vWorldPos.xz) * k - uTime * k * 1.5) * dir;
      }
      // 遠くのさざ波は画素より細かくなってちらつく（モアレ）ので、距離で消す
      float fade = 1.0 - smoothstep(uRippleFadeStart, uRippleFadeEnd, length(eyeVec));
      vec3 n = normalize(vNormal + vec3(-g.x, 0.0, -g.y) * uRippleStrength * fade);
      vec3 color = waterShade(n, toEye);
    #endif
    vec3 r = reflect(-toEye, n);
    color += uSunColor * pow(max(dot(r, uSunDirection), 0.0), uSunShininess) * uSunSpecular;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * 海面。カメラに追従する平面で、頂点をワールド座標の正弦波でゆっくり上下させる。
 * 色は真下が水の色（反射率 × 太陽と空の光）、浅い角度ほど空の反射（フレネル）。空の色は大気散乱から取る。
 * 本格的な水面は 4-2
 */
export class Ocean {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private spacing = 1;

  private simple = false;
  // 大気から入れる uniform の値（太陽を動かしたら書き換える）
  private readonly sunDirection = new Vector3();
  private readonly sunE = { value: 0 };
  private readonly sunColor = new Color();
  private readonly waterLight = new Color();

  constructor(atmosphere: Atmosphere, drawDistance: number) {
    const cfg = OCEAN_CONFIG;
    const waves = cfg.waves.map((w) => {
      const a = (w.direction * Math.PI) / 180;
      return new Vector4(Math.cos(a), Math.sin(a), (2 * Math.PI) / w.wavelength, w.amplitude);
    });
    const omega = cfg.waves.map((w) => ((2 * Math.PI) / w.wavelength) * w.speed);
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWaves: { value: waves },
          uOmega: { value: omega },
          uRippleK: { value: cfg.rippleWavelengths.map((l) => (2 * Math.PI) / l) },
          uRippleStrength: { value: cfg.rippleStrength },
          uRippleFadeStart: { value: cfg.rippleFade.start },
          uRippleFadeEnd: { value: cfg.rippleFade.end },
          uDeepColor: { value: new Color(cfg.deepColor) },
          uShallowColor: { value: new Color(cfg.shallowColor) },
          uReflectivity: { value: cfg.reflectivity },
          uSunDirection: { value: this.sunDirection },
          uSunE: this.sunE,
          uSunColor: { value: this.sunColor },
          uWaterLight: { value: this.waterLight },
          uSunShininess: { value: cfg.sunShininess },
          uSunSpecular: { value: cfg.sunSpecular },
        },
      ]),
      vertexShader,
      fragmentShader,
      fog: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.name = 'ocean';
    // 平面はカメラの真下に置き直すので、カリングで消えないようにする
    this.mesh.frustumCulled = false;
    this.setDrawDistance(drawDistance);
    this.applyAtmosphere(atmosphere);
    atmosphere.onChange((a) => {
      this.applyAtmosphere(a);
    });
  }

  /** 太陽の向き・空の光を uniform に入れる（太陽を動かしたときも） */
  private applyAtmosphere(atmosphere: Atmosphere): void {
    const d = atmosphere.sun;
    const l = atmosphere.lighting;
    this.sunDirection.set(d.x, d.y, d.z);
    this.sunE.value = SKY_CONFIG.sun.irradiance;
    // 照り返しは地上に届く太陽光の色
    this.sunColor.setRGB(l.sun[0], l.sun[1], l.sun[2]);
    // 水の中で散乱して出てくる光 = 水平面の放射照度 / π（拡散面と同じ）
    const sin = Math.max(d.y, 0);
    this.waterLight.setRGB(
      (l.sun[0] * sin + l.skyIrradiance[0]) / Math.PI,
      (l.sun[1] * sin + l.skyIrradiance[1]) / Math.PI,
      (l.sun[2] * sin + l.skyIrradiance[2]) / Math.PI,
    );
  }

  /** 描画距離に合わせて平面の大きさを作り直す */
  setDrawDistance(drawDistance: number): void {
    const size = drawDistance * SIZE_PER_DRAW_DISTANCE;
    const segments = OCEAN_CONFIG.segments;
    const geometry = new PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.spacing = size / segments;
  }

  /** 画質「低」用の簡略シェーダーに切り替える（切り替えたときだけ再コンパイル） */
  setSimple(simple: boolean): void {
    if (simple === this.simple) return;
    this.simple = simple;
    const material = this.mesh.material;
    if (simple) material.defines.OCEAN_SIMPLE = '';
    else delete material.defines.OCEAN_SIMPLE;
    material.needsUpdate = true;
  }

  /** time は秒。カメラの真下へ格子間隔単位で動かす（頂点の位置がずれて波が揺れないように） */
  update(camera: Readonly<Vec3>, time: number): void {
    const s = this.spacing;
    this.mesh.position.set(
      Math.round(camera.x / s) * s,
      TERRAIN_CONFIG.seaLevel,
      Math.round(camera.z / s) * s,
    );
    const uTime = this.mesh.material.uniforms.uTime;
    if (uTime) uTime.value = time;
  }
}
