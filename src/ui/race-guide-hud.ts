// 9-8 リングレースの道案内の HUD（DOM）: 次とその次のリングの番号の札（種類の色。印があれば「宙返り」など）、
// 上の帯の「次: ↑ 上へ」の行と、通り損ねの行（戻る向きは画面端の矢印・菱形。ミッションの HUD の印が赤くなる）。
// 画面座標は render/race-guide-link.ts が入れる。値が変わったときだけ DOM を書く
import { t } from '../core/i18n';
import { RACE_CONFIG } from '../data/race';
import type { RingCue } from '../missions/race/guide';
import type { RingKind } from '../missions/race/types';
import { el } from './hud-dom';
import { changed } from './hud-math';

/** 札 1 枚の値（画面座標 px。shown でなければ隠す） */
export interface RaceBadgeFrame {
  shown: boolean;
  x: number;
  y: number;
  /** リングの番号（1 始まり） */
  number: number;
  kind: RingKind;
  cue: RingCue | null;
}

export interface RaceGuideFrame {
  /** 0 = 次のリング、1 = その次 */
  readonly badges: [RaceBadgeFrame, RaceBadgeFrame];
  /** 上の帯の印の行（次のリングの印。なければその次の印。どちらもなければ null） */
  cue: { readonly which: 'next' | 'after'; readonly cue: RingCue } | null;
  /** 通り損ねたリング（null は通り損ねていない）。required は飛ばせない（戻って通る） */
  missed: { readonly number: number; readonly required: boolean } | null;
}

export function createRaceGuideFrame(): RaceGuideFrame {
  const badge = (): RaceBadgeFrame => ({
    shown: false,
    x: 0,
    y: 0,
    number: 0,
    kind: 'normal',
    cue: null,
  });
  return { badges: [badge(), badge()], cue: null, missed: null };
}

/** 印の記号（どの端末のフォントにもある矢印だけ） */
const CUE_ICON: Readonly<Record<RingCue, string>> = { up: '↑', down: '↓', loop: '↻', pull: '↗' };

export function cueLabel(cue: RingCue): string {
  return `${CUE_ICON[cue]} ${t(`race.guide.cue.${cue}`)}`;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

interface BadgeEl {
  readonly root: HTMLDivElement;
  readonly no: HTMLSpanElement;
  readonly cue: HTMLSpanElement;
  last: { shown: boolean; x: number; y: number; text: string; cue: string; kind: string };
}

export class RaceGuideHud {
  private readonly badges: BadgeEl[];
  private readonly cueRow: HTMLDivElement;
  private readonly missRow: HTMLDivElement;
  private last = { cue: '', miss: '' };

  /** root は札（画面全体）、band はレースの上の帯（印・通り損ねの行） */
  constructor(root: HTMLElement, band: HTMLElement) {
    this.badges = [0, 1].map((i) => {
      const b = el('div', `race-guide-badge${i === 1 ? ' is-after' : ''}`, root);
      b.hidden = true;
      return {
        root: b,
        no: el('span', 'race-guide-no', b),
        cue: el('span', 'race-guide-cue', b),
        last: { shown: false, x: NaN, y: NaN, text: '', cue: '', kind: '' },
      };
    });
    this.cueRow = el('div', 'race-guide-row is-cue', band);
    this.missRow = el('div', 'race-guide-row is-missed', band);
    this.cueRow.hidden = this.missRow.hidden = true;
  }

  /** 隠す（レースの外・HUD OFF・下見の後の始め） */
  hide(): void {
    for (const b of this.badges) {
      b.root.hidden = true;
      b.last.shown = false;
    }
    this.cueRow.hidden = this.missRow.hidden = true;
    this.last = { cue: '', miss: '' };
  }

  update(f: Readonly<RaceGuideFrame>): void {
    f.badges.forEach((v, i) => {
      const b = this.badges[i];
      if (b) this.updateBadge(b, v);
    });
    const cue = f.cue
      ? t(f.cue.which === 'next' ? 'race.guide.next' : 'race.guide.after', {
          cue: cueLabel(f.cue.cue),
        })
      : '';
    if (cue !== this.last.cue) {
      this.last.cue = cue;
      this.cueRow.textContent = cue;
      this.cueRow.hidden = cue === '';
    }
    const m = f.missed;
    const miss = m
      ? `↩ ${t('race.guide.missed', { number: m.number })}  ${t(m.required ? 'race.guide.missedRequired' : 'race.guide.missedSkip', { seconds: RACE_CONFIG.missPenaltySeconds })}`
      : '';
    if (miss !== this.last.miss) {
      this.last.miss = miss;
      this.missRow.textContent = miss;
      this.missRow.hidden = miss === '';
    }
  }

  private updateBadge(b: BadgeEl, v: Readonly<RaceBadgeFrame>): void {
    const last = b.last;
    if (v.shown !== last.shown) {
      last.shown = v.shown;
      b.root.hidden = !v.shown;
      last.x = last.y = NaN;
    }
    if (!v.shown) return;
    if (changed(last.x, v.x, 0.5) || changed(last.y, v.y, 0.5)) {
      last.x = v.x;
      last.y = v.y;
      b.root.style.transform = `translate(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px)`;
    }
    const text = String(v.number);
    if (text !== last.text) b.no.textContent = last.text = text;
    const cue = v.cue ? cueLabel(v.cue) : '';
    if (cue !== last.cue) {
      b.cue.textContent = last.cue = cue;
      b.cue.hidden = cue === '';
    }
    if (v.kind !== last.kind) {
      last.kind = v.kind;
      b.root.style.setProperty('--race-kind-color', hex(RACE_CONFIG.colors[v.kind]));
    }
  }
}
