// 10-6: ネフィルガのソロのボット（tests/kaiju2-raid-bots.ts）の体への衝突の部分: 衝突を入れる前の判定（当てずに通り抜けた回数を
// 数える）・近づきすぎない避け方（kaiju-hull-avoid.ts）・衝突の回数 / 撃墜 / どこにぶつかったか
import { Kaiju2Hull } from '../src/ai/kaiju-hull/kaiju2-hull';
import { RamGrace } from '../src/combat/kaiju-ram';
import type { Vec3 } from '../src/flight/math';
import type { FlightSession } from '../src/missions/flight-session';
import type { Kaiju2Dev } from '../src/missions/kaiju2-dev';
import { kaiju2HullAvoid } from './kaiju-hull-avoid';

/** 近づきすぎない避け方（ボットだけ）: 先読みの秒数・体の形に足す余裕（m）・離れる秒数 */
const AVOID = { ahead: 1.0, pad: 30, seconds: 0.8 };

export class Kaiju2BotRam {
  /** 避けている残り秒と行き先 */
  avoid = 0;
  readonly avoidPoint: Vec3 = { x: 0, y: 0, z: 0 };
  ramDowns = 0;
  readonly scenes: Record<string, number> = {};
  private readonly avoidHull = new Kaiju2Hull();
  private readonly contact: Kaiju2Hull['contact'];
  private passes = 0;
  private readonly passGrace = new RamGrace();
  private lastRams: number;

  constructor(
    private readonly dev: Kaiju2Dev,
    private readonly noRam: boolean,
  ) {
    this.contact = dev.hull.contact.bind(dev.hull);
    this.lastRams = dev.ramHits;
    if (noRam)
      dev.hull.contact = (body, a, b, margin, step) => {
        if (this.contact(body, a, b, margin, step) && this.passGrace.hit(0)) this.passes++;
        return false;
      };
  }

  /** 操縦を決める前: 体へ入りそうなら避け始める（noRam では避けない） */
  think(s: FlightSession, ground: (x: number, z: number) => number, dt: number): void {
    const raid = this.dev.raid;
    const k = raid.body;
    // キャンペーン（M8）は体を通り抜けられる（衝突なし）ので避けない
    if (
      this.noRam ||
      raid.campaign ||
      this.avoid > 0 ||
      !s.player.active ||
      !k.visible ||
      raid.dead
    )
      return;
    const a = s.aircraft;
    const me = a.state.position;
    const v = {
      x: (me.x - a.prevPosition.x) / dt,
      y: (me.y - a.prevPosition.y) / dt,
      z: (me.z - a.prevPosition.z) / dt,
    };
    const kv = {
      x: (k.position.x - k.prevPosition.x) / dt,
      y: (k.position.y - k.prevPosition.y) / dt,
      z: (k.position.z - k.prevPosition.z) / dt,
    };
    this.avoidHull.pose(k.pose, k.broken);
    const floor = ground(me.x, me.z) + 250;
    const A = AVOID;
    if (kaiju2HullAvoid(this.avoidHull, k, kv, me, v, A.ahead, A.pad, floor, this.avoidPoint))
      this.avoid = A.seconds;
  }

  /** 1 ステップ進めた後: 衝突の撃墜・どこにぶつかったか（体の軸からの横の距離・前後）とボットの動き */
  after(downed: boolean, dodging: boolean, dt: number): void {
    this.passGrace.tick(dt);
    const dev = this.dev;
    const k = dev.raid.body;
    if (dev.ramHits > this.lastRams) {
      if (downed) this.ramDowns++;
      const q = dev.hull.point;
      const f = k.forward;
      const dx = q.x - k.position.x;
      const dy = q.y - k.position.y;
      const dz = q.z - k.position.z;
      const along = dx * f.x + dy * f.y + dz * f.z;
      const lat = Math.hypot(dx - f.x * along, dy - f.y * along, dz - f.z * along);
      const where = lat > 25 ? 'wing' : along < -30 ? 'tail' : along > 35 ? 'head' : 'body';
      const key = `${where}:${this.avoid > 0 ? 'avoid' : dodging ? 'dodge' : 'fight'}`;
      this.scenes[key] = (this.scenes[key] ?? 0) + 1;
    }
    this.lastRams = dev.ramHits;
  }

  /** 終わり: 判定を元に戻し、衝突の回数（noRam なら通り抜けた回数）を返す */
  finish(): number {
    if (this.noRam) this.dev.hull.contact = this.contact;
    return this.noRam ? this.passes : this.dev.ramHits;
  }
}
