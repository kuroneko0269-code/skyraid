// 飛行中の一言（9-5c。Three.js・DOM 非依存）: 練習場（とチュートリアルの章）の狙いの指標（aim-stats.ts）の数えの増え方から、
// 「追い越した直後」「射程外で撃ち続けた」「的を見失った」を見つけて 1 つ返す。判定（リプレイ）には入れず、表示の側が毎フレーム呼ぶ
import { PRACTICE_TIPS_CONFIG } from '../../data/practice-advice';
import { inverseRotateVec3, vec3, type Quat, type Vec3 } from '../../flight/math';

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

  /**
   * now は飛行の経過（秒）。出す一言があれば返す（間を空けるので、同じ一言は続けて出ない）。
   * allow（9-5d）: 出してよい一言（補助の組で自動に任せている物は出さない）。出さない一言は次の候補に譲る
   */
  update(
    now: number,
    c: Readonly<TipCounts>,
    allow: (tip: FlightTip) => boolean = () => true,
  ): FlightTip | null {
    const prev = this.last;
    const dt = Math.max(0, now - this.lastNow);
    this.last = { ...c };
    this.lastNow = now;
    if (!prev) return null;
    const cfg = PRACTICE_TIPS_CONFIG;
    let tip: FlightTip | null = null;
    if (c.overtakes > prev.overtakes && allow('overtake')) tip = 'overtake';
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
      if (allow('offRange')) tip = 'offRange';
      this.offRange = 0;
    }
    // 見失い: 対象がいて、画面の外の数えだけが増え続けている
    const engaged = c.engagedSteps - prev.engagedSteps;
    const off = c.offScreenSteps - prev.offScreenSteps;
    if (engaged > 0 && off >= engaged) this.lost += engaged * STEP;
    else if (engaged > 0) this.lost = 0;
    if (!tip && this.lost >= cfg.lostSeconds) {
      if (allow('lost')) tip = 'lost';
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

/** 一言を出すときの設定（その回のタッチの補助）。キーボード・パッドは自動の補助が無いので touch: false */
export interface TipAssist {
  readonly touch: boolean;
  readonly autoFire: boolean;
  readonly speedMatch: boolean;
}

/**
 * 9-5d: 手動の要素のある一言だけ出す。追い越しは速度合わせ OFF（キーボード・パッドも）、射程外は自動射撃 OFF のときだけ
 * （自動の補助が効いていると起きにくく、起きても直す手が無い）。見失いはどの組でも出す（向きを添える）
 */
export function tipAllowed(tip: FlightTip, a: Readonly<TipAssist>): boolean {
  if (tip === 'overtake') return !(a.touch && a.speedMatch);
  if (tip === 'offRange') return !(a.touch && a.autoFire);
  return true;
}

export type TipSide = 'left' | 'right' | 'up' | 'down';

export interface TipDirection {
  /** 曲がる向き（機体から見て。上下は機首の上げ下げ） */
  side: TipSide;
  /** 機首と的のなす角（度） */
  angleDeg: number;
  /** 画面の上から時計回りの向き（度。HUD 補助の矢印と同じ） */
  arrowDeg: number;
}

const local = vec3();
const DEG = 180 / Math.PI;
/** 上・下とみなす幅（画面の上 / 下から ±この角度）。それより横なら左右 */
const VERTICAL_DEG = 35;

/** 見失った的の向き（9-5d: 「見失いました」に添える）。的が同じ位置なら null */
export function tipDirection(
  out: TipDirection,
  orientation: Readonly<Quat>,
  from: Readonly<Vec3>,
  to: Readonly<Vec3>,
): TipDirection | null {
  local.x = to.x - from.x;
  local.y = to.y - from.y;
  local.z = to.z - from.z;
  if (Math.hypot(local.x, local.y, local.z) < 1e-6) return null;
  inverseRotateVec3(local, orientation, local);
  out.angleDeg = Math.atan2(Math.hypot(local.x, local.y), -local.z) * DEG;
  out.arrowDeg = Math.atan2(local.x, local.y) * DEG;
  const a = Math.abs(out.arrowDeg);
  out.side =
    a <= VERTICAL_DEG
      ? 'up'
      : a >= 180 - VERTICAL_DEG
        ? 'down'
        : out.arrowDeg > 0
          ? 'right'
          : 'left';
  return out;
}
