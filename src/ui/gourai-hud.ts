// 10-4b: メカ怪獣ゴウライのレイドの HUD（ゴウライの遅延チャンク）。見た目はヴォルガス・ネフィルガ・アルビオンの HUD（kaiju-hud.css）と
// 同じ部品: 上の帯に名前・体力バー（後半の 40% の目盛り）・段階と残り時間・熱・生きている砲台の数、ロック中の部位と部位 HP、
// 壊せる 9 部位の小さなバー（核・砲台 6・排気口 2。ロック中は枠）。予兆の警告（攻撃名・避け方・残り秒。回転掃射は攻撃の間も）、
// 攻めどき（放熱・装甲を捨てる間・大きな攻撃の後の隙）。ミサイルの警告は今の HUD の MISSILE（追ってくるミサイルを数える）。
// 部位の破壊・段階の変化・放熱は上のお知らせに。協力では部位をロックしている他の人の色の印と、狙われているときの「TARGET」
import { t } from '../core/i18n';
import { attackTimes } from '../ai/gourai-attacks';
import { GOURAI_CONFIG as C, GOURAI_PARTS, type GouraiPart } from '../data/gourai';
import { grt } from '../data/gourai-text';
import type { GouraiPartTarget } from '../entities/gourai/gourai-target';
import type { GouraiRaid } from '../missions/gourai-raid';
import { el } from './hud-dom';
import { formatClock } from './mission-text';
import { showToast } from './toast';

const TOAST_SECONDS = 3.5;
const CHIPS: readonly GouraiPart[] = [
  'core',
  'gunL',
  'gunR',
  'hipL',
  'hipR',
  'podL',
  'podR',
  'exhaustL',
  'exhaustR',
];
const TURRET_PARTS = new Set<string>(['gunL', 'gunR', 'podL', 'podR', 'hipL', 'hipR']);

interface Chip {
  readonly root: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly marks: HTMLSpanElement;
  lastMarks: string;
}

/** 協力の 1 フレーム分の値（部位の名前 → ロックしている他の人の色。自分は入れない） */
export interface GouraiCoopFrame {
  readonly marks: ReadonlyMap<string, readonly string[]>;
  readonly targeted: boolean;
}

/** 予兆の警告の文（攻撃名・残り秒・避け方）。回転掃射は攻撃の間も出す。無ければ '' */
export function gouraiWarning(raid: GouraiRaid): string {
  const k = raid.kaiju;
  if (raid.dead || k.attack === null) return '';
  if (k.action === 'active' && k.attack === 'sweep')
    return `⚠ ${grt('attack.sweep')}  ${grt('active.sweep')}`;
  if (k.action !== 'windup') return '';
  const left = Math.max(0, attackTimes(k.attack).windup - k.actionTime);
  return `⚠ ${grt(`attack.${k.attack}`)}  ${left.toFixed(1)}  ${grt(`warn.${k.attack}`)}`;
}

/** 攻めどきの文（放熱・装甲を捨てる間・大きな攻撃の後の隙）。無ければ '' */
export function gouraiOpening(raid: GouraiRaid): string {
  const k = raid.kaiju;
  if (raid.dead) return '';
  if (k.action === 'vent') {
    const left = k.actionLeft.toFixed(1);
    return grt(k.phase === 1 ? 'opening.vent' : 'opening.ventLate', { t: left });
  }
  if (k.action === 'purge') return grt('opening.purge');
  if (k.action === 'recover') return grt('opening.recover');
  return '';
}

