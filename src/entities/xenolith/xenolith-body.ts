// 10-5a: UFO ゼノリスの体（Three.js 非依存）: 狙う人の周りを回る円盤の位置と速度（巡航・急停止・急加速・光線の間は止まる）、
// 体の向き（狙う人へ速く回す。光線の基準）、床から浮く高さ・地形と海と戦域の制約、瞬間移動（位置を一度に移す）、見た目の傾きと回転。
// 攻撃・バリア・部位は src/ai/xenolith-ai.ts。状態は数・文字列のプロパティだけ（リプレイの状態の走査にそのまま入る）
import { XENOLITH_CONFIG as C, type XenolithMove } from '../../data/xenolith';
import { clamp, vec3, type Vec3 } from '../../flight/math';
import { bodyPoint, type BodyFrame, type BodyOffset } from '../../ai/raid-kit/frame';

/** 地面の高さ（地表と建物の屋根。海の下は負でもよい: 海面 0 との高い方を床にする） */
export type XenolithGround = (x: number, z: number) => number;

const DEG = Math.PI / 180;

/** ぶつかりそうな人（位置・速度。協力は全員） */
export interface Rammer {
  readonly position: Readonly<Vec3>;
  readonly velocity?: Readonly<Vec3>;
  readonly active: boolean;
}

