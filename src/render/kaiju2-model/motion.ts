// 10-7a: ネフィルガの動きの上乗せ（描画だけ。判定の姿勢の値 Kaiju2Pose は読むだけで書かない）: 翼のしなりとねじれ、尾の波と
// 傾きの遅れ、頭が自機を追う、被弾の身じろぎ（減衰するばね）、咆哮で首を上げて翼を広げる。animateKaiju2 の後・
// applyKaiju2Broken の前に呼ぶ（骨の回転に足す）
import type { Bone } from 'three';
import { KAIJU2_VISUAL } from '../../data/kaiju2-visual';
import type { Kaiju2Pose } from '../../entities/kaiju2/sky-kaiju';
import { BONE2, type Kaiju2BoneName, type Kaiju2Skeleton } from './skeleton';

const MO = KAIJU2_VISUAL.motion;
const DEG = Math.PI / 180;

export interface Kaiju2MotionInput {
  readonly pose: Readonly<Kaiju2Pose>;
  readonly bank: number;
  /** 頭から自機への向き（体の座標: 右 +X・上 +Y・前 −Z。単位でなくてよい。null は追わない） */
  readonly look: Readonly<{ x: number; y: number; z: number }> | null;
  /** 咆哮の強さ（0〜1）・倒れた */
  readonly roar: number;
  readonly dead: boolean;
}

/** 動きの残り（ばね・追う角度）。描画のたびに進める */
export class Kaiju2Motion {
  private yaw = 0;
  private pitch = 0;
  private flinch = 0;
  private flinchVel = 0;

  /** 被弾・部位の破壊の身じろぎ（strength 1 で motion.flinchKick） */
  kick(strength: number): void {
    this.flinchVel += MO.flinchKick * 30 * strength;
  }

  reset(): void {
    this.yaw = this.pitch = this.flinch = this.flinchVel = 0;
  }

  apply(s: Kaiju2Skeleton, input: Kaiju2MotionInput, time: number, dt: number): void {
    const get = (n: Kaiju2BoneName): Bone => {
      const b = s.bones[BONE2[n]];
      if (!b) throw new Error(n);
      return b;
    };
    const p = input.pose;
    const ph = p.flapPhase * Math.PI * 2;
    // 打ち下ろしの速さ（cos）: 下ろす間は先が遅れて上へしなり、上げる間は下へ
    const vel = Math.cos(ph) * p.flapAmount * (1 - p.wingFold);
    // ばね（身じろぎ）
    const k = Math.min(dt, 1 / 30);
    this.flinchVel += (-160 * this.flinch - MO.flinchDecay * 2 * this.flinchVel) * k;
    this.flinch += this.flinchVel * k;
    const jolt = this.flinch;
    const roar = input.roar;
    for (const side of [-1, 1] as const) {
      const n = side < 0 ? 'L' : 'R';
      const w0 = get(`wing${n}0`);
      const w1 = get(`wing${n}1`);
      const w2 = get(`wing${n}2`);
      w0.rotation.z += side * (jolt * 0.8 - roar * 0.45 * (1 - p.wingFold));
      w1.rotation.z += -side * vel * MO.wingFlex * 0.45;
      w2.rotation.z += -side * vel * MO.wingFlex;
      w1.rotation.x += vel * MO.wingTwist;
      w2.rotation.x += vel * MO.wingTwist * 1.4;
    }
    // 尾: 付け根から先へ進む波と、曲がる向きと逆へ遅れて流れる
    for (let i = 0; i < 5; i++) {
      const t = get(`tail${i}` as Kaiju2BoneName);
      const w = (i + 1) / 5;
      t.rotation.y +=
        Math.sin(time * 1.6 - i * 0.8) * MO.tailWave * w - input.bank * MO.tailBankLag * w * 0.5;
      t.rotation.x += Math.sin(time * 1.1 - i * 0.7) * MO.tailWave * 0.4 * w + jolt * 0.3 * w;
    }
    // 頭が自機を追う（首 4 割・頭 6 割。体の向きからの最大角で切る）
    let wantYaw = 0;
    let wantPitch = 0;
    const L = input.look;
    if (L && !input.dead) {
      wantYaw = Math.atan2(-L.x, -L.z);
      wantPitch = Math.atan2(L.y, Math.hypot(L.x, L.z));
      const maxY = MO.lookYawDeg * DEG;
      const maxP = MO.lookPitchDeg * DEG;
      // 後ろ半分にいるときは追わない（首をひねりすぎない）
      if (Math.abs(wantYaw) > Math.PI * 0.6) wantYaw = 0;
      wantYaw = Math.max(-maxY, Math.min(maxY, wantYaw));
      wantPitch = Math.max(-maxP, Math.min(maxP, wantPitch));
    }
    const a = 1 - Math.exp(-MO.lookRate * dt);
    this.yaw += (wantYaw - this.yaw) * a;
    this.pitch += (wantPitch - this.pitch) * a;
    const n0 = get('neck0');
    const n1 = get('neck1');
    const head = get('head');
    n0.rotation.x += -roar * MO.roarNeck + jolt * 1.1;
    n1.rotation.y += this.yaw * 0.4;
    n1.rotation.x += -this.pitch * 0.4 - roar * MO.roarNeck * 0.5;
    head.rotation.y += this.yaw * 0.6;
    head.rotation.x += -this.pitch * 0.6 + roar * 0.35 + jolt * 0.6;
    get('chest').rotation.x += jolt * 0.5;
  }
}