export class GouraiHud {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly phase: HTMLSpanElement;
  private readonly partRow: HTMLDivElement;
  private readonly partName: HTMLSpanElement;
  private readonly partFill: HTMLDivElement;
  private readonly chips = new Map<GouraiPart, Chip>();
  private readonly warning: HTMLDivElement;
  private readonly opening: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private lastTarget = false;
  private last = { hp: NaN, phase: '', part: '', partHp: NaN, warn: '', open: '' };
  /** お知らせを比べる前の値 */
  private seenBroken = -1;
  private seenPhase = 0;
  private seenVents = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'kaiju-hud gourai-hud', parent);
    this.root = root;
    const top = el('div', 'kaiju-top', root);
    const head = el('div', 'kaiju-head', top);
    el('span', 'kaiju-name', head, grt('hudName'));
    this.phase = el('span', 'kaiju-phase', head);
    const bar = el('div', 'kaiju-bar', top);
    this.fill = el('div', 'kaiju-bar-fill', bar);
    const tick = el('div', 'kaiju-bar-tick', bar);
    tick.style.left = `${C.phases.purgeAt * 100}%`;
    this.partRow = el('div', 'kaiju-part', top);
    this.partName = el('span', 'kaiju-part-name', this.partRow);
    const pbar = el('div', 'kaiju-part-bar', this.partRow);
    this.partFill = el('div', 'kaiju-part-fill', pbar);
    const list = el('div', 'kaiju-coop', top);
    for (const id of CHIPS) {
      const c = el('div', 'kaiju-coop-part', list);
      el('span', 'kaiju-coop-name', c, grt(`chip.${id}`));
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
    raid: GouraiRaid,
    shown: boolean,
    locked: GouraiPartTarget | null,
    coop: Readonly<GouraiCoopFrame> | null = null,
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
    const heat = Math.round((k.heat / C.heat.max) * 100);
    const phase = [
      grt('phase', { phase: k.phase, time: formatClock(raid.timeLeft) }),
      grt('heat', { n: heat }),
      grt('turrets', { n: k.turretsAlive }),
    ].join('  ');
    if (phase !== this.last.phase) {
      this.last.phase = phase;
      this.phase.textContent = phase;
      this.phase.classList.toggle('is-final', k.phase >= 2 || heat >= 80);
    }
    this.setPart(raid, locked);
    for (const id of CHIPS) {
      const c = this.chips.get(id);
      if (!c) continue;
      const i = GOURAI_PARTS.indexOf(id);
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
    const warn = gouraiWarning(raid);
    if (warn !== this.last.warn) {
      this.last.warn = warn;
      this.warning.textContent = warn;
      this.warning.hidden = warn === '';
    }
    const open = gouraiOpening(raid);
    if (open !== this.last.open) {
      this.last.open = open;
      this.opening.textContent = open;
      this.opening.hidden = open === '';
    }
  }

  private setPart(raid: GouraiRaid, p: GouraiPartTarget | null): void {
    const label = p ? grt(`part.${p.id}`) : '';
    const name = p?.broken ? grt('partBroken', { part: label }) : label;
    if (name !== this.last.part) {
      this.last.part = name;
      this.partName.textContent = name;
      this.partRow.hidden = name === '';
      this.partRow.classList.toggle('is-broken', p?.broken ?? false);
    }
    // 胴・前の装甲は部位 HP が無いので全体の体力
    const whole = p?.id === 'hull' || p?.id === 'armor';
    const hp = p ? (whole ? raid.kaiju.parts.ratio : Math.max(0, p.hp / p.maxHp)) : 0;
    if (hp !== this.last.partHp) {
      this.last.partHp = hp;
      this.partFill.style.transform = `scaleX(${hp.toFixed(4)})`;
    }
  }

  /** 部位の破壊・段階の変化・放熱をお知らせに（出した直後・リプレイのシークで一度に来た分は最後の 1 つだけ） */
  private notify(raid: GouraiRaid): void {
    const k = raid.kaiju;
    const count = raid.brokenCount;
    if (this.seenBroken < 0 || count < this.seenBroken) {
      this.seenBroken = count;
      this.seenPhase = k.phase;
      this.seenVents = k.vents;
      return;
    }
    if (count > this.seenBroken) {
      const last = k.parts.brokenOrder[count - 1] ?? 0;
      const id = GOURAI_PARTS[last] ?? 'hull';
      const all = TURRET_PARTS.has(id) && k.turretsAlive === 0;
      showToast(grt(all ? 'broken.turrets' : `broken.${id}`), { seconds: TOAST_SECONDS });
      this.seenBroken = count;
    }
    if (k.phase > this.seenPhase && raid.raid) showToast(grt('phase2'), { seconds: TOAST_SECONDS });
    this.seenPhase = k.phase;
    if (k.vents > this.seenVents && raid.raid && k.phase === 1)
      showToast(grt('vent'), { seconds: 2.5 });
    this.seenVents = k.vents;
  }
}
