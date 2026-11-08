// 10-4b: メカ怪獣ゴウライの手応えの表（調整用。ふだんの npm test では回さない）。
// VITE_TUNE=1 VITE_TUNE_ROLE=skilled VITE_TUNE_DIFF=normal VITE_TUNE_PRESET=easy VITE_TUNE_SEEDS=20 npx vitest run tests/gourai-tune.test.ts
import { describe, it } from 'vitest';
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import { createGouraiWorld, runGouraiBot } from './gourai-raid-bots';
import type { Kaiju2Role } from './kaiju2-bot-roles';

const env = import.meta.env as Record<string, string | undefined>;
const on = env.VITE_TUNE === '1';

describe.runIf(on)('10-4b: ゴウライの手応えの表', () => {
  it('役 × 難易度 × 補助の組', () => {
    const role = (env.VITE_TUNE_ROLE ?? 'skilled') as Kaiju2Role;
    const difficulty = (env.VITE_TUNE_DIFF ?? 'normal') as RaidDifficulty;
    const preset = env.VITE_TUNE_PRESET as AssistPreset | undefined;
    const seeds = Number(env.VITE_TUNE_SEEDS ?? '20');
    const from = Number(env.VITE_TUNE_FROM ?? '0');
    const noHull = env.VITE_TUNE_NOHULL === '1';
    // 必ず避ける（遅れ 0.25 秒）: 「予兆を見て正しく避ければ当たらない」の確かめ
    const dodge = env.VITE_TUNE_DODGE === '1' ? { chance: 1, react: 0.25 } : undefined;
    const world = createGouraiWorld();
    const rows: string[] = [];
    for (let seed = from; seed < from + seeds; seed++) {
      const r = runGouraiBot(
        {
          role,
          seed,
          difficulty,
          ...(preset ? { preset } : {}),
          ...(dodge ? { dodge } : {}),
          noHullAvoid: noHull,
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
          turrets: r.turretsAlive,
          vents: r.vents,
          coreVent: r.coreInVent,
          decoyed: r.decoyed,
          hpLost: r.hpLostAtClear === null ? null : Math.round(r.hpLostAtClear * 100),
          dmg: Math.round(r.damageRatio * 100),
          speed: Math.round(r.meanSpeed),
          dist: Math.round(r.medianDist),
          fire: Math.round(r.fireShare * 100),
          modes: r.modes,
          inBand: Math.round(r.inBand * 100),
        }),
      );
    }
    console.log(`TUNE ${role} ${difficulty} ${preset ?? '-'}\n${rows.join('\n')}`);
  }, 3_600_000);
});
