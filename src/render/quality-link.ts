// 画質設定とレンダラー・ワールドの配線（初期判定・切り替え・自動ダウングレード・露出）
import type { WebGLRenderer } from 'three';
import { FpsWatch } from '../core/fps-watch';
import {
  QualitySettings,
  isTouchDevice,
  resolveInitialQuality,
  type StorageLike,
} from '../core/settings';
import { createQualitySelect } from '../ui/quality-select';
import { getGpuRendererName, type RenderPipeline } from './pipeline';
import type { World } from './scene';

export class QualityLink {
  readonly settings: QualitySettings;
  // 自動ダウングレード: 飛行開始から 5 秒間の平均 fps が 30 未満なら一段下げる（手動設定があれば行わない）
  private readonly watch = new FpsWatch();

  constructor(
    renderer: WebGLRenderer,
    pipeline: RenderPipeline,
    world: World,
    storage: StorageLike | null,
  ) {
    // 保存された手動設定 > 自動ダウングレードの保存値 > 自動判定（ソフトウェア GPU は low、他は medium）
    this.settings = new QualitySettings(
      storage,
      resolveInitialQuality(storage, {
        touch: isTouchDevice(),
        gpuRenderer: getGpuRendererName(renderer),
      }),
    );
    pipeline.applyQuality(this.settings.preset);
    world.applyQuality(this.settings.preset);
    this.settings.onChange((_level, preset) => {
      pipeline.applyQuality(preset);
      world.applyQuality(preset);
    });
    // 露出は大気の明るさから計算する（太陽の高さで変わる）
    pipeline.setExposure(world.exposure);
    world.atmosphere.onChange(() => {
      pipeline.setExposure(world.exposure);
    });
  }

  /** ポーズメニューの設定に画質のセレクトを置く。自動ダウングレードで変わったときも表示を合わせる */
  createSelect(parent: HTMLElement): void {
    const select = createQualitySelect(parent, this.settings.level, (level) => {
      this.settings.set(level);
    });
    this.settings.onChange((level) => {
      select.value = level;
    });
  }

  /** 飛行開始のたびに fps の測定を始める */
  startWatch(): void {
    if (!this.settings.hasManual) this.watch.start();
  }

  /** 飛行中の描画フレームごとに呼ぶ。自動ダウングレードしたら true */
  recordFlightFrame(frameSeconds: number): boolean {
    return this.watch.record(frameSeconds) && this.settings.downgrade() !== null;
  }
}
