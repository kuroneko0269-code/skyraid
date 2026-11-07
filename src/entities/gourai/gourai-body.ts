// 10-4a: メカ怪獣ゴウライの体（Three.js 非依存）: 巡回の点を順にホバリングで滑って巡る位置と、狙う人へ向ける体の向き（進む向きとは
// 別。機械らしい横滑り）・床から浮く高さ・地形と海と戦域の制約・描画が読む姿勢。攻撃・熱・部位は src/ai/gourai-ai.ts。
// 状態は数と配列のプロパティだけ（リプレイの状態の走査にそのまま入る）。巡回の点も数の配列で持つ
import { GOURAI_CONFIG as C } from '../../data/gourai';
import { clamp, vec3, type Vec3 } from '../../flight/math';
import { bodyPoint, type BodyFrame, type BodyOffset } from '../../ai/raid-kit/frame';

/** 地面の高さ（地表と建物の屋根。海の下は負でもよい: 海面 0 との高い方を床にする） */
export type GouraiGround = (x: number, z: number) => number;

/** 巡回: 中心と半径（点は円の上に等間隔。右回り） */
export interface GouraiPatrol {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** 描画が読む姿勢（固定ステップで滑らかに動かす。0〜1） */
export interface GouraiPose {
  /** 前の装甲が開く（放熱）。後半は装甲が無い */
  armorOpen: number;
  /** 背のハッチが開く（一斉発射の予兆） */
  hatch: number;
  /** 機銃が赤く光る（回転掃射の予兆と攻撃） */
  gunGlow: number;
  /** 排気口の光（熱の割合に合わせて明るく。放熱で最大） */
  exhaust: number;
  /** 装甲を捨てた（後半。0 → 1 で装甲の板が外へ飛んで消える） */
  purge: number;
  /** 回転掃射の向き（度。機銃の砲身が回る） */
  spin: number;
}

const DEG = Math.PI / 180;
const tmp = vec3();
const wpTmp = { x: 0, z: 0 };
const CORNERS: readonly BodyOffset[] = [
  { forward: C.size.length / 2, right: C.size.width / 2, up: 0 },
  { forward: C.size.length / 2, right: -C.size.width / 2, up: 0 },
  { forward: -C.size.length / 2, right: C.size.width / 2, up: 0 },
  { forward: -C.size.length / 2, right: -C.size.width / 2, up: 0 },
];

/** 方位の差（−π〜π） */
function wrapRad(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class GouraiBody implements BodyFrame {
  patrol: GouraiPatrol = { x: 0, z: 0, radius: C.patrol.radius };
  /** 次に向かう巡回の点の番号 */
  waypoint = 0;
  /** 巡回の点を回った数 */
  laps = 0;
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  /** 体の向き（前の装甲の向き。北 −z から時計回りのラジアン） */
  heading = 0;
  prevHeading = 0;
  /** 進む向きへの傾き（ラジアン。前へ進むと前が下がる・横へ滑ると傾く。見た目） */
  pitch = 0;
  roll = 0;
  /** 水平の速さ（m/s） */
  speed = 0;
  time = 0;
  visible = false;
  arenaX = 0;
  arenaZ = 0;
  readonly pose: GouraiPose = { armorOpen: 0, hatch: 0, gunGlow: 0, exhaust: 0, purge: 0, spin: 0 };

  constructor(private readonly ground: GouraiGround) {}

  /** 床（地面・建物の屋根と海面の高い方） */
  floorAt(x: number, z: number): number {
    return Math.max(0, this.ground(x, z));
  }

  /** 巡回の点 i の位置（右回り。0 は北） */
  waypointAt(i: number, out: { x: number; z: number }): { x: number; z: number } {
    const n = C.patrol.count;
    const a = ((((i % n) + n) % n) / n) * Math.PI * 2;
    out.x = this.patrol.x + Math.sin(a) * this.patrol.radius;
    out.z = this.patrol.z - Math.cos(a) * this.patrol.radius;
    return out;
  }

  /** 出す（巡回・始めの位置に一番近い点の次へ向かう・向き） */
  spawn(patrol: GouraiPatrol, x: number, z: number, heading: number): void {
    this.patrol = { ...patrol };
    this.position.x = x;
    this.position.z = z;
    this.heading = heading;
    this.prevHeading = heading;
    this.time = 0;
    this.laps = 0;
    this.speed = 0;
    this.pitch = 0;
    this.roll = 0;
    let best = 0;
    let bestD = Infinity;
    const p = { x: 0, z: 0 };
    for (let i = 0; i < C.patrol.count; i++) {
      this.waypointAt(i, p);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.waypoint = (best + 1) % C.patrol.count;
    this.position.y = this.wantedFloor() + C.hover.height;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    Object.assign(this.pose, { armorOpen: 0, hatch: 0, gunGlow: 0, exhaust: 0, purge: 0, spin: 0 });
    this.visible = true;
  }

  point(out: Vec3, o: BodyOffset): Vec3 {
    return bodyPoint(out, this, o);
  }

  /** 体の四隅の下と、進む先の床の一番高い所 */
  private wantedFloor(): number {
    let f = this.floorAt(this.position.x, this.position.z);
    for (const c of CORNERS) {
      this.point(tmp, c);
      f = Math.max(f, this.floorAt(tmp.x, tmp.z));
    }
    for (const sec of C.hover.lookahead) {
      f = Math.max(
        f,
        this.floorAt(
          this.position.x + this.velocity.x * sec,
          this.position.z + this.velocity.z * sec,
        ),
      );
    }
    return f;
  }

  /**
   * 1 ステップ: speedMax は今の速さの上限（止まるときは 0）、turnMul は旋回の倍率、face は向ける先（null なら進む向き）。
   * 巡回の点へ滑り、体の向きを face へ回し、高さを床から浮かせる
   */
  step(dt: number, speedMax: number, turnMul: number, face: Readonly<Vec3> | null): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevHeading = this.heading;
    this.time += dt;
    // 巡回の点へ: 着いたら次へ
    const wp = this.waypointAt(this.waypoint, wpTmp);
    let dx = wp.x - this.position.x;
    let dz = wp.z - this.position.z;
    let d = Math.hypot(dx, dz);
    if (d < C.patrol.arrive) {
      this.waypoint = (this.waypoint + 1) % C.patrol.count;
      this.laps += 1 / C.patrol.count;
      this.waypointAt(this.waypoint, wp);
      dx = wp.x - this.position.x;
      dz = wp.z - this.position.z;
      d = Math.hypot(dx, dz);
    }
    // 速さ: 上限へ加速 / 減速（点の手前では減速しない: 巡回は止まらずに回る）
    this.speed += clamp(speedMax - this.speed, -C.patrol.accel * 2 * dt, C.patrol.accel * dt);
    const ux = d > 0 ? dx / d : 0;
    const uz = d > 0 ? dz / d : 0;
    // 進む向きは速度をなめらかに曲げる（急に跳ばない）
    const k = Math.min(1, dt * 0.8);
    this.velocity.x += (ux * this.speed - this.velocity.x) * k;
    this.velocity.z += (uz * this.speed - this.velocity.z) * k;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.clampArena();
    // 体の向き: 向ける先へ（上限の速さで回る）
    const fx = face ? face.x - this.position.x : this.velocity.x;
    const fz = face ? face.z - this.position.z : this.velocity.z;
    if (Math.hypot(fx, fz) > 1) {
      const want = Math.atan2(-fx, -fz);
      const turn = C.patrol.turnDeg * turnMul * DEG * dt;
      this.heading = wrapRad(this.heading + clamp(wrapRad(want - this.heading), -turn, turn));
    }
    // 高さ: 床 + 浮く高さ（ゆらぎ付き）へ。上がるのは速く（建物を越える）、下がるのはゆっくり
    const bob = Math.sin(this.time * C.hover.bobHz * Math.PI * 2) * C.hover.bob;
    const target = this.wantedFloor() + C.hover.height + bob;
    const vy = clamp(target - this.position.y, -C.hover.sinkRate * dt, C.hover.climbRate * dt);
    this.position.y += vy;
    const under = this.floorAt(this.position.x, this.position.z) + C.hover.min;
    if (this.position.y < under) this.position.y = under;
    this.velocity.y = dt > 0 ? (this.position.y - this.prevPosition.y) / dt : 0;
    // 見た目の傾き: 体の前・右の向きへの速度の成分から
    const hx = -Math.sin(this.heading);
    const hz = -Math.cos(this.heading);
    const fwd = this.velocity.x * hx + this.velocity.z * hz;
    const side = this.velocity.x * -hz + this.velocity.z * hx;
    const r = Math.min(1, dt * 1.5);
    this.pitch += (-fwd * 0.006 - this.pitch) * r;
    this.roll += (side * 0.006 - this.roll) * r;
  }

  /** 戦域の外へ出ない（巡回は内側に置くが、念のため押し戻す） */
  private clampArena(): void {
    const dx = this.position.x - this.arenaX;
    const dz = this.position.z - this.arenaZ;
    const r = Math.hypot(dx, dz);
    if (r > C.arena.hard) {
      this.position.x = this.arenaX + (dx * C.arena.hard) / r;
      this.position.z = this.arenaZ + (dz * C.arena.hard) / r;
    }
  }
}

/** 巡回の中心を戦域の内側（中心から limit − 半径 − margin）へ寄せる */
export function fitPatrol(
  p: GouraiPatrol,
  cx: number,
  cz: number,
  limit: number,
  margin: number,
): GouraiPatrol {
  const room = Math.max(0, limit - p.radius - margin);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= room) return p;
  const k = d > 0 ? room / d : 0;
  return { ...p, x: cx + dx * k, z: cz + dz * k };
}
