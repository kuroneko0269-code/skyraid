// 9-7: キャンペーン M6〜M8 の調整の表（ふだんの npm test では回さない）。役 × 補助の組で、成功・所要時間・撃墜を数える。
// VITE_TUNE=1 VITE_TUNE_MISSION=finale VITE_TUNE_ROLES=skilled,average,beginner,human VITE_TUNE_PRESETS=easy,normal \
//   VITE_TUNE_SEEDS=20 [VITE_TUNE_OUT=<追記するファイル>] npx vitest run tests/campaign-tune.test.ts
import { appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { AssistPreset } from '../src/data/assist';
import { runCampaignBot } from './campaign-bots';
import type { Kaiju2Role } from './kaiju2-bot-roles';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1' && env.VITE_TUNE_MISSION !== undefined;

const list = (v: string | undefined, d: string): string[] => (v ?? d).split(',');

describe.runIf(on)('9-7: キャンペーン M6〜M8 の調整の表', () => {
  it('役 × 補助の組', () => {
    const mission = env.VITE_TUNE_MISSION ?? 'finale';
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const rows: string[] = [];
    for (const role of list(env.VITE_TUNE_ROLES, 'skilled,average,beginner,human'))
      for (const preset of list(env.VITE_TUNE_PRESETS, 'easy,normal')) {
        const times: number[] = [];
        const reasons: Record<string, number> = {};
        let ok = 0;
        let downs = 0;
        let damage = 0;
        for (let seed = 0; seed < seeds; seed++) {
          const r = runCampaignBot({
            missionId: mission,
            role: role as Kaiju2Role,
            preset: preset as AssistPreset,
            seed,
          });
          if (r.status === 'success') {
            ok++;
            times.push(r.seconds / 60);
          } else reasons[r.reason ?? '?'] = (reasons[r.reason ?? '?'] ?? 0) + 1;
          if (r.shotDown) downs++;
          damage += r.damageRatio;
        }
        times.sort((a, b) => a - b);
        const med = times.length ? (times[Math.floor((times.length - 1) / 2)] ?? 0) : NaN;
        rows.push(
          [
            mission,
            role,
            preset,
            `${ok}/${seeds}`,
            `${med.toFixed(2)} (${(times[0] ?? NaN).toFixed(2)}–${(times.at(-1) ?? NaN).toFixed(2)})`,
            `${downs}/${seeds}`,
            `${Math.round((100 * damage) / seeds)}%`,
            JSON.stringify(reasons),
          ].join(' | '),
        );
      }
    const text = rows.join('\n');
    console.log(`TUNE\n${text}`);
    if (env.VITE_TUNE_OUT) appendFileSync(env.VITE_TUNE_OUT, `${text}\n`);
  }, 3_600_000);
});
