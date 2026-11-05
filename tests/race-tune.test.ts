// 9-8: リングレースの表（ふだんの npm test では回さない）。方向へ倒す方式のボットで全コース × 4 機種（人の手なし = 初心者役）と、
// 模擬の人（9-1 の人の手: 反応の遅れ 0.2 秒・指のぶれ 0.12・カーブ 1.5。Kestrel）の完走・タイム・通り損ね。
// 補助の組（かんたん / ふつう）はレースでは効かない（武器・対象が無い）ので、組の値で同じ結果になる
// VITE_TUNE=1 VITE_TUNE_RACE=1 VITE_TUNE_SEEDS=16 [VITE_TUNE_OUT=<追記するファイル>] npx vitest run tests/race-tune.test.ts
import { appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { DEFAULT_HANDS, Hands } from '../scripts/replay-analysis/hands';
import { createRandom } from '../src/core/random';
import { COURSES } from '../src/data/courses';
import { runDirectRace } from './direct-race-bots';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1' && env.VITE_TUNE_RACE === '1';
const AIRCRAFT = ['kestrel', 'swift', 'bastion', 'vector'];

const missedList = (status: readonly string[]): string =>
  status
    .map((s, i) => (s === 'missed' ? String(i + 1) : ''))
    .filter(Boolean)
    .join('・') || 'なし';

describe.runIf(on)('9-8: リングレースの表', () => {
  it('4 機種（初心者役 = 人の手なし）と模擬の人', () => {
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '16');
    const rows: string[] = [];
    for (const c of COURSES) {
      const cells = AIRCRAFT.map((id) => {
        const r = runDirectRace(c, id);
        const time = r.result?.outcome === 'finished' ? r.result.time.toFixed(1) : '時間切れ';
        return `${time} 秒・通り損ね ${missedList(r.sim.race.status)}・墜落 ${r.crashes}`;
      });
      rows.push(`bots | ${c.id} | ${cells.join(' | ')}`);
    }
    for (const c of COURSES) {
      const times: number[] = [];
      let missed = 0;
      let crashes = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const hands = new Hands({ ...DEFAULT_HANDS, curve: 1.5 }, createRandom(seed));
        const r = runDirectRace(c, 'kestrel', hands);
        if (r.result?.outcome === 'finished') times.push(r.result.time);
        missed += r.sim.race.missed;
        crashes += r.crashes;
      }
      times.sort((a, b) => a - b);
      const med = times.length ? (times[Math.floor((times.length - 1) / 2)] ?? NaN) : NaN;
      rows.push(
        [
          'human',
          c.id,
          `${times.length}/${seeds}`,
          `${med.toFixed(1)} (${(times[0] ?? NaN).toFixed(1)}–${(times.at(-1) ?? NaN).toFixed(1)})`,
          (missed / seeds).toFixed(2),
          String(crashes),
          String(c.goldTimeSeconds),
        ].join(' | '),
      );
    }
    const text = rows.join('\n');
    console.log(`TUNE\n${text}`);
    if (env.VITE_TUNE_OUT) appendFileSync(env.VITE_TUNE_OUT, `${text}\n`);
  }, 3_600_000);
});
