// 10-7c: メカ怪獣ゴウライの見た目の演出の進行（描画だけ。判定の値は読むだけ）: 部位を壊したときの爆発と煙・被弾の火花・放熱の蒸気
// （背の放熱板・前の装甲）・熱が高いときの継ぎ目の蒸気・排気口の熱のゆらぎ（壊れると黒い煙）・推進器の熱と海面の吹きおろし・
// 雨と稲光・体の下の影・装甲を捨てる瞬間の爆発・撃破の爆発の連鎖と海に着いたときの水柱・沈む間の蒸気・登場で体から落ちる水・
// 目と熱と口の光をマテリアルへ。粒は共通の kaiju-look/（炎は足し合わせて光る粒）。乱数は Math.random（見た目だけ）
import { Color, Vector3, type Object3D } from 'three';
import { GOURAI_PARTS, type GouraiPart } from '../../data/gourai';
import { GOURAI_VISUAL, type GouraiTierSpec } from '../../data/gourai-visual';
import type { GouraiKaiju } from '../../ai/gourai-ai';
import { KaijuDebris } from '../kaiju-look/debris';
import type { KaijuLights } from '../kaiju-look/lights';
import { KaijuPuffs } from '../kaiju-look/puffs';
import { KaijuShadow } from '../kaiju-look/shadow';
import { KaijuStreaks } from '../kaiju-look/streaks';
import { GOURAI_PART_AT, GouraiAmbient } from './gourai-ambient';
import { GouraiEmit } from './gourai-emit';
import { createGouraiGlow, type GouraiGlow } from './material';
import { GouraiMotion } from './motion';
import { GOURAI_BONE, type GouraiSkeleton } from './skeleton';

const V = GOURAI_VISUAL;

/** 描画の側から渡す値（runtime が作る） */
export interface GouraiViewInput {
  /** カメラの位置（ワールド） */
  readonly camera: Readonly<{ x: number; y: number; z: number }>;
  /** 天候の雨（0〜1） */
  readonly rain: number;
  /** 倒した（レイドの撃破）・海に着いた・沈んだ割合（0〜1。着いてから消えるまで） */
  readonly dead: boolean;
  readonly landed: boolean;
  readonly sink: number;
  /** 登場: 水の下にいる割合（1 = 沈んでいる → 0 = 浮かび上がった）・目が灯った（0 = 暗い → 1。灯る瞬間は強く光る） */
  readonly rise: number;
  readonly eyes: number;
  /** 演出を進める秒数（止めている間は 0） */
  readonly fxDt: number;
}

const v1 = new Vector3();
const vel = new Vector3();
const cam = new Vector3();
const local = new Vector3();
const tmpC = new Color();

export class GouraiEffects {
  readonly streaks: KaijuStreaks;
  readonly puffs: KaijuPuffs;
  readonly fire: KaijuPuffs;
  readonly debris: KaijuDebris;
  readonly shadow: KaijuShadow | null;
  readonly motion = new GouraiMotion();
  readonly glow: GouraiGlow = createGouraiGlow();
  private readonly emit: GouraiEmit;
  private readonly ambient: GouraiAmbient;
  private readonly wasBroken = new Map<GouraiPart, boolean>();
  private readonly brokenSmoke = new Map<GouraiPart, number>();
  private wasDead = false;
  private wasLanded = false;
  private wasPhase = 1;
  private deadTime = 0;
  private lastFlash = 0;
  private flashAge = 9;
  private strikeIn = 3;
  private readonly lastCenter = new Vector3();

  constructor(
    private readonly spec: GouraiTierSpec,
    private readonly rig: GouraiSkeleton,
    private readonly lights: KaijuLights,
  ) {
    this.streaks = new KaijuStreaks(spec.streaks, V.streaks);
    this.streaks.windColor.set(V.colors.spark);
    this.streaks.windAlpha = 0.95;
    this.puffs = new KaijuPuffs(spec.puffs);
    this.fire = new KaijuPuffs(spec.fire, true);
    this.debris = new KaijuDebris(spec.debris, V.debris);
    this.shadow = spec.shadow ? new KaijuShadow(V.shadow) : null;
    // 線の粒の 3 割が火花（7 割は雨。kaiju-look/streaks.ts）
    this.emit = new GouraiEmit(
      this.puffs,
      this.fire,
      this.streaks,
      this.debris,
      Math.floor(spec.streaks * 0.3),
    );
    this.ambient = new GouraiAmbient(spec, this.emit, this.motion, (out, p) => this.at(out, p));
    for (const p of GOURAI_PARTS) {
      this.wasBroken.set(p, false);
      this.brokenSmoke.set(p, 0);
    }
  }

