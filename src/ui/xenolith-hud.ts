// 10-5b: UFO ゼノリスのレイドの HUD（ゼノリスの遅延チャンク）。見た目はほかの怪獣の HUD（kaiju-hud.css）と同じ部品: 上の帯に名前・
// 体力バー（段階 2 の 60%・段階 3 の 30% の目盛り）・段階と残り時間・バリア（外れている間は残り秒）・次の光線までの秒、ロック中の部位と
// 部位 HP（バリアで効かない間はそう書く）、壊せる 9 部位の小さなバー（ドーム・砲口・発光体 4・発生器 3）。予兆の警告（LOCK は
// 自分が狙われている間は赤く点滅・なぎ払い・光の弾・瞬間移動の残り秒と避け方）、攻めどき（バリアが外れた・止まった）。
// 部位の破壊・段階の変化は上のお知らせに。協力では部位をロックしている他の人の色の印と、狙われているときの「TARGET」
import { t } from '../core/i18n';
import {
  XENOLITH_CONFIG as C,
  XENOLITH_GENS,
  XENOLITH_PARTS,
  type XenolithPart,
} from '../data/xenolith';
import { xnt } from '../data/xenolith-text';
import type { XenolithPartTarget } from '../entities/xenolith/xenolith-target';
import type { XenolithRaid } from '../missions/xenolith-raid';
import { el } from './hud-dom';
import { formatClock } from './mission-text';
import { showToast } from './toast';

const TOAST_SECONDS = 3.5;
const CHIPS: readonly XenolithPart[] = [
  'dome',
  'cannon',
  'emitter0',
  'emitter1',
  'emitter2',
  'emitter3',
  'gen0',
  'gen1',
  'gen2',
];
const PART = (id: XenolithPart): number => XENOLITH_PARTS.indexOf(id);

interface Chip {
  readonly root: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly marks: HTMLSpanElement;
  lastMarks: string;
}

/** 協力の 1 フレーム分の値（部位の名前 → ロックしている他の人の色。自分は入れない） */
export interface XenolithCoopFrame {
  readonly marks: ReadonlyMap<string, readonly string[]>;
  readonly targeted: boolean;
}

/** 予兆の警告（文と、自分が LOCK されているか）。無ければ文は '' */
export interface XenolithWarning {
  readonly text: string;
  readonly lock: boolean;
}

const NONE: XenolithWarning = { text: '', lock: false };
const f1 = (n: number): string => Math.max(0, n).toFixed(1);

/**
 * 予兆の警告: 光線（溜め撃ちは自分が狙われているときだけ LOCK。ほかの人なら一言）> 瞬間移動 > 光の弾。me は自分のプレイヤー ID
 * （ソロは 0）。なぎ払いは撃つ間も出す
 */
export function xenolithWarning(raid: XenolithRaid, me = 0): XenolithWarning {
  const k = raid.kaiju;
  if (raid.dead || !k.body.visible) return NONE;
  const beam = k.beam;
  if (beam.busy && beam.phase !== 'recover') {
    if (beam.kind === 'sweep') {
      if (beam.phase === 'fire')
        return { text: `⚠ ${xnt('attack.sweep')}  ${xnt('active.sweep')}`, lock: false };
      return {
        text: `⚠ ${xnt('attack.sweep')}  ${f1(beam.untilFire)}  ${xnt('warn.sweep')}`,
        lock: false,
      };
    }
    const mine = beam.targetId === me;
    if (!mine)
      return { text: `⚠ ${xnt('attack.charged')}  ${xnt('warn.chargedOther')}`, lock: false };
    if (beam.phase === 'fire')
      return { text: `⚠ ${xnt('attack.charged')}  ${xnt('active.charged')}`, lock: true };
    const key = beam.phase === 'charge' ? 'warn.charge' : 'warn.charged';
    return { text: `⚠ ${xnt('attack.charged')}  ${f1(beam.untilFire)}  ${xnt(key)}`, lock: true };
  }
  if (k.warp.phase === 'telegraph')
    return {
      text: `⚠ ${xnt('attack.warp')}  ${f1(k.untilWarp)}  ${xnt('warn.warp')}`,
      lock: false,
    };
  if (k.orbPhase === 'warn')
    return {
      text: `⚠ ${xnt('attack.orbs')}  ${f1(C.orbs.warn - k.orbTime)}  ${xnt('warn.orbs')}`,
      lock: false,
    };
  return NONE;
}

/** 自分が溜め撃ちに狙われている（ロック警告・溜め。警告音） */
export function xenolithLockedOn(raid: XenolithRaid, me = 0): boolean {
  const b = raid.kaiju.beam;
  return (
    !raid.dead &&
    b.kind === 'charged' &&
    (b.phase === 'warn' || b.phase === 'charge') &&
    b.targetId === me
  );
}

/** 攻めどきの文（バリアが外れている残り秒・急停止で止まった）。無ければ '' */
export function xenolithOpening(raid: XenolithRaid): string {
  const k = raid.kaiju;
  if (raid.dead) return '';
  const bar = k.barrier;
  if (!bar.absorbs) {
    const busy = k.beam.busy && k.beam.phase !== 'warn';
    const left = busy
      ? k.beam.spec.fire + k.beam.spec.recover + bar.spec.down
      : bar.spec.down - bar.time;
    return xnt('opening.down', { t: f1(left) });
  }
  if (k.body.move === 'stop' && k.brokenGens < XENOLITH_GENS.length) return xnt('opening.stop');
  return '';
}

