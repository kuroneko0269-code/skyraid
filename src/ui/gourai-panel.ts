// 10-4a: ?dev=gourai の値の表示の文（gourai-runtime.ts から分けた。開発用なので英語だけ）: 状態・段階・熱・次の攻撃・生きている砲台・
// 飛んでいる弾・体力・距離・高さ・壊れた部位・当たり・三角形と描画の回数。10-4b: レイドの経過・回転掃射の傾き・体への衝突
import { attackWeights, inSweepBand } from '../ai/gourai-attacks';
import { relativeAim } from '../ai/raid-kit/frame';
import { GOURAI_CONFIG as C, GOURAI_PARTS, GOURAI_TURRETS } from '../data/gourai';
import type { GouraiDev } from '../missions/gourai-dev';
import type { GouraiObject } from '../render/gourai-model/gourai-object';

const f0 = (n: number): string => n.toFixed(0);
const f1 = (n: number): string => n.toFixed(1);

export function gouraiPanelText(dev: GouraiDev, obj: GouraiObject): string {
  const k = dev.kaiju;
  const b = k.body;
  const r = dev.raid;
  const pl = dev.playerPosition;
  const act = k.attack ? `${k.attack} ${k.action}` : k.action;
  const cands = attackWeights(k, pl).map((c) => `${c.attack}×${f1(c.weight)}`);
  const next =
    k.action === 'idle'
      ? `in ${f1(Math.max(0, k.cooldown))}s [${cands.join(',') || 'none'}]`
      : `${act} ${f1(k.actionLeft)}s left`;
  const broken = GOURAI_PARTS.filter((_, i) => k.parts.isBroken(i)).join(',') || 'none';
  const floor = b.floorAt(b.position.x, b.position.z);
  const dist = Math.hypot(pl.x - b.position.x, pl.y - b.position.y, pl.z - b.position.z);
  const aim = relativeAim(b, b.position, pl);
  // 自機の方角（体から見て）: 前 / 横 / 後ろ（左が正の方位）
  const ay = Math.abs(aim.yawDeg);
  const side = ay < 45 ? 'FRONT' : ay > 135 ? 'REAR' : aim.yawDeg > 0 ? 'LEFT' : 'RIGHT';
  const shots = k.shots;
  let guns = 0;
  let missiles = 0;
  for (const s of shots.shots) {
    if (!s.active) continue;
    if (s.kind === 'gun') guns++;
    else missiles++;
  }
  const turrets = GOURAI_TURRETS.map((t, i) =>
    k.turretAlive(i) ? (t.weapon === 'gun' ? 'G' : 'M') : '-',
  ).join('');
  const hits = dev.partTargets.reduce((s, t) => s + t.hits, 0);
  const phase = k.phase === 1 ? '1 armored' : '2 purged (fast)';
  const sweep =
    k.attack === 'sweep'
      ? `  pitch ${f1(k.sweepPitch)}°${inSweepBand(b, pl, k.sweepPitch) ? ' IN BAND' : ''}`
      : '';
  const t = dev.taken;
  return [
    `GOURAI (dev)${dev.raiding ? ` raid ${r.difficulty} ${f0(r.elapsed)}s` : ''}  ${f0(k.elapsed)}s  laps ${f1(b.laps)}`,
    `state  ${act} ${f1(k.actionTime)}s${k.coreOpen ? '  CORE OPEN' : ''}${sweep}`,
    `phase  ${phase}  hp ${f0(k.parts.hp)}/${f0(k.parts.maxHp)} (${f0(k.parts.ratio * 100)}%)`,
    `heat   ${f0(k.heat)}/${String(C.heat.max)} ×${f1(k.heatMul)}  vents ${String(k.vents)}`,
    `next   ${next}`,
    `turret ${String(k.turretsAlive)}/6 [${turrets}]`,
    `shots  ${String(guns + missiles)}/${String(C.shotCap)} (gun ${String(guns)} msl ${String(missiles)})  drop ${String(shots.dropped)}`,
    `       fired g${String(k.fired.gun)} m${String(k.fired.missile)}  hit g${String(k.hits.gun)} m${String(k.hits.missile)}  flared ${String(k.decoyed)}`,
    `you    ${side} ${f0(aim.yawDeg)}°  dist ${f0(dist)}m  dy ${f0(pl.y - b.position.y)}m`,
    `alt ${f0(b.position.y)}m  agl ${f0(b.position.y - floor)}m  spd ${f1(Math.hypot(b.velocity.x, b.velocity.z))}`,
    `broken ${broken}`,
    `hits on kaiju ${String(hits)}  taken g${String(t.gun)} s${String(t.sweep)} m${String(t.missile)} body${String(t.body)}`,
    `tris ${String(obj.triangles)} + shot 8×n  draws ${String(obj.draws)}`,
    dev.lateStart ? 'LATE START (replay differs)' : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
