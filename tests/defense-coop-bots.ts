// 協力の防衛戦（7-2）のテストのボット: インメモリの対戦（pvp-match.ts）で、各プレイヤーが最も近い敵（ホストの正の位置）を追って
// 機銃を撃ち、ロックしてミサイルを撃つ。準備の間は全員がスキップを押す（補給はしない）
import { DEFENSE_ID_BASE } from '../src/combat/pvp-arena';
import type { CombatTarget } from '../src/combat/target';
import { GUN_CONFIG } from '../src/data/weapons';
import { pursue } from './pvp-bots';
import { steerToward } from '../src/ai/steering';
import { getGroundHeight } from '../src/render/terrain-height';

const to = { x: 0, y: 0, z: 0 };
const floor = (x: number, z: number): number => Math.max(0, getGroundHeight(x, z));
import type { Match } from './pvp-match';

/** run の each に渡す操作（4 人分） */
export function defenseBots(m: Match): (k: number) => void {
  const d = m.host.defense;
  if (!d) throw new Error('defense');
  const targets = d.targets;
  return (k) => {
    for (let id = 0; id < m.owns.length; id++) {
      const a = m.owns[id];
      const ctl = m.controls[id];
      const cmb = m.combat[id];
      const g = m.game(id);
      if (!a || !ctl || !cmb || !g) continue;
      const p = a.state.position;
      if (d.runner.phase === 'intermission') {
        // 補給してからスキップ（基地の中心へ、地表 200m・速度 130 で）
        if (d.runner.hasSupplied(id)) {
          if (k % 30 === id) g.skipBriefing();
        } else {
          const c = d.runner.map.center;
          const dist = Math.hypot(c.x - p.x, c.z - p.z);
          to.x = c.x - p.x;
          to.z = c.z - p.z;
          to.y = Math.max(-0.3 * dist, Math.min(0.3 * dist, floor(c.x, c.z) + 200 - p.y));
          if (dist < 150) to.x -= to.z;
          ctl.throttleTarget = dist > 2500 ? 1 : a.state.speed > 135 ? 0 : 0.45;
          steerToward(ctl, a.state.orientation, a.state.angularRate, to, 1);
          continue;
        }
      }
      let bestD = Infinity;
      let index = -1;
      targets.forEach((t, i) => {
        if (!t.active) return;
        const dist = Math.hypot(t.position.x - p.x, t.position.y - p.y, t.position.z - p.z);
        // 巡航ミサイルは優先（距離を半分に見る）
        const w = i >= targets.length - d.props.cruiseMissiles.length ? dist / 2 : dist;
        if (w < bestD) {
          bestD = w;
          index = i;
        }
      });
      const t: CombatTarget | undefined = targets[index];
      if (!t) {
        ctl.throttleTarget = 0.7;
        ctl.pitch = p.y < 700 ? 0.3 : 0;
        continue;
      }
      const dist = Math.hypot(t.position.x - p.x, t.position.y - p.y, t.position.z - p.z);
      const off = pursue(ctl, a, t);
      if (dist > 3000) ctl.afterburner = true;
      cmb.fire = off < 3 && dist < GUN_CONFIG.range && (k + id * 7) % 60 < 20;
      cmb.targetId = DEFENSE_ID_BASE + index;
      cmb.locked = off < 10 && dist < 2400;
      cmb.missile = cmb.locked && dist > 500 && k % 240 === id * 30;
    }
  };
}