export class XenolithHud {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly phase: HTMLSpanElement;
  private readonly partRow: HTMLDivElement;
  private readonly partName: HTMLSpanElement;
  private readonly partFill: HTMLDivElement;
  private readonly chips = new Map<XenolithPart, Chip>();
  private readonly warning: HTMLDivElement;
  private readonly opening: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private lastTarget = false;
  private last = { hp: NaN, phase: '', part: '', partHp: NaN, warn: '', lock: false, open: '' };
  /** お知らせを比べる前の値 */
  private seenBroken = -1;
  private seenStage = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'kaiju-hud xenolith-hud', parent);
    this.root = root;
    const top = el('div', 'kaiju-top', root);
    const head = el('div', 'kaiju-head', top);
    el('span', 'kaiju-name', head, xnt('hudName'));
    this.phase = el('span', 'kaiju-phase', head);
    const bar = el('div', 'kaiju-bar', top);
    this.fill = el('div', 'kaiju-bar-fill', bar);
    for (const at of [C.stages.stage2, C.stages.stage3]) {
      const tick = el('div', 'kaiju-bar-tick', bar);
      tick.style.left = `${at * 100}%`;
    }
    this.partRow = el('div', 'kaiju-part', top);
    this.partName = el('span', 'kaiju-part-name', this.partRow);
    const pbar = el('div', 'kaiju-part-bar', this.partRow);
    this.partFill = el('div', 'kaiju-part-fill', pbar);
    const list = el('div', 'kaiju-coop', top);
    for (const id of CHIPS) {
      const c = el('div', 'kaiju-coop-part', list);
      el('span', 'kaiju-coop-name', c, xnt(`chip.${id}`));
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

  /**
   * 描画フレームごと。shown は HUD を出す（H キー）。locked はロック中の部位。coop は協力の印（ソロは null）。me は自分のプレイヤー ID
   */
  update(
    raid: XenolithRaid,
    shown: boolean,
    locked: XenolithPartTarget | null,
    coop: Readonly<XenolithCoopFrame> | null = null,
    me = 0,
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
    const open = !k.barrier.absorbs;
    const beam = k.beam;
    const phase = [
      xnt('phase', { phase: k.stage, time: formatClock(raid.timeLeft) }),
      open ? xnt('barrierDown') : xnt('barrierUp'),
      beam.busy ? xnt('beamNow') : xnt('nextBeam', { t: Math.ceil(Math.max(0, k.cooldown)) }),
    ].join('  ');
    if (phase !== this.last.phase) {
      this.last.phase = phase;
      this.phase.textContent = phase;
      this.phase.classList.toggle('is-final', k.stage >= 3);
      this.phase.classList.toggle('is-open', open);
    }
    this.setPart(raid, locked);
    for (const id of CHIPS) {
      const c = this.chips.get(id);
      if (!c) continue;
      const i = PART(id);
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
    const warn = xenolithWarning(raid, me);
    if (warn.text !== this.last.warn || warn.lock !== this.last.lock) {
      this.last.warn = warn.text;
      this.last.lock = warn.lock;
      this.warning.textContent = warn.text;
      this.warning.hidden = warn.text === '';
      this.warning.classList.toggle('is-lock', warn.lock);
    }
    const opening = xenolithOpening(raid);
    if (opening !== this.last.open) {
      this.last.open = opening;
      this.opening.textContent = opening;
      this.opening.hidden = opening === '';
    }
  }

  private setPart(raid: XenolithRaid, p: XenolithPartTarget | null): void {
    const k = raid.kaiju;
    const label = p ? xnt(`part.${p.id}`) : '';
    const shielded = p !== null && !p.broken && k.barrier.absorbs && !k.outsideBarrier(p.sphere);
    const name = p?.broken
      ? xnt('partBroken', { part: label })
      : shielded
        ? xnt('partShielded', { part: label })
        : label;
    if (name !== this.last.part) {
      this.last.part = name;
      this.partName.textContent = name;
      this.partRow.hidden = name === '';
      this.partRow.classList.toggle('is-broken', p?.broken ?? false);
    }
    // 胴（と壊れたドーム）は部位 HP が無いので全体の体力
    const whole = p?.id === 'hull' || (p?.id === 'dome' && p.broken);
    const hp = p ? (whole ? k.parts.ratio : Math.max(0, p.hp / p.maxHp)) : 0;
    if (hp !== this.last.partHp) {
      this.last.partHp = hp;
      this.partFill.style.transform = `scaleX(${hp.toFixed(4)})`;
    }
  }

  /** 部位の破壊・段階の変化をお知らせに（出した直後・リプレイのシークで一度に来た分は最後の 1 つだけ） */
  private notify(raid: XenolithRaid): void {
    const k = raid.kaiju;
    const count = raid.brokenCount;
    if (this.seenBroken < 0 || count < this.seenBroken) {
      this.seenBroken = count;
      this.seenStage = k.stage;
      return;
    }
    if (count > this.seenBroken) {
      const last = k.parts.brokenOrder[count - 1] ?? 0;
      const id = XENOLITH_PARTS[last] ?? 'hull';
      showToast(brokenText(raid, id), { seconds: TOAST_SECONDS });
      this.seenBroken = count;
    }
    if (k.stage > this.seenStage && raid.raid)
      showToast(xnt(`stage${String(k.stage)}`), { seconds: TOAST_SECONDS });
    this.seenStage = k.stage;
  }
}

function brokenText(raid: XenolithRaid, id: XenolithPart): string {
  const k = raid.kaiju;
  if (id.startsWith('emitter')) {
    const left = 4 - k.brokenEmitters;
    return left <= 0 ? xnt('broken.emitters') : xnt('broken.emitter', { n: left });
  }
  if (id.startsWith('gen')) {
    const left = 3 - k.brokenGens;
    return left <= 0 ? xnt('broken.gens') : xnt('broken.gen', { n: left });
  }
  return xnt(`broken.${id}`);
}
