// 9-6b: ネフィルガのレイドの HUD（ネフィルガの遅延チャンク）。見た目はヴォルガスの HUD（kaiju-hud.css）と同じ部品:
// 上の帯に名前・体力バー（70% / 40% の目盛り）・段階と残り時間（嵐は赤）、ロック中の部位と部位 HP、壊せる 4 部位の小さなバー。
// 予兆の警告（攻撃名と残り秒）、攻めどき（止まり木・引き起こし）。部位の破壊・段階の変化は上のお知らせに。
// スタンのノイズはヴォルガスの HUD（KaijuHudLink）が自機のスタンから出す。DOM は最初に作り、値が変わったときだけ書く。
// 9-6c: 協力では、部位をロックしている他の人の色の印と、自分が狙われているときの「TARGET」（ヴォルガスの協力と同じ部品）
import { KAIJU2_CONFIG, KAIJU2_PARTS, type Kaiju2Part } from '../data/kaiju2';
import { KAIJU2_RAID_CONFIG } from '../data/kaiju2-raid';
import { k2t } from '../data/kaiju2-text';
import type { Kaiju2PartTarget } from '../entities/kaiju2/kaiju2-target';
import { isPerching, type Kaiju2Raid } from '../missions/kaiju2-raid';
import { t } from '../core/i18n';
import { el } from './hud-dom';
import { formatClock } from './mission-text';
import { showToast } from './toast';

const TOAST_SECONDS = 3.5;

interface Chip {
  readonly root: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly marks: HTMLSpanElement;
  lastMarks: string;
}

/** 9-6c: 協力の 1 フレーム分の値（部位の印は KAIJU2_TARGETS の順。自分は入れない） */
export interface Kaiju2CoopFrame {
  readonly marks: readonly (readonly string[])[];
  readonly targeted: boolean;
}

/** 予兆の警告の文（攻撃名と残り秒）。予兆でなければ '' */
export function warningText(raid: Kaiju2Raid): string {
  const k = raid.body;
  if (raid.dead || k.state !== 'windup' || k.attack === null) return '';
  const windup = KAIJU2_CONFIG.attacks[k.attack].windup * k.windupScale;
  return `⚠ ${k2t(`attack.${k.attack}`)}  ${Math.max(0, windup - k.stateTime).toFixed(1)}`;
}

/** 攻めどきの文（止まり木・引き起こし）。無ければ '' */
export function openingText(raid: Kaiju2Raid): string {
  const k = raid.body;
  if (raid.dead) return '';
  if (isPerching(k)) return k2t('opening.perch');
  if (k.attack === 'dive' && k.state === 'recover') return k2t('opening.recover');
  return '';
}

