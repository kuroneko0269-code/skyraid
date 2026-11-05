// 9-8 リングレースの道案内の配線（描画側）: 次とその次のリングを画面に投影して番号の札の位置を出し、
// 印（上へ・下へ・宙返り・引き起こし）と通り損ね（missions/race/guide.ts）を HUD（ui/race-guide-hud.ts）に渡す。
// 道筋の点線（race-guide-view.ts）とコースの下見のカメラ（missions/race/preview.ts）もここで動かす。判定には触らない
import { Vector3, type PerspectiveCamera } from 'three';
import type { Vec3 } from '../flight/math';
import { missedRing, ringCues, type RingCue } from '../missions/race/guide';
import { CoursePreview } from '../missions/race/preview';
import type { RaceRunner } from '../missions/race/runner';
import { createRaceGuideFrame, type RaceGuideHud } from '../ui/race-guide-hud';
import type { RaceGuideView } from './race-guide-view';

const p = new Vector3();
const eye: Vec3 = { x: 0, y: 0, z: 0 };
const look: Vec3 = { x: 0, y: 0, z: 0 };

/** 札をリングの中心から上（次）・下（その次）へずらす（px。次のリングの菱形・距離と重ねない） */
const BADGE_OFFSET = 26;

export interface RaceGuideParts {
  readonly camera: PerspectiveCamera;
  readonly hud: RaceGuideHud;
  readonly view: RaceGuideView;
  /** 自機の位置・速度（通り損ねの判定） */
  readonly player: () => { readonly position: Readonly<Vec3>; readonly velocity: Readonly<Vec3> };
  readonly groundHeight: (x: number, z: number) => number;
}

export class RaceGuideLink {
  /** 次のリングを通り損ねている（ミッションの HUD の印を赤く） */
  missed = false;
  private readonly frame = createRaceGuideFrame();
  private race: RaceRunner | null = null;
  private cues: (RingCue | null)[] = [];
  private missedFor = -1;
  private preview: CoursePreview | null = null;

  constructor(private readonly p: RaceGuideParts) {}

  /** 下見の途中か（固定ステップを止める） */
  get previewing(): boolean {
    return this.preview !== null;
  }

  /** 下見の進み（0〜1。下見していなければ null） */
  get previewProgress(): number | null {
    const pv = this.preview;
    return pv ? pv.time / pv.duration : null;
  }

  /** レースを付け替える（null で隠す） */
  attach(race: RaceRunner | null): void {
    this.race = race;
    this.cues = race ? ringCues(race.course, race.rings) : [];
    this.missed = false;
    this.missedFor = -1;
    this.preview = null;
    this.p.hud.hide();
    if (!race) this.p.view.update(null);
  }

  /** スタート前の下見を始める */
  startPreview(): void {
    const race = this.race;
    if (race) this.preview = new CoursePreview(race.course, race.rings);
  }

  /** 下見を終える（飛ばす・見終えた） */
  endPreview(): void {
    this.preview = null;
  }

  /** 下見のカメラ（flight-frame の追従カメラの代わり）。置いたら true */
  updatePreviewCamera(frameSeconds: number): boolean {
    const pv = this.preview;
    if (!pv) return false;
    pv.advance(frameSeconds);
    pv.pose(eye, look);
    // 地面・海面にめり込まないように
    eye.y = Math.max(eye.y, this.p.groundHeight(eye.x, eye.z) + 25);
    const cam = this.p.camera;
    cam.position.set(eye.x, eye.y, eye.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(look.x, look.y, look.z);
    return true;
  }

  /** 下見を見終えた（最後のフレームまで進んだ） */
  get previewDone(): boolean {
    return this.preview?.done ?? false;
  }

  /** 描画フレームごと（飛行中・カメラを置いた後）。hudShown は H キー / 設定の HUD */
  update(width: number, height: number, hudShown: boolean, guideLine: boolean): void {
    const race = this.race;
    const live = race !== null && race.phase !== 'finished';
    const view = this.p.view;
    view.enabled = guideLine;
    view.update(live ? race : null);
    if (!live || !hudShown) {
      this.missed = false;
      this.p.hud.hide();
      return;
    }
    const f = this.frame;
    const next = race.next;
    for (let k = 0; k < 2; k++) {
      const b = f.badges[k];
      const ring = race.rings[next + k];
      if (!b) continue;
      // 次の札はリングの上、その次の札はリングの下（2 つのリングが一直線に並んでも重ならない）
      b.shown =
        ring !== undefined && this.project(ring.position, width, height, b, k === 0 ? -1 : 1);
      if (ring) {
        b.number = ring.index + 1;
        b.kind = ring.kind;
        b.cue = this.cues[ring.index] ?? null;
      }
    }
    const c0 = this.cues[next] ?? null;
    const c1 = this.cues[next + 1] ?? null;
    f.cue = c0 ? { which: 'next', cue: c0 } : c1 ? { which: 'after', cue: c1 } : null;
    // 通り損ね（走行中だけ。次のリングが変わったら数え直す）
    const ring = race.rings[next];
    if (next !== this.missedFor) {
      this.missedFor = next;
      this.missed = false;
    }
    if (race.phase === 'racing' && ring) {
      const pl = this.p.player();
      this.missed = missedRing(ring, pl.position, pl.velocity, this.missed);
    } else this.missed = false;
    f.missed = this.missed && ring ? { number: ring.index + 1, required: ring.required } : null;
    if (this.preview) f.missed = null;
    this.p.hud.update(f);
  }

  /** 画面内なら out に札の位置を書いて true */
  private project(
    pos: Readonly<Vec3>,
    width: number,
    height: number,
    out: { x: number; y: number },
    side: number,
  ): boolean {
    p.set(pos.x, pos.y, pos.z);
    const cam = this.p.camera;
    cam.updateMatrixWorld();
    p.applyMatrix4(cam.matrixWorldInverse);
    if (p.z > 0) return false;
    p.applyMatrix4(cam.projectionMatrix);
    if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return false;
    out.x = (p.x * 0.5 + 0.5) * width;
    out.y = (-p.y * 0.5 + 0.5) * height + side * BADGE_OFFSET;
    return true;
  }
}
