// 10-7e: ヴォルガスの動きの上乗せ（描画だけ。判定の姿勢の値で animate() が骨を回した後に足す）: 足が着いたときの重い沈みと胸の
// うなずき・頭と首が自機を追う・被弾の身じろぎ。どれも小さく、動かしていない形との差は VORGAS_VISUAL.motion.tolerance m の中
// （tests/vorgas-visual.test.ts。頭の当たりの球は半径 20m）。倒した後は崩れ落ちる（膝が折れ、横へ倒れ込む。判定はもう終わっている）
import type { Bone, Vector3 } from 'three';
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
import { BONE, bonePosition, type BoneName, type KaijuSkeleton } from './skeleton';

const MO = VORGAS_VISUAL.motion;
const CO = VORGAS_VISUAL.collapse;
const HEAD = bonePosition('head');

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** 倒してからの秒数から、膝が折れる割合（0〜1）と倒れ込む割合（0〜1。だんだん速く） */
export function collapseAmount(deadTime: number): { kneel: number; fall: number } {
  if (deadTime < 0) return { kneel: 0, fall: 0 };
  const k = smooth(deadTime / CO.kneel);
  const t = Math.max(0, Math.min(1, (deadTime - CO.kneel * 0.7) / (CO.fall - CO.kneel * 0.7)));
  return { kneel: k, fall: t * t };
}

export class VorgasMotion {
  private stomp = 0;
  private flinch = 0;
  private yaw = 0;
  private pitch = 0;

  reset(): void {
    this.stomp = this.flinch = this.yaw = this.pitch = 0;
  }

  /** 足が着いた（強さ 0〜1） */
  kickStomp(k: number): void {
    this.stomp = Math.max(this.stomp, k);
  }

  kickFlinch(): void {
    this.flinch = 1;
  }

  /** look は頭が追う相手（体の座標。null は前へ戻す）、deadTime は倒してからの秒数（−1 は生きている） */
  apply(
    rig: KaijuSkeleton,
    look: Readonly<Vector3> | null,
    deadTime: number,
    dt: number,
    time: number,
  ): void {
    const get = (n: BoneName): Bone => {
      const b = rig.bones[BONE[n]];
      if (!b) throw new Error(n);
      return b;
    };
    const e = Math.min(1, dt * MO.lookRate);
    let wantYaw = 0;
    let wantPitch = 0;
    if (look && deadTime < 0) {
      const dx = look.x - HEAD.x;
      const dz = look.z - HEAD.z;
      wantYaw = Math.max(-MO.lookYaw, Math.min(MO.lookYaw, Math.atan2(-dx, -dz)));
      const h = Math.hypot(dx, dz);
      wantPitch = Math.max(-MO.lookPitch, Math.min(MO.lookPitch, Math.atan2(look.y - HEAD.y, h)));
    }
    this.yaw += (wantYaw - this.yaw) * e;
    this.pitch += (wantPitch - this.pitch) * e;
    const neck = get('neck');
    const head = get('head');
    neck.rotation.y += this.yaw * 0.6;
    head.rotation.y += this.yaw * 0.4;
    neck.rotation.x += this.pitch * 0.5;
    head.rotation.x += this.pitch * 0.5;
    // 足が着いた: 骨盤が沈み、胸がうなずく（すぐ戻る）
    const pelvis = get('pelvis');
    const chest = get('chest');
    pelvis.position.y -= MO.stompDrop * this.stomp;
    chest.rotation.x += MO.stompNod * this.stomp;
    chest.rotation.z += MO.flinchKick * this.flinch * Math.sin(time * 31);
    this.stomp *= Math.exp(-dt * 7);
    this.flinch *= Math.exp(-dt * MO.flinchDecay);
    // 崩れ落ちる（膝は呼ぶ側が姿勢の沈みで折る）: 左へ倒れ込み、少し前へ。首は上がり、尾は地面へ
    const c = collapseAmount(deadTime);
    const root = rig.root;
    root.rotation.set(-CO.pitch * c.fall, 0, CO.topple * c.fall);
    // 膝をつくと沈んだ分、脚と尾が地面に埋まるので少し持ち上げ、尾を上げる
    root.position.set(0, CO.lift * (0.4 * c.kneel + 0.6 * c.fall), 0);
    neck.rotation.x += 0.25 * c.fall;
    for (let i = 0; i < 5; i++)
      get(`tail${i}` as BoneName).rotation.x -= 0.09 * c.kneel - 0.04 * c.fall;
  }
}
