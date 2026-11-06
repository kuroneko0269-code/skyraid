// レイドの怪獣選び（9-10d。モード選択の「レイド」で開く全画面のダイアログ。6-2 / 6-6 / 9-6b のダイアログを作り直した）:
// - 左半分: 怪獣の大きな画像（src/data/kaiju-profiles.ts の art）。上に怪獣の切り替えと「‹ 戻る」、下の帯に英字の名前・名前・一言
// - 右半分: 概要の札 3 つ（大きさ・動き方・部位）、攻撃の札、攻めどき、難易度（通常・高難度）と残機・自己ベスト、
//   「協力 2〜4 人」「ソロで出撃」（ソロが主のボタン）
// 怪獣はデータ（KAIJU_PROFILES）から並べる。ヴォルガスと、登録された別の怪獣（raid-variants）だけを出す
import { t } from '../core/i18n';
import { KAIJU_PROFILES, type KaijuProfile } from '../data/kaiju-profiles';
import { RAID_DIFFICULTY_LABELS, RAID_RULES, type RaidDifficulty } from '../data/raid';
import { raidKaijuName, VORGAS_ID, type RaidKaijuId } from '../data/raid-kaiju';
import { findRaidVariant } from '../missions/raid-variants';
import { el } from './hud-dom';
import { createButton } from './screen';
import { Segmented } from './segmented';
import './raid-select.css';

export interface RaidSelectHandlers {
  readonly onBack: () => void;
  readonly onCoop: (kaiju: RaidKaijuId) => void;
  readonly onSolo: (kaiju: RaidKaijuId, difficulty: RaidDifficulty) => void;
  /** 自己ベスト（撃破までの最短の表示。無ければ null） */
  readonly best: (kaiju: RaidKaijuId, difficulty: RaidDifficulty) => string | null;
  /** 怪獣を選んだ（ネフィルガの先読み） */
  readonly onPick: (kaiju: RaidKaijuId) => void;
}

/** 選べる怪獣（ヴォルガスと、登録された怪獣） */
export function availableKaiju(): readonly KaijuProfile[] {
  return KAIJU_PROFILES.filter((p) => p.id === VORGAS_ID || findRaidVariant(p.id) !== null);
}

export class RaidSelect {
  readonly wrap: HTMLDivElement;
  readonly soloButton: HTMLButtonElement;
  kaiju: RaidKaijuId = VORGAS_ID;
  difficulty: RaidDifficulty = 'normal';
  private readonly box: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly kaijuSlot: HTMLDivElement;
  private kaijuSeg: Segmented | null = null;
  private kaijuCount = 0;
  private readonly latin: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly tagline: HTMLDivElement;
  private readonly summary: Record<'size' | 'motion' | 'parts', HTMLDivElement>;
  private readonly attacks: HTMLDivElement;
  private readonly opening: HTMLParagraphElement;
  private readonly diff: Segmented;
  private readonly lives: HTMLSpanElement;
  private readonly best: HTMLSpanElement;
  private readonly diffNote: HTMLParagraphElement;

