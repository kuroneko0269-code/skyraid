import './hud.css';
import { HUD_CONFIG } from '../data/hud';
import { TOUCH_CONFIG } from '../data/touch';
import type { Quat } from '../flight/math';
import {
  attitudeFromQuat,
  changed,
  formatAltitude,
  formatSpeed,
  isGroundWarning,
  isStallWarning,
  ladderRungs,
  ladderTransform,
  radarPoint,
  type Attitude,
  type LadderTransform,
  type RadarPoint,
} from './hud-math';

/** HUD に渡す 1 フレーム分の値 */
export interface HudFrame {
  /** 速度（m/s 相当） */
  speed: number;
  /** スロットル位置（0〜1） */
  throttle: number;
  afterburnerGauge: number;
  afterburnerActive: boolean;
  afterburnerLocked: boolean;
  /** 位置（m）。y は海面基準の高度 */
  x: number;
  y: number;
  z: number;
  /** 地表（海の上は海面）からの高さ（m） */
  altitudeAboveGround: number;
  /** 失速の度合い（0〜1） */
  stall: number;
  orientation: Readonly<Quat>;
  /** 進行方向マーカーの画面座標（px、左上原点）。null なら隠す（カメラの後ろ） */
  flightPath: { x: number; y: number } | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** 縦のゲージ（スロットル・アフターバーナー）。fill を scaleY で伸縮する */
function gauge(parent: HTMLElement, label: string): HTMLDivElement {
  const wrap = el('div', 'hud-gauge', parent);
  const track = el('div', 'hud-gauge-track', wrap);
  const fill = el('div', 'hud-gauge-fill', track);
  el('div', 'hud-gauge-label', wrap, label);
  return fill;
}

/** 数値パラメータを CSS 変数で渡す */
function applyCssVariables(root: HTMLElement): void {
  const l = HUD_CONFIG.ladder;
  const r = HUD_CONFIG.radar;
  const vars: Record<string, number> = {
    '--hud-ppd-normal': l.pxPerDeg,
    '--hud-ppd-compact': l.compactPxPerDeg,
    '--hud-ladder-w-normal': l.width,
    '--hud-ladder-h-normal': l.height,
    '--hud-ladder-w-compact': l.compactWidth,
    '--hud-ladder-h-compact': l.compactHeight,
    '--hud-rung-w-normal': l.rungWidth,
    '--hud-rung-w-compact': l.compactRungWidth,
    '--hud-horizon-w-normal': l.horizonWidth,
    '--hud-horizon-w-compact': l.compactHorizonWidth,
    '--hud-radar-normal': r.size,
    '--hud-radar-compact': r.compactSize,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, String(value));
  root.style.setProperty('--hud-touch-shift', `${touchGapShift()}px`);
}

/**
 * タッチ操作中にレーダーを置く横位置のずれ（画面中央から、px）。
 * 左下のスティック（待機位置）の右端と、右下のボタン群・スロットルの左端の間の中央に置く
 */
function touchGapShift(): number {
  const t = TOUCH_CONFIG;
  // + 16 は touch-controls.css の .tc-stick-base の left と同じ余白
  const stickRight = t.edgeMargin + t.stick.radius * 2 + 16;
  const buttonsWidth =
    t.edgeMargin +
    t.throttle.width +
    t.buttons.sliderGap +
    t.buttons.size +
    t.buttons.gap +
    t.buttons.fireSize;
  return (stickRight - buttonsWidth) / 2;
}

/**
 * 戦闘機風の HUD（DOM + CSS）。update() は毎フレーム呼んでよいが、
 * DOM は表示が変わったときだけ書き換える（テキストは文字列、位置・角度は epsilon 以上の変化）
 */
export class Hud {
  readonly root: HTMLDivElement;
  private shown = true;
  private compact = false;
  private readonly ladder: HTMLDivElement;
  private readonly fpm: HTMLDivElement;
  private readonly speedText: HTMLSpanElement;
  private readonly altText: HTMLSpanElement;
  private readonly throttleFill: HTMLDivElement;
  private readonly abFill: HTMLDivElement;
  private readonly island: HTMLDivElement;

