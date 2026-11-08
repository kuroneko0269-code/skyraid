// 10-7a: ネフィルガの見た目の演出の進行（描画だけ。判定の値は読むだけ）: 嵐の強さ（段階 3・雨。倒すと晴れる）と稲光、
// 体の電気の弧（雷球の予兆・嵐・咆哮・倒れた後）、翼の風の筋と突風、部位を壊したときの破片・身じろぎ、墜ちるときの煙、
// 呼吸・裂けた翼をマテリアルへ。乱数は Math.random（見た目だけ）
import { Vector3, type Bone, type Object3D } from 'three';
import { KAIJU2_CONFIG } from '../../data/kaiju2';
import { KAIJU2_VISUAL, type Kaiju2TierSpec } from '../../data/kaiju2-visual';
import type { Kaiju2Part } from '../../data/kaiju2';
import type { SkyKaiju } from '../../entities/kaiju2/sky-kaiju';
import { Kaiju2Debris } from './kaiju2-debris';
import { Kaiju2Arcs } from './kaiju2-arcs';
import { Kaiju2Streaks } from './kaiju2-fx';
import type { Kaiju2Look } from './material';
import { Kaiju2Motion } from './motion';
import type { Kaiju2ViewInput } from './kaiju2-view-input';
import { BONE2, WING_TIP, bone2Position, type Kaiju2Skeleton } from './skeleton';

const VL = KAIJU2_VISUAL;
const LI = VL.lightning;

const tipL = new Vector3(-WING_TIP.x, WING_TIP.y, WING_TIP.z).sub(bone2Position('wingL2'));
const tipR = new Vector3(WING_TIP.x, WING_TIP.y, WING_TIP.z).sub(bone2Position('wingR2'));
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const vel = new Vector3();
const fwd = new Vector3();
const local = new Vector3();
const ANCHORS = [
  'chest',
  'neck0',
  'head',
  'wingL0',
  'wingL1',
  'wingL2',
  'wingR0',
  'wingR1',
  'wingR2',
  'tail1',
] as const;

export class Kaiju2Effects {
  readonly streaks: Kaiju2Streaks;
  readonly arcs: Kaiju2Arcs;
  readonly debris: Kaiju2Debris;
  readonly motion = new Kaiju2Motion();
  readonly look: Kaiju2Look = {
    throat: 0,
    vein: 0,
    storm: 0,
    dead: 0,
    lightning: 0,
    lightningDir: new Vector3(0, 1, 0),
    breath: 0,
    tornL: false,
    tornR: false,
  };
  private readonly wasBroken: Record<Kaiju2Part, boolean> = {
    wingL: false,
    wingR: false,
    head: false,
    tail: false,
  };
  private readonly brokenSmoke: Record<Kaiju2Part, number> = {
    wingL: 0,
    wingR: 0,
    head: 0,
    tail: 0,
  };
  private wasDead = false;
  private wasShout = false;
  private lastFlash = 0;
  private strikeIn: number = LI.minGap;
  private flashAge = 9;
  private deadTime = 0;
  private roar = 0;
  private arcAcc = 0;
  private puffAcc = 0;
  private readonly lastCenter = new Vector3();

  constructor(
    private readonly spec: Kaiju2TierSpec,
    private readonly rig: Kaiju2Skeleton,
  ) {
    this.streaks = new Kaiju2Streaks(spec.streaks);
    this.arcs = new Kaiju2Arcs(spec.arcs);
    this.debris = new Kaiju2Debris(spec.debris);
  }

  get objects(): readonly Object3D[] {
    return [this.streaks.mesh, this.arcs.mesh, this.debris.shards, this.debris.smoke];
  }

  /** 咆哮の強さ（0〜1。motion が首を上げる） */
  get roarAmount(): number {
    return this.roar;
  }

  private bone(n: (typeof ANCHORS)[number] | 'tail3'): Bone | undefined {
    return this.rig.bones[BONE2[n]];
  }

  private anchor(out: Vector3, n: (typeof ANCHORS)[number] | 'tail3'): Vector3 {
    const b = this.bone(n);
    return b ? out.setFromMatrixPosition(b.matrixWorld) : out;
  }

  private tip(out: Vector3, side: -1 | 1): Vector3 {
    const b = this.bone(side < 0 ? 'wingL2' : 'wingR2');
    return b ? out.copy(side < 0 ? tipL : tipR).applyMatrix4(b.matrixWorld) : out;
  }

