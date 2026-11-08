// 10-7b: 白鯨アルビオンの動きの上乗せ（描画だけ。判定の姿勢の値 AlbionPose は読むだけで書かない）: 泳ぐ動き。
// 尾びれの大きくゆっくりした上下の打ち（約 9 秒に 1 回・尾びれの先で ±39m）と後ろ半分へのうねりは判定の形と同じ式（skeleton.ts の
// animateAlbion・src/ai/albion-hull.ts）で、ここでは打ちに合わせた体全体の上下の揺れと機首の上下・胸びれの舵（曲がる・半円で
// 傾くとき）・ゆっくりした横の揺れ・被弾の身じろぎ・口を開ける、だけを足す。どれも当たりの形からのずれを motion.tolerance（m）
// の中に収める（tests/albion-visual.test.ts が頂点ごとに確かめる）。animateAlbion の後に呼ぶ
import type { Bone } from 'three';
import { ALBION_VISUAL } from '../../data/albion-visual';
import type { AlbionPose } from '../../entities/albion/albion-body';
import { ALBION_BONE, type AlbionBoneName, type AlbionSkeleton } from './skeleton';

const MO = ALBION_VISUAL.motion;

export interface AlbionMotionInput {
  readonly pose: Readonly<AlbionPose>;
  /** 傾き（ラジアン。正で右が下がる = 右へ曲がる。胸びれの舵） */
  readonly bank: number;
  /** 吠える強さ（0〜1）・倒れた */
  readonly roar: number;
  readonly dead: boolean;
}

export class AlbionMotion {
  private flinch = 0;
  private flinchVel = 0;
  private jaw = 0;
  private steer = 0;
  /** 体全体の上下の揺れ（m。albion-object.ts が体の位置に足す） */
  bob = 0;

  /** 被弾・部位の破壊の身じろぎ（strength 1 で flinchKick） */
  kick(strength: number): void {
    this.flinchVel += MO.flinchKick * strength;
  }

  reset(): void {
    this.flinch = this.flinchVel = this.jaw = this.steer = this.bob = 0;
  }

  /** 今の口の開き（0〜1） */
  get mouth(): number {
    return this.jaw;
  }

  apply(s: AlbionSkeleton, input: AlbionMotionInput, time: number, dt: number): void {
    const get = (n: AlbionBoneName): Bone => {
      const b = s.bones[ALBION_BONE[n]];
      if (!b) throw new Error(n);
      return b;
    };
    const p = input.pose;
    const live = input.dead ? 0.3 : 1;
    // 重いばね（ゆっくり揺れて戻る。角度は flinchMax まで）
    const k = Math.min(dt, 1 / 30);
    this.flinchVel += (-18 * this.flinch - MO.flinchDecay * 2 * this.flinchVel) * k;
    this.flinch += this.flinchVel * k;
    const jolt = Math.max(-MO.flinchMax, Math.min(MO.flinchMax, this.flinch));
    // 尾の打ち（判定の泳ぎの位相）に合わせて、体全体が上下に揺れ、機首が逆に上下する
    const ph = p.swimPhase * Math.PI * 2;
    this.bob = MO.bob * live * Math.sin(ph + Math.PI / 2);
    // animateAlbion が付けない回転は = で（積もらない）
    get('root').rotation.set(
      MO.bobPitch * live * Math.sin(ph + Math.PI) + jolt,
      0,
      MO.roll * Math.sin(time * 0.21),
    );
    // 胸びれの舵: 曲がる向き（傾き）へ前縁をひねる（左右逆）。まっすぐのときは打ちに合わせて少しかく
    const want = Math.max(-1, Math.min(1, input.bank / MO.steerBank));
    this.steer += (want - this.steer) * Math.min(1, dt * 0.8);
    const scull = (1 - Math.abs(this.steer)) * 0.3 * Math.sin(ph + 0.6);
    get('finL').rotation.x = MO.finTwist * Math.max(-1, Math.min(1, -this.steer * 0.9 + scull));
    get('finR').rotation.x = MO.finTwist * Math.max(-1, Math.min(1, this.steer * 0.9 + scull));
    get('head').rotation.y = 0;
    // 口: 姿勢の口の開き（吠える・雲・倒れた後）と吠える強さの大きい方へゆっくり。開く角度は当たりの形の中
    const mouth = Math.max(p.mouth, input.roar);
    this.jaw += (mouth - this.jaw) * Math.min(1, dt * 2.5);
    get('jaw').rotation.x = -this.jaw * MO.jawOpen;
  }
}
