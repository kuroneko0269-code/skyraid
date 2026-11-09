// 10-6: ヴォルガスの手応えの表（調整用。ふだんの npm test では回さない。9-6d の表と同じボット tests/kaiju-raid-bots.ts）。
// VITE_TUNE=1 VITE_TUNE_SKILL=skilled VITE_TUNE_PLAYERS=1 VITE_TUNE_SEEDS=20 npx vitest run tests/kaiju-tune.test.ts --disable-console-intercept
// VITE_TUNE_RAM=count で体への衝突を入れる前の判定（通り抜けた回数を数える）、VITE_TUNE_HARD=1 で高難度、VITE_TUNE_LIVES=0 で残機なし
import { describe, it } from 'vitest';
import { runRaidBots } from './kaiju-raid-bots';
import type { RaidBotSkill } from './raid-bot-skills';

const env = import.meta.env as Record<string, string | undefined>;

describe.runIf(env.VITE_TUNE === '1')('10-6: ヴォルガスの手応えの表', () => {
  it('腕前 × 人数', () => {
    const skill = (env.VITE_TUNE_SKILL ?? 'skilled') as RaidBotSkill;
    const players = Number(env.VITE_TUNE_PLAYERS ?? '1');
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const hard = env.VITE_TUNE_HARD === '1';
    const lives = env.VITE_TUNE_LIVES === '0' ? undefined : 3;
    const ram = env.VITE_TUNE_RAM === 'count' ? 'count' : 'on';
    const rows: string[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const r = runRaidBots({ players, seed, maxSeconds: 1200, skill, hard, lives, ram });
      rows.push(
        JSON.stringify({
          seed,
          status: r.killed ? 'success' : 'failed',
          reason: r.killed ? null : r.livesOut ? 'livesOut' : r.cityReached ? 'city' : 'time',
          seconds: Math.round(r.seconds),
          downs: r.playerDowns / players,
          rams: r.ramHits / players,
          ramDowns: r.ramDowns / players,
        }),
      );
    }
    console.log(`TUNE ${skill} ${String(players)}\n${rows.join('\n')}`);
  }, 3_600_000);
});
