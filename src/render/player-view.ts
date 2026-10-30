// 自機の見た目: 出撃する機体の形で作り、固定ステップの間を補間して置く（main.ts から分けた）
import type { Group, Scene } from 'three';
import type { AircraftModel } from '../data/aircraft';
import type { Aircraft } from '../entities/aircraft';
import {
  applyInterpolatedPose,
  createPlaceholderAircraft,
  rebuildPlaceholderAircraft,
} from './aircraft-mesh';
import { setShadowFlags } from './lighting';

export class PlayerView {
  readonly mesh: Group;
  /** 今の見た目の機体（出撃する機体が変わったら作り直す） */
  private shapeOf: AircraftModel | null = null;

  constructor(scene: Scene) {
    this.mesh = createPlaceholderAircraft();
    // 自機は影を落とし、自分の影（翼の影など）も受ける
    setShadowFlags(this.mesh, true, true);
    scene.add(this.mesh);
  }

  /** 見た目を機体の形にする（同じ機体なら何もしない） */
  setModel(model: AircraftModel): void {
    if (this.shapeOf === model) return;
    this.shapeOf = model;
    rebuildPlaceholderAircraft(this.mesh, model.shape);
    setShadowFlags(this.mesh, true, true);
  }

  /** 前ステップと現ステップの間を alpha で補間して置く */
  updatePose(aircraft: Aircraft, alpha: number): void {
    applyInterpolatedPose(
      this.mesh,
      aircraft.prevPosition,
      aircraft.state.position,
      aircraft.prevOrientation,
      aircraft.state.orientation,
      alpha,
    );
  }
}
