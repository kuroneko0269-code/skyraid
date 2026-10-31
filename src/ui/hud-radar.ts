// HUD のレーダー（1-4 / 2-3）。機首方向が上。島の中心・敵機（赤い点）・自機を追うミサイル（赤い ×）を出す。
// HUD 補助（4-12）が ON なら、敵機の高度差を点の上下の小さな三角で、後方の敵機を点滅で出す。
// DOM の点は最初に作って使い回し、位置が変わったときだけ書く
import { HUD_CONFIG } from '../data/hud';
import { el } from './hud-dom';
import { changed, radarPoint, type RadarPoint } from './hud-math';

/** ally: PvP のチーム戦の味方（5-4。シアンの点） */
export type RadarContactKind = 'enemy' | 'ally' | 'missile';

/** 高度差の印（4-12）: above = 自機より高い / below = 低い / '' = なし */
export type RadarAltitude = '' | 'above' | 'below';

export interface RadarContact {
  x: number;
  z: number;
  kind: RadarContactKind;
  altitude: RadarAltitude;
  /** 自機の後方（BEHIND）にいる敵機（4-12） */
  behind: boolean;
}

/** レーダーに出す対象（ワールドの x, z）。先頭 count 個が有効 */
export interface HudRadarFrame {
  readonly contacts: RadarContact[];
  count: number;
  /** HUD 補助（4-12）。false なら高度差・後方の印を出さない */
  assist: boolean;
}

export function createRadarFrame(): HudRadarFrame {
  return {
    contacts: Array.from({ length: HUD_CONFIG.radar.maxContacts }, () => ({
      x: 0,
      z: 0,
      kind: 'enemy',
      altitude: '',
      behind: false,
    })),
    count: 0,
    assist: false,
  };
}

interface Dot {
  readonly el: HTMLDivElement;
  shown: boolean;
  kind: RadarContactKind | '';
  edge: boolean;
  altitude: RadarAltitude;
  behind: boolean;
  x: number;
  y: number;
}

export class HudRadar {
  private readonly island: HTMLDivElement;
  private readonly dots: Dot[];
  private readonly point: RadarPoint = { x: 0, y: 0, clamped: false };
  private last = { x: NaN, y: NaN, edge: false };

  constructor(root: HTMLElement) {
    const radar = el('div', 'hud-radar', root);
    el('div', 'hud-radar-ring', radar);
    this.island = el('div', 'hud-radar-island', radar);
    this.dots = Array.from({ length: HUD_CONFIG.radar.maxContacts }, () => {
      const e = el('div', 'hud-radar-dot', radar);
      e.hidden = true;
      return {
        el: e,
        shown: false,
        kind: '',
        edge: false,
        altitude: '',
        behind: false,
        x: NaN,
        y: NaN,
      };
    });
    el('div', 'hud-radar-self', radar);
  }

  update(selfX: number, selfZ: number, headingDeg: number, f: Readonly<HudRadarFrame>): void {
    const r = HUD_CONFIG.radar;
    const c = r.islandCenter;
    const p = radarPoint(this.point, selfX, selfZ, headingDeg, c.x, c.z, r.rangeM);
    const last = this.last;
    if (
      changed(last.x, p.x, HUD_CONFIG.epsilon.radar) ||
      changed(last.y, p.y, HUD_CONFIG.epsilon.radar)
    ) {
      last.x = p.x;
      last.y = p.y;
      this.island.style.transform = translate(p.x, p.y);
    }
    if (p.clamped !== last.edge) {
      last.edge = p.clamped;
      this.island.classList.toggle('is-edge', p.clamped);
    }

    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (!d) continue;
      const contact = f.contacts[i];
      const shown = i < f.count && contact !== undefined;
      if (shown !== d.shown) {
        d.shown = shown;
        d.el.hidden = !shown;
      }
      if (!shown) continue;
      const q = radarPoint(this.point, selfX, selfZ, headingDeg, contact.x, contact.z, r.rangeM);
      if (contact.kind !== d.kind) {
        d.kind = contact.kind;
        d.el.className = `hud-radar-dot is-${contact.kind}`;
        d.edge = false;
        d.altitude = '';
        d.behind = false;
      }
      const altitude = f.assist ? contact.altitude : '';
      if (altitude !== d.altitude) {
        d.el.classList.toggle('is-above', altitude === 'above');
        d.el.classList.toggle('is-below', altitude === 'below');
        d.altitude = altitude;
      }
      const behind = f.assist && contact.behind;
      if (behind !== d.behind) {
        d.el.classList.toggle('is-behind', behind);
        d.behind = behind;
      }
      if (q.clamped !== d.edge) {
        d.edge = q.clamped;
        d.el.classList.toggle('is-edge', q.clamped);
      }
      if (
        changed(d.x, q.x, HUD_CONFIG.epsilon.radar) ||
        changed(d.y, q.y, HUD_CONFIG.epsilon.radar)
      ) {
        d.x = q.x;
        d.y = q.y;
        d.el.style.transform = translate(q.x, q.y);
      }
    }
  }

  invalidate(): void {
    this.last.x = this.last.y = NaN;
    for (const d of this.dots) d.x = d.y = NaN;
  }
}

function translate(x: number, y: number): string {
  return `translate(calc(${x.toFixed(3)} * var(--hud-radar-r)), calc(${y.toFixed(3)} * var(--hud-radar-r)))`;
}
