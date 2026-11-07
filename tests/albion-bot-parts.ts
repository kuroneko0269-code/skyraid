// 10-3b: 白鯨アルビオンのボットの共通（albion-raid-bots.ts・albion-coop-bots.ts）: 熟練が狙う順・世界の用意・始めの状態・
// 予兆が自分に向いているか（避ける判断）
import type { AlbionKaiju } from '../src/ai/albion-ai';
import { inSlam, inSpout, slamRadius } from '../src/ai/albion-attacks';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import type { Vec3 } from '../src/flight/math';
import { attachAlbionDev, type AlbionDev } from '../src/missions/albion-dev';
import { ALBION_VARIANT } from '../src/missions/albion-mission';
import { registerRaidVariant } from '../src/missions/raid-variants';
import type { ReplayStart } from '../src/replay/types';
import { createWorld, type TestWorld } from './replay-helpers';

/** 熟練が狙う順（壊れていない最初の部位。胴は最後） */
export const ALBION_FOCUS = [
  'nestFront',
  'nestMid',
  'nestRear',
  'tail',
  'head',
  'dorsal',
  'body',
] as const;

export interface AlbionBotWorld {
  readonly w: TestWorld;
  readonly dev: AlbionDev;
}

export function createAlbionWorld(): AlbionBotWorld {
  registerRaidVariant(ALBION_VARIANT);
  const w = createWorld({ enemies: { enabled: false, difficulty: 'normal' } });
  const dev = attachAlbionDev(
    w.play,
    { hpPercent: 100, broken: [], bay: false },
    { ground: w.map.ordnanceGround, map: () => w.map.def, freeFlight: false },
  );
  return { w, dev };
}

export function albionStart(seed: number, difficulty: RaidDifficulty, weapons = 0): ReplayStart {
  return {
    mode: 'raid',
    mapId: RAID_CONFIG.mapId,
    raidDifficulty: difficulty,
    raidKaiju: ALBION_VARIANT.id,
    aircraftId: 'kestrel',
    upgrades: { engine: 0, airframe: 0, weapons, avionics: 0 },
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 10300 + seed,
    weatherId: 'clear',
  };
}

/** 予兆・攻撃が自分に向いているか（避ける判断）。今の位置か、ahead 秒先の位置（速度 v）が範囲に入る */
export function albionThreat(
  k: AlbionKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3> = { x: 0, y: 0, z: 0 },
  ahead = 1.2,
): boolean {
  if (k.attack === null || (k.action !== 'windup' && k.action !== 'active')) return false;
  const inside = (p: Readonly<Vec3>): boolean =>
    k.attack === 'spout'
      ? inSpout(k.body, 3, p)
      : k.attack === 'slam' && inSlam(k.body, slamRadius(k) + 150, p);
  for (let i = 0; i <= 4; i++) {
    const t = (ahead * i) / 4;
    if (inside({ x: me.x + v.x * t, y: me.y + v.y * t, z: me.z + v.z * t })) return true;
  }
  return false;
}
