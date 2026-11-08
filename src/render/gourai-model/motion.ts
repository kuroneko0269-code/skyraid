// 10-7c: メカ怪獣ゴウライの動きの上乗せ（描画だけ。判定の値（姿勢 GouraiPose・段・熱）は読むだけで書かない）: 油圧のように
// 「止まって・速く動いて・止まって少し揺れ戻る」サーボで、頭が自機を追う・あごを開く・腕が構える / 下ろす・爪が開く・背の放熱板が
// 開閉する（後ろの板ほど遅れる）・尾が揺れる・浮いた体の重い上下の揺れと傾き・被弾の身じろぎ。どれも体の当たりの箱 + 衝突の余裕の中
// （tests/gourai-visual.test.ts が頂点ごとに確かめる）。装甲・ハッチ・砲台・核は gourai-object.ts（判定の姿勢のまま）
import type { Bone, Vector3 } from 'three';
import { GOURAI_VISUAL } from '../../data/gourai-visual';
import type { GouraiAction, GouraiAttack } from '../../data/gourai';
import { GOURAI_BONE, GOURAI_FIN_Z, type GouraiBoneName, type GouraiSkeleton } from './skeleton';

const MO = GOURAI_VISUAL.motion;

/** 油圧のサーボ: 目標へ最大の速さ・加速で動き、止まるときに小さく揺れ戻る */
export class Servo {
  x = 0;
  private v = 0;
  private wob = 0;
  private wobV = 0;

  constructor(
    private readonly rate: number = MO.rate,
    private readonly accel: number = MO.accel,
  ) {}

  /** 今の値（揺れ戻りを含む） */
  get value(): number {
    return this.x + this.wob;
  }

  step(target: number, dt: number): number {
    if (dt <= 0) return this.value;
    const err = target - this.x;
    // 止まれる速さ（残りの距離から）と最大の速さの小さい方
    const want = Math.sign(err) * Math.min(this.rate, Math.sqrt(2 * this.accel * Math.abs(err)));
    const dv = Math.max(-this.accel * dt, Math.min(this.accel * dt, want - this.v));
    const before = this.v;
    this.v += dv;
    this.x += this.v * dt;
    // 急に止まった分だけ揺れ戻る（重い物が止まるときの小さな跳ね）
    if (Math.abs(this.v) < Math.abs(before)) this.wobV += (before - this.v) * MO.settle;
    this.wobV += (-140 * this.wob - 9 * this.wobV) * dt;
    this.wob += this.wobV * dt;
    return this.value;
  }

  reset(x = 0): void {
    this.x = x;
    this.v = this.wob = this.wobV = 0;
  }
}

