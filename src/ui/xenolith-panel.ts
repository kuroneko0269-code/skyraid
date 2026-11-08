// 10-5a: ?dev=xenolith の値の表示の文（xenolith-runtime.ts から分けた。開発用なので英語だけ）: 状態・段階・バリア・次の光線・
// 瞬間移動までの時間・速さ・体力・距離・高さ・壊れた部位・当たり・三角形と描画の回数。10-5b: レイドの経過・光の弾
import { attackWeights } from '../ai/xenolith-attacks';
import { XENOLITH_CONFIG as C, XENOLITH_PARTS } from '../data/xenolith';
import type { XenolithDev } from '../missions/xenolith-dev';
import type { XenolithObject } from '../render/xenolith-model/xenolith-object';

const f0 = (n: number): string => n.toFixed(0);
const f1 = (n: number): string => n.toFixed(1);

export function xenolithPanelText(dev: XenolithDev, obj: XenolithObject): string {
  const k = dev.kaiju;
  const b = k.body;
  const r = dev.raid;
  const pl = dev.playerPosition;
  const beam = k.beam;
  const cands = attackWeights(k, pl).map((c) => `${c.attack}×${f1(c.weight)}`);
  const next = beam.busy
    ? `${beam.kind} ${beam.phase} ${f1(beam.time)}s${beam.untilFire > 0 ? `  fire in ${f1(beam.untilFire)}s` : ''}`
    : `in ${f1(Math.max(0, k.cooldown))}s [${cands.join(',') || 'none'}]`;
  const bar = k.barrier;
  const barLeft =
    bar.phase === 'flicker'
      ? `${f1(Math.max(0, bar.spec.flicker - bar.time))}s`
      : bar.phase === 'down'
        ? beam.busy && beam.phase !== 'warn'
          ? 'held'
          : `${f1(Math.max(0, bar.spec.down - bar.time))}s`
        : '';
  const warp = k.warp;
  const warpText = !k.warpEnabled
    ? 'disabled (emitters)'
    : warp.phase === 'telegraph'
      ? `TELEGRAPH ${f1(k.untilWarp)}s`
      : `in ${f1(k.untilWarp)}s (every ${f1(k.warpInterval)}s)`;
  const orbs =
    k.orbPhase === 'warn'
      ? `WARN ${f1(C.orbs.warn - k.orbTime)}s`
      : `in ${f1(Math.max(0, k.orbTimer))}s`;
  const broken = XENOLITH_PARTS.filter((_, i) => k.parts.isBroken(i)).join(',') || 'none';
  const floor = b.floorAt(b.position.x, b.position.z);
  const dist = Math.hypot(pl.x - b.position.x, pl.y - b.position.y, pl.z - b.position.z);
  const hits = dev.partTargets.reduce((s, t) => s + t.hits, 0);
  const t = dev.taken;
  return [
    `XENOLITH (dev)${dev.raiding ? ` raid ${r.difficulty} ${f0(r.elapsed)}s` : ''}  ${f0(k.elapsed)}s`,
    `state  ${b.move} ${f1(b.moveTime)}s  orbit ${b.orbitDir > 0 ? 'L' : 'R'} r${f0(b.orbitRadius)} alt+${f0(b.altOffset)}`,
    `stage  ${String(k.stage)}  hp ${f0(k.parts.hp)}/${f0(k.parts.maxHp)} (${f0(k.parts.ratio * 100)}%)`,
    `barrier ${bar.phase.toUpperCase()} ${barLeft}  down ${f1(bar.spec.down)}s  drops ${String(bar.drops)}  blocked ${String(k.absorbed)}`,
    `next   ${next}`,
    `warp   ${warpText}  warps ${String(warp.warps)}`,
    `orbs   ${orbs}  volleys ${String(k.orbVolleys)}  flying ${String(k.orbs.activeCount)}`,
    `speed  ${f0(b.speed)} m/s  (cruise ${f0(C.move.cruise * b.speedMul)} / dash ${f0(C.move.dash * b.speedMul)})`,
    `you    dist ${f0(dist)}m  dy ${f0(pl.y - b.position.y)}m`,
    `alt ${f0(b.position.y)}m  agl ${f0(b.position.y - floor)}m`,
    `used   sweep ${String(k.attacksUsed.sweep)} charged ${String(k.attacksUsed.charged)} combo ${String(k.combos)}`,
    `broken ${broken}`,
    `hits on kaiju ${String(hits)}  taken sw${String(t.sweep)} ch${String(t.charged)} orb${String(t.orbs)} body${String(t.body)}`,
    `tris ${String(obj.triangles)} + orb 8×n  draws ${String(obj.draws)}`,
    dev.lateStart ? 'LATE START (replay differs)' : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