  constructor(
    root: HTMLElement,
    private readonly h: RaidSelectHandlers,
  ) {
    this.wrap = el('div', 'mode-prompt raid-select-wrap', root);
    this.wrap.hidden = true;
    const box = el('div', 'ui-dialog mode-prompt-box raid-select', this.wrap);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', t('modes.raid.label'));
    this.box = box;

    // 左: 画像
    const art = el('div', 'raid-art', box);
    this.img = el('img', 'raid-art-img', art);
    this.img.alt = '';
    this.img.decoding = 'async';
    const top = el('div', 'raid-art-top', art);
    createButton(top, 'ui-button is-ghost raid-back', t('raidSelect.back'), h.onBack);
    this.kaijuSlot = el('div', 'raid-kaiju-slot', top);
    const band = el('div', 'raid-art-band', art);
    this.latin = el('div', 'raid-art-latin', band);
    this.name = el('div', 'raid-art-name', band);
    this.tagline = el('div', 'raid-art-tagline', band);

    // 右: 概要・攻撃・攻めどき・難易度・出撃
    const info = el('div', 'raid-info', box);
    const summary = el('div', 'raid-summary', info);
    const card = (key: 'size' | 'motion' | 'parts'): HTMLDivElement => {
      const c = el('div', 'raid-summary-card', summary);
      el('div', 'raid-card-label', c, t(`raidSelect.${key}`));
      return el('div', 'raid-summary-value', c);
    };
    this.summary = { size: card('size'), motion: card('motion'), parts: card('parts') };
    const attacks = el('div', 'raid-block', info);
    el('div', 'raid-card-label', attacks, t('raidSelect.attacks'));
    this.attacks = el('div', 'raid-attacks', attacks);
    const opening = el('div', 'raid-block raid-opening', info);
    el('div', 'raid-card-label', opening, t('raidSelect.opening'));
    this.opening = el('p', 'raid-opening-text', opening);
    const diffRow = el('div', 'raid-difficulty', info);
    this.diff = new Segmented(
      diffRow,
      t('raidSelect.difficulty'),
      (['normal', 'hard'] as const).map((d) => ({ value: d, label: RAID_DIFFICULTY_LABELS[d] })),
      this.difficulty,
      (v) => {
        this.difficulty = v === 'hard' ? 'hard' : 'normal';
        this.syncDifficulty();
      },
      'raid-diff-seg',
    );
    const stats = el('div', 'raid-diff-stats', diffRow);
    this.lives = el('span', 'raid-lives', stats);
    this.best = el('span', 'raid-best', stats);
    this.diffNote = el('p', 'raid-diff-note', info);
    const buttons = el('div', 'raid-actions', info);
    const coop = createButton(buttons, 'ui-button raid-coop', t('modes.dialog.coop'), () => {
      h.onCoop(this.kaiju);
    });
    coop.title = t('raidSelect.coopNote');
    this.soloButton = createButton(
      buttons,
      'ui-button is-primary raid-solo',
      t('modes.dialog.solo'),
      () => {
        h.onSolo(this.kaiju, this.difficulty);
      },
    );
  }

  /** 開く前に: 怪獣の切り替え（登録された怪獣が増えていれば作り直す）と中身を合わせる */
  sync(): void {
    const list = availableKaiju();
    if (!list.some((p) => p.id === this.kaiju)) this.kaiju = VORGAS_ID;
    if (list.length !== this.kaijuCount) {
      this.kaijuCount = list.length;
      this.kaijuSlot.replaceChildren();
      this.kaijuSeg =
        list.length > 1
          ? new Segmented(
              this.kaijuSlot,
              '',
              list.map((p) => ({ value: p.id, label: raidKaijuName(p.id) })),
              this.kaiju,
              (v) => {
                const p = list.find((x) => x.id === v);
                if (!p) return;
                this.kaiju = p.id;
                this.render();
                this.h.onPick(p.id);
              },
              'raid-kaiju-seg',
            )
          : null;
    }
    if (this.kaijuSeg) this.kaijuSeg.value = this.kaiju;
    this.diff.value = this.difficulty;
    this.render();
  }

  private render(): void {
    const p = KAIJU_PROFILES.find((x) => x.id === this.kaiju) ?? KAIJU_PROFILES[0];
    if (!p) return;
    const k = `raidSelect.kaiju.${p.id}`;
    this.box.dataset.kaiju = p.id;
    // 画像は public/ からの相対（Vite の base に合わせる）
    this.img.src = `${import.meta.env.BASE_URL}${p.art}`;
    this.img.style.objectPosition = p.focus;
    this.latin.textContent = p.latinName;
    const name = raidKaijuName(p.id);
    this.name.textContent = name;
    // 英語では名前が英字の名前と同じなので出さない
    this.name.hidden = name.toUpperCase() === p.latinName;
    this.tagline.textContent = t(`${k}.tagline`);
    this.summary.size.textContent = t(`${k}.size`);
    this.summary.motion.textContent = t(`${k}.motion`);
    this.summary.parts.textContent = t(`${k}.parts`);
    this.attacks.replaceChildren();
    for (const a of p.attacks) {
      const c = el('div', 'raid-attack', this.attacks);
      el('div', 'raid-attack-name', c, t(`${k}.attacks.${a}.name`));
      el('div', 'raid-attack-note', c, t(`${k}.attacks.${a}.note`));
    }
    this.opening.textContent = t(`${k}.opening`);
    this.syncDifficulty();
  }

  private syncDifficulty(): void {
    const d = this.difficulty;
    this.lives.textContent = t('raidSelect.lives', { count: String(RAID_RULES.lives[d]) });
    const best = this.h.best(this.kaiju, d);
    this.best.textContent = best ? t('raidSelect.best', { time: best }) : t('raidSelect.noBest');
    this.diffNote.textContent = t(`raidSelect.kaiju.${this.kaiju}.${d}`);
    this.box.dataset.difficulty = d;
  }
}
