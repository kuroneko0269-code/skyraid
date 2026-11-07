// 10-3a: 白鯨アルビオンの体（Three.js 非依存）: 周回路の上を進む位置・向き・傾き・高さと、地形・海・戦域の制約、描画が読む姿勢。
// 攻撃・子分・部位は src/ai/albion-ai.ts。状態は数と配列のプロパティだけ（リプレイの状態の走査にそのまま入る）
import { ALBION_CONFIG as C } from '../../data/albion';
import { clamp, vec3, type Vec3 } from '../../flight/math';
import { bodyPoint, type BodyFrame, type BodyOffset } from '../../ai/raid-kit/frame';
import { routeLength, routePoint, type AlbionRoute, type RoutePoint } from './albion-route';

/** 地面の高さ（地表と建物の屋根。海の下は負でもよい: 海面 0 との高い方を床にする） */
export type AlbionGround = (x: number, z: number) => number;

/** 描画が読む姿勢（固定ステップで滑らかに動かす） */
export interface AlbionPose {
  /** 泳ぎの位相（回数。尾びれの上下・胸びれのあおぎ） */
  swimPhase: number;
  /** 尾を持ち上げる（叩きつけの予兆 1）→ 打ち下ろす（−1） */
  tailLift: number;
  /** 噴気孔の膨らみと光（潮吹きの予兆 0〜1） */
  spoutSwell: number;
  /** 体の沈み（m。潮吹きの予兆） */
  sink: number;
  /** 頭の周りの霧の渦（雲の予兆 0〜1） */
  mist: number;
  /** 口を開く（吠える・雲を吐く 0〜1） */
  mouth: number;
}

const DEG = Math.PI / 180;
const rp: RoutePoint = { x: 0, z: 0, heading: 0, turning: false };
const tmp = vec3();

export class AlbionBody implements BodyFrame {
  route: AlbionRoute = {
    x: 0,
    z: 0,
    axis: 0,
    halfLength: C.route.halfLength,
    turnRadius: C.route.turnRadius,
  };
  /** 周回路の上の距離（m） */
  s = 0;
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  heading = 0;
  prevHeading = 0;
  /** 傾き（ラジアン。正で右へ傾く = 右の胸びれが下がる） */
  bank = 0;
  prevBank = 0;
  /** 機首の上下（ラジアン。高さの変化から。見た目） */
  pitch = 0;
  speed: number = C.route.speed;
  turning = false;
  /** 周回の回数（半円を出た回数） */
  laps = 0;
  /** 出てからの秒数（高さのゆらぎ） */
  time = 0;
  visible = false;
  /** 10-3c: 横転（攻撃）の傾き。rollOn の間は周回路の傾きの代わりに rollBank へ rollRate（ラジアン/秒）で寄せる */
  rollOn = false;
  rollBank = 0;
  rollRate = 0;
  /** 戦域の中心（水平） */
  arenaX = 0;
  arenaZ = 0;
  readonly pose: AlbionPose = {
    swimPhase: 0,
    tailLift: 0,
    spoutSwell: 0,
    sink: 0,
    mist: 0,
    mouth: 0,
  };

  constructor(private readonly ground: AlbionGround) {}

  /** 床（地面・建物の屋根と海面の高い方） */
  floorAt(x: number, z: number): number {
    return Math.max(0, this.ground(x, z));
  }

  /** 周回路の上の s に出す（高さは巡航の高さか、床から空ける高さの高い方） */
  spawn(route: AlbionRoute, s: number): void {
    this.route = { ...route };
    this.s = s;
    this.time = 0;
    this.laps = 0;
    routePoint(this.route, s, rp);
    this.position.x = rp.x;
    this.position.z = rp.z;
    this.heading = rp.heading;
    this.turning = rp.turning;
    this.position.y = Math.max(C.altitude.cruise, this.wantedFloor() + C.floor.clearance);
    this.bank = 0;
    this.rollOn = false;
    this.rollBank = 0;
    this.rollRate = 0;
    this.pitch = 0;
    this.speed = C.route.speed;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevHeading = this.heading;
    this.prevBank = 0;
    Object.assign(this.pose, {
      swimPhase: 0,
      tailLift: 0,
      spoutSwell: 0,
      sink: 0,
      mist: 0,
      mouth: 0,
    });
    this.visible = true;
  }