  get objects(): readonly Object3D[] {
    const o: Object3D[] = [
      this.streaks.mesh,
      this.puffs.mesh,
      this.fire.mesh,
      this.debris.shards,
      this.debris.smoke,
    ];
    if (this.shadow) o.push(this.shadow.mesh);
    return o;
  }

  /** 体の座標の点をワールドへ（root の骨。group と骨が新しい後） */
  private at(out: Vector3, p: Readonly<Vector3>): Vector3 {
    const b = this.rig.bones[GOURAI_BONE.root];
    return b ? out.copy(p).applyMatrix4(b.matrixWorld) : out.copy(p);
  }

  /** 新しく出した（レイドのやり直し・再生のシーク）: 残りを消す */
  reset(k: GouraiKaiju): void {
    GOURAI_PARTS.forEach((p, i) => {
      this.wasBroken.set(p, k.parts.isBroken(i));
      this.brokenSmoke.set(p, 0);
    });
    this.wasDead = false;
    this.wasLanded = false;
    this.wasPhase = k.phase;
    this.deadTime = 0;
    this.debris.clear();
    this.puffs.clear();
    this.fire.clear();
    this.motion.reset();
  }

  /** 粒と動き・光の残りを消す（撮影の場面の切り替え） */
  clearParticles(): void {
    this.debris.clear();
    this.puffs.clear();
    this.fire.clear();
    this.motion.reset();
    Object.assign(this.glow, { heat: 0, vent: 0, anger: 0, wet: 0, storm: 0 });
  }

