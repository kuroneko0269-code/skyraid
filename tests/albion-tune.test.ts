// 10-3b: 白鯨アルビオンの手応えの表（調整用。ふだんの npm test では回さない）。
// VITE_TUNE=1 VITE_TUNE_ROLE=skilled VITE_TUNE_DIFF=normal VITE_TUNE_PRESET=easy VITE_TUNE_SEEDS=20 npx vitest run tests/albion-tune.test.ts
import { describe, it } from 'vitest';
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import { createAlbionWorld, runAlbionBot } from './albion-raid-bots';
import type { Kaiju2Role } from './kaiju2-bot-roles';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1';

describe.runIf(on)('10-3b: アルビオンの手応えの表', () => {
  it('役 × 難易度 × 補助の組', () => {
    const role = (env.VITE_TUNE_ROLE ?? 'skilled') as Kaiju2Role;
    const difficulty = (env.VITE_TUNE_DIFF ?? 'normal') as RaidDifficulty;
    const preset = env.VITE_TUNE_PRESET as AssistPreset | undefined;
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const from = Number(env.VITE_TUNE_FROM ?? '0');
    const world = createAlbionWorld();
    const rows: string[] = [];
    for (let seed = from; seed < from + seeds; seed++) {
      const r = runAlbionBot({ role, seed, difficulty, ...(preset ? { preset } : {}) }, world);
      rows.push(
        JSON.stringify({
          seed,
          status: r.status,
          reason: r.reason,
          seconds: Math.round(r.seconds),
          downs: r.playerDowns,
          attackDowns: r.attackDowns,
          ramDowns: r.ramDowns,
          attacks: r.attacks,
          hitAttacks: r.hitAttacks,
          rams: r.rams,
          hp: Math.round(r.kaijuHp * 100),
          partHits: r.partHits,
          kills: r.minionKills,
          kinds: r.attackKinds,
          taken: r.taken,
          hpLost: r.hpLostAtClear === null ? null : Math.round(r.hpLostAtClear * 100),
          dmg: Math.round(r.damageRatio * 100),
          parts: r.partsBroken,
          nests: r.nestsBroken,
          maxHit: Math.round(r.maxHit),
        }),
      );
    }
    console.log(`TUNE ${role} ${difficulty} ${preset ?? '-'}\n${rows.join('\n')}`);
  }, 3_600_000);
});
