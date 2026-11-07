// 10-3b: 白鯨アルビオンのレイドの HUD（アルビオンの遅延チャンク）。見た目はヴォルガス・ネフィルガの HUD（kaiju-hud.css）と同じ部品:
// 上の帯に名前・体力バー（60% / 30% の目盛り）・段階と残り時間・子分の数、ロック中の部位と部位 HP、壊せる 6 部位の小さなバー
// （巣 3・背びれ・尾・頭。ロック中は枠）。予兆の警告（攻撃名・避け方・残り秒）、攻めどき（回り返し・叩きつけの後・吠える間）、
// 雲の中。部位の破壊と段階の変化は上のお知らせに。協力では部位をロックしている他の人の色の印と、狙われているときの「TARGET」
import { t } from '../core/i18n';
import { attackTimes } from '../ai/albion-attacks';
import { ALBION_CONFIG as C, ALBION_PARTS, type AlbionPart } from '../data/albion';
import { abt } from '../data/albion-text';
import type { AlbionPartTarget } from '../entities/albion/albion-target';
import type { AlbionRaid } from '../missions/albion-raid';
import { el } from './hud-dom';
import { formatClock } from './mission-text';
import { showToast } from './toast';

const TOAST_SECONDS = 3.5;
const CHIPS: readonly AlbionPart[] = ['nestFront', 'nestMid', 'nestRear', 'dorsal', 'tail', 'head'];

interface Chip {
  readonly root: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly marks: HTMLSpanElement;
  lastMarks: string;
}

/** 協力の 1 フレーム分の値（部位の名前 → ロックしている他の人の色。自分は入れない） */
export interface AlbionCoopFrame {
  readonly marks: ReadonlyMap<string, readonly string[]>;
  readonly targeted: boolean;
}

/** 予兆の警告の文（攻撃名・避け方・残り秒）。予兆でなければ ''。10-3c: 歌の輪・呼び声の突撃は攻撃の間も出す */
export function albionWarning(raid: AlbionRaid): string {
  const k = raid.kaiju;
  if (raid.dead || k.attack === null) return '';
  if (k.action === 'active' && (k.attack === 'sonar' || k.attack === 'call'))
    return `⚠ ${abt(`attack.${k.attack}`)}  ${abt(`active.${k.attack}`)}`;
  if (k.action !== 'windup') return '';
  const left = Math.max(0, attackTimes(k.attack).windup - k.actionTime);
  return `⚠ ${abt(`attack.${k.attack}`)}  ${left.toFixed(1)}  ${abt(`warn.${k.attack}`)}`;
}

/** 攻めどきの文（回り返し・叩きつけの硬直・吠える間）。無ければ '' */
export function albionOpening(raid: AlbionRaid): string {
  const k = raid.kaiju;
  if (raid.dead) return '';
  if (k.action === 'roar') return abt('opening.roar');
  if (k.attack === 'slam' && k.action === 'recover') return abt('opening.recover');
  if (k.body.turning) return abt('opening.turn');
  return '';
}

