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
import { markerRange } from '../core/weather-state';
import { autoFireReady } from '../combat/auto-fire';
import { HUD_CONFIG } from '../data/hud';

export class HudLink {
  private readonly frame: HudFrame;
  private readonly flightPath = { x: 0, y: 0 };
  private readonly projector: TargetProjector;
  private readonly impact = { x: 0, y: 0 };
  /** 視認性の悪さ（0〜1。霧・雨・夜。7-5）。マーカーを出す距離を索敵距離の 60% まで縮める */
  visibility: () => number = () => 0;
  /** 宙返り（9-3）の速度不足（「方向へ倒す」方式の SteerControl。app.ts が入れる） */
  loopSpeedLow: () => boolean = () => false;
  /** 9-5b: 機銃だけで飛んでいる（練習場。app.ts が入れる） */
  gunOnly: () => boolean = () => false;
  /** 9-5b: 速度合わせでスロットルを下げている（HUD の THR に AUTO） */
  speedMatching: () => boolean = () => false;
  private lastShots = 0;
  private lastShotAt = -Infinity;

  constructor(
    private readonly hud: Hud,
    private readonly camera: PerspectiveCamera,
    private readonly aircraftMesh: Object3D,
    private readonly ff: FlightSession,
    private readonly groundHeight: GroundHeightFn,
    /** タッチの MSL ボタンで撃つ兵装を HUD に出す（2-6） */
    private readonly weaponInput: Pick<WeaponInput, 'secondary'> | null = null,
    /** 設定「HUD 補助」（4-12）。毎フレーム読む */
    private readonly assist: () => boolean = () => false,
  ) {
    this.frame = createHudFrame(ff.aircraft);
    // 7-5 の天候が入れる（main.ts）
    this.projector = new TargetProjector(camera);
  }

  /** 描画フレームごとに呼ぶ（DOM の書き換えは HUD 側で変化があったときだけ） */
  update(alpha: number, width: number, height: number): void {
    const f = this.frame;
    fillHudFrame(f, this.ff, this.groundHeight, this.assist());
    f.loopSpeedLow = this.ff.player.active && this.loopSpeedLow();
    f.speedMatching = this.ff.player.active && this.speedMatching();
    f.gunOnly = this.gunOnly();
    const fpm = projectFlightPath(this.camera, this.aircraftMesh, width, height, this.flightPath);
    f.flightPath = fpm ? this.flightPath : null;
    f.viewWidth = width;
    f.viewHeight = height;
    this.projector.fill(
      f.weapons,
      this.ff.combat,
      this.aircraftMesh,
      f.flightPath,
      alpha,
      width,
      height,
      markerRange(this.ff.combat.targeting.spec.sensorRange, this.visibility()),
      this.ff.aircraft.state.speed,
    );
    this.fillGun();
    this.fillImpact(width, height);
    this.hud.update(f);
  }

  /**
   * 9-5b: 狙う印が「撃てば当たる」か（自動射撃と同じ判定）と、射程外で撃っているか（GUN ボタン。自動射撃は射程内でしか撃たない）。
   * 撃っている = 直前 rangeFireHoldSeconds の間に弾が出た
   */
  private fillGun(): void {
    const w = this.frame.weapons;
    const c = this.ff.combat;
    const st = this.ff.aircraft.state;
    w.leadReady =
      w.leadShown &&
      autoFireReady(
        c.targeting.selected,
        c.lead,
        c.leadValid,
        st.position,
        st.orientation,
        c.gun.hitRadiusScale,
      );
    const now = performance.now() / 1000;
    const shots = c.gun.shotCount;
    if (shots > this.lastShots) this.lastShotAt = now;
    if (shots < this.lastShots) this.lastShotAt = -Infinity;
    this.lastShots = shots;
    const firing = now - this.lastShotAt < HUD_CONFIG.rangeFireHoldSeconds;
    const sel = c.targeting.selected;
    w.outOfRangeFire =
      firing &&
      this.ff.player.active &&
      sel !== null &&
      sel.active &&
      c.targeting.selectedDistance > c.gun.spec.range;
  }

  /** 爆弾の着弾予測点（2-6）と、MSL ボタンの兵装 */
  private fillImpact(width: number, height: number): void {
    const o = this.frame.ordnance;
    const bombs = this.ff.combat.bombs;
    o.secondary = this.weaponInput?.secondary ?? 'missile';
    // 9-5b: 機銃だけの練習場では出さない（機銃で狙う印と間違える）
    o.impactShown =
      this.ff.player.active &&
      !this.frame.gunOnly &&
      bombs.predictionValid &&
      this.projector.projectPoint(bombs.prediction, width, height, this.impact);
    o.impactX = this.impact.x;
    o.impactY = this.impact.y;
  }

  /** element をタップ（クリック）すると、近くに表示している対象を選ぶ（enabled が true の間だけ） */
  bindTap(
    element: HTMLElement,
    enabled: () => boolean,
    /** 選び方（7-B: 記録中はリプレイの記録を通す） */
    select: (target: CombatTarget) => void = (t) => {
      this.ff.combat.targeting.select(t);
    },
  ): void {
    element.addEventListener('pointerdown', (e) => {
      if (!enabled()) return;
      const target = this.pick(e.clientX, e.clientY);
      if (target) select(target);
    });
  }

  /** 画面の (x, y) をタップ・クリックしたとき、近くに表示している対象（なければ null） */
  pick(x: number, y: number): CombatTarget | null {
    return this.projector.pick(x, y);
  }
}
