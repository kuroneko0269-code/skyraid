// 10-3b: 白鯨アルビオンの協力の表（調整用。ふだんの npm test では回さない）。
// VITE_TUNE=1 VITE_TUNE_ROLE=skilled VITE_TUNE_DIFF=normal VITE_TUNE_PLAYERS=2 VITE_TUNE_SEEDS=10 npx vitest run tests/albion-coop-tune.test.ts
import { describe, it } from 'vitest';
import type { RaidDifficulty } from '../src/data/raid';
import { runAlbionCoop } from './albion-coop-bots';
import type { Kaiju2Role } from './kaiju2-bot-roles';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1';

describe.runIf(on)('10-3b: アルビオンの協力の表', () => {
  it('役 × 人数', async () => {
    const role = (env.VITE_TUNE_ROLE ?? 'skilled') as Kaiju2Role;
    const difficulty = (env.VITE_TUNE_DIFF ?? 'normal') as RaidDifficulty;
    const players = Number(env.VITE_TUNE_PLAYERS ?? '1');
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '10');
    const lives = env.VITE_TUNE_LIVES !== '0';
    // 役の割り当て（例: minion,body,body,body）
    const jobs = env.VITE_TUNE_JOBS?.split(',') as ('auto' | 'minion' | 'body')[] | undefined;
    const rows: string[] = [];
    for (let seed = 0; seed < seeds; seed++) {
      const r = await runAlbionCoop({
        role,
        players,
        seed,
        difficulty,
        lives,
        ...(jobs ? { jobs } : {}),
      });
      rows.push(
        JSON.stringify({
          seed,
          cleared: r.cleared,
          outcome: r.outcome,
          seconds: Math.round(r.seconds),
          downs: r.downs,
          rams: r.rams,
          share: r.minionShare.map((v) => Math.round(v * 100)),
        }),
      );
    }
    console.log(`COOP ${role} ${difficulty} ${String(players)}\n${rows.join('\n')}`);
  }, 7_200_000);
});
