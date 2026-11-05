// 9-6d: ネフィルガの手応えの表（調整用。ふだんの npm test では回さない）。
// VITE_TUNE=1 VITE_TUNE_ROLE=skilled VITE_TUNE_DIFF=normal VITE_TUNE_SEEDS=20 npx vitest run tests/kaiju2-tune.test.ts
import { describe, it } from 'vitest';
import { createKaiju2World, runKaiju2Bot, type Kaiju2Role } from './kaiju2-raid-bots';
import type { RaidDifficulty } from '../src/data/raid';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1';

describe.runIf(on)('9-6d: ネフィルガの手応えの表', () => {
  it('役 × 難易度', () => {
    const role = (env.VITE_TUNE_ROLE ?? 'skilled') as Kaiju2Role;
    const difficulty = (env.VITE_TUNE_DIFF ?? 'normal') as RaidDifficulty;
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const world = createKaiju2World();
    const rows: string[] = [];
    for (let seed = 0; seed < seeds; seed++) {
      const r = runKaiju2Bot({ role, seed, difficulty }, world);
      rows.push(
        JSON.stringify({
          seed,
          status: r.status,
          reason: r.reason,
          seconds: Math.round(r.seconds),
          downs: r.playerDowns,
          attackDowns: r.attackDowns,
          kinds: r.attackKinds,
          states: Object.fromEntries(
            Object.entries(r.stateSeconds).map(([k, v]) => [k, Math.round(v)]),
          ),
          attacks: r.attacks,
          hitAttacks: r.hitAttacks,
          hpLost: r.hpLostAtClear === null ? null : Math.round(r.hpLostAtClear * 100),
          dmg: Math.round(r.damageRatio * 100),
          hits: r.hitsTaken,
          parts: r.partsBroken,
          maxHit: Math.round(r.maxHit),
        }),
      );
    }
    console.log(`TUNE ${role} ${difficulty}\n${rows.join('\n')}`);
  }, 3_600_000);
});
