// リングレース（7-1）の HUD: 上中央に現在タイム・リングの数・ゴーストとの差、チェックポイントのスプリット（±）と
// タイムの加減（未通過 +5・細い −2）を数秒、画面中央にカウントダウン（3・2・1・GO）とゴール。
// 次のリングへの矢印と距離はミッションの HUD の印（render/mission-link.ts）が出す。値が変わったときだけ DOM を書く
import './race.css';
import { RACE_CONFIG } from '../data/race';
import type { RaceRunner } from '../missions/race/runner';
import { formatDelta, formatRaceTime } from '../missions/race/score';
import { el } from './hud-dom';

export class RaceHud {
  readonly root: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly rings: HTMLSpanElement;
  private readonly ghost: HTMLSpanElement;
  private readonly flash: HTMLDivElement;
  private readonly big: HTMLDivElement;
  private readonly bigSub: HTMLDivElement;
  private race: RaceRunner | null = null;
  private off: (() => void)[] = [];
  private flashUntil = 0;
  private bigUntil = 0;
  private last = { time: '', rings: '', ghost: '' };

  constructor(parent: HTMLElement) {
    const root = el('div', 'race-hud', parent);
    root.hidden = true;
    this.root = root;
    const top = el('div', 'race-top', root);
    this.time = el('div', 'race-time', top);
    const sub = el('div', 'race-sub', top);
    this.rings = el('span', 'race-rings', sub);
    this.ghost = el('span', 'race-ghost', sub);
    this.flash = el('div', 'race-flash', top);
    this.flash.hidden = true;
    const big = el('div', 'race-big', root);
    this.big = el('div', 'race-big-main', big);
    this.bigSub = el('div', 'race-big-sub', big);
    big.hidden = true;
  }

  /** レースを付け替える（null で隠す）。イベントでスプリット・加減・カウントダウン・ゴールを出す */
  attach(race: RaceRunner | null): void {
    for (const f of this.off) f();
    this.off = [];
    this.race = race;
    this.root.hidden = race === null;
    this.flash.hidden = true;
    this.hideBig();
    this.last = { time: '', rings: '', ghost: '' };
    if (!race) return;
    const bus = race.bus;
    this.off.push(
      bus.on('race:countdown', ({ count }) => {
        this.showBig(String(count), '', 'is-count');
      }),
      bus.on('race:start', () => {
        this.showBig('GO', '', 'is-go', 0.8);
      }),
      bus.on('race:miss', ({ rings }) => {
        const penalty = rings.length * RACE_CONFIG.missPenaltySeconds;
        this.showFlash(`リング未通過 +${penalty.toFixed(0)}秒`, 'is-bad');
      }),
      bus.on('race:ring', ({ ring }) => {
        if (ring.kind === 'thin')
          this.showFlash(`細いリング −${RACE_CONFIG.thinBonusSeconds}秒`, 'is-good');
        else if (ring.kind === 'boost') this.showFlash('BOOST', 'is-boost');
      }),
      bus.on('race:split', ({ time, delta }) => {
        const d = delta === null ? '' : `  ${formatDelta(delta)}`;
        const kind = delta === null ? 'is-split' : delta <= 0 ? 'is-good' : 'is-bad';
        this.showFlash(`SPLIT ${formatRaceTime(time)}${d}`, kind);
      }),
      bus.on('race:finish', ({ result }) => {
        if (result.outcome === 'finished')
          this.showBig('FINISH', formatRaceTime(result.time), 'is-finish', 99);
        else this.showBig('TIME OVER', '', 'is-over', 99);
      }),
    );
  }

  /** 描画フレームごとに呼ぶ（飛行中だけ） */
  update(): void {
    const race = this.race;
    if (!race) return;
    const now = performance.now();
    if (!this.flash.hidden && now > this.flashUntil) this.flash.hidden = true;
    if (!this.big.parentElement?.hidden && now > this.bigUntil) this.hideBig();
    const last = this.last;
    const time = formatRaceTime(Math.max(0, race.currentTime));
    if (time !== last.time) this.time.textContent = last.time = time;
    const passed = Math.min(race.next, race.rings.length);
    const rings = `RING ${passed}/${race.rings.length}`;
    if (rings !== last.rings) this.rings.textContent = last.rings = rings;
    const g = race.ghostDelta;
    const ghost = g === null ? '' : `GHOST ${formatDelta(g)}`;
    if (ghost !== last.ghost) {
      this.ghost.textContent = last.ghost = ghost;
      this.ghost.classList.toggle('is-ahead', g !== null && g <= 0);
      this.ghost.classList.toggle('is-behind', g !== null && g > 0);
    }
  }

  private showFlash(text: string, kind: string): void {
    this.flash.textContent = text;
    this.flash.className = `race-flash ${kind}`;
    this.flash.hidden = false;
    this.flashUntil = performance.now() + RACE_CONFIG.splitShowSeconds * 1000;
  }

  private showBig(main: string, sub: string, kind: string, seconds = 1): void {
    const box = this.big.parentElement;
    if (!box) return;
    this.big.textContent = main;
    this.bigSub.textContent = sub;
    box.className = `race-big ${kind}`;
    box.hidden = false;
    this.bigUntil = performance.now() + seconds * 1000;
  }

  private hideBig(): void {
    const box = this.big.parentElement;
    if (box) box.hidden = true;
  }
}
