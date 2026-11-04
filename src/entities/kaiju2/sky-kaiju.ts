// 9-6a: 空を飛ぶ怪獣「ネフィルガ」の本体（Three.js 非依存）: 位置・向き・速さと、地形・海・戦域の制約、見た目の姿勢の値。
// 状態の進め方（巡航 → 予兆 → 攻撃 → 硬直、止まり木）は src/ai/kaiju2-ai.ts。乱数は種から（SeededRandom）で、
// リプレイの状態の走査（ハッシュ・キーフレーム）にそのまま入る（関数・Three.js の物を持たない）
import { SeededRandom } from '../../core/random';
import {
  KAIJU2_CONFIG as C,
  type Kaiju2Attack,
  type Kaiju2Part,
  type Kaiju2State,
} from '../../data/kaiju2';
import { clamp, vec3, type Vec3 } from '../../flight/math';

/** 地面の高さ（海の下は負でもよい。海面 0 との高い方を床にする） */
export type Kaiju2Ground = (x: number, z: number) => number;

/** 雷球 1 つ */
export interface Kaiju2Orb {
  active: boolean;
  readonly position: Vec3;
  readonly prevPosition: Vec3;
  readonly velocity: Vec3;
  age: number;
  /** フレアに乗り換えた（その時のフレアの位置へ向かう） */
  decoyed: boolean;
  readonly decoy: Vec3;
}

/** 描画が読む姿勢の値（0〜1。固定ステップで滑らかに動かす） */
export interface Kaiju2Pose {
  /** 羽ばたきの位相（回数。小数） */
  flapPhase: number;
  /** 羽ばたきの強さ（0 は滑空で止める） */
  flapAmount: number;
  /** 翼をたたむ（急降下・止まり木） */
  wingFold: number;
  /** 翼を高く掲げる（突風の予兆） */
  wingRaise: number;
  /** 喉の袋の光（雷球の予兆） */
  throatGlow: number;
  /** 尾を巻き上げる（打ち払いの予兆）と振り（攻撃中 −1〜1） */
  tailCurl: number;
  tailSwing: number;
  /** 首を下げる・上げる（−1〜1） */
  neckPitch: number;
  /** 脚を下ろす（止まり木） */
  legsDown: number;
}

export const MAX_ORBS = 5;

function newOrb(): Kaiju2Orb {
  return {
    active: false,
    position: vec3(),
    prevPosition: vec3(),
    velocity: vec3(),
    age: 0,
    decoyed: false,
    decoy: vec3(),
  };
}

const scratch = vec3();
const axis = vec3();

export class SkyKaiju {
  readonly position = vec3();
  readonly prevPosition = vec3();
  /** 進む向き（単位） */
  readonly forward = vec3(0, 0, -1);
  readonly prevForward = vec3(0, 0, -1);
  speed: number = C.cruise.speed;
  /** 横の傾き（ラジアン。右翼が下がる向きが正） */
  bank = 0;
  prevBank = 0;
  state: Kaiju2State = 'cruise';
  stateTime = 0;
  attack: Kaiju2Attack | null = null;
  /** 次の攻撃を選ぶまでの秒数 */
  attackCooldown: number = C.firstAttackDelay;
  /** 直前の攻撃（同じ攻撃を続けない） */
  readonly history: Kaiju2Attack[] = [];
  /** 全体 HP の割合（9-6a は武器で減らない。確かめる場の URL で決める） */
  hpRatio = 1;
  /** 体力の段階 1〜3 */
  phase = 1;
  /** 飛び続けられる残りの秒数（0 で止まり木へ） */
  stamina: number = C.perch.stamina;
  readonly broken: Record<Kaiju2Part, boolean> = {
    wingL: false,
    wingR: false,
    head: false,
    tail: false,
  };
  /** 周回の中心（水平）と向き（+1 左回り / −1 右回り） */
  readonly anchor = { x: 0, z: 0 };
  orbitSign = 1;
  /** 止まり木の場所（地面の上の体の中心） */
  readonly perch = vec3();
  /** 急降下の狙う点 */
  readonly diveTarget = vec3();
  /** この攻撃で当てたか（1 回の攻撃で 1 回だけ当てる） */
  attackHit = false;
  /** 9-6c: 段階 2 から、前の急降下（無ければ段階 2 に入ってから）からの秒数。attacks.dive.dueSeconds 以上で出番 */
  diveWait: number = C.attacks.dive.dueSeconds;
  /** 9-6b: 今の雷球の扇で当たった数（attacks.orbs.maxHits で残りを消す） */
  orbVolleyHits = 0;
  /** 9-6b: 難易度（レイド）: 予兆の秒数・攻撃の間隔・当たりのダメージの倍率。確かめる場は 1 */
  windupScale = 1;
  intervalScale = 1;
  damageScale = 1;
  /** 9-6b: 見えている（レイドの撃破の後は落ちて消える。確かめる場は常に true） */
  visible = true;
  readonly orbs: Kaiju2Orb[] = Array.from({ length: MAX_ORBS }, newOrb);
  readonly pose: Kaiju2Pose = {
    flapPhase: 0,
    flapAmount: 1,
    wingFold: 0,
    wingRaise: 0,
    throatGlow: 0,
    tailCurl: 0,
    tailSwing: 0,
    neckPitch: 0,
    legsDown: 0,
  };
  /** 当てた回数（確かめる場の表示） */
  readonly hits: Record<Kaiju2Attack, number> = { orbs: 0, gust: 0, dive: 0, tail: 0 };
  /** 経過秒数 */
  time = 0;
  readonly random = new SeededRandom(1);

