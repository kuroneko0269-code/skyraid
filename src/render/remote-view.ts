// PvP の他プレイヤーの機体（5-1）: 自機と同じモデル生成器（AircraftObject）で、機体の色をプレイヤーごとに変える。
// 1 機あたり draw call は機体 1・キャノピー 1・炎 1（点火中だけ）。最大 3 機。陽炎は出さない。
// 他機の見た目の機銃の弾（5-3。発射の event から出す）はまとめて 1 つで描く。復帰後の無敵中は半透明
import { Group, type Scene } from 'three';
import type { Bullet } from '../combat/gun';
import type { Pool } from '../combat/pool';
import { PVP_CONFIG } from '../data/pvp';
import type { Vec3 } from '../flight/math';
import { TracerRenderer } from './tracers';
import { findAircraftModel, AIRCRAFT_MODELS, type AircraftModel } from '../data/aircraft';
import type { AircraftShape } from '../data/aircraft-shapes';
import type { AircraftDetail } from '../data/aircraft-model';
import { NET_CONFIG } from '../data/net';
import type { RemoteSample } from '../net/net-game';
import { resolveLoadout } from '../progression/loadout';
import { AircraftObject } from './aircraft-model/aircraft-object';

/** 色を混ぜる（0xrrggbb、t は b の割合） */
function mixColor(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out;
}

const shapeCache = new Map<string, AircraftShape>();

/** プレイヤー ID の色を付けた機体の形（アクセント色 = プレイヤーの色、胴体も少しその色に寄せる） */
export function playerShape(model: AircraftModel, id: number): AircraftShape {
  const key = `${model.id}:${id}`;
  const cached = shapeCache.get(key);
  if (cached) return cached;
  const color = NET_CONFIG.playerColors[id % NET_CONFIG.playerColors.length] ?? 0xffffff;
  const shape: AircraftShape = {
    ...model.shape,
    accentColor: color,
    bodyColor: mixColor(model.shape.bodyColor, color, NET_CONFIG.playerBodyTint),
  };
  shapeCache.set(key, shape);
  return shape;
}

export function modelOf(aircraftId: string): AircraftModel {
  const m = findAircraftModel(aircraftId) ?? AIRCRAFT_MODELS[0];
  if (!m) throw new Error('機体の定義がありません');
  return m;
}

interface RemoteObject {
  readonly group: Group;
  readonly object: AircraftObject;
}

const NO_UPGRADES = { engine: 0, airframe: 0, weapons: 0, avionics: 0 };
/** 機体 id → パイロンの数（見た目だけ。強化 Lv0 の数） */
const pylons = new Map<string, number>();

function pylonsOf(model: AircraftModel): number {
  let n = pylons.get(model.id);
  if (n === undefined) {
    n = resolveLoadout(model, NO_UPGRADES).missiles;
    pylons.set(model.id, n);
  }
  return n;
}

/**
 * 他機の描画。プレイヤー ID ごとに 1 つ作って使い回す（抜けたら隠すだけ。作り直しのたびにジオメトリ・マテリアルを
 * 作らない）。機体が変われば同じ入れ物で作り直す
 */
export class RemoteView {
  private readonly objects = new Map<number, RemoteObject>();
  private detail: AircraftDetail;
  /** 他機の見た目の弾（3 機 × 64 発まで） */
  private readonly tracers = new TracerRenderer(192);

  constructor(
    private readonly scene: Scene,
    detail: AircraftDetail,
  ) {
    this.detail = detail;
    scene.add(this.tracers.mesh);
  }

  setDetail(detail: AircraftDetail): void {
    this.detail = detail;
    for (const o of this.objects.values()) o.object.setDetail(detail);
  }

  /**
   * 描画フレームごと。samples にない（切断した）機体は隠す。dt は演出の時間。
   * bullets は他機の見た目の機銃の弾（alpha は固定ステップの間の位置）
   */
  update(
    samples: readonly RemoteSample[],
    dt: number,
    bullets: readonly Pool<Bullet>[] = [],
    alpha = 1,
    camera: Readonly<Vec3> | null = null,
  ): void {
    for (const o of this.objects.values()) o.group.visible = false;
    if (camera) this.tracers.update(bullets, alpha, camera);
    for (const s of samples) {
      const o = this.objectFor(s);
      o.group.visible = s.alive;
      o.object.setOpacity(s.invulnerable ? PVP_CONFIG.invulnerableOpacity : 1);
      o.group.position.set(s.position.x, s.position.y, s.position.z);
      o.group.quaternion.set(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w);
      o.object.flame.update(s.alive && s.afterburner, dt);
    }
  }

  /** すべて隠す（PvP の終わり） */
  clear(): void {
    for (const o of this.objects.values()) o.group.visible = false;
    this.tracers.update([], 0, { x: 0, y: 0, z: 0 });
  }

  private objectFor(s: RemoteSample): RemoteObject {
    let o = this.objects.get(s.id);
    if (!o) {
      const object = new AircraftObject();
      object.haze.mesh.visible = false;
      const group = new Group();
      group.add(object.group);
      this.scene.add(group);
      o = { group, object };
      this.objects.set(s.id, o);
    }
    // 形・細かさが同じなら作り直さない（AircraftObject.build が比べる）
    const model = modelOf(s.aircraftId);
    o.object.build(playerShape(model, s.id), this.detail, pylonsOf(model));
    return o;
  }
}
