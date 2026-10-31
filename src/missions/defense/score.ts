// 防衛戦（7-2）のスコアと報酬（Three.js 非依存）。
// 報酬: クリアした波 × 300 CR + 完全クリアで 2000 CR + 施設（司令部以外の 4 つ）が全部残っていれば +1000。
// 失敗はクリアした波 × 300 だけ
import { DEFENSE_CONFIG, FACILITY_KINDS } from '../../data/defense';

export type DefenseOutcome = 'cleared' | 'failed';

export interface DefenseScore {
  readonly outcome: DefenseOutcome;
  /** クリアした波の数（0〜10） */
  readonly wavesCleared: number;
  readonly hqHp: number;
  readonly hqMaxHp: number;
  /** 残った施設（司令部以外）の数と全体の数 */
  readonly facilitiesAlive: number;
  readonly facilitiesTotal: number;
  /** 撃墜数（ソロは自分、協力は全員の合計） */
  readonly kills: number;
}

/** 司令部以外の施設の数 */
export const FACILITY_TOTAL = FACILITY_KINDS.length - 1;

export interface DefenseRewardBreakdown {
  readonly waves: number;
  readonly fullClear: number;
  readonly facilities: number;
  readonly total: number;
}

export function defenseReward(
  s: Pick<DefenseScore, 'outcome' | 'wavesCleared' | 'facilitiesAlive' | 'facilitiesTotal'>,
): DefenseRewardBreakdown {
  const r = DEFENSE_CONFIG.reward;
  const waves = Math.max(0, s.wavesCleared) * r.perWave;
  const cleared = s.outcome === 'cleared';
  const fullClear = cleared ? r.fullClear : 0;
  const facilities = cleared && s.facilitiesAlive >= s.facilitiesTotal ? r.allFacilities : 0;
  return { waves, fullClear, facilities, total: waves + fullClear + facilities };
}
