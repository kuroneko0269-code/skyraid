// 振動（4-11。操作設定）: Vibration API で被弾・ミサイル発射・撃墜を短く知らせる。
// Android のブラウザだけ（iOS の Safari は Vibration API を持たない。PC の Chrome は関数はあるが振動しない）
import { CONTROL_SETTINGS } from '../data/controls';

export type VibrationKind = keyof typeof CONTROL_SETTINGS.vibration;

/** navigator のうち使う部分（テストでは偽物を渡す） */
export interface VibrationNavigator {
  readonly userAgent: string;
  vibrate?: (pattern: number) => boolean;
}

/** この端末で振動できるか（Android で Vibration API がある） */
export function vibrationSupported(nav: VibrationNavigator | undefined): boolean {
  return !!nav && typeof nav.vibrate === 'function' && /Android/i.test(nav.userAgent);
}

export class Vibrator {
  /** 設定の ON/OFF */
  enabled = false;
  readonly supported: boolean;

  constructor(private readonly nav: VibrationNavigator | undefined) {
    this.supported = vibrationSupported(nav);
  }

  pulse(kind: VibrationKind): void {
    if (!this.enabled || !this.supported) return;
    try {
      this.nav?.vibrate?.(CONTROL_SETTINGS.vibration[kind]);
    } catch {
      // ユーザー操作の前などで拒否されても無視
    }
  }
}
