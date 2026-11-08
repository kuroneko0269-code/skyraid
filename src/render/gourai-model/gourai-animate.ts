// 10-4a: メカ怪獣ゴウライの判定の姿勢で動かす骨（10-7c で gourai-object.ts から分けた。動きは 10-4a のまま）: 前の装甲が開く・
// 装甲を捨てる・ハッチ・核の脈・砲台が自機の方へ向く（回転掃射の間は掃射の向き）・壊れた砲台はうなだれて縮む
import { Vector3 } from 'three';
import { GOURAI_TURRETS } from '../../data/gourai';
import { GOURAI_MODEL_CONFIG } from '../../data/gourai-model';
import type { GouraiKaiju } from '../../ai/gourai-ai';
import { inArc } from '../../ai/raid-kit/barrage';
import { relativeAim } from '../../ai/raid-kit/frame';
import { GOURAI_BONE, type GouraiBoneName, type GouraiSkeleton } from './skeleton';

const M = GOURAI_MODEL_CONFIG;
const DEG = Math.PI / 180;
const origin = new Vector3();
const TURRET_BONES: readonly GouraiBoneName[] = ['gunL', 'gunR', 'podL', 'podR', 'hipL', 'hipR'];
const GUN_SLOT: Readonly<Record<number, number>> = { 0: 0, 1: 1, 4: 2, 5: 3 };

export function animateGouraiParts(
  rig: GouraiSkeleton,
  k: GouraiKaiju,
  turretYaw: number[],
  time: number,
  dt: number,
  aimAt: Readonly<{ x: number; y: number; z: number }> | null,
): void {
  const bone = (name: GouraiBoneName) => rig.bones[GOURAI_BONE[name]];
  const pose = k.body.pose;
  const m = M.motion;
  const pg = pose.purge;
  for (const s of [-1, 1] as const) {
    const plate = bone(s < 0 ? 'armorL' : 'armorR');
    if (!plate) continue;
    // 開く: 横の蝶番で外へ（左は +Y 回り、右は −Y 回り）。捨てる: 外・上・前へ飛びながら回って小さく消える
    plate.rotation.set(
      pg * M.purge.spin * 0.4,
      -s * (pose.armorOpen * m.armorOpen + pg * M.purge.spin),
      s * pg * M.purge.spin * 0.3,
    );
    plate.position.set(
      s * (44 + pg * M.purge.fly),
      pg * M.purge.fly * 0.4,
      -58 - pg * M.purge.fly * 0.3,
    );
    const sc = Math.max(0.001, 1 - pg);
    plate.scale.set(sc, sc, sc);
  }
  const hatch = bone('hatch');
  if (hatch) hatch.rotation.x = pose.hatch * m.hatchOpen;
  const core = bone('core');
  if (core) {
    const c = 1 + 0.06 * Math.sin(time * 6) * Math.max(pose.armorOpen, pose.purge);
    core.scale.set(c, c, c);
  }
  // 砲台: 回転掃射の間は掃射の向き、ふだんは撃てる向きの範囲に入った自機の方、いなければ真ん中へ。壊れた砲台はうなだれて縮む
  const sweeping = k.attack === 'sweep' && k.action === 'active';
  GOURAI_TURRETS.forEach((t, i) => {
    const turret = bone(TURRET_BONES[i] ?? 'gunL');
    if (!turret) return;
    if (!k.turretAlive(i)) {
      turret.rotation.set(-0.45, turretYaw[i] ?? 0, 0.25);
      turret.scale.set(0.8, 0.6, 0.8);
      return;
    }
    turret.scale.set(1, 1, 1);
    let want = t.yawCenterDeg * DEG;
    let pitch = 0;
    const slot = GUN_SLOT[i];
    if (sweeping && slot !== undefined) {
      want = (pose.spin + slot * 90) * DEG;
      pitch = k.sweepPitch * DEG;
    } else if (aimAt) {
      const o = k.body.point(origin, t.offset);
      if (inArc(t, k.body, o, aimAt)) {
        const a = relativeAim(k.body, o, aimAt);
        want = a.yawDeg * DEG;
        pitch = Math.max(-0.5, Math.min(0.9, a.pitchDeg * DEG));
      }
    }
    const cur = turretYaw[i] ?? 0;
    const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    const rate = sweeping ? 99 : m.turretTurn * dt;
    const next = cur + Math.max(-rate, Math.min(rate, diff));
    turretYaw[i] = next;
    // 骨の回転は Y（方位: 左が正）→ X（仰角: 上が正）
    turret.rotation.set(t.weapon === 'gun' ? pitch : 0, next, 0, 'YXZ');
  });
}