  private readonly attitude: Attitude = { pitch: 0, roll: 0, heading: 0 };
  private readonly ladderXf: LadderTransform = { rotateDeg: 0, offsetPx: 0 };
  private readonly radar: RadarPoint = { x: 0, y: 0, clamped: false };
  // 前回書いた値。NaN / '' は「未表示」で、次の update() で必ず書く
  private last = {
    speed: '',
    alt: '',
    throttle: NaN,
    ab: NaN,
    abState: '',
    ground: false,
    stall: false,
    pitch: NaN,
    roll: NaN,
    fpmX: NaN,
    fpmY: NaN,
    fpmShown: true,
    radarX: NaN,
    radarY: NaN,
    radarEdge: false,
  };

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    applyCssVariables(root);
    this.root = root;

    // 中央: ピッチラダー（楕円の窓で切り抜き、中身を回す）と進行方向マーカー
    const window_ = el('div', 'hud-ladder-window', root);
    this.ladder = el('div', 'hud-ladder', window_);
    for (const deg of ladderRungs(HUD_CONFIG.ladder.stepDeg)) {
      const kind = deg === 0 ? 'is-horizon' : deg > 0 ? 'is-up' : 'is-down';
      const rung = el('div', `hud-rung ${kind}`, this.ladder);
      rung.style.setProperty('--deg', String(deg));
      const label = deg === 0 ? '' : String(Math.abs(deg));
      el('span', 'hud-rung-label', rung, label);
      el('span', 'hud-rung-line hud-rung-left', rung);
      el('span', 'hud-rung-gap', rung);
      el('span', 'hud-rung-line hud-rung-right', rung);
      el('span', 'hud-rung-label', rung, label);
    }
    this.fpm = el('div', 'hud-fpm', root);
    el('div', 'hud-warn hud-stall', root, 'STALL');

    // 左: スロットル・AB ゲージと速度
    const left = el('div', 'hud-side hud-left', root);
    const gauges = el('div', 'hud-gauges', left);
    this.throttleFill = gauge(gauges, 'THR');
    this.abFill = gauge(gauges, 'AB');
    const speedBox = el('div', 'hud-box', left);
    el('div', 'hud-box-label', speedBox, 'SPD');
    this.speedText = el('span', 'hud-box-value', speedBox);
    el('div', 'hud-box-unit', speedBox, 'm/s');

    // 右: 高度（海面基準）と地面接近警告
    const right = el('div', 'hud-side hud-right', root);
    const altBox = el('div', 'hud-box', right);
    el('div', 'hud-box-label', altBox, 'ALT');
    this.altText = el('span', 'hud-box-value', altBox);
    el('div', 'hud-box-unit', altBox, 'm');
    el('div', 'hud-warn hud-ground', right, 'PULL UP');

    // 下: レーダー（機首方向が上）。今は自機と島の中心だけ
    const radar = el('div', 'hud-radar', root);
    el('div', 'hud-radar-ring', radar);
    el('div', 'hud-radar-self', radar);
    this.island = el('div', 'hud-radar-island', radar);

    parent.appendChild(root);

