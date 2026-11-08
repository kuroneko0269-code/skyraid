// 10-5a: UFO ゼノリスを出すときに状態を戻す（xenolith-ai.ts から分けた）: 部位・体・バリア・瞬間移動・光線・段・数え。
// 体力の割合と壊れた部位で始める（?xnhp= ?xnbreak=）。種は呼ぶ側が先に掛け直す。決まった計算・Three.js 非依存
import { XENOLITH_CONFIG as C } from '../data/xenolith';
import type { XenolithKaiju } from './xenolith-ai';

export function resetXenolith(
  k: XenolithKaiju,
  x: number,
  y: number,
  z: number,
  heading: number,
  hpRatio: number,
  broken: readonly string[],
): void {
  const p = k.parts;
  for (let i = 0; i < p.count; i++) p.partHp[i] = p.partMaxHp[i] ?? 0;
  p.brokenOrder.length = 0;
  for (const row of p.damageBy) row.fill(0);
  p.breaksBy.fill(0);
  for (const id of broken) {
    const i = p.indexOf(id);
    if (i >= 0 && p.specs[i]?.breakable) p.partHp[i] = 0;
  }
  p.hp = p.maxHp * Math.max(0.01, Math.min(1, hpRatio));
  k.body.spawn(x, y, z, heading, k.random.next);
  k.barrier.phase = 'up';
  k.barrier.time = 0;
  k.barrier.drops = 0;
  k.warp.phase = 'idle';
  k.warp.time = 0;
  k.warp.warps = 0;
  k.beam.cancel();
  k.beam.shots = 0;
  k.attack = null;
  k.cooldown = C.firstAttack;
  k.lastAttack = null;
  k.repeat = 0;
  k.warpTimer = C.warp.first;
  k.stage = 1;
  k.comboArmed = false;
  k.attacksUsed.sweep = 0;
  k.attacksUsed.charged = 0;
  k.beamHits.sweep = 0;
  k.beamHits.charged = 0;
  k.combos = 0;
  k.absorbed = 0;
  k.rippleSphere = -1;
  k.rippleAge = 99;
  k.elapsed = 0;
  k.clearOrbs();
  k.orbTimer = C.orbs.first;
  k.orbVolleys = 0;
  k.orbHits = 0;
  k.orbs.dropped = 0;
  k.updateStage();
}
