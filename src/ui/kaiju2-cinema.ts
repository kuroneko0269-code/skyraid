// 10-7a: ネフィルガの演出（カメラと見た目だけ。判定・時間・リプレイの結果は変えない。時間を遅くするものは入れない）:
// 登場のとき短い場面（3.6 秒。カメラが遠くから寄って下から見上げる。画面のどこかをタップ / キーで飛ばせる）、
// 段階が変わるときの画面の揺れ、撃破のときの揺れと、雨の空なら晴れ間へ（天候は見た目と HUD の目印の距離だけ。倒した後）
import type { PerspectiveCamera } from 'three';
import { KAIJU2_VISUAL } from '../data/kaiju2-visual';
import { k2t } from '../data/kaiju2-text';
import { FINALE_WEATHER } from '../data/weather';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import type { CameraOverride, FlightFrame } from '../render/flight-frame';
import { el } from './hud-dom';

const C = KAIJU2_VISUAL.cinema;

export interface Kaiju2CinemaParts {
  readonly parent: HTMLElement;
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly shake: (strength: number) => void;
  readonly roar: () => void;
  readonly setWeather: (id: string) => void;
  /** 今の天候の雨（0〜1） */
  readonly rain: () => number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

export class Kaiju2Cinema {
  private readonly root: HTMLDivElement;
  private raid: Kaiju2Raid | null = null;
  private time = -1;
  private roared = false;
  private elapsed = Infinity;
  private phase = 1;
  private dead = false;
  private fov = 0;
  private readonly override: CameraOverride = {
    update: () => this.place(),
  };

  constructor(private readonly p: Kaiju2CinemaParts) {
    this.root = el('div', 'kaiju2-cinema', p.parent);
    const name = el('div', 'kaiju2-cinema-name', this.root);
    el('div', 'kaiju2-cinema-main', name).textContent = k2t('cinema.name');
    el('div', 'kaiju2-cinema-sub', name).textContent = k2t('cinema.sub');
    el('div', 'kaiju2-cinema-skip', this.root).textContent = k2t('cinema.skip');
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

  /**
   * 描画フレームごと。raid はソロのレイドを飛んでいるとき（それ以外は null）。flying は飛行中（ポーズ・結果では止める）。
   * campaign の天候の移り変わりは kaiju2-finale.ts
   */
  update(raid: Kaiju2Raid | null, flying: boolean, dt: number): void {
    if (!raid) {
      this.elapsed = Infinity;
      this.end();
      return;
    }
    const k = raid.body;
    // 新しく始まった（やり直し・再生のシークで戻った）
    if (raid.elapsed < this.elapsed) {
      this.phase = k.phase;
      this.dead = raid.dead;
      if (raid.elapsed < 1 && flying) this.start(raid);
    }
    this.elapsed = raid.elapsed;
    if (k.phase > this.phase && !raid.dead) this.p.shake(C.phaseShake);
    this.phase = k.phase;
    if (raid.dead && !this.dead) {
      this.p.shake(C.defeatShake);
      if (!raid.campaign && this.p.rain() > 0.3) this.p.setWeather(FINALE_WEATHER.cleared);
    }
    this.dead = raid.dead;
    if (!this.active) return;
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

  private start(raid: Kaiju2Raid): void {
    // ほかのカメラ（リプレイの自由・シネマ）を使っているときは出さない
    if (this.p.frame.cameraOverride && this.p.frame.cameraOverride !== this.override) return;
    this.raid = raid;
    this.time = 0;
    this.roared = false;
    this.fov = this.p.camera.fov;
    this.p.frame.cameraOverride = this.override;
    this.root.hidden = false;
    // 場面の間は飛行の HUD・タッチの操作を隠す（kaiju2-dev.css）
    document.documentElement.dataset.kaijuCinema = '';
  }

  private end(): void {
    if (this.time < 0) return;
    this.time = -1;
    this.raid = null;
    this.root.hidden = true;
    delete document.documentElement.dataset.kaijuCinema;
    if (this.p.frame.cameraOverride === this.override) {
      this.p.frame.cameraOverride = null;
      this.p.camera.fov = this.fov;
      this.p.camera.updateProjectionMatrix();
    }
  }

  /** カメラを置く（遠くの斜め前 → 下から見上げる位置へ寄る。頭のあたりを見る） */
  private place(): boolean {
    const raid = this.raid;
    if (!raid || this.time < 0) return false;
    const k = raid.body;
    const len = Math.hypot(k.forward.x, k.forward.z) || 1;
    const fx = k.forward.x / len;
    const fz = k.forward.z / len;
    const t = smooth(Math.min(1, this.time / (C.seconds * 0.8)));
    const o = {
      forward: C.from.forward + (C.to.forward - C.from.forward) * t,
      right: C.from.right + (C.to.right - C.from.right) * t,
      up: C.from.up + (C.to.up - C.from.up) * t,
    };
    const cam = this.p.camera;
    cam.position.set(
      k.position.x + fx * o.forward - fz * o.right,
      k.position.y + o.up,
      k.position.z + fz * o.forward + fx * o.right,
    );
    cam.up.set(0, 1, 0);
    cam.fov = 40 + 15 * t;
    cam.updateProjectionMatrix();
    cam.lookAt(k.position.x - fx * 20, k.position.y + 10, k.position.z - fz * 20);
    return true;
  }
}
