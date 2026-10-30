// ポストエフェクト（4-1）: three/examples/jsm の EffectComposer。
// シーン（リニア HDR、MSAA）→ ブルーム（画質「高」のみ）→ 仕上げ（陽炎の屈折（4-4。「高」のみ）+ ビネット + 露出 + ACES + sRGB を 1 パスで）
import {
  HalfFloatType,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BLOOM_CONFIG, POST_CONFIG, VIGNETTE_CONFIG } from '../data/sky';
import type { HazeSegment } from './fx/heat-haze';

// UnrealBloomPass の内部の描画回数（明るい部分の抽出 1 + ぼかし 5 段 × 2 + 合成 1 + 足し込み 1）
const BLOOM_STEPS = 13;

/**
 * 仕上げのパス。トーンマッピングと sRGB 変換はレンダラーの設定（ACES・露出）を
 * Three.js のチャンクで使う（画面に描くときだけ有効になる）
 */
const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: VIGNETTE_CONFIG.strength },
    // 陽炎の帯（4-4）: 始点・終点の uv、太さ（画面の高さに対する割合）、ずれの大きさ、時間、画面の縦横比
    uHazeSeg: { value: new Vector4() },
    uHazeWidth: { value: 0 },
    uHazeStrength: { value: 0 },
    uHazeTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform vec4 uHazeSeg;
    uniform float uHazeWidth;
    uniform float uHazeStrength;
    uniform float uHazeTime;
    uniform float uAspect;
    varying vec2 vUv;

    // 陽炎: ノズルから後ろへ伸びる帯の中だけ、流れる波で像をずらす（根元は細く強く、先は太く弱く）
    vec2 hazeOffset(vec2 uv) {
      vec2 scale = vec2(uAspect, 1.0);
      vec2 p = uv * scale;
      vec2 a = uHazeSeg.xy * scale;
      vec2 ab = uHazeSeg.zw * scale - a;
      float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      float d = length(p - a - ab * h);
      float w = uHazeWidth * mix(1.0, 2.4, h);
      float m = (1.0 - smoothstep(0.0, w, d)) * (1.0 - h) * smoothstep(0.0, 0.08, h);
      vec2 n = vec2(
        sin(h * 37.0 - uHazeTime * 17.0 + p.y * 230.0),
        cos(h * 29.0 - uHazeTime * 13.0 + p.x * 190.0)
      );
      return n * uHazeStrength * m;
    }

    void main() {
      vec2 uv = vUv;
      if (uHazeStrength > 0.0) uv += hazeOffset(vUv);
      vec3 color = texture2D(tDiffuse, uv).rgb;
      // ビネット: 中心からの距離² に比例して暗く（四隅 = 距離² 0.5 で uVignette）
      vec2 d = vUv - 0.5;
      color *= 1.0 - uVignette * 2.0 * dot(d, d);
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export class PostEffects {
  private readonly composer: EffectComposer;
  private readonly finish: ShaderPass;
  private bloom: UnrealBloomPass | null = null;
  private bloomEnabled = false;
  private exposure = 1;
  private readonly size = new Vector2();

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ) {
    renderer.getSize(this.size);
    const pixelRatio = renderer.getPixelRatio();
    const target = new WebGLRenderTarget(this.size.x * pixelRatio, this.size.y * pixelRatio, {
      type: HalfFloatType,
      samples: POST_CONFIG.samples,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
  }

  /** ブルームの有無。初めて有効にしたときにパスを作る */
  setBloom(enabled: boolean): void {
    if (enabled === this.bloomEnabled) return;
    this.bloomEnabled = enabled;
    if (enabled) {
      const b = BLOOM_CONFIG;
      this.bloom ??= new UnrealBloomPass(this.size.clone(), b.strength, b.radius, b.threshold);
      this.composer.insertPass(this.bloom, 1);
      this.composer.setSize(this.size.x, this.size.y);
      this.updateThreshold();
    } else if (this.bloom) {
      this.composer.removePass(this.bloom);
    }
  }

  /**
   * 露出が変わったとき。ブルームはトーンマッピング前（露出を掛ける前）の明るさで判定するので、
   * しきい値を露出で割る
   */
  setExposure(exposure: number): void {
    this.exposure = exposure;
    this.updateThreshold();
  }

  /** 陽炎の屈折の帯（strength 0 で無し）と時間（秒） */
  setHaze(seg: Readonly<HazeSegment>, time: number): void {
    const strength = seg.strength;
    uniform(this.finish, 'uHazeStrength').value = strength;
    if (strength <= 0) return;
    const v: unknown = uniform(this.finish, 'uHazeSeg').value;
    if (v instanceof Vector4) v.set(seg.ax, seg.ay, seg.bx, seg.by);
    uniform(this.finish, 'uHazeWidth').value = seg.width;
    uniform(this.finish, 'uHazeTime').value = time;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.size.set(width, height);
    uniform(this.finish, 'uAspect').value = width / Math.max(1, height);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  /** 1 フレームの描画ステップ数（シーン 1 + ブルーム + 仕上げ 1） */
  get steps(): number {
    return 2 + (this.bloomEnabled ? BLOOM_STEPS : 0);
  }

  private updateThreshold(): void {
    if (this.bloom) this.bloom.threshold = BLOOM_CONFIG.threshold / this.exposure;
  }

  /** レンダーターゲットを解放する */
  dispose(): void {
    this.bloom?.dispose();
    this.composer.dispose();
    this.renderer.setRenderTarget(null);
  }
}

/** ShaderPass の uniform（ShaderPass は定義を複製するので、パスの側から取る） */
function uniform(pass: ShaderPass, name: string): { value: unknown } {
  const u = pass.uniforms[name];
  if (!u) throw new Error(`uniform ${name} がない`);
  return u;
}
