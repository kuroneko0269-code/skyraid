// 防衛戦（7-2）の HUD: 上中央に波数と残りの敵・司令部の HP バー、準備の間は残り秒数とスキップのボタン・補給の案内。
// 左上の帯に施設の状態（アイコン）・次の波の予告（レーダーが残っていれば）（7-C で上中央から分けた。SPD/ALT の箱と重なっていた）。中央に大きな文字（WAVE 3・CLEAR・補給完了など）。
// 巡航ミサイルは専用の赤い警告マーカー（優先目標。画面外は画面端の赤い三角）。ソロも協力も同じ表示（値の出どころが違う）
import './defense.css';
import { DEFENSE_CONFIG, FACILITY_KINDS } from '../data/defense';
import type { DefensePhase } from '../missions/defense/runner';
import { t } from '../core/i18n';
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
  get hq() {
    return t('defense.icon.hq');
  },
  get radar() {
    return t('defense.icon.radar');
  },
  get fuel() {
    return t('defense.icon.fuel');
  },
  get aaa1() {
    return t('defense.icon.aaa1');
  },
  get aaa2() {
    return t('defense.icon.aaa2');
  },
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
    // 上中央の帯（幅 50% 以内・SPD/ALT の箱より上。7-C）: 波数と司令部の HP を 1 行、準備の間は残り秒数とスキップ
    const top = el('div', 'defense-top', root);
    const row = el('div', 'defense-top-row', top);
    this.waveText = el('div', 'defense-wave', row);
    const hq = el('div', 'defense-hq', row);
    el('span', 'defense-hq-label', hq, 'HQ');
    const track = el('div', 'defense-hq-track', hq);
    this.hqFill = el('div', 'defense-hq-fill', track);
    this.hqText = el('span', 'defense-hq-value', hq);
    this.prep = el('div', 'defense-prep', top);
    this.prepText = el('span', 'defense-prep-text', this.prep);
    this.skip = el('button', 'ui-button defense-skip', this.prep, t('defense.hud.skip'));
    this.skip.type = 'button';
    this.skip.addEventListener('click', () => {
      this.onSkip();
    });
    const sup = DEFENSE_CONFIG.supply;
    this.supply = el(
      'div',
      'defense-supply',
      top,
      t('defense.hud.supplyHint', { agl: sup.maxAgl, speed: sup.maxSpeed }),
    );
    // 左上の帯（左上のボタンの右・ゲージより上。7-C）: 施設の状態・次の波の予告
    const side = el('div', 'defense-side', root);
    const icons = el('div', 'defense-icons', side);
    for (const k of FACILITY_KINDS) this.icons.push(el('span', 'defense-icon', icons, ICONS[k]));
    this.forecast = el('div', 'defense-forecast', side);
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
      ? t('defense.hud.wavePrep', { wave: s.wave, total })
      : s.phase === 'wave'
        ? t('defense.hud.waveRemaining', { wave: s.wave, total, remaining: s.remaining })
        : `WAVE ${Math.min(s.wave, total)} / ${total}`;
    const ratio = s.hqMaxHp > 0 ? Math.max(0, s.hqHp / s.hqMaxHp) : 0;
    this.hqFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.hqFill.classList.toggle('is-low', ratio <= 0.3);
    this.hqText.textContent = String(Math.ceil(Math.max(0, s.hqHp)));
    this.icons.forEach((icon, i) => {
      icon.classList.toggle('is-lost', (s.aliveBits & (1 << i)) === 0);
    });
    this.prep.hidden = !prep;
    this.prepText.textContent = t('defense.hud.nextWaveIn', { seconds: left });
    this.skip.disabled = s.skipped;
    this.skip.textContent = s.skipped ? t('defense.hud.waiting') : t('defense.hud.skip');
    this.forecast.hidden = !prep;
    this.forecast.textContent = s.forecast
      ? t('defense.hud.forecast', { forecast: s.forecast })
      : t('defense.hud.forecastUnknown');
    this.forecast.classList.toggle('is-unknown', s.forecast === null);
    this.supply.hidden = !prep;
    this.supply.classList.toggle('is-done', s.supplied);
    if (s.supplied) this.supply.textContent = t('defense.hud.supplied');
    else {
      const c = DEFENSE_CONFIG.supply;
      this.supply.textContent = t('defense.hud.supplyHint', { agl: c.maxAgl, speed: c.maxSpeed });
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
