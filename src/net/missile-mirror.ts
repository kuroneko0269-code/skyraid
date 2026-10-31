// PvP のミサイルの表示（5-3 の pvp-mirror.ts から 5-4 で分けた）: ホストの最新のミサイルの状態を自機の FlightSession の
// ミサイルの入れ物に映す（新しい netId は発射、なくなったものは消す、状態の間は速度で進める）。Three.js 非依存
import type { Missile } from '../combat/missile';
import { TEAM_ENEMY, TEAM_PLAYER } from '../combat/target';
import type { Vec3 } from '../flight/math';
import type { FlightSession } from '../missions/flight-session';
import type { MissileStateMsg } from './protocol';
import type { RivalProxy } from './rival-proxy';

export class MissileMirror {
  private readonly shown = new Map<number, Missile>();
  private readonly seen = new Set<number>();
  /** 起爆した netId と時刻 */
  private readonly exploded = new Map<number, number>();

  constructor(
    private readonly session: FlightSession,
    private readonly localId: number,
    private readonly rivals: ReadonlyMap<number, RivalProxy>,
  ) {}

  /** ホストの最新のミサイルに合わせる（新しい netId は発射、なくなったものは消す） */
  sync(list: readonly MissileStateMsg[], dt: number, time: number): void {
    const pool = this.session.combat.missiles.missiles;
    this.seen.clear();
    for (const [id, t] of this.exploded) if (t < time - 1) this.exploded.delete(id);
    for (const m of list) {
      this.seen.add(m.netId);
      let d = this.shown.get(m.netId);
      if (!d) {
        if (this.exploded.has(m.netId)) continue;
        const fresh = pool.acquire();
        if (!fresh) continue;
        d = fresh;
        d.serial = this.session.combat.missiles.nextSerial();
        d.age = 0;
        d.checkedBurst = 0;
        copy(d.prevPosition, m.position);
        this.shown.set(m.netId, d);
      } else {
        copy(d.prevPosition, d.position);
        d.age += dt;
      }
      copy(d.position, m.position);
      copy(d.velocity, m.velocity);
      d.owner = m.owner === this.localId ? TEAM_PLAYER : TEAM_ENEMY;
      d.target =
        m.targetId === this.localId ? this.session.player : (this.rivals.get(m.targetId) ?? null);
    }
    for (const id of [...this.shown.keys()]) if (!this.seen.has(id)) this.remove(id);
  }

  /** 状態の間は速度で進める */
  advance(dt: number): void {
    for (const d of this.shown.values()) {
      copy(d.prevPosition, d.position);
      d.position.x += d.velocity.x * dt;
      d.position.y += d.velocity.y * dt;
      d.position.z += d.velocity.z * dt;
      d.age += dt;
    }
  }

  /** 起爆した（その後に順不同で遅れて届いた前の状態で生き返らせない） */
  explode(netId: number, time: number): void {
    this.remove(netId);
    this.exploded.set(netId, time);
  }

  private remove(netId: number): void {
    const d = this.shown.get(netId);
    if (!d) return;
    this.shown.delete(netId);
    const pool = this.session.combat.missiles.missiles;
    for (let i = 0; i < pool.count; i++) {
      if (pool.get(i) === d) {
        pool.release(i);
        return;
      }
    }
  }
}

function copy(out: Vec3, v: Readonly<Vec3>): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}
