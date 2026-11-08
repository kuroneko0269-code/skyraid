// 10-7b: 白鯨アルビオンの見た目の演出の進行（描画だけ。判定の値は読むだけ）: 体に沿って流れる雲・潮吹きのしぶきと霧・
// 雲を吐く前の霧・胸びれと尾びれの水の筋・雨と稲光・体の下の大きな影・鳥の群れ・部位を壊したときの破片と巣が裂ける赤い霧・
// 撃破で海へ落ちたときの大きな水柱・登場の雲の幕・身じろぎ・呼吸・目の光をマテリアルへ。粒は共通の kaiju-look/。
// 乱数は Math.random（見た目だけ）
import { Color, Matrix4, Vector3, type Object3D } from 'three';
import { ALBION_NESTS, ALBION_PARTS, type AlbionPart } from '../../data/albion';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import { ALBION_VISUAL, type AlbionTierSpec } from '../../data/albion-visual';
import type { AlbionKaiju } from '../../ai/albion-ai';
import { KaijuBirds } from '../kaiju-look/birds';
import { KaijuDebris } from '../kaiju-look/debris';
import type { KaijuLights } from '../kaiju-look/lights';
import { KaijuPuffs } from '../kaiju-look/puffs';
import { KaijuShadow } from '../kaiju-look/shadow';
import { KaijuStreaks } from '../kaiju-look/streaks';
import { createAlbionLook, type AlbionLook } from './material';
import { AlbionPuffFx, P, REST } from './albion-puffs';
import { AlbionMotion } from './motion';
import { ALBION_BONE, type AlbionSkeleton } from './skeleton';

const V = ALBION_VISUAL;
const MG = ALBION_MODEL_CONFIG.glow;

/** 描画の側から渡す値（runtime が作る） */
export interface AlbionViewInput {
  /** カメラの位置（ワールド） */
  readonly camera: Readonly<{ x: number; y: number; z: number }>;
  /** 天候の雨（0〜1） */
  readonly rain: number;
  /** 倒した（レイドの撃破）・海に着いた */
  readonly dead: boolean;
  readonly landed: boolean;
  /** 登場の雲の幕（0〜1。場面の間だけ） */
  readonly veil: number;
  /** 演出を進める秒数（止めている間は 0） */
  readonly fxDt: number;
}

/** 部位の場所（体の座標） */
const PART_AT: Readonly<Record<AlbionPart, Vector3>> = {
  body: new Vector3(0, -40, 0),
  nestFront: new Vector3(0, -58, -120),
  nestMid: new Vector3(0, -55, 0),
  nestRear: new Vector3(0, -42, 110),
  dorsal: P.dorsal,
  tail: P.tail,
  head: P.head,
};

const v1 = new Vector3();
const v2 = new Vector3();
const vel = new Vector3();
const fwd = new Vector3();
const cam = new Vector3();
const local = new Vector3();
const tmpC = new Color();
const bone = new Matrix4();

export class AlbionEffects {
  readonly streaks: KaijuStreaks;
  readonly puffs: KaijuPuffs;
  readonly debris: KaijuDebris;
  readonly shadow: KaijuShadow | null;
  readonly birds: KaijuBirds;
  readonly motion = new AlbionMotion();
  readonly look: AlbionLook = createAlbionLook();
  private readonly emit: AlbionPuffFx;
  private readonly wasBroken = new Map<AlbionPart, boolean>();
  private readonly brokenSmoke = new Map<AlbionPart, number>();
  private wasDead = false;
  private wasLanded = false;
  private wasRoar = false;
  private strokeSign = 0;
  private deadTime = 0;
  private roar = 0;
  private flashAge = 9;
  private strikeIn = 3;
  private lastFlash = 0;
  private readonly lastCenter = new Vector3();

