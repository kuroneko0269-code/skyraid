// ハンガーの「塗装」タブ（7-3）: パターン 8 種・色（基本 / アクセント / マーキング）・デカール（主翼 / 垂直尾翼、置き方の
// スライダー）・機体番号。変えるとすぐ展示の機体に反映する（onPreview）。持っていないパターン・デカールは試し塗りだけで、
// 購入ボタンで買う（価格はパターン・デカールの単位、全機体共通）。色・番号・置き方は無料ですぐ保存する
import './paint.css';
import { UI_SOUND_EVENTS } from '../data/audio';
import {
  DECALS,
  SKIN_CONFIG,
  SKIN_PATTERNS,
  findDecal,
  findSkinPattern,
  type DecalId,
  type DecalSlot,
} from '../data/skins';
import { clonePaint, type Paint } from '../progression/paint';
import { unlockLabel, type Paintshop } from '../progression/paintshop';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { PaintSlider, SwatchRow, decalIcon, setDecalIcon } from './paint-parts';
import { createButton } from './screen';
import { Segmented } from './segmented';

export interface PaintPanelHandlers {
  /** 試し塗り（展示の機体に反映する） */
  onPreview: (paint: Readonly<Paint>) => void;
  /** 購入した（残高の表示を直す） */
  onPurchase: () => void;
}

const two = (n: number): string => String(n).padStart(2, '0');
const SLOT_LABELS: Readonly<Record<DecalSlot, string>> = { wing: '主翼', fin: '垂直尾翼' };

