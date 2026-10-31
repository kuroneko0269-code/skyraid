import {
  ACESFilmicToneMapping,
  Fog,
  Mesh,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { QUALITY_CONFIG, type QualityPreset } from '../data/quality';
import { AtmosphereFog } from './atmosphere';
import { PostEffects } from './post';
import type { HazeSegment } from './fx/heat-haze';
import type { GradeUniforms } from '../core/photo-grade';
import type { FocusSettings } from './focus-pass';

export interface RenderStats {
  /** 1 フレームの合計（影・シーン・ポストエフェクトのすべての描画） */
  drawCalls: number;
  triangles: number;
  /** 描画ステップ数（シャドウマップ・シーン・ポストエフェクトのパス） */
  steps: number;
}

/**
 * レンダラーへの品質設定の適用と描画をまとめる。
 * core/ と ui/ から Three.js を触らずに済むよう、ここを窓口にする
 */
export class RenderPipeline {
  private maxPixelRatio = 1;
  private post: PostEffects | null = null;
  private exposure = 1;
  /** フォトモード（7-A）の露出の倍率（2^EV） */
  private exposureScale = 1;
  private grade: Readonly<GradeUniforms> | null = null;
  private focus: Readonly<FocusSettings> | null = null;
  private focusAllowed = false;
  private readonly stats: RenderStats = { drawCalls: 0, triangles: 0, steps: 0 };

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    // トーンマッピングはどの画質でも ACES。「低」はレンダラー側（各マテリアルの最後）で、
    // 「中」以上はポストエフェクトの仕上げのパスで掛ける
    renderer.toneMapping = ACESFilmicToneMapping;
    // ポストエフェクトの複数パスを 1 フレームとして数える（render() の最初に手動で reset）
    renderer.info.autoReset = false;
  }

  applyQuality(preset: QualityPreset): void {
    this.maxPixelRatio = preset.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));

    // 実行中に切り替えた場合、既存マテリアルの再コンパイルが必要になる
    if (this.renderer.shadowMap.enabled !== preset.shadows) {
      this.renderer.shadowMap.enabled = preset.shadows;
      this.scene.traverse((obj) => {
        if (isMesh(obj)) markMaterialsDirty(obj);
      });
    }

    // ポストエフェクト（「中」以上）。「低」に切り替えたら解放する
    if (preset.postEffects) {
      this.post ??= new PostEffects(this.renderer, this.scene, this.camera);
      this.post.setBloom(preset.bloom);
      this.post.setExposure(this.exposure * this.exposureScale);
      this.post.setGrade(this.grade);
      this.post.setSize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
    } else if (this.post) {
      this.post.dispose();
      this.post = null;
    }
    if (this.scene.fog instanceof AtmosphereFog) this.scene.fog.setOutputToScreen(!this.post);
    this.focusAllowed = preset.photoFocus;
    this.post?.setFocus(this.focusAllowed ? this.focus : null);

    this.camera.far = preset.drawDistance;
    this.camera.updateProjectionMatrix();
    // 空気遠近とは別に、描画距離の果てを空の色に溶かしきる範囲
    if (this.scene.fog instanceof Fog) {
      this.scene.fog.near = preset.drawDistance * QUALITY_CONFIG.fogNearRatio;
      this.scene.fog.far = preset.drawDistance * QUALITY_CONFIG.fogFarRatio;
    }
  }

  get postEffectsEnabled(): boolean {
    return this.post !== null;
  }

  /** 露出（トーンマッピング前の倍率。大気の明るさから計算した値） */
  setExposure(exposure: number): void {
    this.exposure = exposure;
    const e = exposure * this.exposureScale;
    this.renderer.toneMappingExposure = e;
    this.post?.setExposure(e);
  }

  /**
   * フォトモードの画面の調整（null で上書きなし）。露出はどの画質でも効き、他はポストエフェクト（「中」以上）だけ
   */
  setGrade(g: Readonly<GradeUniforms> | null): void {
    this.grade = g;
    this.exposureScale = g ? g.exposureScale : 1;
    this.setExposure(this.exposure);
    this.post?.setGrade(g);
  }

  /** 被写界深度（null で無し。画質「高」だけ効く） */
  setFocus(f: Readonly<FocusSettings> | null): void {
    this.focus = f;
    this.post?.setFocus(this.focusAllowed ? f : null);
  }

  /** 画面の調整（露出以外）が効くか */
  get gradeAvailable(): boolean {
    return this.post !== null;
  }

  get focusAvailable(): boolean {
    return this.post !== null && this.focusAllowed;
  }

  /** GPU で描ける最大の辺（px） */
  get maxCaptureSide(): number {
    const gl = this.renderer.getContext();
    const dims: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const viewport = dims instanceof Int32Array ? Math.min(dims[0] ?? 0, dims[1] ?? 0) : 4096;
    return Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, viewport);
  }

  /**
   * width × height（px）で 1 回描いて 2D の canvas に写す（フォトモードの保存。HUD は DOM なので入らない）。
   * 描画バッファを一時的にその大きさにし（表示の大きさは変えない）、終わったら戻して描き直す
   */
  capture(width: number, height: number): HTMLCanvasElement {
    const r = this.renderer;
    const canvas = r.domElement;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const ratio = r.getPixelRatio();
    const aspect = this.camera.aspect;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.post?.setMultisample(false);
    this.post?.setSize(width, height, 1);
    this.render();
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const gl = r.getContext();
    out
      .getContext('2d')
      ?.drawImage(canvas, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, 0, width, height);
    r.setPixelRatio(ratio);
    r.setSize(cssW, cssH, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.post?.setMultisample(true);
    this.post?.setSize(cssW, cssH, ratio);
    this.render();
    return out;
  }

  /** 陽炎の屈折（4-4。ポストエフェクトがあるときだけ効く） */
  setHaze(seg: Readonly<HazeSegment>, time: number): void {
    this.post?.setHaze(seg, time);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height);
    this.post?.setSize(width, height, this.renderer.getPixelRatio());
  }

  render(): void {
    const info = this.renderer.info;
    info.reset();
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    const shadowSteps = this.renderer.shadowMap.enabled ? 1 : 0;
    this.stats.steps = shadowSteps + (this.post ? this.post.steps : 1);
  }

  /** 直前の render() の統計。オブジェクトは使い回すので保持しないこと */
  get lastStats(): Readonly<RenderStats> {
    return this.stats;
  }
}

// instanceof だけだと型引数が any になるため、既定の型引数で絞り込む
function isMesh(obj: Object3D): obj is Mesh {
  return obj instanceof Mesh;
}

function markMaterialsDirty(mesh: Mesh): void {
  const material: Material | Material[] = mesh.material;
  for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true;
}

/** GPU 名を取得する（自動品質判定用）。取れなければ null */
export function getGpuRendererName(renderer: WebGLRenderer): string | null {
  try {
    const gl = renderer.getContext();
    // Chrome 等は拡張経由でしか実名を返さない。Firefox は拡張が非推奨で RENDERER が実名
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value: unknown = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
