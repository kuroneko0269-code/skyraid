// 飛行中の一言（9-5c。Three.js・DOM 非依存）: 練習場（とチュートリアルの章）の狙いの指標（aim-stats.ts）の数えの増え方から、
// 「追い越した直後」「射程外で撃ち続けた」「的を見失った」を見つけて 1 つ返す。判定（リプレイ）には入れず、表示の側が毎フレーム呼ぶ
import { PRACTICE_TIPS_CONFIG } from '../../data/practice-advice';

export const FLIGHT_TIPS = ['overtake', 'offRange', 'lost'] as const;
export type FlightTip = (typeof FLIGHT_TIPS)[number];

/** 指標の数え（AimStatsTotals の一部。ステップ数） */
export interface TipCounts {
  readonly overtakes: number;
  readonly fireOutOfRange: number;
  readonly offScreenSteps: number;
  /** 選んだ対象がいたステップ（画面の外の数えが止まっているのが「見えている」か「対象なし」かを分ける） */
  readonly engagedSteps: number;
}

const STEP = 1 / 60;

export class FlightTips {
  private last: TipCounts | null = null;
  private lastNow = 0;
  /** 射程外で撃ち続けている秒数（途切れて quietSeconds たつと 0 に戻す） */
  private offRange = 0;
  private offRangeQuiet = 0;
  /** 対象が画面の外にい続けている秒数 */
  private lost = 0;
  private readonly lastShown = new Map<FlightTip, number>();
  private lastAny = -Infinity;

  /** 始め直す（新しい回・章） */
  reset(): void {
    this.last = null;
    this.offRange = this.offRangeQuiet = this.lost = 0;
    this.lastShown.clear();
    this.lastAny = -Infinity;
  }

  /** now は飛行の経過（秒）。出す一言があれば返す（間を空けるので、同じ一言は続けて出ない） */
  update(now: number, c: Readonly<TipCounts>): FlightTip | null {
    const prev = this.last;
    const dt = Math.max(0, now - this.lastNow);
    this.last = { ...c };
    this.lastNow = now;
    if (!prev) return null;
    const cfg = PRACTICE_TIPS_CONFIG;
    let tip: FlightTip | null = null;
    if (c.overtakes > prev.overtakes) tip = 'overtake';
    // 射程外の射撃: 増えた分（ステップ）を秒にして溜める
    const outSteps = c.fireOutOfRange - prev.fireOutOfRange;
    if (outSteps > 0) {
      this.offRange += outSteps * STEP;
      this.offRangeQuiet = 0;
    } else {
      this.offRangeQuiet += dt;
      if (this.offRangeQuiet >= cfg.offRangeQuietSeconds) this.offRange = 0;
    }
    if (!tip && this.offRange >= cfg.offRangeSeconds) {
      tip = 'offRange';
      this.offRange = 0;
    }
    // 見失い: 対象がいて、画面の外の数えだけが増え続けている
    const engaged = c.engagedSteps - prev.engagedSteps;
    const off = c.offScreenSteps - prev.offScreenSteps;
    if (engaged > 0 && off >= engaged) this.lost += engaged * STEP;
    else if (engaged > 0) this.lost = 0;
    if (!tip && this.lost >= cfg.lostSeconds) {
      tip = 'lost';
      this.lost = 0;
    }
    if (!tip) return null;
    const shown = this.lastShown.get(tip) ?? -Infinity;
    if (now - shown < cfg.sameTipSeconds || now - this.lastAny < cfg.anyTipSeconds) return null;
    this.lastShown.set(tip, now);
    this.lastAny = now;
    return tip;
  }
}
