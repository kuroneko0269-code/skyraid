// 10-7b: 怪獣の演出の共通の部品（10-7a のネフィルガの kaiju2-cinema.ts から共通にした。カメラと見た目だけ。判定・時間・
// リプレイの結果は変えない。時間を遅くするものは入れない）: 登場のとき短い場面（カメラが遠くから寄って見上げる。画面のどこかを
// タップ / キーで飛ばせる）・段階が変わるときの画面の揺れ・撃破のときの揺れ。怪獣ごとの足し（雨の空の晴れ間・雲の幕など）は
// 呼ぶ側が hooks で
import './kaiju-cinema.css';
import type { PerspectiveCamera } from 'three';
import type { KaijuCinemaSpec, KaijuOffset } from '../data/kaiju-look';
import type { CameraOverride, FlightFrame } from '../render/flight-frame';
import { el } from './hud-dom';

/** 演出が読む怪獣のレイドの値（ソロのレイドを飛んでいるとき） */
export interface KaijuCinemaSubject {
  /** レイドの経過（小さくなったら新しいレイド） */
  readonly elapsed: number;
  readonly phase: number;
  readonly dead: boolean;
  /** 体の中心と水平の前（長さは問わない） */
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly forward: Readonly<{ x: number; z: number }>;
}

export interface KaijuCinemaParts {
  readonly parent: HTMLElement;
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly shake: (strength: number) => void;
  /** 咆哮（音） */
  readonly roar: () => void;
  /** 名前・副題・飛ばす案内と、色を変える組（kaiju-cinema.css の is-<name>） */
  readonly name: string;
  readonly sub: string;
  readonly skip: string;
  readonly theme: string;
}

export interface KaijuCinemaHooks {
  /** 場面の始め・終わり（飛ばしたときも） */
  readonly onStart?: () => void;
  readonly onEnd?: () => void;
  /** 撃破の瞬間（揺れの後） */
  readonly onDefeat?: () => void;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (
  a: KaijuOffset,
  b: KaijuOffset,
  t: number,
  out: { forward: number; right: number; up: number },
) => {
  out.forward = a.forward + (b.forward - a.forward) * t;
  out.right = a.right + (b.right - a.right) * t;
  out.up = a.up + (b.up - a.up) * t;
  return out;
};

export class KaijuCinema {
  private readonly root: HTMLDivElement;
  private subject: KaijuCinemaSubject | null = null;
  private time = -1;
  private roared = false;
  private elapsed = Infinity;
  private phase = 1;
  private dead = false;
  private fov = 0;
  private readonly o = { forward: 0, right: 0, up: 0 };
  private readonly l = { forward: 0, right: 0, up: 0 };
  private readonly override: CameraOverride = {
    update: () => this.place(),
  };

  constructor(
    private readonly p: KaijuCinemaParts,
    private readonly C: KaijuCinemaSpec,
    private readonly hooks: KaijuCinemaHooks = {},
  ) {
    this.root = el('div', `kaiju-cinema is-${p.theme}`, p.parent);
    const name = el('div', 'kaiju-cinema-name', this.root);
    el('div', 'kaiju-cinema-main', name).textContent = p.name;
    el('div', 'kaiju-cinema-sub', name).textContent = p.sub;
    el('div', 'kaiju-cinema-skip', this.root).textContent = p.skip;
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.end();
    });
    window.addEventListener('keydown', () => {
      if (this.active) this.end();
    });
  }

  /** 登場の場面を出している */
  get active(): boolean {
    return this.time >= 0;
  }

  /** 場面の進み（0〜1。出していなければ 1） */
  get progress(): number {
    return this.time < 0 ? 1 : Math.min(1, this.time / this.C.seconds);
  }

  /**
   * 描画フレームごと。subject はソロのレイドを飛んでいるとき（それ以外は null）。flying は飛行中（ポーズ・結果では止める）
   */
  update(subject: KaijuCinemaSubject | null, flying: boolean, dt: number): void {
    if (!subject) {
      this.elapsed = Infinity;
      this.end();
      return;
    }
    const C = this.C;
    // 新しく始まった（やり直し・再生のシークで戻った）
    if (subject.elapsed < this.elapsed) {
      this.phase = subject.phase;
      this.dead = subject.dead;
      if (subject.elapsed < 1 && flying) this.start(subject);
    }
    this.elapsed = subject.elapsed;
    if (subject.phase > this.phase && !subject.dead) this.p.shake(C.phaseShake);
    this.phase = subject.phase;
    if (subject.dead && !this.dead) {
      this.p.shake(C.defeatShake);
      this.hooks.onDefeat?.();
    }
    this.dead = subject.dead;
    if (!this.active) return;
    this.subject = subject;
    this.root.hidden = !flying;
    if (!flying) return;
    this.time += dt;
    if (!this.roared && this.time >= C.roarAt) {
      this.roared = true;
      this.p.roar();
      this.p.shake(0.8);
    }
    if (this.time >= C.seconds) this.end();
  }

  private start(subject: KaijuCinemaSubject): void {
    // ほかのカメラ（リプレイの自由・シネマ）を使っているときは出さない
    if (this.p.frame.cameraOverride && this.p.frame.cameraOverride !== this.override) return;
    this.subject = subject;
    this.time = 0;
    this.roared = false;
    this.fov = this.p.camera.fov;
    this.p.frame.cameraOverride = this.override;
    this.root.hidden = false;
    // 場面の間は飛行の HUD・タッチの操作を隠す（kaiju-cinema.css）
    document.documentElement.dataset.kaijuCinema = '';
    this.hooks.onStart?.();
  }

  private end(): void {
    if (this.time < 0) return;
    this.time = -1;
    this.subject = null;
    this.root.hidden = true;
    delete document.documentElement.dataset.kaijuCinema;
    if (this.p.frame.cameraOverride === this.override) {
      this.p.frame.cameraOverride = null;
      this.p.camera.fov = this.fov;
      this.p.camera.updateProjectionMatrix();
    }
    this.hooks.onEnd?.();
  }

  /** カメラを置く（遠くから寄る。見る所も寄せる） */
  private place(): boolean {
    const k = this.subject;
    if (!k || this.time < 0) return false;
    const C = this.C;
    const len = Math.hypot(k.forward.x, k.forward.z) || 1;
    const fx = k.forward.x / len;
    const fz = k.forward.z / len;
    const t = smooth(Math.min(1, this.time / (C.seconds * C.moveShare)));
    const o = lerp(C.from, C.to, t, this.o);
    const l = lerp(C.lookFrom, C.lookTo, t, this.l);
    const cam = this.p.camera;
    cam.position.set(
      k.position.x + fx * o.forward - fz * o.right,
      k.position.y + o.up,
      k.position.z + fz * o.forward + fx * o.right,
    );
    cam.up.set(0, 1, 0);
    cam.fov = C.fovFrom + (C.fovTo - C.fovFrom) * t;
    cam.updateProjectionMatrix();
    cam.lookAt(
      k.position.x + fx * l.forward - fz * l.right,
      k.position.y + l.up,
      k.position.z + fz * l.forward + fx * l.right,
    );
    return true;
  }
}