  private partAt(out: Vector3, part: Kaiju2Part): Vector3 {
    if (part === 'wingL' || part === 'wingR')
      return this.tip(out, part === 'wingL' ? -1 : 1).lerp(
        this.anchor(v3, part === 'wingL' ? 'wingL1' : 'wingR1'),
        0.5,
      );
    return this.anchor(out, part === 'head' ? 'head' : 'tail3');
  }

  /** 新しく出した（レイドのやり直し・再生のシーク）: 残りを消す */
  reset(k: SkyKaiju): void {
    Object.assign(this.wasBroken, k.broken);
    this.wasDead = false;
    this.deadTime = 0;
    this.debris.clear();
    this.motion.reset();
  }

  /**
   * 骨を動かした後（matrixWorld が新しい）。center は体の位置（ワールド）、flash は被弾の残り（0〜1）。
   * 骨の上乗せ（motion）はこの前に呼ぶので、ここでは粒とマテリアルの値だけ
   */
  update(
    k: SkyKaiju,
    center: Readonly<Vector3>,
    flash: number,
    input: Kaiju2ViewInput,
    time: number,
  ): void {
    const dt = input.fxDt;
    const cam = v1.set(input.camera.x, input.camera.y, input.camera.z);
    fwd.set(k.forward.x, k.forward.y, k.forward.z);
    vel.subVectors(center, this.lastCenter).divideScalar(Math.max(dt, 1e-3));
    if (dt <= 0 || vel.lengthSq() > 400 * 400) vel.copy(fwd).multiplyScalar(k.speed);
    this.lastCenter.copy(center);
    // 嵐: 段階 3 か雨で強く、倒すと 3 秒ほどで晴れる
    const stormGoal = input.dead ? 0 : Math.max(input.rain, k.phase >= 3 ? 1 : 0);
    const L = this.look;
    L.storm += (stormGoal - L.storm) * Math.min(1, dt * (stormGoal < L.storm ? 0.6 : 1.5));
    // 部位の破壊: 破片・身じろぎ・電気の弧・しばらく煙
    for (const part of ['wingL', 'wingR', 'head', 'tail'] as const) {
      if (k.broken[part] && !this.wasBroken[part]) {
        const at = this.partAt(v2, part);
        this.debris.burst(at, vel, Math.min(24, this.spec.debris >> 2), part.startsWith('wing'));
        this.motion.kick(1.6);
        for (let i = 0; i < 4; i++)
          this.arcs.spark(at, local.copy(at).addScaledVector(randomDir(), 30), 0.35, 1.4);
        this.brokenSmoke[part] = 8;
      }
      this.wasBroken[part] = k.broken[part];
    }
    L.tornL = k.broken.wingL;
    L.tornR = k.broken.wingR;
    if (flash > this.lastFlash + 0.3) this.motion.kick(0.45);
    this.lastFlash = flash;
    // 咆哮（段階の変わり目）: 首を上げ、弧を散らし、稲光
    if (input.shout && !this.wasShout) {
      this.strikeIn = 0;
      for (let i = 0; i < 8; i++) this.bodyArc(1.2);
    }
    this.wasShout = input.shout;
    this.roar += ((input.shout ? 1 : 0) - this.roar) * Math.min(1, dt * 4);
    // 倒した: 煙を引いて墜ちる、弧が消えていく
    if (input.dead && !this.wasDead) {
      this.deadTime = 0;
      this.debris.burst(center, vel, Math.min(30, this.spec.debris >> 1), true);
    }
    this.wasDead = input.dead;
    if (input.dead) this.deadTime += dt;
    L.dead = input.dead ? Math.min(1, this.deadTime / 2.5) : 0;
    this.lightning(k, center, dt);
    this.arcsFrom(k, dt, input.dead);
    this.wind(k, dt);
    this.smoke(k, center, dt, input.dead);
    // 呼吸（止まり木では深く）
    const deep = k.state === 'perched' ? 1.5 : 1;
    L.breath = input.dead
      ? 0
      : VL.breath.amount * deep * Math.sin(time * VL.breath.rate * Math.PI * 2);
    this.streaks.update(center, cam, this.spec.streaks > 0 ? L.storm : 0, dt);
    this.arcs.update(cam, dt);
    this.debris.update(dt);
  }

