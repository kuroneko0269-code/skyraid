// リングレース（7-1）のゴーストの描画: ベストタイムの走行を半透明の機体（手続き生成モデルの「低」・draw call 2）で再生する。
// 位置・姿勢は GhostTrack（15Hz の記録を補間）から、レースの走行の時計で引く
import { Group, type Scene } from 'three';
import { RACE_CONFIG } from '../data/race';
import type { AircraftModel } from '../data/aircraft';
import type { GhostTrack } from '../missions/race/ghost';
import { quatIdentity, vec3 } from '../flight/math';
import { AircraftObject } from './aircraft-model/aircraft-object';

export class GhostView {
  private readonly mesh = new Group();
  private readonly object = new AircraftObject();
  private track: GhostTrack | null = null;
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
  setGhost(track: GhostTrack | null, model: AircraftModel | null): void {
    this.track = model ? track : null;
    if (track && model) {
      this.object.build(model.shape, 'low', 0);
      this.object.setOpacity(RACE_CONFIG.ghostOpacity);
    }
    this.mesh.visible = false;
  }

  /** 描画フレームごと。time はレースの走行の時計（null は出さない: カウントダウン中・レース外） */
  update(time: number | null): void {
    const t = this.track;
    this.mesh.visible = t !== null && time !== null;
    if (!t || time === null) return;
    t.sample(time, this.p, this.q);
    this.mesh.position.set(this.p.x, this.p.y, this.p.z);
    this.mesh.quaternion.set(this.q.x, this.q.y, this.q.z, this.q.w);
  }
}
