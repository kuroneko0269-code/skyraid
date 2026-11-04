// 9-5d 補助の組（`--presets`）: 「模擬の人」「初心者役」が、補助の組（かんたん / ふつう / むずかしい。src/data/assist.ts の
// ASSIST_PRESET_VALUES）ごとに練習場の動く的・M1・M2 を飛ぶ。スロットルは実機の人と同じく最大のまま（9-5b と同じ）。
// 自動射撃 OFF の組はボットの撃ち方（役の腕前: 機首から決まった角度の内で撃つ = GUN ボタンの人）で撃つ。
// 組の名前の順（かんたん < ふつう < むずかしい）が命中率・撃墜までの時間の順になっているかを見る
import {
  AIM_ASSIST_LEVEL_SPECS,
  ASSIST_PRESET_VALUES,
  ASSIST_PRESETS,
} from '../../src/data/assist';
import { PRACTICE_CONFIG } from '../../src/data/practice';
import { findRole, flyMission, type FlightTweaks } from './flight';
import { DEFAULT_HANDS } from './hands';
import { TimedAnalyzer } from './kill-timer';
import type { ControlAnalyzer } from './metrics';
import { median, Totals } from './totals';

const PRESET_LABELS = { easy: 'かんたん', normal: 'ふつう', hard: 'むずかしい' } as const;
const ROLE_LABELS: Readonly<Record<string, string>> = { human: '模擬の人', beginner: '初心者役' };

export const PRESET_COURSES = ['practice:moving', 'training', 'first-sortie'] as const;

function tweaksOf(preset: (typeof ASSIST_PRESETS)[number], role: string): FlightTweaks {
  const v = ASSIST_PRESET_VALUES[preset];
  return {
    // 模擬の人はタッチの初期値の手（方向へ倒す・カーブ 1.5）。初心者役は人の手なし（9-1 の役のまま）
    ...(role === 'human' ? { direct: true, hands: { ...DEFAULT_HANDS, curve: 1.5 } } : {}),
    assist: AIM_ASSIST_LEVEL_SPECS[v.aimAssist],
    autoFireScale: v.autoFire ? 1 : 0,
    speedMatch: v.speedMatch,
    throttle: 'max',
  };
}

const pct = (n: number, d: number): string => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : '-');

export const PRESET_HEADER = [
  '役',
  '課題',
  '組',
  '成功',
  '命中率',
  '撃墜',
  '1 機あたりの秒',
  '撃墜まで秒（2km 内から・中央値）',
  '追い越し/分',
  '射程外で撃った',
];

/** 役 × 課題 × 組の表（Markdown の行） */
export function runPresets(
  seeds: number,
  progress: (line: string) => void,
  roles: readonly string[] = ['human', 'beginner'],
  courses: readonly string[] = PRESET_COURSES,
): string {
  const rows = [PRESET_HEADER.join(' | '), PRESET_HEADER.map(() => '---').join(' | ')];
  for (const roleId of roles) {
    const role = findRole(roleId);
    for (const course of courses)
      for (const preset of ASSIST_PRESETS) {
        const tweaks = tweaksOf(preset, roleId);
        const total = new Totals();
        let ok = 0;
        let seconds = 0;
        for (let seed = 1; seed <= seeds; seed++) {
          const box: { a: ControlAnalyzer | null } = { a: null };
          const r = flyMission(course, seed, role, {
            tweaks,
            analyzer: (play) =>
              (box.a = new TimedAnalyzer(play, { aspect: 2.16, assist: tweaks.assist })),
          });
          if (r.status === 'success') ok++;
          seconds += course === 'practice:moving' ? PRACTICE_CONFIG.durations.moving : r.seconds;
          if (box.a) total.merge(box.a.finish());
        }
        const practice = course.startsWith('practice:');
        rows.push(
          [
            ROLE_LABELS[roleId] ?? roleId,
            course,
            PRESET_LABELS[preset],
            practice ? '-' : `${ok}/${seeds}`,
            pct(total.hits, total.shots),
            String(total.kills),
            total.kills > 0 ? (seconds / total.kills).toFixed(1) : '-',
            total.killSeconds.length > 0 ? median(total.killSeconds).toFixed(1) : '-',
            (total.overtakes / Math.max(1e-9, total.aliveMinutes)).toFixed(1),
            pct(total.fire.outOfRange + total.fire.noTarget, total.fireSteps),
          ].join(' | '),
        );
        progress(rows[rows.length - 1] ?? '');
      }
  }
  return rows.join('\n');
}
