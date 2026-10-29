// HUD に渡す 1 フレーム分の値をまとめて作る（機体・戦闘の状態 + カメラで投影した画面座標）
import type { Object3D, PerspectiveCamera } from 'three';
import type { CombatSystem } from '../combat/combat-system';
import type { CombatTarget } from '../combat/target';
import type { Aircraft, GroundHeightFn } from '../entities/aircraft';
import type { Hud, HudFrame } from '../ui/hud';
import { createHudFrame, fillHudFrame } from '../ui/hud-feed';
import { projectFlightPath } from './hud-projection';
import { TargetProjector } from './target-projection';

export class HudLink {
  private readonly frame: HudFrame;
  private readonly flightPath = { x: 0, y: 0 };
  private readonly projector: TargetProjector;

  constructor(
    private readonly hud: Hud,
    private readonly camera: PerspectiveCamera,
    private readonly aircraftMesh: Object3D,
    private readonly aircraft: Aircraft,
    private readonly combat: CombatSystem,
    private readonly groundHeight: GroundHeightFn,
  ) {
    this.frame = createHudFrame(aircraft);
    this.projector = new TargetProjector(camera);
  }

  /** 描画フレームごとに呼ぶ（DOM の書き換えは HUD 側で変化があったときだけ） */
  update(alpha: number, width: number, height: number): void {
    const f = this.frame;
    fillHudFrame(f, this.aircraft, this.combat, this.groundHeight);
    const fpm = projectFlightPath(this.camera, this.aircraftMesh, width, height, this.flightPath);
    f.flightPath = fpm ? this.flightPath : null;
    this.projector.fill(
      f.weapons,
      this.combat,
      this.aircraftMesh,
      f.flightPath,
      alpha,
      width,
      height,
    );
    this.hud.update(f);
  }

  /** 画面の (x, y) をタップ・クリックしたとき、近くに表示している対象（なければ null） */
  pick(x: number, y: number): CombatTarget | null {
    return this.projector.pick(x, y);
  }
}
