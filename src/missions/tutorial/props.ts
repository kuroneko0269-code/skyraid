// チュートリアルの章（9-5c）で進行役が出す物（Three.js 非依存）: 付いていく的・後ろに置く的（ドローン 1 機を経路で）と、
// フレアの章で自機の後ろから撃たせるミサイル
import { TEAM_ENEMY } from '../../combat/target';
import { TUTORIAL_TASK_CONFIG as C } from '../../data/tutorial-tasks';
import { headingQuat } from '../../entities/enemy-aircraft';
import { quatIdentity, vec3 } from '../../flight/math';
import type { FlightSession } from '../flight-session';
import { configureDrones } from '../session-spawn';
import { createAttitude, readAttitude } from './attitude';

const DEG = Math.PI / 180;
const att = createAttitude();
const at = vec3();
const q = quatIdentity();

/**
 * ドローンを 1 機だけ出し、自機の前方 ahead m（turnDeg だけ回した向き）に置いて選ぶ。turnDeg が 0 なら自機と同じ向きへ、
 * ほかは横切る向きへ飛ぶ経路（length m を speed m/s）
 */
export function placeTutorialDrone(
  s: FlightSession,
  ahead: number,
  speed: number,
  length: number,
  turnDeg = 0,
): void {
  const st = s.aircraft.state;
  readAttitude(att, st.orientation);
  const dir = (att.headingDeg + turnDeg) * DEG;
  const drones = s.combat.drones;
  configureDrones(drones, 1, true);
  const d = drones[0];
  if (!d) return;
  d.setPath({
    from: {
      x: st.position.x + Math.sin(dir) * ahead,
      y: Math.min(1500, Math.max(650, st.position.y)),
      z: st.position.z - Math.cos(dir) * ahead,
    },
    headingDeg: att.headingDeg + (turnDeg === 0 ? 0 : 90),
    length,
    speed,
    respawnSeconds: 2,
  });
  s.combat.targeting.select(d);
}

/** 自機の後ろ・横から自機へミサイルを 1 発撃たせる（敵の陣営。燃焼の間に届く近さ） */
export function launchAtPlayer(s: FlightSession): void {
  const st = s.aircraft.state;
  readAttitude(att, st.orientation);
  const f = C.flare;
  const h = att.headingDeg * DEG;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  at.x = st.position.x - fx * f.behind + Math.cos(h) * f.side;
  at.y = st.position.y + f.above;
  at.z = st.position.z - fz * f.behind + Math.sin(h) * f.side;
  const toward = Math.atan2(st.position.x - at.x, -(st.position.z - at.z)) / DEG;
  headingQuat(q, toward);
  s.combat.missiles.launch({ position: at, orientation: q, speed: f.speed }, s.player, TEAM_ENEMY);
}
