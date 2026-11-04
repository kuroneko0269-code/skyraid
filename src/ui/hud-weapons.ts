// HUD の索敵・ロック・予測照準・残弾（2-2）。DOM 要素は最初に作って使い回し、値が変わったときだけ書く
import './hud-weapons.css';
import { HUD_CONFIG } from '../data/hud';
import { el } from './hud-dom';
import { changed, formatDistance } from './hud-math';

export interface HudPoint {
  x: number;
  y: number;
}

/** HUD に渡す武装の 1 フレーム分の値（座標は px、左上原点） */
export interface HudWeaponsFrame {
  /** 索敵範囲の対象（選択中を除く）の画面上の位置。先頭 markerCount 個が有効 */
  readonly markers: HudPoint[];
  markerCount: number;
  /** 選択中の対象: none = なし / screen = 画面内（selX, selY）/ edge = 画面外（矢印を selX, selY に arrowDeg 向き） */
  selected: 'none' | 'screen' | 'edge';
  selX: number;
  selY: number;
  arrowDeg: number;
  /** 選択中の対象までの距離（m） */
  distance: number;
  /** ロックの進行（0〜1）とロック完了 */
  lockProgress: number;
  locked: boolean;
  /**
   * 機銃で狙う印（予測照準点）。leadShown が false なら隠す。9-5b: leadInRange が false なら射程外の印（破線）、
   * leadReady は機首が当たる範囲に入っている（撃てば当たる。白く強調）
   */
  leadShown: boolean;
  leadInRange: boolean;
  leadReady: boolean;
  /** 9-5b: 射程外で機銃を撃っている（GUN ボタン。HUD に OUT OF RANGE） */
  outOfRangeFire: boolean;
  leadX: number;
  leadY: number;
  missiles: number;
  flares: number;
  /** フレアのクールダウン中 */
  flareCooling: boolean;
}

export function createWeaponsFrame(): HudWeaponsFrame {
  return {
    markers: Array.from({ length: HUD_CONFIG.targets.maxMarkers }, () => ({ x: 0, y: 0 })),
    markerCount: 0,
    selected: 'none',
    selX: 0,
    selY: 0,
    arrowDeg: 0,
    distance: 0,
    lockProgress: 0,
    locked: false,
    leadShown: false,
    leadInRange: false,
    leadReady: false,
    outOfRangeFire: false,
    leadX: 0,
    leadY: 0,
    missiles: 0,
    flares: 0,
    flareCooling: false,
  };
}

interface Slot {
  readonly el: HTMLDivElement;
  shown: boolean;
  x: number;
  y: number;
  deg: number;
}

function slot(e: HTMLDivElement): Slot {
  e.hidden = true;
  return { el: e, shown: false, x: NaN, y: NaN, deg: NaN };
}

/** 位置（translate）・回転（度）と表示を、変わったときだけ書く */
function place(s: Slot, shown: boolean, x: number, y: number, deg = 0): void {
  if (shown !== s.shown) {
    s.shown = shown;
    s.el.hidden = !shown;
  }
  if (!shown) return;
  const eps = HUD_CONFIG.epsilon;
  if (changed(s.x, x, eps.px) || changed(s.y, y, eps.px) || changed(s.deg, deg, eps.angleDeg)) {
    s.x = x;
    s.y = y;
    s.deg = deg;
    const t = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    s.el.style.transform = deg === 0 ? t : `${t} rotate(${deg.toFixed(1)}deg)`;
  }
}

export class HudWeapons {
  private readonly markers: Slot[];
  private readonly selected: Slot;
  private readonly arrow: Slot;
  private readonly lead: Slot;
  private readonly ring: HTMLDivElement;
  /** 選択中の対象の距離（HUD 補助の接近 / 離脱の色。4-12） */
  readonly distText: HTMLDivElement;
  private readonly mslText: HTMLSpanElement;
  private readonly flrText: HTMLSpanElement;
  private readonly flrRow: HTMLDivElement;
  /** 残弾の列とミサイルの行（2-6 のロケット・爆弾の行・兵装の印は hud-ordnance.ts が足す） */
  readonly ammo: HTMLDivElement;
  readonly mslRow: HTMLDivElement;
  private last = {
    ring: NaN,
    leadFar: false,
    leadReady: false,
    rangeFire: false,
    locked: false,
    dist: '',
    msl: '',
    flr: '',
    flrCooling: false,
  };