/** 動きの入力（gourai-object.ts が作る） */
export interface GouraiMotionInput {
  readonly action: GouraiAction;
  readonly attack: GouraiAttack | null;
  readonly actionTime: number;
  readonly phase: number;
  /** 熱（0〜1）・倒れた・装甲を捨てた（0〜1） */
  readonly heat: number;
  readonly dead: boolean;
  readonly purge: number;
  /** 頭が追う相手（体の座標。null は前を見回す） */
  readonly aim: Readonly<Vector3> | null;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class GouraiMotion {
  private readonly headYaw = new Servo(1.1, 5);
  private readonly headPitch = new Servo(0.8, 4);
  private readonly jaw = new Servo(1.8, 10);
  private readonly arm = [new Servo(), new Servo()];
  private readonly fore = [new Servo(), new Servo()];
  private readonly claw = [new Servo(3, 20), new Servo(3, 20)];
  private readonly fins = GOURAI_FIN_Z.map(() => new Servo(1.3, 6));
  private flinch = 0;
  private flinchVel = 0;
  private scan = 0;
  private scanIn = 2;
  /** 体全体の上下の重い揺れ（m。gourai-object.ts が体の位置に足す） */
  bob = 0;

  /** 被弾・部位の破壊の身じろぎ（strength 1 で flinchKick） */
  kick(strength: number): void {
    this.flinchVel += MO.flinchKick * strength;
  }

  reset(): void {
    for (const s of [
      this.headYaw,
      this.headPitch,
      this.jaw,
      ...this.arm,
      ...this.fore,
      ...this.claw,
      ...this.fins,
    ])
      s.reset();
    this.flinch = this.flinchVel = this.bob = 0;
  }

  /** 今のあごの開き（0〜1。口の中の光） */
  get mouth(): number {
    return clamp(this.jaw.value, 0, 1);
  }

  /** 放熱板の開き（0〜1。蒸気・格子の光） */
  get finOpen(): number {
    let s = 0;
    for (const f of this.fins) s += clamp(f.value, 0, 1);
    return s / this.fins.length;
  }

  apply(s: GouraiSkeleton, input: GouraiMotionInput, time: number, dt: number): void {
    const get = (n: GouraiBoneName): Bone => {
      const b = s.bones[GOURAI_BONE[n]];
      if (!b) throw new Error(n);
      return b;
    };
    const a = input.action;
    const attacking = (a === 'windup' || a === 'active') && input.attack !== null;
    const vent = a === 'vent';
    const purge = a === 'purge';
    const dead = input.dead;
    // 重い揺れ（浮いた体がゆっくり上下・前後左右に傾く）と身じろぎ
    const k = Math.min(dt, 1 / 30);
    this.flinchVel += (-30 * this.flinch - MO.flinchDecay * 2 * this.flinchVel) * k;
    this.flinch += this.flinchVel * k;
    const jolt = clamp(this.flinch, -MO.flinchMax, MO.flinchMax);
    const w = time * MO.swayHz * Math.PI * 2;
    const live = dead ? 0 : 1;
    this.bob = MO.bob * live * Math.sin(w * 0.9 + 0.4);
    get('root').rotation.set(
      MO.sway * live * Math.sin(w) + jolt,
      0,
      MO.sway * 0.8 * live * Math.sin(w * 0.73 + 1.1) + jolt * 0.4,
    );
    // 頭: 自機を追う（前の半分にいるとき）。いなければときどき見回す。予兆は少し上・放熱は下・倒れるとうなだれる
    let yaw = 0;
    let pitch = 0;
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 2 + ((time * 7.3) % 3);
      this.scan = Math.sin(time * 3.7) * MO.headYaw * 0.7;
    }
    if (input.aim && !dead) {
      const ay = Math.atan2(-input.aim.x, -input.aim.z);
      if (Math.abs(ay) < 1.9) {
        yaw = ay;
        pitch = Math.atan2(input.aim.y - 25.5, Math.hypot(input.aim.x, input.aim.z));
      } else yaw = this.scan;
    } else if (!dead) yaw = this.scan;
    if (attacking) pitch += 0.1;
    if (vent) pitch -= 0.1;
    if (purge) pitch = MO.headPitchUp;
    if (dead) pitch = -MO.headPitchDown;
    get('head').rotation.set(
      clamp(
        this.headPitch.step(clamp(pitch, -MO.headPitchDown, MO.headPitchUp), dt),
        -MO.headPitchDown,
        MO.headPitchUp,
      ),
      clamp(this.headYaw.step(clamp(yaw, -MO.headYaw, MO.headYaw), dt), -MO.headYaw, MO.headYaw),
      0,
      'YXZ',
    );
    // あご: 予兆で開く（吠える）・回転掃射の間は小刻みに・放熱は半分（息を吐く）・装甲を捨てる間は大きく・倒れると開いたまま
    let jaw = 0;
    if (attacking) jaw = a === 'windup' ? 0.75 : 0.45 + 0.25 * Math.sin(time * 18);
    if (vent) jaw = 0.5;
    if (purge) jaw = 1;
    if (dead) jaw = 0.7;
    get('jaw').rotation.x = -clamp(this.jaw.step(jaw, dt), 0, 1) * MO.jawOpen;
    // 腕: 予兆と攻撃で構える（爪を頭の高さの前へ）・放熱で下ろす・ふだんは左右で少しずれて動く。爪は予兆で鳴らす。
    // 構えるときは油圧の順に「上腕を後ろへ引く → 前腕をたたむ → 上腕を上げる」、戻すときは逆の順（爪の通る道を体の当たりの中に収める）
    for (const i of [0, 1] as const) {
      const side = i === 0 ? 'L' : 'R';
      let rest = MO.armIdle * Math.sin(time * 0.31 + i * 2.1);
      let guard = false;
      let open = 0;
      if (attacking) {
        guard = true;
        open = a === 'windup' ? (Math.sin(time * 9 + i) > 0 ? 1 : 0.2) : 1;
      }
      if (vent) {
        rest = MO.armVent;
        open = 1;
      }
      if (purge) {
        guard = true;
        open = 1;
      }
      if (dead) {
        rest = MO.armVent;
        open = 0.6;
      }
      const arm = this.arm[i] as Servo;
      const fore = this.fore[i] as Servo;
      const back = MO.armBack;
      let armT: number;
      let foreT: number;
      if (guard) {
        // たたみ終わるまでは後ろへ引いたまま
        const folded = fore.x > MO.armFold - 0.12;
        armT = folded ? MO.armGuard : back;
        foreT = arm.x < back + 0.05 || folded ? MO.armFold : 0;
      } else if (fore.x > 0.08) {
        // 上腕を後ろへ引いてから前腕を伸ばす
        armT = back;
        foreT = arm.x < back + 0.05 ? 0 : MO.armFold;
      } else {
        armT = rest;
        foreT = 0;
      }
      get(`arm${side}`).rotation.x = arm.step(armT, dt);
      get(`fore${side}`).rotation.x = fore.step(foreT, dt);
      get(`claw${side}`).rotation.x =
        clamp((this.claw[i] as Servo).step(open, dt), 0, 1.1) * MO.clawOpen;
    }
    // 背の放熱板: 放熱で開く（後ろの板ほど遅れる）・熱が高いと少し浮く・装甲を捨てる間は開く・倒れると半ば開いたまま
    this.fins.forEach((f, i) => {
      let open = Math.max(0, (input.heat - 0.7) / 0.3) * MO.finHeat;
      if (vent && input.actionTime > i * MO.finStagger) open = 1;
      if (purge) open = 1;
      if (dead) open = 0.45;
      const ang = clamp(f.step(open, dt), 0, 1) * MO.finOpen;
      // 開いている間は熱で小さく震える
      const buzz = ang > 0.2 ? Math.sin(time * 31 + i * 1.7) * 0.012 : 0;
      get(`finL${String(i)}` as GouraiBoneName).rotation.z = -(ang + buzz);
      get(`finR${String(i)}` as GouraiBoneName).rotation.z = ang + buzz;
    });
    // 尾: ゆっくり左右に振れる（後ろの節ほど遅れる）。予兆で持ち上がる。後半は速い。倒れると垂れる
    const th = time * MO.tailHz * Math.PI * 2 * (input.phase === 2 ? 1.6 : 1);
    const lift = attacking || purge ? -0.06 : dead ? 0.05 : 0;
    const swing = dead ? 0.2 : 1;
    get('tail1').rotation.set(lift * 0.5, MO.tailSwing * swing * Math.sin(th), 0);
    get('tail2').rotation.set(lift * 0.5, MO.tailSwing * swing * Math.sin(th - 0.8), 0);
    get('tail3').rotation.set(lift, MO.tailSwing * swing * Math.sin(th - 1.6), 0);
  }
}
