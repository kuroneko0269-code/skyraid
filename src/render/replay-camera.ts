// リプレイの再生中のカメラ（7-B）: 追従（今までの追従カメラ）/ 自由（フォトモードの軌道カメラを流用。ドラッグで回す）/
// 敵視点（選んだ敵機・爆撃機・怪獣の後ろから自機を見る）/ シネマ（自機の行く先に置いた固定カメラを数秒ごとに切り替える）
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { CombatTarget } from '../combat/target';
import {
  createOrbit,
  headingFrom,
  orbitPose,
  panOrbit,
  rotateOrbit,
  wheelZoomFactor,
  zoomOrbit,
  type Heading,
} from '../core/photo-orbit';
import { REPLAY_CONFIG } from '../data/replay';
import type { FlightSession } from '../missions/flight-session';
import type { CameraOverride } from './flight-frame';

export const REPLAY_CAMERAS = ['follow', 'free', 'enemy', 'cinema'] as const;
export type ReplayCameraMode = (typeof REPLAY_CAMERAS)[number];

export const REPLAY_CAMERA_LABELS: Readonly<Record<ReplayCameraMode, string>> = {
  follow: '追従',
  free: '自由',
  enemy: '敵視点',
  cinema: 'シネマ',
};

/** 敵視点で選べる相手（出ている敵機・爆撃機・巡航ミサイル・怪獣の最も高い部位） */
export function viewTargets(session: FlightSession, out: CombatTarget[] = []): CombatTarget[] {
  out.length = 0;
  for (const e of session.enemies) if (e.active) out.push(e);
  const props = session.props;
  for (const b of props.bombers) if (b.active) out.push(b);
  for (const c of props.cruiseMissiles) if (c.active) out.push(c);
  let top: CombatTarget | null = null;
  for (const p of props.kaiju.parts)
    if (p.active && (!top || p.position.y > top.position.y)) top = p;
  if (top) out.push(top);
  return out;
}