  constructor(
    private readonly root: HTMLElement,
    gauges: HTMLElement,
  ) {
    const layer = el('div', 'hud-targets', root);
    this.markers = Array.from({ length: HUD_CONFIG.targets.maxMarkers }, () =>
      slot(el('div', 'hud-tgt', layer)),
    );
    const sel = el('div', 'hud-sel', layer);
    el('div', 'hud-sel-diamond', sel);
    el('div', 'hud-sel-frame', sel);
    this.ring = el('div', 'hud-lock-ring', sel);
    el('div', 'hud-lock-label', sel, 'LOCK');
    this.distText = el('div', 'hud-sel-dist', sel);
    this.selected = slot(sel);
    this.arrow = slot(el('div', 'hud-arrow', layer));
    this.lead = slot(el('div', 'hud-lead', layer));
    // 9-5b: 射程外で撃っている（機首の下。hud.ts が機首の位置に合わせて動かす）
    el('div', 'hud-warn hud-range-warn', root, 'OUT OF RANGE');

    const ammo = el('div', 'hud-ammo', gauges);
    this.ammo = ammo;
    this.mslRow = el('div', 'hud-ammo-row', ammo);
    el('span', 'hud-ammo-label', this.mslRow, 'MSL');
    this.mslText = el('span', 'hud-ammo-value', this.mslRow);
    this.flrRow = el('div', 'hud-ammo-row', ammo);
    el('span', 'hud-ammo-label', this.flrRow, 'FLR');
    this.flrText = el('span', 'hud-ammo-value', this.flrRow);
  }

  update(f: Readonly<HudWeaponsFrame>): void {
    const last = this.last;
    for (let i = 0; i < this.markers.length; i++) {
      const s = this.markers[i];
      const p = f.markers[i];
      if (s && p) place(s, i < f.markerCount, p.x, p.y);
    }

    place(this.selected, f.selected === 'screen', f.selX, f.selY);
    if (f.selected === 'screen') {
      const locking = !f.locked && f.lockProgress > 0;
      const scale = locking
        ? 1 + (HUD_CONFIG.targets.lockRingStartScale - 1) * (1 - f.lockProgress)
        : 0;
      if (changed(last.ring, scale, 0.01)) {
        last.ring = scale;
        this.ring.hidden = scale === 0;
        this.ring.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      }
      if (f.locked !== last.locked) {
        last.locked = f.locked;
        this.selected.el.classList.toggle('is-locked', f.locked);
      }
      const dist = formatDistance(f.distance);
      if (dist !== last.dist) this.distText.textContent = last.dist = dist;
    }

    place(this.arrow, f.selected === 'edge', f.selX, f.selY, f.arrowDeg);

    place(this.lead, f.leadShown, f.leadX, f.leadY);
    const far = f.leadShown && !f.leadInRange;
    if (far !== last.leadFar) {
      last.leadFar = far;
      this.lead.el.classList.toggle('is-far', far);
    }
    const ready = f.leadShown && f.leadInRange && f.leadReady;
    if (ready !== last.leadReady) {
      last.leadReady = ready;
      this.lead.el.classList.toggle('is-ready', ready);
    }
    if (f.outOfRangeFire !== last.rangeFire) {
      last.rangeFire = f.outOfRangeFire;
      this.root.classList.toggle('is-out-of-range', f.outOfRangeFire);
    }

    const msl = String(f.missiles);
    if (msl !== last.msl) {
      this.mslText.textContent = last.msl = msl;
      this.mslRow.classList.toggle('is-empty', f.missiles === 0);
    }
    const flr = String(f.flares);
    if (flr !== last.flr) {
      this.flrText.textContent = last.flr = flr;
      this.flrRow.classList.toggle('is-empty', f.flares === 0);
    }
    if (f.flareCooling !== last.flrCooling) {
      last.flrCooling = f.flareCooling;
      this.flrRow.classList.toggle('is-cooling', f.flareCooling);
    }
  }

  /** 再表示したときに全部書き直す */
  invalidate(): void {
    const all = [...this.markers, this.selected, this.arrow, this.lead];
    for (const s of all) s.x = s.y = s.deg = NaN;
    const last = this.last;
    last.ring = NaN;
    last.dist = last.msl = last.flr = '';
    last.leadFar = last.leadReady = last.rangeFire = false;
    this.lead.el.classList.remove('is-far', 'is-ready');
    this.root.classList.remove('is-out-of-range');
  }
}
