// 10-3a: 白鯨アルビオンの攻撃の見た目: 潮吹きの柱（予兆は薄く危ない所を見せ、攻撃で白く噴く）・叩きつけの扇（予兆は薄く、
// 打ち下ろしで光って広がる）・雲（予兆は頭の周りの霧の渦、出たら体の周りの大きな球）。出ているものだけ描く（各 1 回）
import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  SphereGeometry,
  Vector3,
} from 'three';
import { ALBION_CONFIG } from '../../data/albion';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import type { AlbionKaiju } from '../../ai/albion-ai';
import { blowhole, tailPivot } from '../../ai/albion-attacks';

const M = ALBION_MODEL_CONFIG;
const A = ALBION_CONFIG.attacks;
const v = { x: 0, y: 0, z: 0 };
const head = new Vector3();

function fxMaterial(color: number, additive: boolean): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : NormalBlending,
  });
}

export class AlbionFx {
  readonly spout: Mesh;
  readonly slam: Mesh;
  readonly cloud: Mesh;
  private readonly spoutMat = fxMaterial(M.colors.spout, true);
  private readonly slamMat = fxMaterial(M.colors.slam, true);
  private readonly cloudMat = fxMaterial(M.colors.cloud, false);

  constructor() {
    // 柱: 底が原点、+Y へ高さ 1・半径 1
    this.spout = new Mesh(
      new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0),
      this.spoutMat,
    );
    // 扇: 水平・要が原点・後ろ（+Z）を中心に左右 halfAngle 度・半径 1
    const half = (A.slam.halfAngle * Math.PI) / 180;
    this.slam = new Mesh(
      new CircleGeometry(1, 20, -Math.PI / 2 - half, 2 * half).rotateX(-Math.PI / 2),
      this.slamMat,
    );
    this.cloud = new Mesh(new SphereGeometry(1, 18, 12), this.cloudMat);
    for (const m of this.objects) {
      m.frustumCulled = false;
      m.visible = false;
    }
  }

  get objects(): readonly Mesh[] {
    return [this.spout, this.slam, this.cloud];
  }

  hide(): void {
    for (const m of this.objects) m.visible = false;
  }

  /** 描画フレームごと（heading は体の向き。補間した位置は使わず固定ステップの位置: 大きく動かないので十分） */
  update(k: AlbionKaiju, time: number): void {
    const act = k.action;
    const a = k.attack;
    const t = k.actionTime;
    // 潮吹き
    const spoutOn = a === 'spout' && (act === 'windup' || act === 'active');
    this.spout.visible = spoutOn;
    if (spoutOn) {
      blowhole(v, k.body);
      const r = k.spoutRadius;
      const active = act === 'active';
      const grow = active ? Math.min(1, t / 0.25) : 1;
      this.spout.position.set(v.x, v.y, v.z);
      this.spout.scale.set(r, A.spout.height * grow, r);
      this.spoutMat.opacity = active
        ? M.fx.spoutActive * (0.8 + 0.2 * Math.sin(time * 30))
        : M.fx.spoutWarn * Math.min(1, t / 0.6) * (0.7 + 0.3 * Math.sin(time * 8));
    }
    // 叩きつけ
    const slamOn = a === 'slam' && (act === 'windup' || act === 'active');
    this.slam.visible = slamOn;
    if (slamOn) {
      tailPivot(v, k.body);
      const r = k.slamRadius;
      const active = act === 'active';
      const s = active ? r * (0.6 + 0.4 * Math.min(1, t / A.slam.active)) : r;
      this.slam.position.set(v.x, v.y - (active ? 30 : 0), v.z);
      this.slam.rotation.set(0, k.body.heading, 0);
      this.slam.scale.set(s, 1, s);
      this.slamMat.opacity = active
        ? M.fx.slamActive
        : M.fx.slamWarn * (0.6 + 0.4 * Math.sin(time * 10));
    }
    // 雲: 予兆は頭の周りの霧（大きくなりながら回る）、出たら体の周り
    const mist = k.body.pose.mist;
    if (k.cloudLeft > 0) {
      const life = k.cloudLeft;
      const fade = Math.min(1, life / 2, (A.cloud.seconds - life) / 1.5 + 0.2);
      const r = A.cloud.radius * (0.3 + 0.7 * Math.min(1, (A.cloud.seconds - life) / 2));
      this.cloud.visible = true;
      this.cloud.position.set(k.body.position.x, k.body.position.y, k.body.position.z);
      this.cloud.scale.setScalar(r);
      this.cloudMat.opacity = M.fx.cloud * fade;
    } else if (mist > 0.01) {
      k.body.point(head, { forward: 290, right: 0, up: 10 });
      this.cloud.visible = true;
      this.cloud.position.copy(head);
      this.cloud.rotation.y = time * 1.5;
      this.cloud.scale.set(60 + 90 * mist, 45 + 60 * mist, 60 + 90 * mist);
      this.cloudMat.opacity = M.fx.mist * mist;
    } else this.cloud.visible = false;
  }
}