  constructor(
    private readonly spec: AlbionTierSpec,
    private readonly rig: AlbionSkeleton,
    private readonly lights: KaijuLights,
  ) {
    this.streaks = new KaijuStreaks(spec.streaks, V.streaks);
    this.streaks.windColor.setRGB(0.85, 0.93, 1);
    this.streaks.windAlpha = 0.2;
    this.puffs = new KaijuPuffs(spec.puffs);
    this.debris = new KaijuDebris(spec.debris, V.debris);
    this.shadow = spec.shadow ? new KaijuShadow(V.shadow) : null;
    this.birds = new KaijuBirds(spec.birds, V.birds.span, V.birds.spread, V.colors.bird);
    this.emit = new AlbionPuffFx(spec, this.puffs, (out, p, b) => this.at(out, p, b));
    for (const p of ALBION_PARTS) {
      this.wasBroken.set(p, false);
      this.brokenSmoke.set(p, 0);
    }
  }

  get objects(): readonly Object3D[] {
    const o: Object3D[] = [
      this.streaks.mesh,
      this.puffs.mesh,
      this.debris.shards,
      this.debris.smoke,
      this.birds.mesh,
    ];
    if (this.shadow) o.push(this.shadow.mesh);
    return o;
  }

  /** 吠える強さ（0〜1。motion が口を開ける） */
  get roarAmount(): number {
    return this.roar;
  }

  /** 体の座標の点をワールドへ（root の骨。group と骨が新しい後） */
  private at(
    out: Vector3,
    p: Readonly<Vector3>,
    boneName: 'root' | 'finL' | 'finR' | 'flukes' = 'root',
  ): Vector3 {
    const b = this.rig.bones[ALBION_BONE[boneName]];
    if (!b) return out.copy(p);
    if (boneName === 'root') return out.copy(p).applyMatrix4(b.matrixWorld);
    // 骨の座標へ（静止姿勢の骨の位置を引く）
    bone.copy(b.matrixWorld);
    const rest = REST[boneName];
    return out.copy(p).sub(rest).applyMatrix4(bone);
  }

  /** 新しく出した（レイドのやり直し・再生のシーク）: 残りを消す */
  reset(k: AlbionKaiju): void {
    ALBION_PARTS.forEach((p, i) => {
      this.wasBroken.set(p, k.parts.isBroken(i));
      this.brokenSmoke.set(p, 0);
    });
    this.wasDead = false;
    this.wasLanded = false;
    this.deadTime = 0;
    this.emit.reset();
    this.debris.clear();
    this.puffs.clear();
    this.motion.reset();
  }

  /** 登場の場面の始め: 体の前の半分を雲の塊で包む（頭が押し分けて出てくる） */
  cloudBank(forward: Readonly<Vector3>): void {
    this.lightCloud(this.emit.cloud, 1);
    this.emit.cloudBank(forward);
  }

  /** 体に沿って流れる雲を前から出ていたことにする */
  warmWisps(k: AlbionKaiju, forward: Readonly<Vector3>): void {
    this.lightCloud(this.emit.cloud, 1);
    this.emit.warmWisps(k, forward);
  }

  /** 雲の色（空と日の色から。明るさ k） */
  private lightCloud(out: Color, k: number): Color {
    const l = this.lights;
    const sky = tmpC.copy(l.skyColor);
    const m = Math.max(1, sky.r, sky.g, sky.b);
    out.set(V.colors.cloud).multiply(sky.multiplyScalar(0.55 / m));
    const s = l.sunColor;
    const sm = Math.max(1, s.r, s.g, s.b);
    out.r += (s.r / sm) * 0.5;
    out.g += (s.g / sm) * 0.5;
    out.b += (s.b / sm) * 0.5;
    return out.multiplyScalar(k);
  }

