// 10-3a: 白鯨アルビオンの攻撃の見た目: 潮吹きの柱（予兆は薄く危ない所を見せ、攻撃で白く噴く）・叩きつけの扇（予兆は薄く、
// 打ち下ろしで光って広がる）・雲（予兆は頭の周りの霧の渦、出たら体の周りの大きな球）。出ているものだけ描く（各 1 回）。
// 10-3c: 水柱（5 本を InstancedMesh 1 つ。予兆は薄い筒、攻撃で床から噴き上がる）・歌の輪（予兆は体の周りで脈打ち、攻撃で広がる
// 帯）・横転の払う範囲（人の側の扇）。攻撃は 1 度に 1 つなので、描画は 体 1 + 子分 1 + 攻撃 1 + 雲 1 = 4 まで
import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  SphereGeometry,
  Vector3,
} from 'three';
import { GEYSER_COUNT, geyserPoint, sonarRadius } from '../../ai/albion-aimed';
import { ALBION_CONFIG } from '../../data/albion';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import type { AlbionKaiju } from '../../ai/albion-ai';
import { blowhole, tailPivot } from '../../ai/albion-attacks';

const M = ALBION_MODEL_CONFIG;
const A = ALBION_CONFIG.attacks;
const C_RADIUS = ALBION_CONFIG.size.radius;
const v = { x: 0, y: 0, z: 0 };
const head = new Vector3();
const gp = { x: 0, z: 0 };
const mat4 = new Matrix4();

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
  readonly geyser: InstancedMesh;
  readonly sonar: Mesh;
  readonly roll: Mesh;
  private readonly spoutMat = fxMaterial(M.colors.spout, true);
  private readonly slamMat = fxMaterial(M.colors.slam, true);
  private readonly cloudMat = fxMaterial(M.colors.cloud, false);
  private readonly geyserMat = fxMaterial(M.colors.geyser, true);
  private readonly sonarMat = fxMaterial(M.colors.sonar, true);
  private readonly rollMat = fxMaterial(M.colors.roll, true);

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
    // 水柱: 底が原点・半径 1・高さ 1 の筒を 5 本
    this.geyser = new InstancedMesh(
      new CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0),
      this.geyserMat,
      GEYSER_COUNT,
    );
    // 歌の輪: 半径 1・高さ 1（中心が原点）の帯
    this.sonar = new Mesh(new CylinderGeometry(1, 1, 1, 48, 1, true), this.sonarMat);
    // 横転の払う範囲: 要が原点・右（+X）を中心に左右 60°・半径 1 の水平の扇
    this.roll = new Mesh(
      new CircleGeometry(1, 20, -Math.PI / 3, (2 * Math.PI) / 3).rotateX(-Math.PI / 2),
      this.rollMat,
    );
    for (const m of this.objects) {
      m.frustumCulled = false;
      m.visible = false;
    }
  }

  get objects(): readonly Mesh[] {
    return [this.spout, this.slam, this.cloud, this.geyser, this.sonar, this.roll];
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
    this.updateAimed(k, time);
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

  /** 10-3c: 水柱・歌の輪・横転の払う範囲 */
  private updateAimed(k: AlbionKaiju, time: number): void {
    const act = k.action;
    const a = k.attack;
    const t = k.actionTime;
    const on = act === 'windup' || act === 'active';
    const active = act === 'active';
    // 水柱: 予兆は床から薄い筒（狙いの所）、攻撃で噴き上がる
    const geyserOn = a === 'geyser' && on;
    this.geyser.visible = geyserOn;
    if (geyserOn) {
      const G = A.geyser;
      const grow = active ? Math.min(1, t / G.rise) : 1;
      const r = active ? G.radius : G.radius * (0.8 + 0.2 * Math.sin(time * 9));
      for (let i = 0; i < GEYSER_COUNT; i++) {
        geyserPoint(k, i, gp);
        const floor = k.body.floorAt(gp.x, gp.z);
        mat4.makeScale(r, Math.max(1, G.height * grow), r);
        mat4.setPosition(gp.x, floor, gp.z);
        this.geyser.setMatrixAt(i, mat4);
      }
      this.geyser.instanceMatrix.needsUpdate = true;
      this.geyserMat.opacity = active
        ? M.fx.geyserActive * (0.85 + 0.15 * Math.sin(time * 25))
        : M.fx.geyserWarn * Math.min(1, t / 0.4);
    }
    // 歌: 予兆は体の周りで脈打つ輪、攻撃で広がる帯（高さ ±band）
    const sonarOn = a === 'sonar' && on;
    this.sonar.visible = sonarOn;
    if (sonarOn) {
      const S = A.sonar;
      if (active) {
        this.sonar.position.set(k.sonarX, k.sonarY, k.sonarZ);
        this.sonar.scale.set(sonarRadius(t), S.band * 2, sonarRadius(t));
        const fade = 1 - Math.min(1, (sonarRadius(t) - S.start) / (S.maxRadius - S.start)) * 0.6;
        this.sonarMat.opacity = M.fx.sonarActive * fade;
      } else {
        const b = k.body.position;
        const pulse = (t * 1.5) % 1;
        this.sonar.position.set(b.x, b.y - k.body.pose.sink, b.z);
        const r = S.start + 260 * pulse;
        this.sonar.scale.set(r, S.band * 2, r);
        this.sonarMat.opacity = M.fx.sonarWarn * (1 - pulse);
      }
    }
    // 横転: 人の側の扇（予兆は薄く、払いで光る）
    const rollOn = a === 'roll' && on;
    this.roll.visible = rollOn;
    if (rollOn) {
      const b = k.body.position;
      this.roll.position.set(b.x, b.y, b.z);
      // 扇の中心（+X）を体の右（rollSide 1）か左へ
      this.roll.rotation.set(0, k.body.heading + (k.rollSide > 0 ? 0 : Math.PI), 0);
      const r = A.roll.reach + C_RADIUS;
      this.roll.scale.set(r, 1, r);
      this.rollMat.opacity = active
        ? M.fx.rollActive
        : M.fx.rollWarn * (0.6 + 0.4 * Math.sin(time * 10));
    }
  }
}