export class PaintPanel {
  readonly root: HTMLDivElement;
  private aircraftId = '';
  /** 試し塗りの塗装（持っていないものも入る） */
  private draft: Paint | null = null;
  private slot: DecalSlot = 'wing';
  private readonly patterns = new Map<
    string,
    { button: HTMLButtonElement; status: HTMLSpanElement }
  >();
  private readonly decals = new Map<
    DecalId | 'none',
    { button: HTMLButtonElement; status: HTMLSpanElement; icon: SVGSVGElement }
  >();
  private readonly buyPattern: HTMLButtonElement;
  private readonly buyDecal: HTMLButtonElement;
  private readonly base: SwatchRow;
  private readonly accent: SwatchRow;
  private readonly marking: SwatchRow;
  private readonly slotSeg: Segmented;
  private readonly sliders: Record<'x' | 'y' | 'size' | 'rotation', PaintSlider>;
  private readonly numberText: HTMLSpanElement;
  private readonly notice: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly shop: Paintshop,
    private readonly handlers: PaintPanelHandlers,
  ) {
    const root = el('div', 'paint-panel', parent);
    el('div', 'campaign-label', root, 'パターン（全機体共通で解放）');
    const grid = el('div', 'paint-grid', root);
    for (const p of SKIN_PATTERNS) {
      const button = createButton(grid, 'ui-button ui-item paint-item', '', () => {
        this.edit((d) => (d.pattern = p.id));
      });
      el('span', 'paint-item-name', button, p.name);
      const status = el('span', 'paint-item-status', button);
      this.patterns.set(p.id, { button, status });
    }
    this.buyPattern = createButton(root, 'ui-button is-primary paint-buy', '', () => {
      this.buy('pattern');
    });

    const color = (key: 'base' | 'accent' | 'marking') => (i: number) => {
      this.edit((d) => (d[key] = i));
    };
    this.base = new SwatchRow(root, '基本色', color('base'));
    this.accent = new SwatchRow(root, 'アクセント', color('accent'));
    this.marking = new SwatchRow(root, 'マーキング', color('marking'));

    el('div', 'campaign-label', root, 'デカール（500 CR・全機体共通）');
    this.slotSeg = new Segmented(
      root,
      '',
      [
        { value: 'wing', label: SLOT_LABELS.wing },
        { value: 'fin', label: SLOT_LABELS.fin },
      ],
      'wing',
      (v) => {
        this.slot = v === 'fin' ? 'fin' : 'wing';
        this.refresh();
      },
      'paint-slot',
    );
    const decalGrid = el('div', 'paint-decals', root);
    for (const d of [null, ...DECALS]) {
      const key = d?.id ?? 'none';
      const button = createButton(decalGrid, 'ui-button ui-item paint-decal', '', () => {
        this.edit((p) => (p[this.slot].decal = d?.id ?? null));
      });
      const icon = decalIcon(button, d?.id ?? null, 0);
      el('span', 'paint-item-name', button, d?.name ?? 'なし');
      const status = el('span', 'paint-item-status', button);
      button.setAttribute('aria-label', d?.name ?? 'なし');
      this.decals.set(key, { button, status, icon });
    }
    this.buyDecal = createButton(root, 'ui-button is-primary paint-buy', '', () => {
      this.buy('decal');
    });
    const commit = (): void => {
      this.save();
    };
    const slide = (key: 'x' | 'y' | 'size' | 'rotation') => (v: number) => {
      this.edit((p) => (p[this.slot][key] = v), false);
    };
    const pct = (v: number): string => `${Math.round((v / 255) * 100)}%`;
    this.sliders = {
      x: new PaintSlider(root, '位置（横）', pct, slide('x'), commit),
      y: new PaintSlider(root, '位置（縦）', pct, slide('y'), commit),
      size: new PaintSlider(root, '大きさ', pct, slide('size'), commit),
      rotation: new PaintSlider(
        root,
        '回転',
        (v) => `${Math.round((v / 256) * 360 - 180)}°`,
        slide('rotation'),
        commit,
      ),
    };

    const numRow = el('div', 'paint-row paint-number', root);
    el('span', 'paint-row-label', numRow, '機体番号');
    const step = (d: number) => () => {
      this.edit((p) => (p.number = (p.number + d + 100) % 100), true);
    };
    createButton(numRow, 'ui-button paint-step', '−', step(-1));
    this.numberText = el('span', 'paint-number-value', numRow);
    createButton(numRow, 'ui-button paint-step', '+', step(1));
    createButton(numRow, 'ui-button is-ghost paint-random', 'ランダム', () => {
      this.edit((p) => (p.number = Math.floor(Math.random() * (SKIN_CONFIG.numberMax + 1))), true);
    });
    this.notice = el('div', 'hangar-notice paint-notice', root);
    this.root = root;
  }

  /** 見ている機体を変える（保存済みの塗装から試し塗りを始め直す） */
  setAircraft(id: string): void {
    this.aircraftId = id;
    this.draft = this.shop.paint(id);
    this.notice.textContent = '';
    this.refresh();
    this.handlers.onPreview(clonePaint(this.draft));
  }

  /** 試し塗りを捨てて保存済みの塗装に戻す（タブ・画面を離れるとき）。保存済みを返す */
  revert(): Paint | null {
    if (!this.aircraftId) return null;
    this.draft = this.shop.paint(this.aircraftId);
    this.refresh();
    return this.draft;
  }

  get current(): Readonly<Paint> | null {
    return this.draft;
  }

  /** 試し塗りを変える。commit なら保存もする（スライダーは離したときに保存） */
  private edit(fn: (p: Paint) => void, commit = true): void {
    const d = this.draft;
    if (!d) return;
    fn(d);
    // 展示は同じ入れ物を渡すと変化を見ないので複製を渡す
    this.handlers.onPreview(clonePaint(d));
    if (commit) this.save();
    this.refresh();
  }

  /** 持っている部分だけ保存する（持っていないパターン・デカールは保存済みのまま） */
  private save(): void {
    const d = this.draft;
    if (!d) return;
    const saved = this.shop.paint(this.aircraftId);
    const next = clonePaint(d);
    if (this.shop.patternStatus(d.pattern) !== 'owned') next.pattern = saved.pattern;
    for (const s of ['wing', 'fin'] as const) {
      const id = d[s].decal;
      if (id !== null && this.shop.decalStatus(id) !== 'owned') next[s].decal = saved[s].decal;
    }
    this.shop.setPaint(this.aircraftId, next);
  }

  private buy(kind: 'pattern' | 'decal'): void {
    const d = this.draft;
    if (!d) return;
    const id = d[this.slot].decal;
    if (kind === 'decal' && id === null) return;
    const name =
      kind === 'pattern'
        ? (findSkinPattern(d.pattern)?.name ?? '')
        : (findDecal(id ?? '')?.name ?? '');
    const result =
      kind === 'pattern'
        ? this.shop.buyPattern(d.pattern)
        : id
          ? this.shop.buyDecal(id)
          : 'unknown';
    const ok = result === 'ok';
    if (ok) {
      this.notice.textContent = `${name} を購入しました`;
      document.dispatchEvent(new Event(UI_SOUND_EVENTS.purchase));
      this.save();
      this.handlers.onPurchase();
    }
    this.refresh();
  }

  refresh(): void {
    const d = this.draft;
    if (!d) return;
    const shop = this.shop;
    const credits = shop.credits;
    for (const p of SKIN_PATTERNS) {
      const e = this.patterns.get(p.id);
      if (!e) continue;
      const st = shop.patternStatus(p.id);
      e.button.classList.toggle('is-viewing', d.pattern === p.id);
      e.button.classList.toggle('is-locked', st === 'locked');
      e.button.setAttribute('aria-pressed', String(d.pattern === p.id));
      e.status.textContent =
        st === 'owned' ? '所持' : st === 'locked' ? '未解放' : formatCredits(p.price);
    }
    const pat = findSkinPattern(d.pattern);
    const pst = shop.patternStatus(d.pattern);
    this.buyPattern.hidden = pst === 'owned';
    if (pat && pst === 'buyable') {
      this.buyPattern.textContent = `${pat.name} を購入 ${formatCredits(pat.price)}`;
      this.buyPattern.disabled = credits < pat.price;
    } else if (pat?.unlock && pst === 'locked') {
      this.buyPattern.textContent = unlockLabel(pat.unlock, shop.snapshot);
      this.buyPattern.disabled = true;
    }
    this.base.update(d.base);
    this.accent.update(d.accent);
    this.marking.update(d.marking);
    this.slotSeg.value = this.slot;
    const place = d[this.slot];
    for (const [key, e] of this.decals) {
      const id = key === 'none' ? null : key;
      const selected = place.decal === id;
      e.button.classList.toggle('is-viewing', selected);
      e.button.setAttribute('aria-pressed', String(selected));
      e.status.textContent =
        id === null
          ? ''
          : shop.decalStatus(id) === 'owned'
            ? '所持'
            : formatCredits(findDecal(id)?.price ?? 0);
      if (id === 'number') setDecalIcon(e.icon, id, d.number);
    }
    const did = place.decal;
    const dOwned = did === null || shop.decalStatus(did) === 'owned';
    this.buyDecal.hidden = dOwned;
    if (did !== null && !dOwned) {
      const price = findDecal(did)?.price ?? 0;
      this.buyDecal.textContent = `${findDecal(did)?.name ?? ''} を購入 ${formatCredits(price)}`;
      this.buyDecal.disabled = credits < price;
    }
    for (const k of ['x', 'y', 'size', 'rotation'] as const) {
      this.sliders[k].set(place[k]);
      this.sliders[k].disabled = did === null;
    }
    this.numberText.textContent = two(d.number);
    if (!shop.isOwnedPaint(d) && !this.notice.textContent.endsWith('購入しました'))
      this.notice.textContent = '未購入のものは試し塗りだけです（購入すると保存されます）';
    else if (shop.isOwnedPaint(d) && this.notice.textContent.startsWith('未購入'))
      this.notice.textContent = '';
  }
}
