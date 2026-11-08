// 10-5a: UFO ゼノリスの 3D オブジェクト: 骨格 1 つに皮の SkinnedMesh 1 つ（銀の円盤・縁の帯・ドーム・発光体・砲口・発生器）、
// バリアの殻・光線（InstancedMesh 1 つ）・瞬間移動の柱と輪（出ているときだけ）。draw call は 体 1 + 殻 0〜1 + 光線 0〜1 + 柱と輪 0〜2
// = 1〜5（シャドウは体の 1 つだけ）。「低」はジオメトリを作り直す
import {
  Group,
  Matrix4,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Mesh,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import {
  XENOLITH_CONFIG,
  XENOLITH_EMITTERS,
  XENOLITH_GENS,
  XENOLITH_PARTS,
} from '../../data/xenolith';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { xenolithSpherePoint, type XenolithKaiju } from '../../ai/xenolith-ai';
import { bodyDirection } from '../../ai/raid-kit/frame';
import { BeamFx, createBarrierMesh, createWarpFx } from './fx';
import { createXenolithMaterial, type XenolithGlow, type XenolithMaterial } from './material';
import { buildXenolithSkin } from './parts';
import {
  createXenolithSkeleton,
  XENOLITH_BONE,
  type XenolithBoneName,
  type XenolithSkeleton,
} from './skeleton';

const M = XENOLITH_MODEL_CONFIG;
const X = XENOLITH_CONFIG;

/** 皮のジオメトリ（テストで三角形を数える） */
export function buildXenolithGeometry(detail: AircraftDetail): {
  skin: BufferGeometry;
  triangles: number;
} {
  const b = buildXenolithSkin(M.detail[detail]);
  return { skin: b.build(), triangles: b.triangleCount };
}

const matrix = new Matrix4();
const yawQ = new Quaternion();
const tilt = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const PART = (id: (typeof XENOLITH_PARTS)[number]): number => XENOLITH_PARTS.indexOf(id);
const CANNON = PART('cannon');
const DOME = PART('dome');
const glow: XenolithGlow = {
  rim: 0,
  emitters: [0, 0, 0, 0],
  gens: [0, 0, 0],
  cannon: 0,
  dome: 0,
  flash: 0,
};
const origin = new Vector3();
const dir = new Vector3();
const tmp = { x: 0, y: 0, z: 0 };
const rippleDir = new Vector3(0, 1, 0);

export class XenolithObject {
  readonly group = new Group();
  private readonly rig: XenolithSkeleton;
  private readonly skin: SkinnedMesh;
  private readonly material: XenolithMaterial;
  readonly barrier: Mesh;
  private readonly barrierFx: ReturnType<typeof createBarrierMesh>;
  readonly beam = new BeamFx();
  private readonly warp = createWarpFx();
  private time = 0;
  triangles = 0;

  constructor(detail: AircraftDetail = 'high') {
    this.rig = createXenolithSkeleton();
    this.group.add(this.rig.root);
    const g = buildXenolithGeometry(detail);
    this.triangles = g.triangles;
    this.material = createXenolithMaterial();
    this.skin = new SkinnedMesh(g.skin, this.material.skin);
    this.skin.bind(this.rig.skeleton, matrix.identity());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    this.group.add(this.skin);
    const b = createBarrierMesh(M.detail[detail].segments);
    this.barrier = b.mesh;
    this.barrierFx = b;
    this.group.visible = false;
  }

  /** シーンに足すもの（体・殻・光線・柱と輪。体のほかはワールド座標で置く） */
  get objects(): readonly (Group | Mesh)[] {
    return [this.group, this.barrier, this.beam.mesh, this.warp.pillar, this.warp.ring];
  }

  /** 今の描画の回数（体 1 + 出ている効果） */
  get draws(): number {
    if (!this.group.visible) return 0;
    return (
      1 +
      [this.barrier, this.beam.mesh, this.warp.pillar, this.warp.ring].filter((m) => m.visible)
        .length
    );
  }

  setDetail(detail: AircraftDetail): void {
    const g = buildXenolithGeometry(detail);
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.triangles = g.triangles;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    if (!v) {
      this.barrier.visible = false;
      this.beam.begin();
      this.beam.end();
      this.warp.set(false, 0, 0, 0, 0, 0);
    }
  }

  /** 描画フレームごと。前ステップとの間を alpha で補間し、骨と効果を動かす。flash は被弾の光（0〜1） */
  update(k: XenolithKaiju, alpha: number, dt: number, flash = 0): void {
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
    yawQ.setFromAxisAngle(yAxis, b.prevHeading + dh * alpha);
    tilt.setFromAxisAngle(xAxis, b.pitch);
    yawQ.multiply(tilt);
    tilt.setFromAxisAngle(zAxis, -b.roll);
    this.group.quaternion.copy(yawQ).multiply(tilt);
    this.animate(k, alpha);
    this.setGlow(k, flash);
    this.updateBarrier(k);
    this.updateBeam(k);
    const w = k.warp;
    const d = w.destination;
    this.warp.set(w.phase === 'telegraph', d.x, d.y, d.z, b.floorAt(d.x, d.z), w.glow);
  }

  private bone(name: XenolithBoneName) {
    return this.rig.bones[XENOLITH_BONE[name]];
  }

  private animate(k: XenolithKaiju, alpha: number): void {
    const b = k.body;
    let ds = b.spin - b.prevSpin;
    if (ds < 0) ds += Math.PI * 2;
    const disc = this.bone('disc');
    if (disc) disc.rotation.y = -(b.prevSpin + ds * alpha);
    const ring = this.bone('ring');
    if (ring) ring.rotation.y = -(b.ringDeg * Math.PI) / 180;
    // 壊れた部位は縮める（発光体・発生器・砲口）
    const shrink = (name: XenolithBoneName, broken: boolean, s: number): void => {
      const bn = this.bone(name);
      if (bn) bn.scale.setScalar(broken ? s : 1);
    };
    XENOLITH_EMITTERS.forEach((id) => {
      shrink(id as XenolithBoneName, k.parts.isBroken(PART(id)), 0.4);
    });
    XENOLITH_GENS.forEach((id) => {
      shrink(id as XenolithBoneName, k.parts.isBroken(PART(id)), 0.45);
    });
    shrink('cannon', k.parts.isBroken(CANNON), 0.6);
    // 溜め撃ちの溜めの間、砲口が小刻みに震える
    const cannon = this.bone('cannon');
    if (cannon) {
      const shake = k.beam.kind === 'charged' && k.beam.phase === 'charge' ? 0.6 : 0;
      cannon.position.set(Math.sin(this.time * 70) * shake, -14, Math.cos(this.time * 63) * shake);
    }
  }

  private setGlow(k: XenolithKaiju, flash: number): void {
    const bar = k.barrier;
    const G = M.glow;
    // 縁の帯: 張っている間は明るく、揺らぎで点滅、外れている間は暗い（攻めどきの印）
    glow.rim =
      bar.phase === 'up'
        ? G.rim
        : bar.phase === 'flicker'
          ? Math.sin(this.time * 40) > 0
            ? G.rim * 1.6
            : 0.2
          : G.rim * 0.2;
    // 瞬間移動の予兆の間は発光体が強く光る
    const warpK = k.warp.glow;
    XENOLITH_EMITTERS.forEach((id, i) => {
      glow.emitters[i] = k.parts.isBroken(PART(id)) ? 0 : G.emitter * (1 + warpK * 1.5);
    });
    XENOLITH_GENS.forEach((id, i) => {
      glow.gens[i] = k.parts.isBroken(PART(id))
        ? 0
        : G.gen * (0.8 + 0.2 * Math.sin(this.time * 5 + i));
    });
    const beam = k.beam;
    let cannon: number = G.cannonIdle;
    if (beam.kind === 'charged') {
      if (beam.phase === 'warn')
        cannon = G.cannonIdle + (G.cannonMax * 0.4 * beam.time) / beam.spec.warn;
      else if (beam.phase === 'charge')
        cannon = G.cannonMax * (Math.sin(this.time * 30) > 0 ? 1 : 0.6);
      else if (beam.phase === 'fire') cannon = G.cannonMax;
    }
    glow.cannon = k.parts.isBroken(CANNON) ? 0 : cannon;
    glow.dome = k.parts.isBroken(DOME) ? 0 : G.dome;
    glow.flash = flash;
    this.material.set(glow);
  }

  private updateBarrier(k: XenolithKaiju): void {
    const bar = k.barrier;
    const B = X.barrier;
    const on = bar.absorbs;
    this.barrier.visible = on;
    if (!on) return;
    this.barrier.position.copy(this.group.position);
    this.barrier.position.y += B.up;
    this.barrier.scale.set(B.rx, B.ry, B.rx);
    let opacity: number = M.barrier.opacity;
    if (bar.phase === 'flicker') opacity *= Math.sin(this.time * 45) > 0 ? 1.4 : 0.15;
    // 波紋: 止めた判定の球の向き（殻の中心から、殻の大きさで割った向き）
    const age = k.rippleAge;
    const life = M.barrier.ripple;
    let ripple = 0;
    if (k.rippleSphere >= 0 && age < life) {
      xenolithSpherePoint(tmp, k.body, k.rippleSphere);
      rippleDir
        .set(
          (tmp.x - k.body.position.x) / B.rx,
          (tmp.y - k.body.position.y - B.up) / B.ry,
          (tmp.z - k.body.position.z) / B.rx,
        )
        .normalize();
      ripple = 1 - age / life;
    }
    this.barrierFx.set(opacity, rippleDir, ripple);
  }

  private updateBeam(k: XenolithKaiju): void {
    const beam = k.beam;
    const fx = this.beam;
    fx.begin();
    if (beam.busy && beam.phase !== 'recover') {
      const s = beam.spec;
      origin.set(beam.origin.x, beam.origin.y, beam.origin.z);
      const charged = beam.kind === 'charged';
      const hex = charged ? M.colors.chargedBeam : M.colors.sweepBeam;
      const warnR = M.beam.warnRadius;
      if (beam.phase === 'fire') {
        const r = s.radius * M.beam.fireScale * (0.85 + 0.15 * Math.sin(this.time * 50));
        dir.set(beam.direction.x, beam.direction.y, beam.direction.z);
        fx.add(origin, dir, s.length, r, hex, 1.3);
      } else if (!charged) {
        // なぎ払いの予兆: 撃つ線の始めと終わりが薄く光る（点滅しながら明るく）
        const kk = 0.25 + 0.5 * (beam.time / s.warn) * (Math.sin(this.time * 18) > 0 ? 1 : 0.6);
        for (const yaw of [beam.fromYawDeg, beam.toYawDeg]) {
          bodyDirection(tmp, k.body, yaw, beam.pitchDeg);
          dir.set(tmp.x, tmp.y, tmp.z);
          fx.add(origin, dir, s.length, warnR, hex, kk);
        }
      } else {
        // 溜め撃ち: ロック警告の間は追う細い線（点滅）、溜めの間は止まった線（明るく）
        dir.set(beam.direction.x, beam.direction.y, beam.direction.z);
        const lock = beam.phase === 'warn';
        const kk = lock ? (Math.sin(this.time * 14) > 0 ? 0.55 : 0.2) : 0.9;
        fx.add(origin, dir, s.length, lock ? warnR : warnR * 1.6, hex, kk);
      }
    }
    fx.end();
  }
}