  /**
   * 骨を動かした後（matrixWorld が新しい）。center は体の位置（ワールド）、heading は向き、flash は被弾の残り（0〜1）
   */
  update(
    k: AlbionKaiju,
    center: Readonly<Vector3>,
    heading: number,
    flash: number,
    input: AlbionViewInput,
    time: number,
  ): void {
    const dt = input.fxDt;
    const L = this.look;
    cam.set(input.camera.x, input.camera.y, input.camera.z);
    fwd.set(-Math.sin(heading), 0, -Math.cos(heading));
    vel.subVectors(center, this.lastCenter).divideScalar(Math.max(dt, 1e-3));
    if (dt <= 0 || vel.lengthSq() > 200 * 200) vel.copy(fwd).multiplyScalar(k.body.speed);
    this.lastCenter.copy(center);
    const parts = k.parts;
    // 部位の破壊: 破片・身じろぎ・巣は赤い霧が噴き出す・しばらく煙
    ALBION_PARTS.forEach((p, i) => {
      const broken = parts.isBroken(i);
      if (broken && !this.wasBroken.get(p)) this.breakPart(p, vel);
      this.wasBroken.set(p, broken);
    });
    if (flash > this.lastFlash + 0.3) this.motion.kick(0.35);
    this.lastFlash = flash;
    // 吠える（段階の変わり目）
    const roaring = k.action === 'roar' && !input.dead;
    if (roaring && !this.wasRoar) this.motion.kick(0.8);
    this.wasRoar = roaring;
    this.roar += ((roaring ? 1 : 0) - this.roar) * Math.min(1, dt * 1.5);
    // 倒した・海に着いた
    if (input.dead && !this.wasDead) {
      this.deadTime = 0;
      this.debris.burst(center, vel, Math.min(30, this.spec.debris >> 1), false);
    }
    this.wasDead = input.dead;
    if (input.dead) this.deadTime += dt;
    if (input.landed && !this.wasLanded) this.emit.startSplash(center, k);
    this.wasLanded = input.landed;
    // マテリアルの値
    const pulse = 0.65 + 0.35 * Math.sin(time * MG.nestPulseHz * Math.PI * 2);
    ALBION_NESTS.forEach((n, i) => {
      L.nests[i] = parts.isBroken(n.part) ? 0 : V.nestGlow * pulse;
    });
    const windup = k.action === 'windup' ? 1 : 0;
    const headOk = !parts.isBroken(parts.indexOf('head'));
    L.eye = headOk
      ? V.eyes.idle + (V.eyes.windup - V.eyes.idle) * windup + V.eyes.roar * this.roar
      : 0.15;
    L.spout = k.body.pose.spoutSwell;
    L.flash = flash;
    L.storm += (input.rain - L.storm) * Math.min(1, dt * 0.8);
    L.dead = input.dead ? Math.min(1, this.deadTime / 3) : 0;
    L.breath = input.dead ? 0 : V.breath.amount * Math.sin(time * V.breath.rate * Math.PI * 2);
    L.veil = input.veil;
    L.mouth = this.motion.mouth * (input.dead ? 0.3 : 1);
    this.lightning(dt);
    // 粒
    this.lightCloud(this.emit.cloud, 1);
    this.emit.vel.copy(vel);
    if (dt > 0) {
      this.emit.wisps(k, dt, input.dead);
      this.emit.spout(k, dt);
      this.emit.mist(k, dt);
      this.waterTrails(k, dt, input.dead);
      this.smoke(dt, input.dead, input.landed);
      this.emit.splash(dt);
    }
    this.streaks.update(center, cam, this.spec.streaks > 0 ? L.storm : 0, dt);
    this.puffs.update(cam, dt);
    this.debris.update(dt);
    // 影: 真下の床へ（倒れて消えると薄く）
    if (this.shadow) {
      const floor = k.body.floorAt(center.x, center.z);
      const sun = this.lights.sunDir;
      const lit = Math.min(1, Math.max(0, sun.y / Math.max(1e-3, sun.length())) * 3);
      this.shadow.update(
        center,
        heading,
        floor,
        sun,
        (k.body.visible ? 1 : 0) * lit * (1 - L.storm * 0.6),
      );
    }
    // 鳥: 体の横（倒すと散って消える）・近いときだけ
    const B = V.birds.offset;
    local.set(B.right, B.up, -B.forward);
    this.at(v1, local);
    this.birds.update(
      v1,
      heading,
      dt,
      !input.dead && cam.distanceTo(v1) < 3000 && this.spec.birds > 0,
    );
  }

