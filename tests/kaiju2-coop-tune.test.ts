// 9-6d: ネフィルガの協力の表（調整用。ふだんの npm test では回さない）。
// VITE_TUNE=1 VITE_TUNE_ROLE=skilled VITE_TUNE_DIFF=normal VITE_TUNE_PLAYERS=2 VITE_TUNE_SEEDS=20 npx vitest run tests/kaiju2-coop-tune.test.ts
import { describe, it } from 'vitest';
import { runKaiju2Coop } from './kaiju2-coop-bots';
import type { Kaiju2Role } from './kaiju2-raid-bots';
import type { RaidDifficulty } from '../src/data/raid';

const env = import.meta.env as Record<string, string | undefined>;

describe.runIf(env.VITE_TUNE === '1')('9-6d: ネフィルガの協力の表', () => {
  it('役 × 難易度 × 人数', async () => {
    const role = (env.VITE_TUNE_ROLE ?? 'skilled') as Kaiju2Role;
    const difficulty = (env.VITE_TUNE_DIFF ?? 'normal') as RaidDifficulty;
    const players = Number(env.VITE_TUNE_PLAYERS ?? '1');
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const rows: string[] = [];
    for (let seed = 0; seed < seeds; seed++) {
      const lives = env.VITE_TUNE_LIVES !== '0';
      const r = await runKaiju2Coop({ role, players, seed, difficulty, lives });
      rows.push(
        JSON.stringify({
          seed,
          cleared: r.cleared,
          outcome: r.outcome,
          seconds: r.seconds,
          downs: r.downs,
        }),
      );
    }
    console.log(`TUNE ${role} ${difficulty} ${String(players)}\n${rows.join('\n')}`);
  }, 7_200_000);
});