  /** 骨を動かした後（matrixWorld が新しい）。center は体の位置（ワールド）、heading は向き、flash は被弾の光（0〜1） */
  update(
    k: GouraiKaiju,
    center: Readonly<Vector3>,
    heading: number,
    flash: number,
    input: GouraiViewInput,
  ): void {
    const dt = input.fxDt;
    const G = this.glow;
    cam.set(input.camera.x, input.camera.y, input.camera.z);
    vel.subVectors(center, this.lastCenter).divideScalar(Math.max(dt, 1e-3));
    if (dt <= 0 || vel.lengthSq() > 120 * 120) vel.set(k.body.velocity.x, 0, k.body.velocity.z);
    this.lastCenter.copy(center);
    const parts = k.parts;
    const live = !input.dead;
    // 部位の破壊: 爆発・身じろぎ・しばらく煙（排気口は消えるまで黒い煙）
    GOURAI_PARTS.forEach((p, i) => {
      const broken = parts.isBroken(i);
      if (broken && !this.wasBroken.get(p)) {
        this.at(v1, GOURAI_PART_AT.get(p) ?? local.set(0, 0, 0));
        this.emit.blast(v1, vel, p === 'core' ? 1.5 : 1, Math.min(24, this.spec.debris >> 2));
        this.motion.kick(1.4);
        this.brokenSmoke.set(p, p.startsWith('exhaust') ? 1e9 : 10);
      }
      this.wasBroken.set(p, broken);
    });
    // 被弾: 身じろぎと、自機の側の装甲に火花
    if (flash > this.lastFlash + 0.3 && dt > 0) {
      this.motion.kick(0.4);
      v1.subVectors(cam, center).normalize().multiplyScalar(48).add(center);
      v1.x += (Math.random() - 0.5) * 50;
      v1.y += (Math.random() - 0.5) * 30;
      v1.z += (Math.random() - 0.5) * 50;
      this.emit.sparkBurst(v1, vel, 10, 70);
    }
    this.lastFlash = flash;
    // 装甲を捨てた瞬間（後半へ）: 前の装甲の蝶番で爆発と蒸気
    if (k.phase > this.wasPhase && live) {
      for (const s of [-1, 1]) {
        this.at(v1, local.set(s * 40, 0, -60));
        this.emit.blast(v1, vel, 1.3, Math.min(20, this.spec.debris >> 2));
      }
      this.motion.kick(1.2);
    }
    this.wasPhase = k.phase;
    // 倒した: 爆発が連鎖して、傾いて海へ。着いたら水柱、沈む間は蒸気
    if (input.dead && !this.wasDead) {
      this.deadTime = 0;
      this.ambient.chainIn = 0;
    }
    this.wasDead = input.dead;
    if (input.dead) this.deadTime += dt;
    if (input.landed && !this.wasLanded) {
      this.emit.column(center, k.body.floorAt(center.x, center.z));
      this.at(v1, local.set(0, 10, 0));
      this.emit.blast(v1, vel, 2.2, Math.min(30, this.spec.debris >> 1));
    }
    this.wasLanded = input.landed;
    // マテリアルの値
    const pose = k.body.pose;
    const vent = k.action === 'vent' ? 1 : 0;
    const attacking = (k.action === 'windup' || k.action === 'active') && k.attack !== null;
    G.heat += (Math.min(1, k.heat / 100) - G.heat) * Math.min(1, dt * 2);
    G.vent +=
      (Math.max(vent, pose.purge * (1 - pose.purge) * 4, this.motion.finOpen) - G.vent) *
      Math.min(1, dt * 3);
    G.anger += ((attacking || k.action === 'purge' ? 1 : 0) - G.anger) * Math.min(1, dt * 4);
    const flare =
      input.eyes > 0 && input.eyes < 1 ? Math.sin(input.eyes * Math.PI) * V.eyes.flare : 0;
    G.eye = live
      ? (V.eyes.dark + (V.eyes.idle - V.eyes.dark) * input.eyes) *
          (1 + G.anger * (V.eyes.windup / V.eyes.idle - 1)) +
        flare
      : Math.max(0, 1 - this.deadTime / 2) * V.eyes.idle;
    G.mouth = this.motion.mouth * (live ? 0.5 + 0.5 * Math.max(G.anger, vent) : 0.2);
    G.slit = live ? (0.35 + 0.9 * G.anger + 0.5 * G.heat) * Math.min(1, input.eyes * 1.5 + 0.1) : 0;
    G.flash = flash;
    G.storm += (input.rain - G.storm) * Math.min(1, dt * 0.8);
    G.dead = input.dead ? Math.min(1, this.deadTime / 3) : 0;
    G.wet = Math.max(G.wet - dt * 0.12, input.rise > 0.02 ? 1 : 0);
    this.lightning(dt);
    // 煙・蒸気の色（空の明るさ）
    const sky = tmpC.copy(this.lights.skyColor);
    const m = Math.max(1, sky.r, sky.g, sky.b);
    const sun = this.lights.sunColor;
    const sm = Math.max(1, sun.r, sun.g, sun.b);
    const light = Math.min(
      1.1,
      0.35 +
        ((sky.r + sky.g + sky.b) / (3 * m)) * 0.4 +
        ((sun.r + sun.g + sun.b) / (3 * sm)) * 0.35,
    );
    this.emit.steam.set(V.colors.steam).multiplyScalar(light);
    this.emit.splash.set(V.colors.splash).multiplyScalar(light);
    this.emit.smoke.set(V.colors.smoke).multiplyScalar(0.6 + light * 0.4);
    if (dt > 0 && k.body.visible)
      this.ambient.step(k, center, vel, dt, input, this.deadTime, this.brokenSmoke);
    this.streaks.update(center, cam, this.spec.streaks > 0 ? G.storm : 0, dt);
    this.puffs.update(cam, dt);
    this.fire.update(cam, dt);
    this.debris.update(dt);
    // 影: 真下の海面へ（倒れて沈むと薄く。登場の水の下では出さない）
    if (this.shadow) {
      const floor = k.body.floorAt(center.x, center.z);
      const s = this.lights.sunDir;
      const lit = Math.min(1, Math.max(0, s.y / Math.max(1e-3, s.length())) * 3);
      this.shadow.update(
        center,
        heading,
        floor,
        s,
        (k.body.visible ? 1 : 0) * lit * (1 - G.storm * 0.6) * (1 - input.sink) * (1 - input.rise),
      );
    }
  }

  /** 雨の空の稲光（体を照らす。2 回瞬いて消える） */
  private lightning(dt: number): void {
    const G = this.glow;
    this.flashAge += dt;
    if (G.storm > 0.5 && dt > 0) {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.strikeIn = (3 + Math.random() * 6) / G.storm;
        this.flashAge = 0;
        const a = Math.random() * Math.PI * 2;
        G.lightningDir.set(Math.cos(a), 1.2, Math.sin(a)).normalize();
      }
    }
    const t = this.flashAge / 0.32;
    G.lightning = t < 1 ? 2 * (1 - t) * (t < 0.25 || t > 0.45 ? 1 : 0.35) : 0;
  }

  hide(): void {
    this.shadow?.hide();
  }

  dispose(): void {
    this.streaks.mesh.geometry.dispose();
    this.puffs.dispose();
    this.fire.dispose();
    this.debris.dispose();
    this.shadow?.dispose();
  }
}
