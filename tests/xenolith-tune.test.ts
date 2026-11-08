// 10-5b: UFO ゼノリスの手応えの表（調整用。ふだんの npm test では回さない）。
// VITE_TUNE=1 VITE_TUNE_ROLE=skilled VITE_TUNE_DIFF=normal VITE_TUNE_PRESET=easy VITE_TUNE_SEEDS=20 npx vitest run tests/xenolith-tune.test.ts
// VITE_TUNE_NOORBS=1 で光の弾なし（足す前の比べ）、VITE_TUNE_DODGE=1 で必ず避ける（遅れ 0.25 秒）
import { describe, it } from 'vitest';
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import { createXenolithWorld, runXenolithBot } from './xenolith-raid-bots';
import type { Kaiju2Role } from './kaiju2-bot-roles';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1';

describe.runIf(on)('10-5b: ゼノリスの手応えの表', () => {
  it('役 × 難易度 × 補助の組', () => {
    const role = (env.VITE_TUNE_ROLE ?? 'skilled') as Kaiju2Role;
    const difficulty = (env.VITE_TUNE_DIFF ?? 'normal') as RaidDifficulty;
    const preset = env.VITE_TUNE_PRESET as AssistPreset | undefined;
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const from = Number(env.VITE_TUNE_FROM ?? '0');
    const dodge = env.VITE_TUNE_DODGE === '1' ? { chance: 1, react: 0.25 } : undefined;
    const world = createXenolithWorld();
    const rows: string[] = [];
    for (let seed = from; seed < from + seeds; seed++) {
      const r = runXenolithBot(
        {
          role,
          seed,
          difficulty,
          ...(preset ? { preset } : {}),
          ...(dodge ? { dodge } : {}),
          noOrbs: env.VITE_TUNE_NOORBS === '1',
          noHullAvoid: env.VITE_TUNE_NOHULL === '1',
        },
        world,
      );
      rows.push(
        JSON.stringify({
          seed,
          status: r.status,
          reason: r.reason,
          seconds: Math.round(r.seconds),
          downs: r.playerDowns,
          by: r.downs,
          body: r.bodyHits,
          attacks: r.attacks,
          hitAttacks: r.hitAttacks,
          kinds: r.attackKinds,
          hitKinds: r.hitKinds,
          taken: r.taken,
          hp: Math.round(r.kaijuHp * 100),
          parts: r.partsBroken,
          gens: r.gensBroken,
          emit: r.emittersBroken,
          warps: r.warps,
          hpLost: r.hpLostAtClear === null ? null : Math.round(r.hpLostAtClear * 100),
          dmg: Math.round(r.damageRatio * 100),
          fire: Math.round(r.fireShare * 100),
          dist: Math.round(r.medianDist),
          calm: Math.round(r.calmShare * 100),
          calmMed: Math.round(r.calmMedian * 10) / 10,
          calmMax: Math.round(r.calmMax * 10) / 10,
          modes: r.modes,
        }),
      );
    }
    console.log(`TUNE ${role} ${difficulty} ${preset ?? '-'}\n${rows.join('\n')}`);
  }, 3_600_000);
});