  /** 体の点の世界の位置（傾きは入れない。判定の球・巣は raid-kit の bodyPoint と同じ） */
  point(out: Vec3, o: BodyOffset): Vec3 {
    return bodyPoint(out, this, o);
  }

  /** 頭・中心・尾の下と、周回路の先の床の一番高い所 */
  private wantedFloor(): number {
    const half = C.size.length / 2;
    let f = this.floorAt(this.position.x, this.position.z);
    for (const fw of [half, -half]) {
      this.point(tmp, { forward: fw, right: 0, up: 0 });
      f = Math.max(f, this.floorAt(tmp.x, tmp.z));
    }
    for (const sec of C.floor.lookahead) {
      routePoint(this.route, this.s + this.speed * sec, rp);
      f = Math.max(f, this.floorAt(rp.x, rp.z));
    }
    return f;
  }

  /**
   * 1 ステップ: speedMul は段階・予兆の倍率、turnMul は回り返しの速さの倍率（尾が壊れると遅い）。
   * 進む距離だけ周回路を進め、高さを床と巡航の高さへ寄せる
   */
  step(dt: number, speedMul: number, turnMul: number): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevHeading = this.heading;
    this.prevBank = this.bank;
    this.time += dt;
    const base = this.turning ? C.route.turnSpeed * turnMul : C.route.speed;
    const want = base * speedMul;
    // 大きな体はゆっくり速さを変える
    this.speed += clamp(want - this.speed, -4 * dt, 4 * dt);
    const len = routeLength(this.route);
    const wasTurning = this.turning;
    this.s += this.speed * dt;
    if (this.s >= len) this.s -= len;
    routePoint(this.route, this.s, rp);
    this.turning = rp.turning;
    if (wasTurning && !this.turning) this.laps += 0.5;
    this.position.x = rp.x;
    this.position.z = rp.z;
    this.heading = rp.heading;
    // 高さ: 巡航の高さ（ゆらぎ付き）と、床から空ける高さの高い方へ。上がるのは速く、下がるのはゆっくり
    const wave = Math.sin((this.time / (len / C.route.speed)) * Math.PI * 2) * C.altitude.wave;
    const floor = this.wantedFloor();
    const target = Math.max(C.altitude.cruise + wave, floor + C.floor.clearance);
    const dy = target - this.position.y;
    this.position.y += clamp(dy, -C.altitude.sinkRate * dt, C.altitude.climbRate * dt);
    // それでも下がりすぎなら押し上げる（めり込まない下限）
    const under = this.floorAt(this.position.x, this.position.z) + C.floor.min;
    if (this.position.y < under) this.position.y = under;
    this.clampArena();
    // 傾き（半円で右へ）と上下の向き
    const bankWant = this.rollOn ? this.rollBank : this.turning ? C.route.bankDeg * DEG : 0;
    const rate = this.rollOn ? this.rollRate : C.route.bankRate * DEG;
    this.bank += clamp(bankWant - this.bank, -rate * dt, rate * dt);
    if (dt > 0) {
      this.velocity.x = (this.position.x - this.prevPosition.x) / dt;
      this.velocity.y = (this.position.y - this.prevPosition.y) / dt;
      this.velocity.z = (this.position.z - this.prevPosition.z) / dt;
    }
    const pitchWant = Math.atan2(this.velocity.y, Math.max(1, this.speed)) * 0.8;
    this.pitch += clamp(pitchWant - this.pitch, -0.05 * dt, 0.05 * dt);
    // 泳ぎ: 速さに合わせて尾をあおぐ（24 m/s で 0.11 回/秒）
    this.pose.swimPhase += dt * (0.05 + this.speed * 0.0025);
  }

  /** 戦域の外へ出ない（周回路は内側に置くが、念のため押し戻す） */
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
