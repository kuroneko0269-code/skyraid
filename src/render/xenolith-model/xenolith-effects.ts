// 10-7d: UFO ゼノリスの見た目の演出の進行（描画だけ。判定の値は読むだけ）: きらめく粒（縁・急加速の後ろ）・急停止の光の波と
// つんのめり・急加速の光の尾・瞬間移動で光がほどけて（予兆の終わり）移った先で組み上がる（ゆがみの波と光の粒）・登場の光の柱と
// 組み上がり・部位の破壊の破片と火花と電気の弧・撃破の電気の弧と煙と水しぶき・遠くの目印の星・海の上の影・光の強さをマテリアルへ。
// 乱数は Math.random（見た目だけ）
import { Color, Vector3, type Object3D } from 'three';
import { xenolithSpherePoint, type XenolithKaiju } from '../../ai/xenolith-ai';
import { XENOLITH_PARTS, XENOLITH_TARGET_SPHERES, type XenolithPart } from '../../data/xenolith';
import { XENOLITH_VISUAL, type XenolithTierSpec } from '../../data/xenolith-visual';
import { KaijuArcs } from '../kaiju-look/arcs';
import { KaijuDebris } from '../kaiju-look/debris';
import { KaijuPuffs } from '../kaiju-look/puffs';
import { KaijuShadow } from '../kaiju-look/shadow';
import { createXenolithGlow, type XenolithGlow } from './chrome-material';
import { WaveFx } from './waves';
import { StarSprites } from './sprites';
import { TrailRibbon } from './trail';
import { stepDefeat } from './defeat-fx';

const V = XENOLITH_VISUAL;
const G = V.glints;

/** 描画の側から渡す値（runtime が作る） */
export interface XenolithViewInput {
  /** カメラの位置（ワールド） */
  readonly camera: Readonly<{ x: number; y: number; z: number }>;
  /** 天候の雨（0〜1） */
  readonly rain: number;
  /** 倒した・海に着いた・沈んだ割合（0〜1。着いてから消えるまで） */
  readonly dead: boolean;
  readonly landed: boolean;
  readonly sink: number;
  /** 登場: 空の上にいる割合（1 = 一番上 → 0 = 降り切った） */
  readonly descend: number;
  /** 演出を進める秒数（止めている間は 0） */
  readonly fxDt: number;
}

const v1 = new Vector3();
const v2 = new Vector3();
const vel = new Vector3();
const cam = new Vector3();
const sphere = (part: XenolithPart): number =>
  XENOLITH_TARGET_SPHERES.findIndex((s) => s.part === part);

export class XenolithEffects {
  readonly sprites: StarSprites;
  readonly waves = new WaveFx();
  readonly trail: TrailRibbon | null;
  readonly puffs: KaijuPuffs;
  readonly debris: KaijuDebris;
  readonly arcs: KaijuArcs | null;
  readonly shadow: KaijuShadow | null;
  readonly glow: XenolithGlow = createXenolithGlow();
  /** 描画だけの動き: 浮かぶ上下の揺れ（m）・急停止のつんのめり（ラジアン） */
  bob = 0;
  tilt = 0;
  private readonly wasBroken = new Map<XenolithPart, boolean>();
  private wasMove = 'cruise';
  private wasWarp = 'idle';
  private wasDead = false;
  private wasLanded = false;
  private deadTime = 0;
  private assemble = 0;
  private lastFlash = 0;
  private time = 0;
  private readonly lastCenter = new Vector3();
  private readonly beaconC = new Color();
  /** 今のカメラの位置（光の弾のきらめき） */
  readonly camera = new Vector3();

  constructor(readonly spec: XenolithTierSpec) {
    // 寿命のある粒 + 光の弾（64）+ 遠くの目印
    this.sprites = new StarSprites(spec.glints, 66);
    this.trail = spec.trail ? new TrailRibbon(78, 16) : null;
    this.puffs = new KaijuPuffs(spec.puffs);
    this.debris = new KaijuDebris(spec.debris, V.debris);
    this.arcs = spec.arcs > 0 ? new KaijuArcs(spec.arcs, V.colors.arc) : null;
    this.shadow = spec.shadow ? new KaijuShadow(V.shadow) : null;
    for (const p of XENOLITH_PARTS) this.wasBroken.set(p, false);
  }

  get objects(): readonly Object3D[] {
    const o: Object3D[] = [this.sprites.mesh, this.waves.mesh, this.puffs.mesh];
    o.push(this.debris.shards, this.debris.smoke);
    if (this.trail) o.push(this.trail.mesh);
    if (this.arcs) o.push(this.arcs.mesh);
    if (this.shadow) o.push(this.shadow.mesh);
    return o;
  }

  /** 新しく出した（レイドのやり直し・再生のシーク）: 残りを消す */
  reset(k: XenolithKaiju): void {
    XENOLITH_PARTS.forEach((p, i) => this.wasBroken.set(p, k.parts.isBroken(i)));
    this.wasDead = false;
    this.wasLanded = false;
    this.wasMove = k.body.move;
    this.wasWarp = k.warp.phase;
    this.deadTime = 0;
    this.assemble = 0;
    this.clearParticles();
  }

