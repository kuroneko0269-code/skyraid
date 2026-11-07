// 10-4a: メカ怪獣ゴウライの 3D オブジェクト: 骨格 1 つに皮の SkinnedMesh 1 つ、弾の InstancedMesh 2 つ（機銃・ミサイル。何発でも 2 回）、
// 回転掃射の危ない高さの輪（出ているときだけ）。draw call は 体 1 + 弾 0〜2 + 輪 0〜1 = 1〜4（シャドウは体の 1 つだけ）。
// 「低」はジオメトリを作り直す
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { GOURAI_CONFIG, GOURAI_PARTS, GOURAI_TURRETS } from '../../data/gourai';
import { GOURAI_MODEL_CONFIG } from '../../data/gourai-model';
import type { GouraiKaiju } from '../../ai/gourai-ai';
import { relativeAim } from '../../ai/raid-kit/frame';
import { inArc } from '../../ai/raid-kit/barrage';
import { createGouraiMaterial, type GouraiGlow, type GouraiMaterial } from './material';
import { buildGouraiSkin } from './parts';
import { ShotMesh } from './shot-mesh';
import {
  createGouraiSkeleton,
  GOURAI_BONE,
  type GouraiBoneName,
  type GouraiSkeleton,
} from './skeleton';

const M = GOURAI_MODEL_CONFIG;
const G = GOURAI_CONFIG;

/** 皮のジオメトリ（テストで三角形を数える） */
export function buildGouraiGeometry(detail: AircraftDetail): {
  skin: BufferGeometry;
  triangles: number;
} {
  const b = buildGouraiSkin(M.detail[detail]);
  return { skin: b.build(), triangles: b.triangleCount };
}

const matrix = new Matrix4();
const yaw = new Quaternion();
const tilt = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const TURRET_BONES: readonly GouraiBoneName[] = ['gunL', 'gunR', 'podL', 'podR', 'hipL', 'hipR'];
const GUN_SLOT: Readonly<Record<number, number>> = { 0: 0, 1: 1, 4: 2, 5: 3 };
const PART = (id: (typeof GOURAI_PARTS)[number]): number => GOURAI_PARTS.indexOf(id);
const glow: GouraiGlow = { core: 0, exhaustL: 0, exhaustR: 0, hatch: 0, gun: 0, flash: 0 };
const DEG = Math.PI / 180;
const origin = new Vector3();

export class GouraiObject {
  readonly group = new Group();
  private readonly rig: GouraiSkeleton;
  private readonly skin: SkinnedMesh;
  private readonly material: GouraiMaterial;
  readonly shots: ShotMesh;
  /** 回転掃射の危ない高さの輪（体の中心から bandLow〜bandHigh の薄い筒） */
  readonly sweepRing: Mesh;
  private readonly ringMat: MeshBasicMaterial;
  /** 砲台の今の向き（ラジアン。体の向きからの方位。左が正） */
  private readonly turretYaw: number[] = GOURAI_TURRETS.map((t) => t.yawCenterDeg * DEG);
  private time = 0;
  triangles = 0;

