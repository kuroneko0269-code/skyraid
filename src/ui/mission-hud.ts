// ミッションの HUD（2-4）: 右上の目標の進み具合と残り時間、画面中央の大きな文字（目標達成・成功・失敗）、
// 戦域の境界の警告（RETURN TO BATTLEFIELD とカウント）、次のリングの印。進み具合はランナーのイベントを購読する。
// DOM は最初に作り、値が変わったときだけ書く
import './mission-hud.css';
import { MISSION_FLOW } from '../data/missions';
import type { MissionRunner } from '../missions/runner';
import { el } from './hud-dom';
import { changed, formatDistance } from './hud-math';
import { FAIL_REASON_TEXT, formatClock, objectiveProgressText } from './mission-text';

/** 次のリングの印（画面座標 px）。onScreen でなければ画面端の矢印（deg は向き） */
export interface WaypointFrame {
  shown: boolean;
  onScreen: boolean;
  x: number;
  y: number;
  deg: number;
  distance: number;
}

export function createWaypointFrame(): WaypointFrame {
  return { shown: false, onScreen: false, x: 0, y: 0, deg: 0, distance: 0 };
}

export class MissionHud {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private rows: HTMLDivElement[] = [];
  private readonly banner: HTMLDivElement;
  private readonly bannerMain: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly boundary: HTMLDivElement;
  private readonly boundaryCount: HTMLDivElement;
  private readonly waypoint: HTMLDivElement;
  private readonly waypointText: HTMLSpanElement;
  private readonly arrow: HTMLDivElement;
  private unsubscribe: (() => void)[] = [];
  private hudShown = true;
  private last = {
    time: '',
    outside: false,
    count: '',
    wpMode: '',
    wpX: NaN,
    wpY: NaN,
    wpDeg: NaN,
    wpText: '',
  };

  constructor(parent: HTMLElement) {
    const root = el('div', 'mission-hud', parent);
    this.root = root;
    this.panel = el('div', 'mission-panel', root);
    this.timer = el('div', 'mission-timer', this.panel);
    this.list = el('div', 'mission-objectives', this.panel);
    this.waypoint = el('div', 'mission-waypoint', root);
    el('div', 'mission-waypoint-mark', this.waypoint);
    this.waypointText = el('span', 'mission-waypoint-text', this.waypoint);
    this.arrow = el('div', 'mission-waypoint-arrow', root);
    this.banner = el('div', 'mission-banner', root);
    this.bannerMain = el('div', 'mission-banner-main', this.banner);
    this.bannerSub = el('div', 'mission-banner-sub', this.banner);
    this.boundary = el('div', 'boundary-warning', root);
    el('div', 'boundary-warning-main', this.boundary, 'RETURN TO BATTLEFIELD');
    this.boundaryCount = el('div', 'boundary-warning-count', this.boundary);
    this.panel.hidden = this.banner.hidden = this.boundary.hidden = true;
    this.waypoint.hidden = this.arrow.hidden = true;
  }

  /** ランナーの進み具合を表示する（null ならフリーフライト。目標の表示を消す） */
  attach(runner: MissionRunner | null): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.list.replaceChildren();
    this.rows = [];
    this.hideBanner();
    this.last.time = '';
    this.panel.hidden = runner === null || !this.hudShown;
    if (!runner) return;
    this.rows = runner.objectives.map((o) => {
      const row = el('div', 'mission-objective is-pending', this.list);
      row.textContent = objectiveProgressText(o.def, o.current, o.target);
      return row;
    });
    const bus = runner.bus;
    const row = (i: number): HTMLDivElement | undefined => this.rows[i];
    this.unsubscribe.push(
      bus.on('objective:activate', ({ index }) => {
        row(index)?.classList.replace('is-pending', 'is-active');
      }),
      bus.on('objective:progress', ({ index, current, target }) => {
        const o = runner.objectives[index];
        const r = row(index);
        if (o && r) r.textContent = objectiveProgressText(o.def, current, target);
      }),
      bus.on('objective:complete', ({ index }) => {
        const r = row(index);
        r?.classList.remove('is-pending', 'is-active');
        r?.classList.add('is-complete');
        if (runner.running) this.showBanner('OBJECTIVE COMPLETE', r?.textContent ?? '', 'is-good');
      }),
      bus.on('mission:end', ({ result }) => {
        if (result.outcome === 'success') this.showBanner('MISSION COMPLETE', '', 'is-good');
        else {
          const reason = result.failReason ? FAIL_REASON_TEXT[result.failReason] : '';
          this.showBanner('MISSION FAILED', reason, 'is-bad');
        }
      }),
    );
  }

  /** H キー・設定の HUD ON/OFF。目標の表示と次のリングの印だけ隠す（大きな文字・境界の警告は出す） */
  setHudVisible(visible: boolean): void {
    this.hudShown = visible;
    this.panel.hidden = !visible || this.rows.length === 0;
    if (!visible) this.waypoint.hidden = this.arrow.hidden = true;
    this.last.wpMode = '';
  }

  /** 残り時間（制限時間がなければ null） */
  setTimeLeft(seconds: number | null): void {
    const text = seconds === null ? '' : `残り ${formatClock(seconds, true)}`;
    if (text === this.last.time) return;
    this.last.time = text;
    this.timer.textContent = text;
    this.timer.hidden = text === '';
    this.timer.classList.toggle('is-low', seconds !== null && seconds <= 30);
  }

  /** 戦域の境界の警告。secondsLeft が null なら数えない（フリーフライト） */
  setBoundary(outside: boolean, secondsLeft: number | null): void {
    const last = this.last;
    if (outside !== last.outside) {
      last.outside = outside;
      this.boundary.hidden = !outside;
    }
    const count = outside && secondsLeft !== null ? String(Math.ceil(secondsLeft - 1e-6)) : '';
    if (count !== last.count) this.boundaryCount.textContent = last.count = count;
  }

  /** 次のリングの印 */
  setWaypoint(w: Readonly<WaypointFrame>): void {
    const last = this.last;
    const mode = !this.hudShown || !w.shown ? 'none' : w.onScreen ? 'mark' : 'arrow';
    if (mode !== last.wpMode) {
      last.wpMode = mode;
      this.waypoint.hidden = mode !== 'mark';
      this.arrow.hidden = mode !== 'arrow';
      last.wpX = last.wpY = last.wpDeg = NaN;
    }
    if (mode === 'none') return;
    if (
      changed(last.wpX, w.x, 0.5) ||
      changed(last.wpY, w.y, 0.5) ||
      changed(last.wpDeg, w.deg, 0.5)
    ) {
      last.wpX = w.x;
      last.wpY = w.y;
      last.wpDeg = w.deg;
      const t = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`;
      if (mode === 'mark') this.waypoint.style.transform = t;
      else this.arrow.style.transform = `${t} rotate(${w.deg.toFixed(1)}deg)`;
    }
    const text = formatDistance(w.distance);
    if (mode === 'mark' && text !== last.wpText) this.waypointText.textContent = last.wpText = text;
  }

  private showBanner(main: string, sub: string, kind: 'is-good' | 'is-bad'): void {
    this.bannerMain.textContent = main;
    this.bannerSub.textContent = sub;
    this.banner.classList.remove('is-good', 'is-bad');
    this.banner.classList.add(kind);
    this.banner.hidden = false;
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.hideBanner();
    }, MISSION_FLOW.bannerSeconds * 1000);
  }

  private hideBanner(): void {
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
    this.banner.hidden = true;
  }
}
