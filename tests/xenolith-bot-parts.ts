// 10-5b: UFO ゼノリスのボットの共通（xenolith-raid-bots.ts・xenolith-coop-bots.ts）: 世界の用意・始めの状態・狙う部位の選び方・
// 予兆が自分に向いているか（なぎ払いの線の高さ・溜め撃ちのロック・光の弾）と避ける先・体を見越して避ける
import type { CombatTarget } from '../src/combat/target';
import type { XenolithKaiju } from '../src/ai/xenolith-ai';
import { xenolithPenetrationLocal } from '../src/ai/xenolith-hull';
import type { HullHit } from '../src/ai/albion-hull';
import { XENOLITH_SWEEP } from '../src/data/xenolith';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import type { XenolithPartTarget } from '../src/entities/xenolith/xenolith-target';
import type { Vec3 } from '../src/flight/math';
import type { FlightSession } from '../src/missions/flight-session';
import { attachXenolithDev, type XenolithDev } from '../src/missions/xenolith-dev';
import { XENOLITH_VARIANT } from '../src/missions/xenolith-mission';
import { registerRaidVariant } from '../src/missions/raid-variants';
import type { ReplayStart } from '../src/replay/types';
import { createWorld, type TestWorld } from './replay-helpers';

export interface XenolithBotWorld {
  readonly w: TestWorld;
  readonly dev: XenolithDev;
}

export function createXenolithWorld(): XenolithBotWorld {
  registerRaidVariant(XENOLITH_VARIANT);
  const w = createWorld({ enemies: { enabled: false, difficulty: 'normal' } });
  const dev = attachXenolithDev(
    w.play,
    { hpPercent: 100, broken: [] },
    { ground: w.map.ordnanceGround, map: () => w.map.def, freeFlight: false },
  );
  return { w, dev };
}

export function xenolithStart(seed: number, difficulty: RaidDifficulty, weapons = 0): ReplayStart {
  return {
    mode: 'raid',
    mapId: RAID_CONFIG.mapId,
    raidDifficulty: difficulty,
    raidKaiju: XENOLITH_VARIANT.id,
    aircraftId: 'kestrel',
    upgrades: { engine: 0, airframe: 0, weapons, avionics: 0 },
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 10500 + seed,
    weatherId: 'clear',
  };
}

/**
 * 狙う部位: 'smart'（熟練）はバリアが外れていればドーム（壊れていれば胴）、張っていれば発生器（無ければ胴）。
 * 'gens'（平均的）は張っている間は発生器、外れていれば胴。'hull'（初心者・模擬の人）はロックした部位（初めは胴）
 */
export type XenolithFocus = 'smart' | 'gens' | 'hull';

export function xenolithPicker(
  s: FlightSession,
  k: XenolithKaiju,
  focus: XenolithFocus,
  parts: readonly XenolithPartTarget[],
): () => CombatTarget {
  const find = (id: string): XenolithPartTarget | undefined =>
    parts.find((p) => p.id === id && p.active && !(id === 'dome' && p.broken));
  const hull = parts[0] as CombatTarget;
  return (): CombatTarget => {
    const open = !k.barrier.absorbs;
    if (focus === 'smart') {
      if (open) return find('dome') ?? hull;
      return find('gen0') ?? find('gen1') ?? find('gen2') ?? hull;
    }
    if (focus === 'gens' && !open) return find('gen0') ?? find('gen1') ?? find('gen2') ?? hull;
    if (focus === 'gens') return hull;
    const sel = s.combat.targeting.selected;
    return sel?.active ? sel : hull;
  };
}

/** なぎ払いの線の高さ（体の口から水平 h m の所）。予兆・撃つ間だけ */
function sweepBandY(k: XenolithKaiju, me: Readonly<Vec3>): number {
  const o = k.beam.origin;
  const h = Math.hypot(me.x - o.x, me.z - o.z);
  return o.y + h * Math.tan((k.beam.pitchDeg * Math.PI) / 180);
}

/** なぎ払いが当たりそうか（予兆・撃つ間。線の長さの内で、線の高さから band m 以内） */
export function sweepThreat(k: XenolithKaiju, me: Readonly<Vec3>, band = 160): boolean {
  const b = k.beam;
  if (b.kind !== 'sweep' || (b.phase !== 'warn' && b.phase !== 'fire')) return false;
  const o = b.origin;
  if (Math.hypot(me.x - o.x, me.y - o.y, me.z - o.z) > XENOLITH_SWEEP.length + 100) return false;
  return Math.abs(me.y - sweepBandY(k, me)) < band;
}

