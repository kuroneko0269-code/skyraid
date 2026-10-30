// HUD に渡す 1 フレーム分の値をまとめて作る（機体・戦闘の状態 + カメラで投影した画面座標）
import type { Object3D, PerspectiveCamera } from 'three';
import type { CombatTarget } from '../combat/target';
import type { WeaponInput } from '../core/weapon-input';
import type { GroundHeightFn } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import type { Hud, HudFrame } from '../ui/hud';
import { createHudFrame, fillHudFrame } from '../ui/hud-feed';
import { projectFlightPath } from './hud-projection';
import { TargetProjector } from './target-projection';

export class HudLink {
  private readonly frame: HudFrame;
  private readonly flightPath = { x: 0, y: 0 };
  private readonly projector: TargetProjector;
  private readonly impact = { x: 0, y: 0 };

  constructor(
    private readonly hud: Hud,
    private readonly camera: PerspectiveCamera,
    private readonly aircraftMesh: Object3D,
    private readonly ff: FlightSession,
    private readonly groundHeight: GroundHeightFn,
    /** タッチの MSL ボタンで撃つ兵装を HUD に出す（2-6） */
    private readonly weaponInput: Pick<WeaponInput, 'secondary'> | null = null,
  ) {
    this.frame = createHudFrame(ff.aircraft);
    this.projector = new TargetProjector(camera);
  }

  /** 描画フレームごとに呼ぶ（DOM の書き換えは HUD 側で変化があったときだけ） */
  update(alpha: number, width: number, height: number): void {
    const f = this.frame;
    fillHudFrame(f, this.ff, this.groundHeight);
    const fpm = projectFlightPath(this.camera, this.aircraftMesh, width, height, this.flightPath);
    f.flightPath = fpm ? this.flightPath : null;
    this.projector.fill(
      f.weapons,
      this.ff.combat,
      this.aircraftMesh,
      f.flightPath,
      alpha,
      width,
      height,
    );
    this.fillImpact(width, height);
    this.hud.update(f);
  }

  /** 爆弾の着弾予測点（2-6）と、MSL ボタンの兵装 */
  private fillImpact(width: number, height: number): void {
    const o = this.frame.ordnance;
    const bombs = this.ff.combat.bombs;
    o.secondary = this.weaponInput?.secondary ?? 'missile';
    o.impactShown =
      this.ff.player.active &&
      bombs.predictionValid &&
      this.projector.projectPoint(bombs.prediction, width, height, this.impact);
    o.impactX = this.impact.x;
    o.impactY = this.impact.y;
  }

  /** element をタップ（クリック）すると、近くに表示している対象を選ぶ（enabled が true の間だけ） */
  bindTap(element: HTMLElement, enabled: () => boolean): void {
    element.addEventListener('pointerdown', (e) => {
      if (!enabled()) return;
      const target = this.pick(e.clientX, e.clientY);
      if (target) this.ff.combat.targeting.select(target);
    });
  }

  /** 画面の (x, y) をタップ・クリックしたとき、近くに表示している対象（なければ null） */
  pick(x: number, y: number): CombatTarget | null {
    return this.projector.pick(x, y);
  }
}
