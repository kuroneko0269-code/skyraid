// ミッションの HUD に渡す値（2-4）: 残り時間・戦域の境界・次のリング（護衛中は輸送機。2-5）の画面座標（カメラで投影）。
// 目標の進み具合は MissionHud がランナーのイベントを購読する
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { HUD_CONFIG } from '../data/hud';
import type { GamePlay } from '../missions/game-play';
import { edgeArrow, type EdgeArrow } from '../ui/hud-math';
import { createWaypointFrame, type MissionHud } from '../ui/mission-hud';

const p = new Vector3();
const arrow: EdgeArrow = { x: 0, y: 0, deg: 0 };

export class MissionLink {
  private readonly waypoint = createWaypointFrame();

  constructor(
    private readonly hud: MissionHud,
    private readonly camera: PerspectiveCamera,
    private readonly aircraft: Object3D,
    private readonly play: GamePlay,
  ) {}

  /** 描画フレームごとに呼ぶ（飛行中だけ） */
  update(width: number, height: number): void {
    const runner = this.play.runner;
    this.hud.setTimeLeft(runner ? runner.timeLeft : null);
    const b = this.play.boundary;
    this.hud.setBoundary(b.outside, b.failOnExpire ? b.secondsLeft : null);

    const w = this.waypoint;
    // 次のリング。なければ護衛中の輸送機（守る相手の位置を示す）
    const ring = runner?.running ? (runner.activeRings?.next ?? null) : null;
    const escort = runner?.running && !ring ? this.escortPosition() : null;
    const mark = ring?.position ?? escort;
    w.shown = mark !== null;
    if (mark) {
      p.set(mark.x, mark.y, mark.z);
      w.distance = p.distanceTo(this.aircraft.position);
      this.camera.updateMatrixWorld();
      p.applyMatrix4(this.camera.matrixWorldInverse);
      const behind = p.z > 0;
      p.applyMatrix4(this.camera.projectionMatrix);
      w.onScreen = !behind && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
      if (w.onScreen) {
        w.x = (p.x * 0.5 + 0.5) * width;
        w.y = (-p.y * 0.5 + 0.5) * height;
      } else {
        edgeArrow(arrow, p.x, p.y, behind, width, height, HUD_CONFIG.targets.edgeMargin);
        w.x = arrow.x;
        w.y = arrow.y;
        w.deg = arrow.deg;
      }
    }
    this.hud.setWaypoint(w);
  }

  /** 進行中の護衛の目標の輸送機の位置（なければ null） */
  private escortPosition(): Readonly<{ x: number; y: number; z: number }> | null {
    const runner = this.play.runner;
    if (!runner) return null;
    for (const o of runner.objectives) {
      if (o.status !== 'active' || o.def.type !== 'escort') continue;
      const e = this.play.session.escort(o.def.group);
      if (e?.active) return e.position;
    }
    return null;
  }
}