export class ReplayCameras implements CameraOverride {
  mode: ReplayCameraMode = 'follow';
  /** 自由カメラの軌道（フォトモードと同じ形。ui の操作が書き換える） */
  readonly orbit = createOrbit();
  private readonly heading: Heading = { x: 0, z: -1 };
  private readonly pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  private readonly forward = new Vector3();
  private readonly targets: CombatTarget[] = [];
  private targetIndex = 0;
  private readonly shot = new Vector3();
  private shotLeft = 0;
  private shotCount = 0;
  private readonly baseFov: number;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly aircraft: Object3D,
    private readonly session: FlightSession,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.baseFov = camera.fov;
  }

  setMode(mode: ReplayCameraMode): void {
    this.mode = mode;
    this.shotLeft = 0;
    this.setFov(mode === 'free' ? this.orbit.fov : this.baseFov);
  }

  /** 敵視点の相手を次へ（なければ何もしない）。今の相手の名前の代わりに「n / 全体」を返す */
  nextTarget(): string {
    const list = viewTargets(this.session, this.targets);
    if (list.length === 0) return '敵なし';
    this.targetIndex = (this.targetIndex + 1) % list.length;
    return `${String(this.targetIndex + 1)} / ${String(list.length)}`;
  }

  /** 自由カメラの操作（フォトモードと同じ。ui/photo/photo-gestures.ts から） */
  rotate(dx: number, dy: number): void {
    rotateOrbit(this.orbit, dx, dy);
  }

  pan(dx: number, dy: number, viewportHeight: number): void {
    panOrbit(this.orbit, dx, dy, viewportHeight, this.heading);
  }

  zoom(factor: number): void {
    zoomOrbit(this.orbit, factor);
  }

  wheel(deltaY: number): void {
    zoomOrbit(this.orbit, wheelZoomFactor(deltaY));
  }

  /** 見る（追従以外）。置いたら true */
  update(frameSeconds: number): boolean {
    switch (this.mode) {
      case 'free':
        return this.updateFree();
      case 'enemy':
        return this.updateEnemy();
      case 'cinema':
        return this.updateCinema(frameSeconds);
      default:
        return false;
    }
  }

  private updateFree(): boolean {
    const c = this.camera;
    this.forward.set(0, 0, -1).applyQuaternion(this.aircraft.quaternion);
    const h = headingFrom(this.forward, this.heading);
    const p = orbitPose(this.orbit, this.aircraft.position, h, this.groundAt, this.pose);
    c.position.set(p.position.x, p.position.y, p.position.z);
    c.up.set(0, 1, 0);
    c.lookAt(p.target.x, p.target.y, p.target.z);
    this.setFov(this.orbit.fov);
    return true;
  }

  private updateEnemy(): boolean {
    const list = viewTargets(this.session, this.targets);
    const t = list[this.targetIndex % Math.max(1, list.length)];
    if (!t) return false;
    const c = this.camera;
    const a = this.aircraft.position;
    const e = t.position;
    const dx = a.x - e.x;
    const dy = a.y - e.y;
    const dz = a.z - e.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const v = REPLAY_CONFIG.enemyView;
    // 相手の後ろ（自機と反対側）から、相手越しに自機を見る
    const back = v.back + t.hitRadius * 2;
    c.position.set(
      e.x - (dx / d) * back,
      e.y - (dy / d) * back + v.up + t.hitRadius,
      e.z - (dz / d) * back,
    );
    const floor = this.groundAt(c.position.x, c.position.z) + 5;
    if (c.position.y < floor) c.position.y = floor;
    c.up.set(0, 1, 0);
    c.lookAt(a.x, a.y, a.z);
    this.setFov(this.baseFov);
    return true;
  }

  private updateCinema(frameSeconds: number): boolean {
    const cfg = REPLAY_CONFIG.cinema;
    const a = this.aircraft.position;
    this.shotLeft -= frameSeconds;
    const far = this.shot.distanceTo(a) > cfg.distance * 3;
    if (this.shotLeft <= 0 || far) this.placeShot();
    const c = this.camera;
    c.position.copy(this.shot);
    c.up.set(0, 1, 0);
    c.lookAt(a.x, a.y, a.z);
    // 遠いほど望遠に
    const dist = this.shot.distanceTo(a);
    this.setFov(
      Math.max(18, Math.min(this.baseFov, (this.baseFov * cfg.distance) / Math.max(1, dist))),
    );
    return true;
  }

  /** 次の固定カメラ: 自機の leadSeconds 先の位置の横（左右・高低を順に変える） */
  private placeShot(): void {
    const cfg = REPLAY_CONFIG.cinema;
    const st = this.session.aircraft.state;
    const a = this.aircraft.position;
    this.forward.set(0, 0, -1).applyQuaternion(this.aircraft.quaternion);
    const f = this.forward;
    const lead = st.speed * cfg.leadSeconds;
    const n = this.shotCount++;
    const side = n % 2 === 0 ? 1 : -1;
    // 水平の右向き
    const len = Math.hypot(f.x, f.z) || 1;
    const rx = (-f.z / len) * side;
    const rz = (f.x / len) * side;
    const high = n % 3 === 0 ? 0.6 : n % 3 === 1 ? -0.15 : 0.25;
    const x = a.x + f.x * lead + rx * cfg.distance;
    const z = a.z + f.z * lead + rz * cfg.distance;
    const y = Math.max(this.groundAt(x, z) + cfg.minHeight, a.y + f.y * lead + high * cfg.distance);
    this.shot.set(x, y, z);
    this.shotLeft = cfg.shotSeconds;
  }

  private setFov(fov: number): void {
    const c = this.camera;
    if (Math.abs(c.fov - fov) < 1e-3) return;
    c.fov = fov;
    c.updateProjectionMatrix();
  }

  /** 再生を終えるとき: 画角を戻す */
  reset(): void {
    this.setMode('follow');
  }
}
