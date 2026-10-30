// 索敵マーカー・選択対象・予測照準点の画面座標を求めて HUD の値に書く（2-2）。
// 計算の中身（画面端の矢印・タップの判定）は ui/hud-math.ts の純関数
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { CombatSystem } from '../combat/combat-system';
import type { CombatTarget } from '../combat/target';
import type { Vec3 } from '../flight/math';
import { HUD_CONFIG } from '../data/hud';
import type { HudPoint, HudWeaponsFrame } from '../ui/hud-weapons';
import { edgeArrow, pickNearest, type EdgeArrow } from '../ui/hud-math';

const ndc = new Vector3();
const lead = new Vector3();
const nose = new Vector3();
const arrow: EdgeArrow = { x: 0, y: 0, deg: 0 };
const sel: HudPoint = { x: 0, y: 0 };
const leadScreen: HudPoint = { x: 0, y: 0 };
const noseScreen: HudPoint = { x: 0, y: 0 };

export class TargetProjector {
  /** markers[i] に対応する対象（タップで選ぶのに使う） */
  private readonly markerTargets: (CombatTarget | null)[];
  private markerCount = 0;
  private markers: readonly HudPoint[] = [];
  private behind = false;

  constructor(private readonly camera: PerspectiveCamera) {
    this.markerTargets = Array.from({ length: HUD_CONFIG.targets.maxMarkers }, () => null);
  }

  /**
   * w に画面座標を書く。aircraft は補間済みの機体の描画位置、fpm は進行方向マーカー（機首 1000m 先）の画面座標
   */
  fill(
    w: HudWeaponsFrame,
    combat: CombatSystem,
    aircraft: Object3D,
    fpm: Readonly<HudPoint> | null,
    alpha: number,
    width: number,
    height: number,
  ): void {
    this.camera.updateMatrixWorld();
    const targeting = combat.targeting;
    const selected = targeting.selected;
    let n = 0;
    for (const t of targeting.candidates) {
      if (n >= w.markers.length) break;
      if (t === selected) continue;
      const m = w.markers[n];
      if (!m || !this.projectTarget(t, alpha, width, height, m) || !onScreen()) continue;
      this.markerTargets[n] = t;
      n++;
    }
    for (let i = n; i < this.markerTargets.length; i++) this.markerTargets[i] = null;
    w.markerCount = this.markerCount = n;
    this.markers = w.markers;

    w.selected = 'none';
    w.leadShown = false;
    if (!selected) return;
    this.projectTarget(selected, alpha, width, height, sel);
    if (!this.behind && onScreen()) {
      w.selected = 'screen';
      w.selX = sel.x;
      w.selY = sel.y;
    } else {
      const c = HUD_CONFIG.targets;
      edgeArrow(arrow, ndc.x, ndc.y, this.behind, width, height, c.edgeMargin);
      w.selected = 'edge';
      w.selX = arrow.x;
      w.selY = arrow.y;
      w.arrowDeg = arrow.deg;
    }
    if (combat.leadValid && fpm)
      this.projectLead(w, combat, selected, aircraft, fpm, alpha, width, height);
  }

  /** ワールドの点を画面座標にして out に書く。画面内なら true（爆弾の着弾予測点。2-6） */
  projectPoint(p: Readonly<Vec3>, width: number, height: number, out: HudPoint): boolean {
    this.camera.updateMatrixWorld();
    lead.set(p.x, p.y, p.z);
    return this.toScreen(lead, width, height, out) && onScreen();
  }

  /** (x, y) の近くのマーカーの対象。なければ null */
  pick(x: number, y: number): CombatTarget | null {
    const i = pickNearest(this.markers, this.markerCount, x, y, HUD_CONFIG.targets.tapRadius);
    return i >= 0 ? (this.markerTargets[i] ?? null) : null;
  }

  /**
   * 予測照準点。対象の補間位置 + （照準点 − 対象の位置）を投影し、機首の照準点の距離と 1000m 先の
   * 見え方の差（カメラが機体の後ろ上にある視差）を足す。進行方向マーカーを○に重ねると機首が照準点を向く
   */
  private projectLead(
    w: HudWeaponsFrame,
    combat: CombatSystem,
    t: CombatTarget,
    aircraft: Object3D,
    fpm: Readonly<HudPoint>,
    alpha: number,
    width: number,
    height: number,
  ): void {
    const p = t.position;
    const q = t.prevPosition;
    lead.set(
      q.x + (p.x - q.x) * alpha + (combat.lead.x - p.x),
      q.y + (p.y - q.y) * alpha + (combat.lead.y - p.y),
      q.z + (p.z - q.z) * alpha + (combat.lead.z - p.z),
    );
    const dist = lead.distanceTo(aircraft.position);
    nose.set(0, 0, -dist).applyQuaternion(aircraft.quaternion).add(aircraft.position);
    if (!this.toScreen(nose, width, height, noseScreen)) return;
    if (!this.toScreen(lead, width, height, leadScreen)) return;
    w.leadX = leadScreen.x + fpm.x - noseScreen.x;
    w.leadY = leadScreen.y + fpm.y - noseScreen.y;
    w.leadShown = true;
  }

  /** 対象の補間位置を投影して out に画面座標を書く。カメラの後ろなら false */
  private projectTarget(
    t: CombatTarget,
    alpha: number,
    width: number,
    height: number,
    out: HudPoint,
  ): boolean {
    const p = t.position;
    const q = t.prevPosition;
    lead.set(q.x + (p.x - q.x) * alpha, q.y + (p.y - q.y) * alpha, q.z + (p.z - q.z) * alpha);
    return this.toScreen(lead, width, height, out);
  }

  /** 投影して out に画面座標を書く。カメラの後ろなら false（ndc と behind は常に更新） */
  private toScreen(world: Vector3, width: number, height: number, out: HudPoint): boolean {
    ndc.copy(world).applyMatrix4(this.camera.matrixWorldInverse);
    this.behind = ndc.z > 0;
    ndc.applyMatrix4(this.camera.projectionMatrix);
    out.x = (ndc.x * 0.5 + 0.5) * width;
    out.y = (-ndc.y * 0.5 + 0.5) * height;
    return !this.behind;
  }
}

function onScreen(): boolean {
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
}