function wrapRad(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class XenolithBody implements BodyFrame {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  /** 体の向き（砲口・光線の基準。北 −z から時計回りのラジアン） */
  heading = 0;
  prevHeading = 0;
  /** 見た目の傾き（ラジアン。加速の向きへ傾ける）と円盤の回転（ラジアン） */
  pitch = 0;
  roll = 0;
  spin = 0;
  prevSpin = 0;
  /** 縁の発光体の輪の回った角度（度。0〜360。判定の球もこれで回る） */
  ringDeg = 0;
  move: XenolithMove = 'cruise';
  moveTime = 0;
  /** 次の急停止までの秒数 */
  maneuver = 5;
  /** 回る向き（+1 左回り / −1 右回り）・半径・狙う人からの高さ */
  orbitDir = 1;
  orbitRadius = 800;
  altOffset = 80;
  /** 速さの倍率（段階 2） */
  speedMul = 1;
  time = 0;
  visible = false;
  /** このステップで瞬間移動した（描画の補間をしない） */
  warped = false;
  arenaX = 0;
  arenaZ = 0;

  constructor(private readonly ground: XenolithGround) {}

  /** 床（地面・建物の屋根と海面の高い方） */
  floorAt(x: number, z: number): number {
    return Math.max(0, this.ground(x, z));
  }

  /** 今の位置で保つ高さの下限（真下と、進む先の床の一番高い所 + min） */
  minAltitude(): number {
    let f = this.floorAt(this.position.x, this.position.z);
    for (const sec of C.floor.lookahead)
      f = Math.max(
        f,
        this.floorAt(
          this.position.x + this.velocity.x * sec,
          this.position.z + this.velocity.z * sec,
        ),
      );
    return f + C.floor.min;
  }

  spawn(x: number, y: number, z: number, heading: number, rnd: () => number): void {
    this.position.x = x;
    this.position.z = z;
    this.position.y = y;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.position.y = Math.max(this.position.y, this.minAltitude());
    this.copyPrev();
    this.heading = heading;
    this.prevHeading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.spin = 0;
    this.prevSpin = 0;
    this.ringDeg = 0;
    this.move = 'cruise';
    this.moveTime = 0;
    this.time = 0;
    this.speedMul = 1;
    this.warped = false;
    this.pickOrbit(rnd);
    this.maneuver = C.move.maneuverMin + rnd() * (C.move.maneuverMax - C.move.maneuverMin);
    this.visible = true;
  }

  point(out: Vec3, o: BodyOffset): Vec3 {
    return bodyPoint(out, this, o);
  }

  private copyPrev(): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
  }

  /** 回る向き・半径・高さを選び直す（急加速のとき） */
  private pickOrbit(rnd: () => number): void {
    const m = C.move;
    if (rnd() < 0.5) this.orbitDir = -this.orbitDir;
    this.orbitRadius = m.orbitMin + rnd() * (m.orbitMax - m.orbitMin);
    this.altOffset = m.altMin + rnd() * (m.altMax - m.altMin);
  }

  /** 瞬間移動: 位置を一度に移す（前の位置も同じにして、描画の補間・判定の線が間を通らない）。速度は回る向きへ */
  teleport(to: Readonly<Vec3>, face: Readonly<Vec3> | null): void {
    this.position.x = to.x;
    this.position.y = to.y;
    this.position.z = to.z;
    this.copyPrev();
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    if (face) this.heading = Math.atan2(-(face.x - to.x), -(face.z - to.z));
    this.prevHeading = this.heading;
    this.move = 'stop';
    this.moveTime = C.move.stopHold * 0.5;
    this.warped = true;
  }

  /**
   * 1 ステップ: focus は回る中心（狙う人。いなければ戦域の中心の上）、hold は止まる（光線の間）、turn は体の向きを回すか。
   * rnd は種の列（急停止・急加速の間合いと回り方）
   */
  step(
    dt: number,
    focus: Readonly<Vec3>,
    hold: boolean,
    turn: boolean,
    rnd: () => number,
    rammers: readonly Rammer[] = [],
  ): void {
    this.copyPrev();
    this.prevHeading = this.heading;
    this.prevSpin = this.spin;
    this.warped = false;
    this.time += dt;
    this.moveTime += dt;
    const m = C.move;
    // 動き方の切り替え
    if (hold) {
      if (this.move !== 'hold') this.setMove('hold');
    } else if (this.move === 'hold') {
      this.setMove('cruise');
    } else if (this.move === 'cruise') {
      this.maneuver -= dt;
      if (this.maneuver <= 0) this.setMove('stop');
    } else if (this.move === 'stop') {
      const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
      if (speed < 5 && this.moveTime >= m.stopHold) {
        this.pickOrbit(rnd);
        this.setMove('dash');
      }
    } else if (this.moveTime >= m.dashSeconds) {
      this.maneuver = m.maneuverMin + rnd() * (m.maneuverMax - m.maneuverMin);
      this.setMove('cruise');
    }
    // 欲しい速度
    let wx = 0;
    let wy = 0;
    let wz = 0;
    let accel: number = m.stopDecel;
    if (this.move === 'stop' || this.move === 'hold') {
      // 止まる: 大きな減速
    } else {
      const fast = this.move === 'dash';
      const speed = (fast ? m.dash : m.cruise) * this.speedMul;
      accel = fast ? m.dashAccel : m.accel;
      let rx = this.position.x - focus.x;
      let rz = this.position.z - focus.z;
      const d = Math.hypot(rx, rz);
      if (d > 1) {
        rx /= d;
        rz /= d;
      } else {
        rx = 1;
        rz = 0;
      }
      // 回る向き（接線）+ 半径へ寄せる（遠すぎれば寄る、近すぎれば離れる）
      const tx = -rz * this.orbitDir;
      const tz = rx * this.orbitDir;
      const radial = clamp((this.orbitRadius - d) * m.radialGain, -speed * 1.5, speed);
      wx = tx * speed + rx * radial;
      wz = tz * speed + rz * radial;
      const h = Math.hypot(wx, wz);
      const cap = fast ? speed : speed * 1.6;
      if (h > cap) {
        wx = (wx / h) * cap;
        wz = (wz / h) * cap;
      }
      const wantY = focus.y + this.altOffset;
      wy = clamp((wantY - this.position.y) * m.verticalGain, -m.climbMax, m.climbMax);
      // 戦域の外寄りなら内へ
      const ax = this.position.x - this.arenaX;
      const az = this.position.z - this.arenaZ;
      const ar = Math.hypot(ax, az);
      if (ar > C.arena.soft) {
        const k = (ar - C.arena.soft) * 0.5;
        wx -= (ax / ar) * k;
        wz -= (az / ar) * k;
      }
    }
    // 10-5b: 人（協力は全員）がぶつかる進路なら（急停止・光線で止まった所へ後ろから追いつくなど）、上か下へ避ける（急に止まって
    // ぶつけさせない。避けるのは上下だけ: 光線の向きは変えない）
    let dodge = 0;
    for (const r of rammers) {
      if (!r.active || !r.velocity) continue;
      dodge = this.rammed(r.position, r.velocity);
      if (dodge !== 0) break;
    }
    if (dodge !== 0) {
      wy = dodge * C.dodge.speed;
      accel = Math.max(accel, C.dodge.accel);
    }
    // 加速の上限で寄せる（急停止・急加速は大きい）
    const dvx = wx - this.velocity.x;
    const dvy = wy - this.velocity.y;
    const dvz = wz - this.velocity.z;
    const dv = Math.hypot(dvx, dvy, dvz);
    const lim = accel * dt;
    const k = dv > lim ? lim / dv : 1;
    this.velocity.x += dvx * k;
    this.velocity.y += dvy * k;
    this.velocity.z += dvz * k;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;
    this.clampArena();
    // 床と天井（地形・海に潜らない。上がるのはすぐ）
    const floor = this.minAltitude();
    if (this.position.y < floor) {
      this.position.y = floor;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    if (this.position.y > C.floor.ceiling) {
      this.position.y = C.floor.ceiling;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
    // 体の向き: 狙う人へ
    if (turn) {
      const fx = focus.x - this.position.x;
      const fz = focus.z - this.position.z;
      if (Math.hypot(fx, fz) > 1) {
        const want = Math.atan2(-fx, -fz);
        const t = m.turnDeg * DEG * dt;
        this.heading = wrapRad(this.heading + clamp(wrapRad(want - this.heading), -t, t));
      }
    }
    // 見た目: 加速の向きへ傾く・円盤と輪が回る
    const hx = -Math.sin(this.heading);
    const hz = -Math.cos(this.heading);
    const ax = dvx * k;
    const az = dvz * k;
    const fwdA = dt > 0 ? (ax * hx + az * hz) / dt : 0;
    const sideA = dt > 0 ? (ax * -hz + az * hx) / dt : 0;
    const r = Math.min(1, dt * 4);
    this.pitch += (clamp(-fwdA * 0.0012, -0.35, 0.35) - this.pitch) * r;
    this.roll += (clamp(sideA * 0.0012, -0.35, 0.35) - this.roll) * r;
    this.spin = (this.spin + m.spin * dt) % (Math.PI * 2);
    this.ringDeg = (this.ringDeg + m.ringDeg * dt) % 360;
  }

  /**
   * 人（位置 p・速度 v）が体へぶつかる進路か: 相対の動きで dodge.ahead 秒以内にいちばん近づく水平の距離が dodge.miss m 未満で、
   * 上下の差が dodge.band m 未満。ぶつかるなら避ける向き（+1 上 / −1 下。人の反対側。床に近ければ上）、無ければ 0
   */
  private rammed(p: Readonly<Vec3>, v: Readonly<Vec3>): number {
    const D = C.dodge;
    const x0 = p.x - this.position.x;
    const y0 = p.y - this.position.y;
    const z0 = p.z - this.position.z;
    const rx = v.x - this.velocity.x;
    const ry = v.y - this.velocity.y;
    const rz = v.z - this.velocity.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1) return 0;
    const t = Math.max(0, Math.min(D.ahead, -(x0 * rx + y0 * ry + z0 * rz) / r2));
    if (t <= 0) return 0;
    const hx = x0 + rx * t;
    const hz = z0 + rz * t;
    const hy = y0 + ry * t;
    if (Math.hypot(hx, hz) > D.miss || Math.abs(hy) > D.band) return 0;
    const low = this.position.y - D.band < this.minAltitude();
    return hy > 0 && !low ? -1 : 1;
  }

  private setMove(m: XenolithMove): void {
    this.move = m;
    this.moveTime = 0;
  }

  /** 戦域の外へ出ない（押し戻す） */
  private clampArena(): void {
    const dx = this.position.x - this.arenaX;
    const dz = this.position.z - this.arenaZ;
    const r = Math.hypot(dx, dz);
    if (r > C.arena.hard) {
      this.position.x = this.arenaX + (dx * C.arena.hard) / r;
      this.position.z = this.arenaZ + (dz * C.arena.hard) / r;
      const out = (this.velocity.x * dx + this.velocity.z * dz) / r;
      if (out > 0) {
        this.velocity.x -= (dx / r) * out;
        this.velocity.z -= (dz / r) * out;
      }
    }
  }

  /** 水平と上下を合わせた速さ */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
  }
}
