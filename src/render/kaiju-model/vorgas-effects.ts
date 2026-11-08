// 10-7e: ヴォルガスの見た目の演出の進行（描画だけ。判定の値は読むだけ。乱数は Math.random = 見た目だけ）: 足が着いたときの土煙 /
// 水しぶきと揺れ・上陸で体から落ちる水と水面のしぶき・濡れが乾く・熱線の溜めで光の粒を口へ吸い込む・撃つ間の口の光と湯気・亀裂の
// 火の粉・咆哮の砂ぼこりの輪・薙ぎ払いの尾の土煙・部位を壊したときの破片と煙・膝をつく / 崩れ落ちるときの土煙と揺れ・倒れると光が消える
import { Vector3, type Object3D } from 'three';
import { KAIJU_CONFIG, KAIJU_PARTS } from '../../data/kaiju';
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
import type { KaijuBodyView } from '../../entities/kaiju-display';
import { collapseAmount, VorgasMotion } from './motion';
import { BODY_BONES, PART_BONE, randomDir, VorgasParticles } from './vorgas-particles';
import type { VorgasLook, VorgasViewInput } from './vorgas-view';

const V = VORGAS_VISUAL;
const COL = V.colors;
const v1 = new Vector3();
const v2 = new Vector3();
const vel = new Vector3();

export class VorgasEffects extends VorgasParticles {
  readonly motion = new VorgasMotion();
  private lastStep = Number.NaN;
  private readonly wasBroken = [false, false, false, false, false];
  private wasDown = false;
  private kneeled = false;
  private lastDead = -1;
  private lastFlash = 0;
  private wasRoar = false;

  get objects(): readonly Object3D[] {
    return [this.puffs.mesh, this.embers.mesh, this.debris.shards, this.debris.smoke];
  }

  /** 粒・濡れ・身じろぎの残りだけ消す（撮影で置き直した。部位の破壊・足音・撃破の合図は残す） */
  clearFx(): void {
    this.puffs.clear();
    this.embers.clear();
    this.debris.clear();
    this.motion.reset();
    this.look.wet = 0;
  }

  /** 新しく出した（レイドのやり直し・再生のシーク）: 粒・身じろぎの残りを消す */
  reset(body: KaijuBodyView): void {
    this.puffs.clear();
    this.embers.clear();
    this.debris.clear();
    this.motion.reset();
    for (let i = 0; i < 5; i++) this.wasBroken[i] = body.parts[i]?.broken ?? false;
    this.lastStep = Number.NaN;
    this.lastDead = -1;
    this.kneeled = false;
    this.wasDown = body.downTimer > 0;
    this.look.wet = 0;
  }

  /**
   * 骨を動かした後（matrixWorld が新しい）。flash は被弾の残り（0〜1）。粒・マテリアルの値・動きの上乗せの合図
   */
  update(
    body: KaijuBodyView,
    input: VorgasViewInput,
    flash: number,
    look: VorgasLook | null,
    time: number,
  ): void {
    const dt = input.fxDt;
    const L = this.look;
    const floor = input.floor;
    const water = floor < 0.5;
    const feet = body.feet;
    const submerged = feet.y < floor - 1;
    // 部位: 亀裂の明るさ（6-1 と同じ: 壊れた部位は 0.2。脚は左右で半分ずつ）
    const br = (i: number): number => (body.parts[i]?.broken ? 1 : 0);
    L.crack[0] = 1 - 0.8 * br(1);
    L.crack[1] = 1 - 0.8 * br(0);
    L.crack[2] = 1;
    L.crack[3] = 1 - 0.4 * (br(2) + br(3));
    L.crack[4] = 1 - 0.8 * br(4);
    // 熱線の溜め・撃つ間（結晶の明るさ 0.15〜1 から）
    const beam = body.attack === 'beam';
    L.heat = beam ? Math.max(0, (body.pose.crystalGlow - 0.15) / 0.85) : 0;
    const throatGoal = beam ? (body.attackStep === 'active' ? 1 : L.heat * 0.7) : 0;
    L.throat += (throatGoal - L.throat) * Math.min(1, dt * 6);
    L.flash = flash;
    // 濡れ（海の中にいる間は 1、上がってから乾く）
    L.wet = submerged ? 1 : Math.max(0, L.wet - dt / V.wet.seconds);
    // 倒した: 光が消えていく・膝をつく・崩れ落ちる
    const dead = input.deadTime;
    L.dead = dead >= 0 ? Math.min(1, dead / 3.5) : 0;
    L.breath = dead >= 0 ? 0 : V.breath.amount * Math.sin(time * V.breath.rate * Math.PI * 2);
    if (body.visible) this.events(body, input, flash, look, water);
    this.lastDead = dead;
    this.flow(body, input, dt, water, submerged);
    this.puffs.update(v2.set(input.camera.x, input.camera.y, input.camera.z), dt);
    this.embers.update(v2, dt);
    this.debris.update(dt);
  }