    const l = HUD_CONFIG;
    const query =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(
            `(max-width: ${l.compactMaxWidth}px), (max-height: ${l.compactMaxHeight}px)`,
          )
        : null;
    const refreshCompact = (): void => {
      this.compact = query?.matches ?? false;
      root.classList.toggle('hud-compact', this.compact);
      // 1 度あたりの px が変わるので、ラダーを書き直す
      this.last.pitch = NaN;
    };
    refreshCompact();
    query?.addEventListener('change', refreshCompact);
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.root.hidden = !visible;
    // 隠している間は書き換えないので、再表示したら全部書き直す
    if (visible) this.invalidate();
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  update(f: Readonly<HudFrame>): void {
    if (!this.shown) return;
    const last = this.last;
    const eps = HUD_CONFIG.epsilon;

    const speed = formatSpeed(f.speed);
    if (speed !== last.speed) this.speedText.textContent = last.speed = speed;
    const alt = formatAltitude(f.y);
    if (alt !== last.alt) this.altText.textContent = last.alt = alt;

    if (changed(last.throttle, f.throttle, eps.gauge)) {
      last.throttle = f.throttle;
      this.throttleFill.style.transform = `scaleY(${f.throttle.toFixed(3)})`;
    }
    if (changed(last.ab, f.afterburnerGauge, eps.gauge)) {
      last.ab = f.afterburnerGauge;
      this.abFill.style.transform = `scaleY(${f.afterburnerGauge.toFixed(3)})`;
    }
    const abState = f.afterburnerLocked ? 'is-locked' : f.afterburnerActive ? 'is-active' : '';
    if (abState !== last.abState) {
      this.abFill.classList.remove('is-locked', 'is-active');
      if (abState) this.abFill.classList.add(abState);
      last.abState = abState;
    }

    const ground = isGroundWarning(f.altitudeAboveGround, HUD_CONFIG.groundWarningAgl);
    if (ground !== last.ground) {
      last.ground = ground;
      this.root.classList.toggle('is-ground-warning', ground);
    }
    const stall = isStallWarning(f.stall, HUD_CONFIG.stallThreshold);
    if (stall !== last.stall) {
      last.stall = stall;
      this.root.classList.toggle('is-stall', stall);
    }

    const att = attitudeFromQuat(this.attitude, f.orientation);
    if (
      changed(last.pitch, att.pitch, eps.angleDeg) ||
      changed(last.roll, att.roll, eps.angleDeg)
    ) {
      last.pitch = att.pitch;
      last.roll = att.roll;
      const ppd = this.compact ? HUD_CONFIG.ladder.compactPxPerDeg : HUD_CONFIG.ladder.pxPerDeg;
      const xf = ladderTransform(this.ladderXf, att.pitch, att.roll, ppd);
      this.ladder.style.transform = `rotate(${xf.rotateDeg.toFixed(2)}deg) translateY(${xf.offsetPx.toFixed(1)}px)`;
    }

    this.updateFlightPath(f.flightPath);

    const c = HUD_CONFIG.radar.islandCenter;
    const p = radarPoint(this.radar, f.x, f.z, att.heading, c.x, c.z, HUD_CONFIG.radar.rangeM);
    if (changed(last.radarX, p.x, eps.radar) || changed(last.radarY, p.y, eps.radar)) {
      last.radarX = p.x;
      last.radarY = p.y;
      this.island.style.transform = `translate(calc(${p.x.toFixed(3)} * var(--hud-radar-r)), calc(${p.y.toFixed(3)} * var(--hud-radar-r)))`;
    }
    if (p.clamped !== last.radarEdge) {
      last.radarEdge = p.clamped;
      this.island.classList.toggle('is-edge', p.clamped);
    }
  }

  private updateFlightPath(pos: { x: number; y: number } | null): void {
    const last = this.last;
    const shown = pos !== null;
    if (shown !== last.fpmShown) {
      last.fpmShown = shown;
      this.fpm.hidden = !shown;
    }
    if (!pos) return;
    const eps = HUD_CONFIG.epsilon.px;
    if (changed(last.fpmX, pos.x, eps) || changed(last.fpmY, pos.y, eps)) {
      last.fpmX = pos.x;
      last.fpmY = pos.y;
      this.fpm.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
    }
  }

  private invalidate(): void {
    const last = this.last;
    last.speed = last.alt = '';
    last.throttle = last.ab = last.pitch = last.roll = NaN;
    last.fpmX = last.fpmY = last.radarX = last.radarY = NaN;
  }
}
