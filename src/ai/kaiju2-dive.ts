// 9-6a: ネフィルガの急降下（kaiju2-ai.ts から分けた。9-6c）: 上昇（予兆）→ 狙った点へ降下（攻撃）→ 引き起こし（攻める隙）。
// Three.js 非依存
import { KAIJU2_CONFIG as C } from '../data/kaiju2';
import { vec3 } from '../flight/math';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';
import { choosePerch, diveHits } from './kaiju2-attacks';
import type { Kaiju2Target } from './kaiju2-ai';

const A = C.attacks;
const DEG = Math.PI / 180;
const want = vec3();

/** 急降下: 上昇（予兆）→ 狙った点へ降下（攻撃）→ 引き起こし（硬直 = 攻める隙） */
export function stepDive(
  k: SkyKaiju,
  dt: number,
  target: Kaiju2Target,
  hit: (attack: 'dive', damage: number, stun: number) => void,
  endAttack: () => void,
): void {
  const d = A.dive;
  if (k.state === 'windup') {
    // 上昇: プレイヤーの手前・上の点へ（終わったときにプレイヤーが前の下に来る）
    const tp = target.position;
    const hx = tp.x - k.position.x;
    const hz = tp.z - k.position.z;
    const hl = Math.hypot(hx, hz) || 1;
    want.x = tp.x - (hx / hl) * d.setback - k.position.x;
    want.z = tp.z - (hz / hl) * d.setback - k.position.z;
    const wl = Math.hypot(want.x, want.z) || 1;
    const wantY = Math.min(k.ceiling, tp.y + d.above) - k.position.y;
    want.y = Math.max(-0.2, Math.min(Math.tan(d.climbDeg * DEG), wantY / wl)) * wl;
    k.steer(want, k.turnRate * 1.5 * dt);
    k.approachSpeed(d.climbSpeed, 40, dt);
    k.integrate(dt);
    if (k.stateTime >= d.windup * k.windupScale) {
      const p = target.position;
      const v = target.velocity;
      k.diveTarget.x = p.x + v.x * d.lead;
      k.diveTarget.y = p.y + v.y * d.lead;
      k.diveTarget.z = p.z + v.z * d.lead;
      k.setState('attack');
    }
    return;
  }
  if (k.state === 'attack') {
    const dir = k.directionTo(k.diveTarget);
    // 狙った点を追う（ゆっくり）。予兆の終わりの向きが大きく違っても、始めの 0.6 秒は速く向ける
    const turn = (k.stateTime < d.aimSeconds ? d.aimDegPerSec : d.turnDegPerSec) * DEG * dt;
    want.x = dir.x;
    want.y = dir.y;
    want.z = dir.z;
    k.steer(want, turn, false);
    k.approachSpeed(d.speed, 140, dt);
    k.integrate(dt);
    if (!k.attackHit && target.active && diveHits(k, target.position)) {
      k.attackHit = true;
      hit('dive', d.damage, 0);
    }
    const tx = k.diveTarget.x - k.position.x;
    const ty = k.diveTarget.y - k.position.y;
    const tz = k.diveTarget.z - k.position.z;
    const passed =
      k.stateTime > d.aimSeconds && tx * k.forward.x + ty * k.forward.y + tz * k.forward.z < 0;
    const low = k.position.y - k.floorAt(k.position.x, k.position.z) < d.pullUpClearance;
    if (passed || low || k.stateTime >= d.active) k.setState('recover');
    return;
  }
  // 引き起こし: 水平より少し上へ、ゆっくり（腹を見せる）
  const f = k.forward;
  const h = Math.hypot(f.x, f.z) || 1;
  want.x = f.x / h;
  want.y = 0.3;
  want.z = f.z / h;
  k.steer(want, 30 * DEG * dt);
  k.approachSpeed(d.recoverSpeed, 50, dt);
  k.integrate(dt);
  if (k.stateTime < d.recover) return;
  endAttack();
  // 9-6b: 隙をつなげる: 急降下で疲れていれば（スタミナが perchAfterDive 未満）そのまま止まり木へ
  if (
    k.stamina < C.perch.stamina * C.perch.perchAfterDive &&
    choosePerch(k, k.random.next, k.perch)
  )
    k.setState('landing', null);
}
