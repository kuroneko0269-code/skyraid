// 防衛戦（7-2）の巡航ミサイルのマーカーの画面座標（カメラで投影）。ソロも協力も MissionProps の巡航ミサイルを見る
// （協力は表示側がホストの判定を写したもの）
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { HUD_CONFIG } from '../data/hud';
import type { CruiseMissile } from '../entities/cruise-missile';
import type { CruiseMarker, DefenseHud } from '../ui/defense-hud';
import { edgeArrow, type EdgeArrow } from '../ui/hud-math';

const p = new Vector3();
const arrow: EdgeArrow = { x: 0, y: 0, deg: 0 };

export class DefenseHudLink {
  private readonly markers: CruiseMarker[] = Array.from({ length: 16 }, () => ({
    shown: false,
    onScreen: false,
    x: 0,
    y: 0,
    deg: 0,
    distance: 0,
  }));

  constructor(
    private readonly hud: DefenseHud,
    private readonly camera: PerspectiveCamera,
    private readonly aircraft: Object3D,
    private readonly cruise: readonly CruiseMissile[],
  ) {}

  update(width: number, height: number): void {
    this.camera.updateMatrixWorld();
    let n = 0;
    for (const c of this.cruise) {
      const m = this.markers[n];
      if (!m) break;
      if (!c.active) continue;
      n++;
      m.shown = true;
      p.set(c.position.x, c.position.y, c.position.z);
      m.distance = p.distanceTo(this.aircraft.position);
      p.applyMatrix4(this.camera.matrixWorldInverse);
      const behind = p.z > 0;
      p.applyMatrix4(this.camera.projectionMatrix);
      m.onScreen = !behind && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
      if (m.onScreen) {
        m.x = (p.x * 0.5 + 0.5) * width;
        m.y = (-p.y * 0.5 + 0.5) * height;
      } else {
        edgeArrow(arrow, p.x, p.y, behind, width, height, HUD_CONFIG.targets.edgeMargin);
        m.x = arrow.x;
        m.y = arrow.y;
        m.deg = arrow.deg;
      }
    }
    for (let i = n; i < this.markers.length; i++) {
      const m = this.markers[i];
      if (m) m.shown = false;
    }
    this.hud.setCruiseMarkers(this.markers);
  }
}