  private lightning(k: SkyKaiju, center: Readonly<Vector3>, dt: number): void {
    const L = this.look;
    this.flashAge += dt;
    if (L.storm > 0.3 && dt > 0) {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.strikeIn = (LI.minGap + Math.random() * (LI.maxGap - LI.minGap)) / L.storm;
        this.flashAge = 0;
        const a = Math.random() * Math.PI * 2;
        const r = 250 + Math.random() * 450;
        v2.set(center.x + Math.cos(a) * r, center.y + LI.boltLength, center.z + Math.sin(a) * r);
        L.lightningDir.subVectors(v2, center).normalize();
        if (this.spec.arcs > 0) {
          // 稲妻: 空から体の近くへ（枝を 1 本）
          this.anchor(local, ANCHORS[Math.floor(Math.random() * ANCHORS.length)] ?? 'chest');
          this.arcs.spark(v2, local, LI.flashSeconds, 3.5, 0.12, 9);
          const mid = v2.clone().lerp(local, 0.45);
          this.arcs.spark(
            mid,
            mid.clone().addScaledVector(randomDir(), 220),
            LI.flashSeconds * 0.8,
            2,
            0.2,
            6,
          );
        }
      }
    }
    // 2 回瞬いて消える
    const t = this.flashAge / LI.flashSeconds;
    L.lightning = t < 1 ? LI.strength * (1 - t) * (t < 0.25 || t > 0.45 ? 1 : 0.35) : 0;
    if (k.state === 'perched') L.lightning *= 0.8;
  }

  private bodyArc(life: number): void {
    const a = ANCHORS[Math.floor(Math.random() * ANCHORS.length)] ?? 'chest';
    const b = ANCHORS[Math.floor(Math.random() * ANCHORS.length)] ?? 'head';
    this.anchor(v2, a);
    this.anchor(local, b);
    if (v2.distanceToSquared(local) < 100) local.addScaledVector(randomDir(), 35);
    this.arcs.spark(v2, local, 0.12 + Math.random() * 0.2 * life, 0.9, 0.22, 5);
  }

  private arcsFrom(k: SkyKaiju, dt: number, dead: boolean): void {
    if (this.spec.arcs <= 0) return;
    const windup = k.attack === 'orbs' && k.state === 'windup' ? 1 : 0;
    let rate = windup * 16 + this.look.storm * 1.5 + this.roar * 10;
    if (dead) rate = Math.max(0, 6 - this.deadTime * 3);
    this.arcAcc += rate * dt;
    while (this.arcAcc >= 1) {
      this.arcAcc -= 1;
      this.bodyArc(1);
    }
  }

  private wind(k: SkyKaiju, dt: number): void {
    if (this.spec.streaks <= 0 || dt <= 0) return;
    const p = k.pose;
    const down = Math.max(0, Math.cos(p.flapPhase * Math.PI * 2)) * p.flapAmount * (1 - p.wingFold);
    this.streaks.wingTrail(this.tip(v2, -1), fwd, down, dt * 0.5);
    this.streaks.wingTrail(this.tip(v2, 1), fwd, down, dt * 0.5);
    if (k.attack === 'gust' && k.state === 'attack') {
      const g = KAIJU2_CONFIG.attacks.gust;
      const n = Math.ceil(dt * 70);
      for (let i = 0; i < n; i++) {
        this.anchor(v2, 'head');
        local
          .copy(fwd)
          .addScaledVector(randomDir(), Math.tan((g.halfAngleDeg * Math.PI) / 180) * 0.8)
          .normalize();
        this.streaks.emit(
          v2,
          local.multiplyScalar(g.range / g.active),
          VL.fx.windLength * 1.6,
          g.active,
        );
      }
    }
  }

  private smoke(k: SkyKaiju, center: Readonly<Vector3>, dt: number, dead: boolean): void {
    this.puffAcc += dt;
    const every = dead ? 0.05 : 0.35;
    while (this.puffAcc >= every) {
      this.puffAcc -= every;
      if (dead && k.visible) {
        local.copy(vel).multiplyScalar(0.15);
        this.debris.puff(v2.copy(center).addScaledVector(randomDir(), 14), local, 16);
        if (Math.random() < 0.5)
          this.debris.puff(this.anchor(v2, Math.random() < 0.5 ? 'wingL1' : 'wingR1'), local, 9);
      }
      for (const part of ['wingL', 'wingR', 'head', 'tail'] as const) {
        if (this.brokenSmoke[part] <= 0) continue;
        this.brokenSmoke[part] -= every;
        if (!dead) this.debris.puff(this.partAt(v2, part), local.copy(vel).multiplyScalar(0.3), 5);
      }
    }
  }

  dispose(): void {
    this.arcs.dispose();
    this.debris.dispose();
    this.streaks.mesh.geometry.dispose();
  }
}

const rd = new Vector3();
function randomDir(): Vector3 {
  return rd.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}