  /** 戦域の中心（水平） */
  readonly center = { x: 0, z: 0 };

  constructor(readonly ground: Kaiju2Ground) {}

  /** 床（地面と海面の高い方） */
  floorAt(x: number, z: number): number {
    return Math.max(0, this.ground(x, z));
  }

  /** 体力の割合から段階を決める */
  setHpRatio(r: number): void {
    this.hpRatio = clamp(r, 0, 1);
    const [p2 = 0.7, p3 = 0.4] = C.phases;
    this.phase = this.hpRatio <= p3 ? 3 : this.hpRatio <= p2 ? 2 : 1;
  }

  get wingsBroken(): number {
    return (this.broken.wingL ? 1 : 0) + (this.broken.wingR ? 1 : 0);
  }

  /** 巡航の速さ（段階・翼の壊れ） */
  get cruiseSpeed(): number {
    return (
      C.cruise.speed * (C.phaseSpeed[this.phase - 1] ?? 1) * C.broken.wingSpeed ** this.wingsBroken
    );
  }

  /** 旋回の角速度（ラジアン/秒。翼・尾の壊れ） */
  get turnRate(): number {
    let r = C.cruise.turnDegPerSec * C.broken.wingTurn ** this.wingsBroken;
    if (this.broken.tail) r *= C.broken.tailTurn;
    return (r * Math.PI) / 180;
  }

  get ceiling(): number {
    return this.wingsBroken > 0 ? C.ceiling.wingBroken : C.ceiling.normal;
  }

