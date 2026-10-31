// フォトモード（7-A）の天候・時刻の一時的な上書き（Three.js 非依存）: 入ったときの天候を覚え、
// プリセット（7-5）・時刻を補間なしで変え、元に戻す / 出るときに入る前の状態（補間の途中・時間の進行も）へ戻す
import type { WeatherDirector, WeatherParams } from './weather-state';

/** WeatherDirector の状態の写し（フォトモードの上書きと復元） */
export interface WeatherSnapshot {
  readonly preset: string;
  readonly flowing: boolean;
  readonly current: WeatherParams;
  readonly from: WeatherParams;
  readonly to: WeatherParams;
  readonly elapsed: number;
  readonly duration: number;
}

export class WeatherOverride {
  private saved: WeatherSnapshot | null = null;
  /** 上書きしたプリセット（null は元の天候のまま） */
  private presetId: string | null = null;

  constructor(private readonly director: WeatherDirector) {}

  get active(): boolean {
    return this.saved !== null;
  }

  /** 上書き中のプリセット（元のままなら null） */
  get preset(): string | null {
    return this.presetId;
  }

  get hour(): number {
    return this.director.current.hour;
  }

  /** 入る: 今の天候を覚え、時間の進行を止める */
  begin(): void {
    if (this.saved) return;
    this.saved = this.director.snapshot();
    this.presetId = null;
    this.director.setTimeFlow(false);
  }

  setPreset(id: string): void {
    if (!this.saved) return;
    this.director.set(id, true);
    this.presetId = this.director.preset;
  }

  setHour(hour: number): void {
    if (!this.saved) return;
    this.director.setHour(hour);
  }

  /** 元の天候に戻す（上書きは続ける） */
  revert(): void {
    if (!this.saved) return;
    this.director.restore(this.saved);
    this.director.setTimeFlow(false);
    this.presetId = null;
  }

  /** 出る: 入る前の状態へ（時間の進行も） */
  end(): void {
    if (!this.saved) return;
    this.director.restore(this.saved);
    this.saved = null;
    this.presetId = null;
  }
}