export class Kaiju2Hud {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly phase: HTMLSpanElement;
  private readonly partRow: HTMLDivElement;
  private readonly partName: HTMLSpanElement;
  private readonly partFill: HTMLDivElement;
  private readonly chips = new Map<Kaiju2Part, Chip>();
  private readonly warning: HTMLDivElement;
  private readonly opening: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private lastTarget = false;
  private last = { hp: NaN, phase: '', part: '', partHp: NaN, warn: '', open: '', chips: '' };
  /** お知らせを比べる前の値 */
  private seenBroken = -1;
  private seenPhase = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'kaiju-hud kaiju2-hud', parent);
    this.root = root;
    const top = el('div', 'kaiju-top', root);
    const head = el('div', 'kaiju-head', top);
    el('span', 'kaiju-name', head, k2t('hudName'));
    this.phase = el('span', 'kaiju-phase', head);
    const bar = el('div', 'kaiju-bar', top);
    this.fill = el('div', 'kaiju-bar-fill', bar);
    for (const r of KAIJU2_CONFIG.phases) {
      const tick = el('div', 'kaiju-bar-tick', bar);
      tick.style.left = `${r * 100}%`;
    }
    this.partRow = el('div', 'kaiju-part', top);
    this.partName = el('span', 'kaiju-part-name', this.partRow);
    const pbar = el('div', 'kaiju-part-bar', this.partRow);
    this.partFill = el('div', 'kaiju-part-fill', pbar);
    const list = el('div', 'kaiju-coop', top);
    for (const id of KAIJU2_PARTS) {
      const c = el('div', 'kaiju-coop-part', list);
      el('span', 'kaiju-coop-name', c, k2t(`part.${id}`));
      const b = el('div', 'kaiju-coop-bar', c);
      const fill = el('div', 'kaiju-coop-fill', b);
      this.chips.set(id, {
        root: c,
        fill,
        marks: el('span', 'kaiju-coop-marks', c),
        lastMarks: '',
      });
    }
    this.warning = el('div', 'kaiju-warning', root);
    this.opening = el('div', 'kaiju-down', root);
    this.target = el('div', 'kaiju-target', root, t('kaiju.hud.targeted'));
    this.target.hidden = true;
    this.warning.hidden = true;
    this.opening.hidden = true;
    this.partRow.hidden = true;
    root.hidden = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.seenBroken = -1;
  }

  /** 描画フレームごと。shown は HUD を出す（H キーの切り替え）。locked はロック中の部位。coop は協力の印（ソロは null） */
  update(
    raid: Kaiju2Raid,
    shown: boolean,
    locked: Kaiju2PartTarget | null,
    coop: Readonly<Kaiju2CoopFrame> | null = null,
  ): void {
    const visible = shown && !raid.dead && raid.body.visible;
    this.root.hidden = !visible;
    this.notify(raid);
    if (!visible) return;
    const targeted = coop?.targeted ?? false;
    if (targeted !== this.lastTarget) {
      this.lastTarget = targeted;
      this.target.hidden = !targeted;
    }
    const ratio = Math.max(0, raid.hp / raid.maxHp);
    if (ratio !== this.last.hp) {
      this.last.hp = ratio;
      this.fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }
    const time = formatClock(raid.timeLeft);
    const storm = raid.stormAt >= 0;
    const phase = storm ? k2t('storm', { time }) : k2t('phase', { phase: raid.body.phase, time });
    if (phase !== this.last.phase) {
      this.last.phase = phase;
      this.phase.textContent = phase;
      this.phase.classList.toggle('is-final', storm);
    }
    this.setPart(locked);
    let chips = '';
    for (const t of raid.targets) {
      const c = t.id === 'body' ? undefined : this.chips.get(t.id);
      if (!c) continue;
      const r = Math.max(0, t.hp / t.maxHp);
      chips += r.toFixed(3);
      c.fill.style.transform = `scaleX(${r.toFixed(3)})`;
      c.root.classList.toggle('is-broken', t.broken);
      c.root.classList.toggle('is-own', t === locked);
      const colors = coop?.marks[t.kaijuIndex] ?? [];
      const key = colors.join(',');
      if (key !== c.lastMarks) {
        c.lastMarks = key;
        c.marks.replaceChildren();
        for (const color of colors) {
          const dot = el('span', 'kaiju-coop-mark', c.marks, '●');
          dot.style.color = color;
        }
      }
    }
    this.last.chips = chips;
    const warn = warningText(raid);
    if (warn !== this.last.warn) {
      this.last.warn = warn;
      this.warning.textContent = warn;
      this.warning.hidden = warn === '';
    }
    const open = openingText(raid);
    if (open !== this.last.open) {
      this.last.open = open;
      this.opening.textContent = open;
      this.opening.hidden = open === '';
    }
  }

  private setPart(p: Kaiju2PartTarget | null): void {
    const label = p ? k2t(`part.${p.id}`) : '';
    const name = p?.broken ? k2t('partBroken', { part: label }) : label;
    if (name !== this.last.part) {
      this.last.part = name;
      this.partName.textContent = name;
      this.partRow.hidden = name === '';
      this.partRow.classList.toggle('is-broken', p?.broken ?? false);
    }
    // 胴は部位 HP が無いので全体の体力
    const hp = p ? (p.id === 'body' ? 1 : Math.max(0, p.hp / p.maxHp)) : 0;
    if (hp !== this.last.partHp) {
      this.last.partHp = hp;
      this.partFill.style.transform = `scaleX(${hp.toFixed(4)})`;
    }
  }

  /** 部位の破壊・段階の変化をお知らせに（出した直後・リプレイのシークで一度に来た分は最後の 1 つだけ） */
  private notify(raid: Kaiju2Raid): void {
    const k = raid.body;
    if (this.seenBroken < 0 || raid.brokenCount < this.seenBroken) {
      this.seenBroken = raid.brokenCount;
      this.seenPhase = k.phase;
      return;
    }
    if (raid.brokenCount > this.seenBroken && raid.lastBroken) {
      showToast(k2t(`broken.${raid.lastBroken}`), { seconds: TOAST_SECONDS });
      this.seenBroken = raid.brokenCount;
    }
    if (k.phase > this.seenPhase && raid.raid) {
      const time = formatClock(KAIJU2_RAID_CONFIG.finalSeconds[raid.difficulty]);
      showToast(k2t(k.phase >= 3 ? 'phase3' : 'phase2', { time }), { seconds: TOAST_SECONDS });
    }
    this.seenPhase = k.phase;
  }
}