  private breakPart(p: AlbionPart, v: Readonly<Vector3>): void {
    const nest = p.startsWith('nest');
    this.at(v1, PART_AT[p]);
    this.debris.burst(v1, v, Math.min(28, this.spec.debris >> 2), nest);
    this.motion.kick(nest ? 0.9 : 1.4);
    this.brokenSmoke.set(p, 8);
    this.emit.partBurst(v1, v, nest);
  }

  /**
   * 胸びれ・尾びれの先から水（雲の水気）の筋。尾びれは打ちの速い所（打ちの途中）で強く、打ち返す所（上と下の端）で
   * 尾びれの先に渦の霧を残す（泳いでいるのが分かるように）
   */
  private waterTrails(k: AlbionKaiju, dt: number, dead: boolean): void {
    if (this.spec.streaks <= 0 || dead || !k.body.visible) return;
    const ph = k.body.pose.swimPhase * Math.PI * 2;
    // 尾びれの骨の打ちの速さ（animateAlbion の尾びれの位相）
    const stroke = Math.cos(ph - 2.1);
    const kick = Math.abs(stroke);
    this.streaks.wingTrail(this.at(v1, P.finTipL, 'finL'), fwd, 0.45, dt * 0.5, 8);
    this.streaks.wingTrail(this.at(v1, P.finTipR, 'finR'), fwd, 0.45, dt * 0.5, 8);
    this.streaks.wingTrail(this.at(v1, P.flukeL, 'flukes'), fwd, 0.2 + kick * 0.8, dt * 0.6, 6);
    this.streaks.wingTrail(this.at(v1, P.flukeR, 'flukes'), fwd, 0.2 + kick * 0.8, dt * 0.6, 6);
    const sign = stroke >= 0 ? 1 : -1;
    if (sign !== this.strokeSign && this.strokeSign !== 0) {
      for (const tip of [P.flukeL, P.flukeR, P.tail]) {
        this.at(v1, tip, tip === P.tail ? 'root' : 'flukes');
        this.emit.vortex(v1, sign);
      }
    }
    this.strokeSign = sign;
  }

  /** 壊れた所の煙・倒れて墜ちる間の煙 */
  private smoke(dt: number, dead: boolean, landed: boolean): void {
    for (const [p, left] of this.brokenSmoke) {
      if (left <= 0) continue;
      this.brokenSmoke.set(p, left - dt);
      if (dead || Math.random() > dt * 3) continue;
      const nest = p.startsWith('nest');
      const where =
        p === 'dorsal' ? P.dorsal : p === 'tail' ? P.tail : p === 'head' ? P.head : null;
      if (where) this.at(v1, where);
      else this.at(v1, local.set(0, -56, p === 'nestFront' ? -120 : p === 'nestMid' ? 0 : 110));
      this.debris.puff(v1, v2.copy(vel).multiplyScalar(0.3), nest ? 10 : 14);
    }
    if (dead && !landed && Math.random() < dt * 8) {
      local.set((Math.random() - 0.5) * 80, -40, -200 + Math.random() * 400);
      this.at(v1, local);
      this.debris.puff(v1, v2.copy(vel).multiplyScalar(0.2), 22);
    }
  }

  /** 雨の空の稲光（体を照らす。2 回瞬いて消える） */
  private lightning(dt: number): void {
    const L = this.look;
    this.flashAge += dt;
    if (L.storm > 0.5 && dt > 0) {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.strikeIn = (3 + Math.random() * 6) / L.storm;
        this.flashAge = 0;
        const a = Math.random() * Math.PI * 2;
        L.lightningDir.set(Math.cos(a), 1.2, Math.sin(a)).normalize();
      }
    }
    const t = this.flashAge / 0.32;
    L.lightning = t < 1 ? 2 * (1 - t) * (t < 0.25 || t > 0.45 ? 1 : 0.35) : 0;
  }

  hide(): void {
    this.shadow?.hide();
    this.birds.hide();
  }

  dispose(): void {
    this.streaks.mesh.geometry.dispose();
    this.puffs.dispose();
    this.debris.dispose();
    this.shadow?.dispose();
    this.birds.dispose();
  }
}