  /** ステップの初めに前の値を写す（描画の補間） */
  beginStep(): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
    this.prevForward.x = this.forward.x;
    this.prevForward.y = this.forward.y;
    this.prevForward.z = this.forward.z;
    this.prevBank = this.bank;
    for (const o of this.orbs) {
      o.prevPosition.x = o.position.x;
      o.prevPosition.y = o.position.y;
      o.prevPosition.z = o.position.z;
    }
  }

  /** 状態を変える */
  setState(s: Kaiju2State, attack: Kaiju2Attack | null = this.attack): void {
    this.state = s;
    this.stateTime = 0;
    this.attack = attack;
  }

  /**
   * 向きを want（単位でなくてよい）へ、1 ステップ maxRad まで回す。
   * avoid が true なら先に地形・戦域を避ける向きに直す
   */
  steer(want: Vec3, maxRad: number, avoid = true): void {
    if (avoid) this.avoid(want);
    const len = Math.hypot(want.x, want.y, want.z);
    if (len < 1e-6) return;
    const wx = want.x / len;
    const wy = want.y / len;
    const wz = want.z / len;
    const f = this.forward;
    const dot = clamp(f.x * wx + f.y * wy + f.z * wz, -1, 1);
    const angle = Math.acos(dot);
    if (angle <= maxRad) {
      f.x = wx;
      f.y = wy;
      f.z = wz;
      return;
    }
    // 回転軸（f × w）。真後ろなら上を軸にする
    axis.x = f.y * wz - f.z * wy;
    axis.y = f.z * wx - f.x * wz;
    axis.z = f.x * wy - f.y * wx;
    let al = Math.hypot(axis.x, axis.y, axis.z);
    if (al < 1e-6) {
      axis.x = 0;
      axis.y = 1;
      axis.z = 0;
      al = 1;
    }
    axis.x /= al;
    axis.y /= al;
    axis.z /= al;
    // ロドリゲスの回転（f は axis に垂直なので項が 2 つ）
    const c = Math.cos(maxRad);
    const s = Math.sin(maxRad);
    const cx = axis.y * f.z - axis.z * f.y;
    const cy = axis.z * f.x - axis.x * f.z;
    const cz = axis.x * f.y - axis.y * f.x;
    f.x = f.x * c + cx * s;
    f.y = f.y * c + cy * s;
    f.z = f.z * c + cz * s;
    const fl = Math.hypot(f.x, f.y, f.z);
    f.x /= fl;
    f.y /= fl;
    f.z /= fl;
  }

  /** 先読みの点が地面・海面に近ければ上へ、戦域の外へ向かっていれば中へ（want を書き換える） */
  private avoid(want: Vec3): void {
    const a = C.avoid;
    const len = Math.hypot(want.x, want.y, want.z) || 1;
    let climb = -Infinity;
    for (const t of a.lookahead) {
      const d = this.speed * t;
      const px = this.position.x + this.forward.x * d;
      const pz = this.position.z + this.forward.z * d;
      const py = this.position.y + this.forward.y * d;
      const short = this.floorAt(px, pz) + a.clearance - py;
      if (short > 0) climb = Math.max(climb, short / Math.max(1, d));
    }
    if (climb > -Infinity) {
      const minY = Math.sin((a.climbDeg * Math.PI) / 180) * Math.min(1, 0.4 + climb);
      want.y = Math.max(want.y / len, minY) * len;
    }
    // 戦域: soft の外で外へ向かう分を中へ
    const dx = this.position.x - this.center.x;
    const dz = this.position.z - this.center.z;
    const r = Math.hypot(dx, dz);
    if (r > C.arena.soft) {
      const k = Math.min(1, (r - C.arena.soft) / (C.arena.hard - C.arena.soft));
      want.x = want.x * (1 - k) - (dx / r) * len * k * 1.5;
      want.z = want.z * (1 - k) - (dz / r) * len * k * 1.5;
    }
  }

  /** 速さを target へ（accel m/s²） */
  approachSpeed(target: number, accel: number, dt: number): void {
    const d = target - this.speed;
    const step = accel * dt;
    this.speed += Math.abs(d) <= step ? d : Math.sign(d) * step;
  }

  /**
   * 進めて、制約（床・天井・戦域）を掛ける。minClear は体の中心から床までの最小（止まり木は立つ高さ）
   */
  integrate(dt: number, minClear: number = C.bodyClearance): void {
    const p = this.position;
    p.x += this.forward.x * this.speed * dt;
    p.y += this.forward.y * this.speed * dt;
    p.z += this.forward.z * this.speed * dt;
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const r = Math.hypot(dx, dz);
    if (r > C.arena.hard) {
      p.x = this.center.x + (dx / r) * C.arena.hard;
      p.z = this.center.z + (dz / r) * C.arena.hard;
    }
    const ground = this.floorAt(p.x, p.z);
    const floor = ground + minClear;
    if (p.y < floor) {
      p.y = floor;
      if (this.forward.y < 0) this.levelOff();
    }
    // 天井は海面からの高さ。高い山の上でも床（巡航の最小）より下にはしない
    const top = Math.max(this.ceiling, ground + C.bodyClearance + 60);
    if (p.y > top && this.state !== 'perched') {
      // 9-6b: 翼が壊れて天井が下がったときに瞬間移動しないよう、上から外れた分は ceilingDrop m/s で下げる
      p.y = Math.max(top, p.y - C.ceilingDrop * dt);
      if (this.forward.y > 0) this.levelOff();
    }
    this.updateBank(dt);
    this.time += dt;
    this.stateTime += dt;
  }

  /** 上下の向きを水平に戻す（床・天井に当たったとき） */
  private levelOff(): void {
    const f = this.forward;
    const h = Math.hypot(f.x, f.z);
    if (h < 1e-6) {
      f.x = 0;
      f.y = 0;
      f.z = -1;
      return;
    }
    f.x /= h;
    f.y = 0;
    f.z /= h;
  }

  /** 傾き: 水平の向きの変わる速さから（曲がる内側へ倒す）。翼が壊れていればその側へ傾く */
  private updateBank(dt: number): void {
    const a = Math.atan2(this.prevForward.x, -this.prevForward.z);
    const b = Math.atan2(this.forward.x, -this.forward.z);
    let d = b - a;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    const yawRate = dt > 0 ? d / dt : 0;
    const list =
      ((this.broken.wingR ? 1 : 0) - (this.broken.wingL ? 1 : 0)) *
      ((C.broken.wingListDeg * Math.PI) / 180);
    const target = this.state === 'perched' ? 0 : clamp(yawRate * 2.2, -1.0, 1.0) + list;
    this.bank += (target - this.bank) * Math.min(1, dt * 2.5);
  }

  /** p への向き（単位）を scratch に入れて返す。距離は戻り値の w ではなく distanceTo で */
  directionTo(p: Readonly<Vec3>): Vec3 {
    scratch.x = p.x - this.position.x;
    scratch.y = p.y - this.position.y;
    scratch.z = p.z - this.position.z;
    const l = Math.hypot(scratch.x, scratch.y, scratch.z) || 1;
    scratch.x /= l;
    scratch.y /= l;
    scratch.z /= l;
    return scratch;
  }
}