/** なぎ払いを避ける先: 進む向きのまま、線の高さから上か下へ 260m（床に近ければ上へ） */
export function sweepDodgePoint(
  k: XenolithKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
): void {
  const band = sweepBandY(k, me);
  const floor = k.body.floorAt(me.x, me.z);
  const up = me.y >= band || band - 260 < floor + 150;
  const sp = Math.hypot(v.x, v.z) || 1;
  out.x = me.x + (v.x / sp) * 1400;
  out.z = me.z + (v.z / sp) * 1400;
  out.y = band + (up ? 260 : -260);
}

/** 溜め撃ち・光の弾を避ける先: 体から自分への向きに直角（今の進む向きに近い側）へ 1400m 横・同じ高さ */
export function breakPoint(
  k: XenolithKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
): void {
  const b = k.body.position;
  const dx = me.x - b.x;
  const dz = me.z - b.z;
  const l = Math.hypot(dx, dz) || 1;
  let px = -dz / l;
  let pz = dx / l;
  if (px * v.x + pz * v.z < 0) {
    px = -px;
    pz = -pz;
  }
  out.x = me.x + px * 1400;
  out.z = me.z + pz * 1400;
  out.y = Math.max(k.body.floorAt(me.x, me.z) + 200, me.y);
}

/** 溜め撃ちを避ける先: 進む向きのまま、上か下へ 400m（床に近ければ上）。機首の上げ下げがいちばん早く進む向きを変えられる */
export function pullPoint(
  k: XenolithKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
): void {
  const sp = Math.hypot(v.x, v.z) || 1;
  out.x = me.x + (v.x / sp) * 900;
  out.z = me.z + (v.z / sp) * 900;
  const floor = k.body.floorAt(me.x, me.z);
  out.y = me.y - 400 < floor + 200 || v.y > 0 ? me.y + 400 : me.y - 400;
}

/** 体を見越す秒数（役ごと。アルビオン・ゴウライと同じ） */
export const XENOLITH_HULL_LOOKAHEAD: Readonly<Record<string, number>> = {
  skilled: 1.6,
  average: 1.4,
  beginner: 1.1,
  human: 2.0,
};

const hullHit: HullHit = { depth: 0, normal: { x: 0, y: 1, z: 0 }, shape: 'body' };

/** 体から見た相対の動きで ahead 秒先まで体（余裕 pad m）へ入るなら、上か下へ逃げる先（out）を決めて true */
export function xenolithHullAvoid(
  k: XenolithKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  ahead: number,
  out: Vec3,
  pad = 50,
  breakAhead = 2.2,
  breakMiss = 130,
): boolean {
  const b = k.body.position;
  const bv = k.body.velocity;
  const rx = v.x - bv.x;
  const ry = v.y - bv.y;
  const rz = v.z - bv.z;
  const x0 = me.x - b.x;
  const y0 = me.y - b.y;
  const z0 = me.z - b.z;
  const dist = Math.hypot(x0, y0, z0);
  if (dist > 140 + Math.hypot(rx, ry, rz) * ahead) return false;
  // ぶつかる進路なら引き起こす: 相対の動きで breakAhead 秒以内にいちばん近づく距離が breakMiss m 未満なら、体の横（今いる側）の
  // 上か下へ抜ける（人は撃ち抜けたら離れる）
  const rl = Math.hypot(rx, ry, rz) || 1;
  const tStar = Math.max(0, Math.min(breakAhead, -(x0 * rx + y0 * ry + z0 * rz) / (rl * rl)));
  const miss = Math.hypot(x0 + rx * tStar, y0 + ry * tStar, z0 + rz * tStar);
  if (tStar > 0 && tStar < breakAhead && miss < breakMiss) {
    // 薄い円盤なので、上下へ抜けるのがいちばん早い（今いる側。床に近ければ上）。進む向きはそのまま
    const sp = Math.hypot(v.x, v.z) || 1;
    out.x = me.x + (v.x / sp) * 700;
    out.z = me.z + (v.z / sp) * 700;
    const floor = k.body.floorAt(me.x, me.z);
    const up = y0 >= -10 || b.y - 140 < floor + 120;
    out.y = b.y + (up ? 140 : -140);
    return true;
  }
  for (let i = 1; i <= 10; i++) {
    const t = (ahead * i) / 10;
    if (!xenolithPenetrationLocal(x0 + rx * t, y0 + ry * t, z0 + rz * t, pad, hullHit)) continue;
    // 薄い円盤なので、今いる側（上か下）へ抜ける
    const sp = Math.hypot(v.x, v.z) || 1;
    out.x = me.x + (v.x / sp) * 800;
    out.z = me.z + (v.z / sp) * 800;
    const floor = k.body.floorAt(me.x, me.z);
    out.y = y0 >= 0 || b.y - 220 < floor + 120 ? b.y + 220 : b.y - 220;
    return true;
  }
  return false;
}