  /** 粒と動きの残りを消す（撮影の場面の切り替え） */
  clearParticles(): void {
    this.sprites.clear();
    this.waves.clear();
    this.puffs.clear();
    this.debris.clear();
    this.trail?.reset();
    this.tilt = 0;
    this.assemble = 0;
  }

  /** 縁の点（体の座標の角度 a・半径 r・高さ y）をワールドへ */
  private rimPoint(out: Vector3, center: Readonly<Vector3>, a: number, r = 80, y = 0): Vector3 {
    return out.set(center.x + Math.sin(a) * r, center.y + y, center.z - Math.cos(a) * r);
  }

  /** きらめく粒をまとめて（中心から半径 r の輪に n 個。外へ speed m/秒） */
  private burst(center: Readonly<Vector3>, n: number, r: number, speed: number, color: number) {
    const count = Math.min(n, this.spec.glints >> 1);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.rimPoint(v1, center, a, r * (0.6 + Math.random() * 0.4), (Math.random() - 0.5) * 16);
      v2.subVectors(v1, center)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random()));
      v2.y += (Math.random() - 0.3) * speed * 0.4;
      this.sprites.emit(v1, v2.add(vel), G.life * (1 + Math.random()), G.size * 1.4, color);
    }
  }

  /** 体の骨を置いた後。center は体の位置（ワールド）、heading は向き、flash は被弾の光（0〜1） */
  update(
    k: XenolithKaiju,
    center: Readonly<Vector3>,
    heading: number,
    flash: number,
    input: XenolithViewInput,
    sun: Readonly<Vector3>,
  ): void {
    const dt = input.fxDt;
    this.time += dt;
    const g = this.glow;
    const b = k.body;
    cam.set(input.camera.x, input.camera.y, input.camera.z);
    this.camera.copy(cam);
    vel.set(b.velocity.x, b.velocity.y, b.velocity.z);
    const live = !input.dead;
    // 部位の破壊: 破片・火花・電気の弧・小さな波
    XENOLITH_PARTS.forEach((p, i) => {
      const broken = k.parts.isBroken(i);
      if (broken && !this.wasBroken.get(p)) {
        xenolithSpherePoint(v1, b, sphere(p));
        this.debris.burst(v1, vel, Math.min(20, this.spec.debris >> 2), false);
        this.debris.puff(v1, vel, 14);
        this.burst(v1, 18, 12, 60, V.colors.glint);
        this.waves.emit(v1, 60, 1, 0.6);
        for (let j = 0; j < 3 && this.arcs; j++) {
          this.rimPoint(v2, center, Math.random() * Math.PI * 2, 40 + Math.random() * 40, 4);
          this.arcs.spark(v1, v2, 0.35, 1.8, 0.18, 1.5);
        }
        this.tilt += V.motion.stopTilt;
      }
      this.wasBroken.set(p, broken);
    });
    // 被弾: きらめく粒を自機の側に
    if (flash > this.lastFlash + 0.3 && dt > 0) {
      v1.subVectors(cam, center).normalize().multiplyScalar(60).add(center);
      for (let i = 0; i < 4; i++) {
        v2.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(80);
        this.sprites.emit(v1, v2, 0.25, G.size, V.colors.glint);
      }
    }
    this.lastFlash = flash;
    // 急停止: 円盤の面の光の波とつんのめり / 急加速: 後ろへ光の粒
    if (b.move !== this.wasMove && live) {
      if (b.move === 'stop' && this.wasMove !== 'hold') {
        this.waves.emit(center, V.wave.stop, 0.12);
        this.burst(center, 14, 80, 50, V.colors.wave);
        this.tilt += V.motion.stopTilt;
      } else if (b.move === 'dash') this.burst(center, 12, 80, 30, V.colors.trailHead);
    }
    this.wasMove = b.move;
    // 瞬間移動: 予兆の終わりに光がほどけ、移った先で組み上がる（波と粒）
    const w = k.warp;
    if (w.phase === 'cooldown' && this.wasWarp === 'telegraph') {
      this.waves.emit(this.lastCenter, V.wave.warp, 0.5);
      this.waves.emit(center, V.wave.warp, 0.5);
      this.burst(this.lastCenter, G.warpBurst, 80, 120, V.colors.warpEdge);
      this.trail?.reset();
      this.assemble = G.assemble;
    }
    this.wasWarp = w.phase;
    let dissolve = 0;
    if (w.phase === 'telegraph') {
      const t = w.time / Math.max(0.01, w.spec.telegraph);
      dissolve = Math.max(0, (t - 0.6) / 0.4) * G.dissolveMax;
      // 移る先に光の粒が集まってくる
      if (dt > 0 && Math.random() < dt * 30 * t) {
        const a = Math.random() * Math.PI * 2;
        v1.set(w.destination.x, w.destination.y, w.destination.z);
        this.rimPoint(v2, v1, a, 140, (Math.random() - 0.5) * 80);
        const toward = v1.sub(v2).multiplyScalar(1.6);
        this.sprites.emit(v2, toward, 0.6, G.size * 1.2, V.colors.warpEdge, 0.4, 0);
      }
      if (dissolve > 0 && dt > 0 && Math.random() < dt * 60)
        this.burst(center, 1, 80, 70, V.colors.warpEdge);
    }
    if (this.assemble > 0) {
      this.assemble = Math.max(0, this.assemble - dt);
      dissolve = Math.max(dissolve, (this.assemble / G.assemble) * G.dissolveMax);
    }
    // 登場: 光の柱の中で組み上がる
    dissolve = Math.max(dissolve, input.descend * 0.5);
    // きらめく粒（縁。急加速は後ろへ多く）
    const speed = vel.length();
    const rate = (speed > V.trail.minSpeed ? G.dashRate : G.rate) * (this.spec.glints / 220);
    if (dt > 0 && live && b.visible && input.descend < 1) {
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          this.rimPoint(
            v1,
            center,
            Math.random() * Math.PI * 2,
            70 + Math.random() * 12,
            (Math.random() - 0.5) * 6,
          );
          v2.copy(vel).multiplyScalar(speed > V.trail.minSpeed ? 0.35 : 0.9);
          this.sprites.emit(
            v1,
            v2,
            G.life * (0.6 + Math.random() * 0.8),
            G.size * (0.6 + Math.random() * 0.8),
            V.colors.glint,
            0.7,
            2,
          );
        }
        n -= 1;
      }
    }
    // 倒した: 光が消え、電気の弧が走り、煙を引いて落ちる。海に着いたら水しぶき
    if (input.dead && !this.wasDead) {
      this.deadTime = 0;
      this.waves.emit(center, V.wave.stop, 0.3);
      this.burst(center, 40, 80, 90, V.colors.glint);
    }
    this.wasDead = input.dead;
    if (input.dead) this.deadTime += dt;
    stepDefeat(
      this,
      center,
      vel,
      input,
      this.wasLanded,
      this.deadTime,
      k.body.floorAt(center.x, center.z),
    );
    this.wasLanded = input.landed;
    this.lastCenter.copy(center);
    // 描画だけの動き（浮かぶ揺れ・つんのめりの減衰）
    this.bob = live ? Math.sin(this.time * V.motion.bobHz * Math.PI * 2) * V.motion.bob : 0;
    this.tilt *= Math.max(0, 1 - dt * V.motion.stopDecay);
    this.tilt = Math.min(this.tilt, V.motion.stopTilt);
    // マテリアルの値（光の筋は急加速と攻撃で強く・核は攻めどき（バリアが外れている）で強く）
    const attacking = k.beam.busy || k.orbPhase === 'warn';
    g.trace +=
      ((speed > V.trail.minSpeed ? 2.2 : attacking ? 1.6 : 1) - g.trace) * Math.min(1, dt * 4);
    g.core = live ? (k.barrier.phase === 'down' ? 1.6 : 1) : Math.max(0, 1 - this.deadTime);
    g.halo = live
      ? k.barrier.phase === 'flicker'
        ? Math.sin(this.time * 40) > 0
          ? 1.3
          : 0.2
        : 1
      : 0;
    g.glyph = live ? 1 : 0;
    g.dissolve = dissolve;
    g.dead = input.dead ? Math.min(1, this.deadTime / 2) : 0;
    g.storm += (input.rain - g.storm) * Math.min(1, dt * 0.8);
    // 粒を進める
    this.sprites.begin(cam, dt);
    // 遠くの目印（遠いほど大きく。予兆の線より暗い）
    const d = cam.distanceTo(center);
    const B = V.beacon;
    const ba = Math.max(0, Math.min(1, (d - B.near) / (B.far - B.near))) * B.alpha;
    if (ba > 0.01 && b.visible && live)
      this.sprites.star(cam, center, d * B.scale, this.beaconColor(k), ba, this.time * 0.5);
    this.waves.update(dt);
    this.trail?.update(center, vel, dt);
    if (this.trail && !live) this.trail.reset();
    this.puffs.update(cam, dt);
    this.debris.update(dt);
    this.arcs?.update(cam, dt);
    if (this.shadow) {
      const floor = b.floorAt(center.x, center.z);
      const lit = Math.min(1, Math.max(0, sun.y / Math.max(1e-3, sun.length())) * 3);
      this.shadow.update(
        center,
        heading,
        floor,
        sun,
        (b.visible ? 1 : 0) * lit * (1 - input.sink) * (1 - input.descend),
      );
    }
  }

  /** 目印の色（ふだん水色・攻めどきは白に近く） */
  private beaconColor(k: XenolithKaiju): Color {
    return this.beaconC.set(k.barrier.phase === 'down' ? V.colors.glint : V.colors.halo);
  }

  hide(): void {
    this.shadow?.hide();
  }

  dispose(): void {
    this.sprites.dispose();
    this.puffs.dispose();
    this.debris.dispose();
    this.arcs?.dispose();
    this.shadow?.dispose();
    this.trail?.dispose();
  }
}
