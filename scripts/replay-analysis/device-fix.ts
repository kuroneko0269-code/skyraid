// 9-5b 実機確認の修正の効果（`--device-fix`）: 「模擬の人」（9-2〜9-4 の初期値: 方向へ倒す・カーブ 1.5・狙いの補助 標準・自動射撃 ON）が
// 実機の人と同じくスロットルを最大のまま飛ぶとき、練習場の動く的・M1・M2 で、速度合わせの有無を比べる。
// 変更前（v1.0.5）の値は、v1.0.5 のコミットを git worktree で取り出し、このファイルと flight.ts・metrics.ts・totals.ts・
// kill-timer.ts・src/missions/practice/overtake.ts を写して走らせる（速度合わせは無いので before の行だけ）
import { AIM_ASSIST_LEVEL_SPECS } from '../../src/data/assist';
import { findRole, flyMission, type FlightTweaks } from './flight';
import { DEFAULT_HANDS } from './hands';
import { TimedAnalyzer } from './kill-timer';
import type { ControlAnalyzer } from './metrics';
import { median, Totals } from './totals';

const BASE: FlightTweaks = {
  direct: true,
  hands: { ...DEFAULT_HANDS, curve: 1.5 },
  assist: AIM_ASSIST_LEVEL_SPECS.normal,
  autoFireScale: 1,
  throttle: 'max',
};

export const DEVICE_FIX_ROWS: readonly { id: string; label: string; tweaks: FlightTweaks }[] = [
  { id: 'before', label: '速度合わせなし（スロットル最大のまま）', tweaks: BASE },
  { id: 'after', label: '速度合わせ ON', tweaks: { ...BASE, speedMatch: true } },
];

export const DEVICE_FIX_COURSES = ['practice:moving', 'training', 'first-sortie'] as const;

const pct = (n: number, d: number): string => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : '-');

export function deviceFixRow(t: Totals): string[] {
  return [
    pct(t.hits, t.shots),
    String(t.kills),
    t.killSeconds.length > 0 ? median(t.killSeconds).toFixed(1) : '-',
    pct(t.angleBins[5] ?? 0, t.engagedSteps),
    pct(t.offScreenSteps, t.engagedSteps),
    (t.overtakes / Math.max(1e-9, t.aliveMinutes)).toFixed(1),
    pct(t.fire.outOfRange + t.fire.noTarget, t.fireSteps),
    `${(t.verticalFastRoll / 60).toFixed(1)}・${t.verticalRollMax.toFixed(0)}`,
  ];
}

export const DEVICE_FIX_HEADER = [
  '命中率',
  '撃墜',
  '撃墜まで秒（中央値）',
  '的が後ろ（>90°）',
  '画面外',
  '追い越し/分',
  '射程外で撃った',
  '真上・真下の横回転 >120°/秒（秒）・最大',
];

/** コースごと × 行（before / after）の表 */
export function runDeviceFix(
  seeds: number,
  progress: (line: string) => void,
  only: readonly string[] = [],
  courses: readonly string[] = DEVICE_FIX_COURSES,
): string {
  const role = findRole('human');
  const rows = [['コース', '行', '成功', ...DEVICE_FIX_HEADER].join(' | ')];
  for (const course of courses)
    for (const ex of DEVICE_FIX_ROWS) {
      if (only.length > 0 && !only.includes(ex.id)) continue;
      const total = new Totals();
      let ok = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const box: { a: ControlAnalyzer | null } = { a: null };
        const r = flyMission(course, seed, role, {
          tweaks: ex.tweaks,
          analyzer: (play) =>
            (box.a = new TimedAnalyzer(play, { aspect: 2.16, assist: ex.tweaks.assist })),
        });
        if (r.status === 'success') ok++;
        if (box.a) total.merge(box.a.finish());
      }
      rows.push([course, ex.label, `${ok}/${seeds}`, ...deviceFixRow(total)].join(' | '));
      progress(rows[rows.length - 1] ?? '');
    }
  return rows.join('\n');
}