export class AlbionHud {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly phase: HTMLSpanElement;
  private readonly partRow: HTMLDivElement;
  private readonly partName: HTMLSpanElement;
  private readonly partFill: HTMLDivElement;
  private readonly chips = new Map<AlbionPart, Chip>();
  private readonly warning: HTMLDivElement;
  private readonly opening: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private lastTarget = false;
  private last = { hp: NaN, phase: '', part: '', partHp: NaN, warn: '', open: '' };
  /** お知らせを比べる前の値 */
  private seenBroken = -1;
  private seenPhase = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'kaiju-hud albion-hud', parent);
    this.root = root;
    const top = el('div', 'kaiju-top', root);
    const head = el('div', 'kaiju-head', top);
    el('span', 'kaiju-name', head, abt('hudName'));
    this.phase = el('span', 'kaiju-phase', head);
    const bar = el('div', 'kaiju-bar', top);
    this.fill = el('div', 'kaiju-bar-fill', bar);
    for (const r of C.phases.at) {
      const tick = el('div', 'kaiju-bar-tick', bar);
      tick.style.left = `${r * 100}%`;
    }
    this.partRow = el('div', 'kaiju-part', top);
    this.partName = el('span', 'kaiju-part-name', this.partRow);
    const pbar = el('div', 'kaiju-part-bar', this.partRow);
    this.partFill = el('div', 'kaiju-part-fill', pbar);
    const list = el('div', 'kaiju-coop', top);
    for (const id of CHIPS) {
      const c = el('div', 'kaiju-coop-part', list);
      el('span', 'kaiju-coop-name', c, abt(`part.${id}`));
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

  /** 描画フレームごと。shown は HUD を出す（H キー）。locked はロック中の部位。coop は協力の印（ソロは null） */
  update(
    raid: AlbionRaid,
    shown: boolean,
    locked: AlbionPartTarget | null,
    inCloud: boolean,
    coop: Readonly<AlbionCoopFrame> | null = null,
  ): void {
    const k = raid.kaiju;
    const visible = shown && !raid.dead && k.body.visible;
    this.root.hidden = !visible;
    this.notify(raid);
    if (!visible) return;
    const targeted = coop?.targeted ?? false;
    if (targeted !== this.lastTarget) {
      this.lastTarget = targeted;
      this.target.hidden = !targeted;
    }
    const ratio = k.parts.ratio;
    if (ratio !== this.last.hp) {
      this.last.hp = ratio;
      this.fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }
    const phase = `${abt('phase', { phase: k.phase, time: formatClock(raid.timeLeft) })}  ${abt(
      'minions',
      { n: k.swarm.activeCount },
    )}`;
    if (phase !== this.last.phase) {
      this.last.phase = phase;
      this.phase.textContent = phase;
      this.phase.classList.toggle('is-final', k.phase >= 3);
    }
    this.setPart(raid, locked);
    for (const id of CHIPS) {
      const c = this.chips.get(id);
      if (!c) continue;
      const i = ALBION_PARTS.indexOf(id);
      c.fill.style.transform = `scaleX(${k.parts.partRatio(i).toFixed(3)})`;
      c.root.classList.toggle('is-broken', k.parts.isBroken(i));
      c.root.classList.toggle('is-own', locked?.id === id);
      const colors = coop?.marks.get(id) ?? [];
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
    const warn = albionWarning(raid);
    if (warn !== this.last.warn) {
      this.last.warn = warn;
      this.warning.textContent = warn;
      this.warning.hidden = warn === '';
    }
    const open = inCloud ? abt('inCloud') : albionOpening(raid);
    if (open !== this.last.open) {
      this.last.open = open;
      this.opening.textContent = open;
      this.opening.hidden = open === '';
    }
  }

  private setPart(raid: AlbionRaid, p: AlbionPartTarget | null): void {
    const label = p ? abt(`part.${p.id}`) : '';
    const name = p?.broken ? abt('partBroken', { part: label }) : label;
    if (name !== this.last.part) {
      this.last.part = name;
      this.partName.textContent = name;
      this.partRow.hidden = name === '';
      this.partRow.classList.toggle('is-broken', p?.broken ?? false);
    }
    // 胴は部位 HP が無いので全体の体力
    const hp = p ? (p.id === 'body' ? raid.kaiju.parts.ratio : Math.max(0, p.hp / p.maxHp)) : 0;
    if (hp !== this.last.partHp) {
      this.last.partHp = hp;
      this.partFill.style.transform = `scaleX(${hp.toFixed(4)})`;
    }
  }

  /** 部位の破壊・段階の変化をお知らせに（出した直後・リプレイのシークで一度に来た分は最後の 1 つだけ） */
  private notify(raid: AlbionRaid): void {
    const k = raid.kaiju;
    const count = raid.brokenCount;
    if (this.seenBroken < 0 || count < this.seenBroken) {
      this.seenBroken = count;
      this.seenPhase = k.phase;
      return;
    }
    if (count > this.seenBroken) {
      const last = k.parts.brokenOrder[count - 1] ?? 0;
      const id = ALBION_PARTS[last] ?? 'body';
      const nests = id.startsWith('nest') && k.nestsGone;
      showToast(abt(nests ? 'broken.nests' : `broken.${id}`), { seconds: TOAST_SECONDS });
      this.seenBroken = count;
    }
    if (k.phase > this.seenPhase && raid.raid)
      showToast(abt(k.phase >= 3 ? 'phase3' : 'phase2'), { seconds: TOAST_SECONDS });
    this.seenPhase = k.phase;
  }
}
