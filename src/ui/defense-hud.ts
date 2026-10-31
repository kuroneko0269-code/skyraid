// 防衛戦（7-2）の HUD: 上中央に波数と残りの敵・司令部の HP バー・施設の状態（アイコン）、準備の間は残り秒数とスキップのボタン・
// 次の波の予告（レーダーが残っていれば）・補給の案内。中央に大きな文字（WAVE 3・CLEAR・補給完了など）。
// 巡航ミサイルは専用の赤い警告マーカー（優先目標。画面外は画面端の赤い三角）。ソロも協力も同じ表示（値の出どころが違う）
import './defense.css';
import { DEFENSE_CONFIG, FACILITY_KINDS } from '../data/defense';
import type { DefensePhase } from '../missions/defense/runner';
import { el } from './hud-dom';

/** HUD に出す値（ソロはランナー、協力はホストの state の写し） */
export interface DefenseHudState {
  readonly phase: DefensePhase;
  readonly wave: number;
  readonly remaining: number;
  readonly intermissionLeft: number;
  readonly hqHp: number;
  readonly hqMaxHp: number;
  /** 施設の状態のビット（FACILITY_KINDS の順に 1 = 残っている） */
  readonly aliveBits: number;
  /** 次の波の予告（レーダーが壊れていれば null） */
  readonly forecast: string | null;
  /** この準備の間に補給した */
  readonly supplied: boolean;
  /** スキップを押した（協力: 全員がそろうまで待つ） */
  readonly skipped: boolean;
}

/** 巡航ミサイルのマーカー 1 つ（画面座標。画面外なら端の位置と向き） */
export interface CruiseMarker {
  shown: boolean;
  onScreen: boolean;
  x: number;
  y: number;
  deg: number;
  distance: number;
}

const ICONS: Readonly<Record<(typeof FACILITY_KINDS)[number], string>> = {
  hq: '司令部',
  radar: 'レーダー',
  fuel: '燃料',
  aaa1: '対空1',
  aaa2: '対空2',
};

export class DefenseHud {
  readonly root: HTMLDivElement;
  private readonly waveText: HTMLDivElement;
  private readonly hqFill: HTMLDivElement;
  private readonly hqText: HTMLSpanElement;
  private readonly icons: HTMLSpanElement[] = [];
  private readonly prep: HTMLDivElement;
  private readonly prepText: HTMLSpanElement;
  private readonly skip: HTMLButtonElement;
  private readonly forecast: HTMLDivElement;
  private readonly supply: HTMLDivElement;
  private readonly big: HTMLDivElement;
  private readonly bigMain: HTMLDivElement;
  private readonly bigSub: HTMLDivElement;
  private readonly markers: HTMLDivElement[] = [];
  private bigTimer: ReturnType<typeof setTimeout> | null = null;
  private last = '';

  /** スキップ（ボタン・N キー）。ソロはランナー、協力は全員の投票（ui/defense-flight.ts が差し替える） */
  onSkip: () => void = () => undefined;