  private events(
    body: KaijuBodyView,
    input: VorgasViewInput,
    flash: number,
    look: VorgasLook | null,
    water: boolean,
  ): void {
    const floor = input.floor;
    const dead = input.deadTime;
    // 足が着いた（左は位相 0.5、右は 1.5。1 歩 = 位相 1）
    const step = Math.floor(body.walkPhase - 0.5);
    const moving = Math.hypot(body.velocity.x, body.velocity.z) > 0.5;
    if (
      !Number.isNaN(this.lastStep) &&
      step !== this.lastStep &&
      moving &&
      dead < 0 &&
      body.downTimer <= 0
    ) {
      const left = ((step % 2) + 2) % 2 === 0;
      this.bone(v1, left ? 'footL' : 'footR');
      this.splash(v1, floor, water, water ? 10 : 14, water ? 16 : 18, water ? 14 : 22);
      if (!water) this.debris.burst(v1.setY(floor + 3), vel.set(0, 0, 0), 3, false);
      this.motion.kickStomp(1);
      look?.impact(V.shake.step, v1);
    }
    this.lastStep = step;
    // 被弾の身じろぎ
    if (flash > this.lastFlash + 0.3) this.motion.kickFlinch();
    this.lastFlash = flash;
    // 部位を壊した: 破片（結晶は青い破片）と、しばらく煙
    for (let i = 0; i < 5; i++) {
      const broken = body.parts[i]?.broken ?? false;
      if (broken && !this.wasBroken[i]) {
        const at = this.bone(v1, PART_BONE[i] ?? 'chest');
        if (KAIJU_PARTS[i] === 'crystal') at.y += 14;
        this.debris.burst(at, vel.set(0, 6, 0), Math.min(36, this.spec.debris >> 1), false);
        for (let k = 0; k < 10; k++)
          this.embers.emit(at, randomDir().multiplyScalar(30 + Math.random() * 40), {
            size: 5,
            life: 0.8,
            alpha: 0.9,
            color: KAIJU_PARTS[i] === 'crystal' ? COL.charge : COL.ember,
            gravity: 20,
            drag: 0.8,
          });
        this.motion.kickFlinch();
        this.smokeLeft[i] = 7;
      }
      this.wasBroken[i] = broken;
    }
    // 膝をつく（脚を壊したダウン）: 膝が地面に着いたとき
    const down = body.downTimer > 0;
    if (down && !this.wasDown) this.kneeled = false;
    if (down && !this.kneeled && body.pose.bodyDrop > KAIJU_CONFIG.down.bodyDrop * 0.8) {
      this.kneeled = true;
      this.knees(floor, water, 1);
      look?.impact(V.shake.kneel, feetOf(body));
    }
    this.wasDown = down;
    // 咆哮: 足元から砂ぼこりの輪
    const roar = body.attack === 'roar' && body.attackStep === 'active';
    if (roar && !this.wasRoar && dead < 0) {
      v1.set(body.feet.x, floor, body.feet.z);
      this.splash(v1, floor, water, 22, 26, 70);
      look?.impact(0.5, v1);
    }
    this.wasRoar = roar;
    // 崩れ落ちる: 膝が折れる → 横へ倒れて地面に着く
    const C = V.collapse;
    if (dead >= 0) {
      const c = collapseAmount(dead);
      if (this.lastDead < C.kneel * 0.9 && dead >= C.kneel * 0.9) {
        this.knees(floor, water, 1.2);
        look?.impact(V.shake.kneel, feetOf(body));
      }
      if (this.lastDead < C.fall && dead >= C.fall && c.fall > 0.99) {
        for (const n of BODY_BONES) {
          this.bone(v1, n);
          this.splash(v1, floor, water, 6, 34, 30);
        }
        this.debris.burst(
          this.bone(v1, 'chest').setY(floor + 4),
          vel.set(0, 10, 0),
          Math.min(40, this.spec.debris >> 1),
          false,
        );
        look?.impact(V.shake.fall, this.bone(v1, 'chest'));
      }
    }
  }

  private knees(floor: number, water: boolean, k: number): void {
    for (const n of ['shinL', 'shinR'] as const) {
      this.bone(v1, n);
      this.splash(v1, floor, water, 12 * k, 22, 26);
    }
  }
}

const fp = new Vector3();
function feetOf(body: KaijuBodyView): Vector3 {
  return fp.set(body.feet.x, body.feet.y, body.feet.z);
}
