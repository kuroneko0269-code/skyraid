// リングレース（7-1）のゴーストの描画: ベストタイムの走行を半透明の機体（手続き生成モデルの「低」・draw call 2）で再生する。
// 位置・姿勢は GhostSource（7-B: 入力の記録を別の世界で再生したもの。固定ステップの補間）から引く
import { Group, type Scene } from 'three';
import { RACE_CONFIG } from '../data/race';
import type { AircraftModel } from '../data/aircraft';
import type { GhostSource } from '../missions/race/ghost';
import { quatIdentity, vec3 } from '../flight/math';
import { AircraftObject } from './aircraft-model/aircraft-object';

export class GhostView {
  private readonly mesh = new Group();
  private readonly object = new AircraftObject();
  private source: GhostSource | null = null;
  private readonly p = vec3();
  private readonly q = quatIdentity();

  constructor(scene: Scene) {
    this.mesh.add(this.object.group);
    this.object.flame.mesh.visible = false;
    this.object.haze.mesh.visible = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** 再生するゴースト（null で消す）と、その機体の形 */
  setGhost(source: GhostSource | null, model: AircraftModel | null): void {
    this.source = model ? source : null;
    if (source && model) {
      this.object.build(model.shape, 'low', 0);
      this.object.setOpacity(RACE_CONFIG.ghostOpacity);
    }
    this.mesh.visible = false;
  }

  /** 描画フレームごと。alpha は固定ステップの補間（null は出さない: レース外・ポーズ中以外の止まった画面） */
  update(alpha: number | null): void {
    const s = this.source;
    this.mesh.visible = s !== null && alpha !== null && s.sample(alpha, this.p, this.q);
    if (!this.mesh.visible) return;
    this.mesh.position.set(this.p.x, this.p.y, this.p.z);
    this.mesh.quaternion.set(this.q.x, this.q.y, this.q.z, this.q.w);
  }
}