  constructor(parent: HTMLElement) {
    const root = el('div', 'defense-hud', parent);
    root.hidden = true;
    const top = el('div', 'defense-top', root);
    this.waveText = el('div', 'defense-wave', top);
    const hq = el('div', 'defense-hq', top);
    el('span', 'defense-hq-label', hq, 'HQ');
    const track = el('div', 'defense-hq-track', hq);
    this.hqFill = el('div', 'defense-hq-fill', track);
    this.hqText = el('span', 'defense-hq-value', hq);
    const icons = el('div', 'defense-icons', top);
    for (const k of FACILITY_KINDS) this.icons.push(el('span', 'defense-icon', icons, ICONS[k]));
    this.prep = el('div', 'defense-prep', top);
    this.prepText = el('span', 'defense-prep-text', this.prep);
    this.skip = el('button', 'ui-button defense-skip', this.prep, 'スキップ (N)');
    this.skip.type = 'button';
    this.skip.addEventListener('click', () => {
      this.onSkip();
    });
    this.forecast = el('div', 'defense-forecast', top);
    const s = DEFENSE_CONFIG.supply;
    this.supply = el(
      'div',
      'defense-supply',
      top,
      `補給: 基地の上空を高度 ${s.maxAgl}m 以下・速度 ${s.maxSpeed} 以下で通過`,
    );
    const big = el('div', 'defense-big', root);
    this.bigMain = el('div', 'defense-big-main', big);
    this.bigSub = el('div', 'defense-big-sub', big);
    this.big = big;
    big.hidden = true;
    const layer = el('div', 'defense-markers', root);
    for (let i = 0; i < 16; i++) {
      const m = el('div', 'defense-cruise', layer);
      el('span', 'defense-cruise-label', m, 'CRUISE');
      m.hidden = true;
      this.markers.push(m);
    }
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && !root.hidden && !this.prep.hidden && !e.repeat) this.onSkip();
    });
    this.root = root;
  }

  setShown(shown: boolean): void {
    this.root.hidden = !shown;
    if (!shown) {
      this.last = '';
      this.big.hidden = true;
    }
  }

  update(s: Readonly<DefenseHudState>): void {
    const prep = s.phase === 'intermission';
    const left = Math.ceil(s.intermissionLeft);
    const key = `${s.phase}|${s.wave}|${s.remaining}|${left}|${Math.ceil(s.hqHp)}|${s.aliveBits}|${s.forecast}|${s.supplied}|${s.skipped}`;
    if (key === this.last) return;
    this.last = key;
    const total = DEFENSE_CONFIG.waves;
    this.waveText.textContent = prep
      ? `WAVE ${s.wave} / ${total}  準備中`
      : s.phase === 'wave'
        ? `WAVE ${s.wave} / ${total}  残り ${s.remaining}`
        : `WAVE ${Math.min(s.wave, total)} / ${total}`;
    const ratio = s.hqMaxHp > 0 ? Math.max(0, s.hqHp / s.hqMaxHp) : 0;
    this.hqFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.hqFill.classList.toggle('is-low', ratio <= 0.3);
    this.hqText.textContent = String(Math.ceil(Math.max(0, s.hqHp)));
    this.icons.forEach((icon, i) => {
      icon.classList.toggle('is-lost', (s.aliveBits & (1 << i)) === 0);
    });
    this.prep.hidden = !prep;
    this.prepText.textContent = `次の波まで ${left} 秒`;
    this.skip.disabled = s.skipped;
    this.skip.textContent = s.skipped ? '待機中…' : 'スキップ (N)';
    this.forecast.hidden = !prep;
    this.forecast.textContent = s.forecast
      ? `次の波：${s.forecast}`
      : '次の波：レーダー喪失のため不明';
    this.forecast.classList.toggle('is-unknown', s.forecast === null);
    this.supply.hidden = !prep;
    this.supply.classList.toggle('is-done', s.supplied);
    if (s.supplied) this.supply.textContent = '補給済み';
    else {
      const c = DEFENSE_CONFIG.supply;
      this.supply.textContent = `補給: 基地の上空を高度 ${c.maxAgl}m 以下・速度 ${c.maxSpeed} 以下で通過`;
    }
  }

  /** 大きな文字を seconds 秒（kind: good は緑、bad は赤） */
  flash(main: string, sub = '', kind: 'good' | 'bad' | 'info' = 'info', seconds = 2.5): void {
    this.bigMain.textContent = main;
    this.bigSub.textContent = sub;
    this.big.dataset.kind = kind;
    this.big.hidden = false;
    if (this.bigTimer) clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => {
      this.big.hidden = true;
    }, seconds * 1000);
  }

  /** 巡航ミサイルのマーカー（優先目標） */
  setCruiseMarkers(list: readonly Readonly<CruiseMarker>[]): void {
    this.markers.forEach((m, i) => {
      const c = list[i];
      if (!c?.shown) {
        m.hidden = true;
        return;
      }
      m.hidden = false;
      m.classList.toggle('is-edge', !c.onScreen);
      m.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)${c.onScreen ? '' : ` rotate(${c.deg.toFixed(1)}deg)`}`;
      const label = m.firstElementChild;
      if (label)
        label.textContent = c.onScreen
          ? `CRUISE ${c.distance < 1000 ? `${Math.round(c.distance)}m` : `${(c.distance / 1000).toFixed(1)}km`}`
          : '';
    });
  }
}