  constructor(detail: AircraftDetail = 'high') {
    this.rig = createGouraiSkeleton();
    this.group.add(this.rig.root);
    const g = buildGouraiGeometry(detail);
    this.triangles = g.triangles;
    this.material = createGouraiMaterial();
    this.skin = new SkinnedMesh(g.skin, this.material.skin);
    this.skin.bind(this.rig.skeleton, matrix.identity());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    this.group.add(this.skin);
    this.shots = new ShotMesh(G.shotCap);
    const s = G.attacks.sweep;
    const ring = new CylinderGeometry(1, 1, s.bandHigh - s.bandLow, 48, 1, true);
    ring.translate(0, (s.bandHigh + s.bandLow) / 2, 0);
    this.ringMat = new MeshBasicMaterial({
      color: M.colors.sweepWarn,
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.sweepRing = new Mesh(ring, this.ringMat);
    this.sweepRing.frustumCulled = false;
    this.sweepRing.visible = false;
    this.group.visible = false;
  }

  /** シーンに足すもの（体・弾・輪。弾と輪はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, ...this.shots.meshes, this.sweepRing];
  }

  /** 今の描画の回数（体 1 + 出ている弾の層 + 輪） */
  get draws(): number {
    if (!this.group.visible) return 0;
    return 1 + this.shots.meshes.filter((m) => m.visible).length + (this.sweepRing.visible ? 1 : 0);
  }

  setDetail(detail: AircraftDetail): void {
    const g = buildGouraiGeometry(detail);
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.triangles = g.triangles;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    if (!v) {
      this.sweepRing.visible = false;
      this.shots.update([], 0, false);
    }
  }

  /** 描画フレームごと。前ステップとの間を alpha で補間し、骨を動かす。aimAt は砲台が向く人（自機）、flash は被弾の光（0〜1） */
  update(
    k: GouraiKaiju,
    alpha: number,
    dt: number,
    aimAt: Readonly<{ x: number; y: number; z: number }> | null,
    flash = 0,
  ): void {
    this.time += dt;
    if (!this.group.visible) return;
    const b = k.body;
    const p = b.position;
    const q = b.prevPosition;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha,
      q.z + (p.z - q.z) * alpha,
    );
    let dh = b.heading - b.prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    yaw.setFromAxisAngle(yAxis, b.prevHeading + dh * alpha);
    tilt.setFromAxisAngle(xAxis, b.pitch);
    yaw.multiply(tilt);
    tilt.setFromAxisAngle(zAxis, -b.roll);
    this.group.quaternion.copy(yaw).multiply(tilt);
    this.animate(k, dt, aimAt);
    const pose = b.pose;
    const parts = k.parts;
    const ex = M.glow.exhaustMin + (M.glow.exhaustMax - M.glow.exhaustMin) * pose.exhaust;
    glow.core = k.parts.isBroken(PART('core'))
      ? 0
      : M.glow.coreClosed +
        (M.glow.coreOpen - M.glow.coreClosed) *
          Math.max(pose.armorOpen, pose.purge) *
          (0.85 + 0.15 * Math.sin(this.time * 9));
    glow.exhaustL = parts.isBroken(PART('exhaustL')) ? 0 : ex;
    glow.exhaustR = parts.isBroken(PART('exhaustR')) ? 0 : ex;
    glow.hatch = pose.hatch * (Math.sin(this.time * M.glow.hatchHz * Math.PI * 2) > 0 ? 3 : 0.6);
    glow.gun = pose.gunGlow * 3;
    glow.flash = flash;
    this.material.set(glow);
    this.shots.update(k.shots.shots, alpha, true);
    this.updateRing(k);
  }

  private bone(name: GouraiBoneName) {
    return this.rig.bones[GOURAI_BONE[name]];
  }

  private animate(
    k: GouraiKaiju,
    dt: number,
    aimAt: Readonly<{ x: number; y: number; z: number }> | null,
  ): void {
    const pose = k.body.pose;
    const m = M.motion;
    const pg = pose.purge;
    for (const s of [-1, 1] as const) {
      const bone = this.bone(s < 0 ? 'armorL' : 'armorR');
      if (!bone) continue;
      // 開く: 横の蝶番で外へ（左は +Y 回り、右は −Y 回り）。捨てる: 外・上・前へ飛びながら回って小さく消える
      bone.rotation.set(
        pg * M.purge.spin * 0.4,
        -s * (pose.armorOpen * m.armorOpen + pg * M.purge.spin),
        s * pg * M.purge.spin * 0.3,
      );
      bone.position.set(
        s * (44 + pg * M.purge.fly),
        pg * M.purge.fly * 0.4,
        -58 - pg * M.purge.fly * 0.3,
      );
      const sc = Math.max(0.001, 1 - pg);
      bone.scale.set(sc, sc, sc);
    }
    const hatch = this.bone('hatch');
    if (hatch) hatch.rotation.x = pose.hatch * m.hatchOpen;
    const core = this.bone('core');
    if (core) {
      const c = 1 + 0.06 * Math.sin(this.time * 6) * Math.max(pose.armorOpen, pose.purge);
      core.scale.set(c, c, c);
    }
    // 砲台: 回転掃射の間は掃射の向き、ふだんは撃てる向きの範囲に入った自機の方、いなければ真ん中へ。壊れた砲台はうなだれて縮む
    const sweeping = k.attack === 'sweep' && k.action === 'active';
    GOURAI_TURRETS.forEach((t, i) => {
      const bone = this.bone(TURRET_BONES[i] ?? 'gunL');
      if (!bone) return;
      if (!k.turretAlive(i)) {
        bone.rotation.set(-0.45, this.turretYaw[i] ?? 0, 0.25);
        bone.scale.set(0.8, 0.6, 0.8);
        return;
      }
      bone.scale.set(1, 1, 1);
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
      const cur = this.turretYaw[i] ?? 0;
      const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const rate = sweeping ? 99 : m.turretTurn * dt;
      const next = cur + Math.max(-rate, Math.min(rate, diff));
      this.turretYaw[i] = next;
      // 骨の回転は Y（方位: 左が正）→ X（仰角: 上が正）
      bone.rotation.set(t.weapon === 'gun' ? pitch : 0, next, 0, 'YXZ');
    });
  }

  private updateRing(k: GouraiKaiju): void {
    const s = G.attacks.sweep;
    const on = k.attack === 'sweep' && (k.action === 'windup' || k.action === 'active');
    this.sweepRing.visible = on && this.group.visible;
    if (!on) return;
    const t = k.action === 'windup' ? Math.min(1, k.actionTime / s.windup) : 1;
    const r = 120 + (s.range - 120) * t;
    this.sweepRing.position.copy(this.group.position);
    // 10-4b: 掃射の面の傾きの分だけ、広がった半径での高さへ上下にずらす（危ない所は狙う人の高さ）
    this.sweepRing.position.y += r * Math.tan(k.sweepPitch * DEG);
    this.sweepRing.scale.set(r, 1, r);
    const blink = k.action === 'windup' ? 0.6 + 0.4 * Math.sin(this.time * 14) : 1;
    this.ringMat.opacity = (k.action === 'windup' ? M.fx.sweepWarn : M.fx.sweepActive) * blink;
  }
}
