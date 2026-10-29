import {
  Fog,
  Mesh,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { QUALITY_CONFIG, type QualityPreset } from '../data/quality';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
}

/**
 * レンダラーへの品質設定の適用と描画をまとめる。
 * core/ と ui/ から Three.js を触らずに済むよう、ここを窓口にする
 */
export class RenderPipeline {
  private maxPixelRatio = 1;
  private postEffects = false;
  private readonly stats: RenderStats = { drawCalls: 0, triangles: 0 };

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {}

  applyQuality(preset: QualityPreset): void {
    this.maxPixelRatio = preset.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));

    // シャドウの受け口。影を落とすライト・メッシュの設定はフェーズ4で行う。
    // 実行中に切り替えた場合、既存マテリアルの再コンパイルが必要になる
    if (this.renderer.shadowMap.enabled !== preset.shadows) {
      this.renderer.shadowMap.enabled = preset.shadows;
      this.scene.traverse((obj) => {
        if (isMesh(obj)) markMaterialsDirty(obj);
      });
    }

    // ポストエフェクトの受け口。本体（ブルーム等）はフェーズ4で render() 内に足す
    this.postEffects = preset.postEffects;

    this.camera.far = preset.drawDistance;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof Fog) {
      this.scene.fog.near = preset.drawDistance * QUALITY_CONFIG.fogNearRatio;
      this.scene.fog.far = preset.drawDistance * QUALITY_CONFIG.fogFarRatio;
    }
  }

  get postEffectsEnabled(): boolean {
    return this.postEffects;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height);
  }

  render(): void {
    // TODO(フェーズ4): this.postEffects が true なら EffectComposer 経由で描画する
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
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
