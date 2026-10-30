import './hangar.css';
import { UI_SOUND_EVENTS } from '../data/audio';
import type { AircraftModel, AircraftStats } from '../data/aircraft';
import { HANGAR_CONFIG } from '../data/hangar';
import { UPGRADE_KINDS, UPGRADE_LEVELS, type UpgradeKind } from '../data/upgrades';
import { nextUpgradePrice, type Hangar } from '../progression/hangar';
import { loadoutStats, resolveLoadout, type Loadout } from '../progression/loadout';
import { initialUpgrades, type UpgradeLevels } from '../progression/save';
import { ConfirmDialog, STAT_KEYS, StatBars, UpgradeRow, type StatTexts } from './hangar-parts';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

export interface HangarHandlers {
  onBack: () => void;
  /** 見ている機体が変わったとき（展示の形）。出撃機・強化が変わったときも呼ぶ */
  onView: (model: AircraftModel) => void;
  /** ミッション id → 解放条件の表示（例「M4 クリアで解放」） */
  unlockText: (missionId: string) => string;
}

/**
 * ハンガー（3-3）: 左に機体一覧（所持 / 価格 / 解放条件）、中央は機体の展示（シーンに置いた 3D。DOM は空ける）、
 * 右に 4 パラメータのバー・強化 4 系統・購入ボタン・残高。狭い画面では上下に並べる（hangar.css）。
 * 購入・強化は 1 タップで確定し、HANGAR_CONFIG.confirmPrice 以上だけ確認する
 */
export class HangarScreen {
  readonly root: HTMLDivElement;
  private viewing: string;
  private readonly entries = new Map<
    string,
    { button: HTMLButtonElement; status: HTMLSpanElement }
  >();
  private readonly name: HTMLHeadingElement;
  private readonly role: HTMLDivElement;
  private readonly bars: StatBars;
  private readonly payload: HTMLDivElement;
  private readonly upgrades = new Map<UpgradeKind, UpgradeRow>();
  private readonly upgradeWrap: HTMLDivElement;
  private readonly action: HTMLButtonElement;
  private readonly balance: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private readonly confirm: ConfirmDialog;

  constructor(
    parent: HTMLElement,
    private readonly hangar: Hangar,
    private readonly handlers: HangarHandlers,
  ) {
    this.viewing = hangar.selectedId;
    const root = createScreen(parent, 'hangar-screen');
    const layout = el('div', 'hangar-layout', root);

    const list = el('div', 'ui-panel hangar-panel hangar-list', layout);
    el('div', 'ui-kicker campaign-kicker', list, 'HANGAR');
    const entries = el('div', 'hangar-entries', list);
    for (const m of hangar.models) {
      const button = createButton(entries, 'ui-button ui-item hangar-entry', '', () => {
        this.view(m.id);
      });
      el('span', 'hangar-entry-name', button, m.name);
      el('span', 'hangar-entry-role', button, m.role);
      const status = el('span', 'hangar-entry-status', button);
      this.entries.set(m.id, { button, status });
    }
    createButton(list, 'ui-button is-ghost campaign-back hangar-back', '← 戻る', () => {
      handlers.onBack();
    });

    // 中央は空けて、後ろのシーンの機体を見せる
    el('div', 'hangar-stage', layout);

    const detail = el('div', 'ui-panel hangar-panel hangar-detail', layout);
    this.balance = el('div', 'hangar-balance', detail);
    this.name = el('h2', 'ui-title campaign-title hangar-name', detail);
    this.role = el('div', 'hangar-role', detail);
    this.bars = new StatBars(detail, maxStats(hangar.models));
    this.payload = el('div', 'hangar-payload', detail);
    this.action = createButton(detail, 'ui-button is-primary campaign-go hangar-action', '', () => {
      this.buy();
    });
    this.notice = el('div', 'hangar-notice', detail);
    el('div', 'campaign-label', detail, '強化（この機体だけ）');
    this.upgradeWrap = el('div', 'hangar-upgrades', detail);
    for (const k of UPGRADE_KINDS)
      this.upgrades.set(
        k,
        new UpgradeRow(this.upgradeWrap, k, (kind) => {
          this.upgrade(kind);
        }),
      );
    this.confirm = new ConfirmDialog(root);
    this.root = root;
  }

  /** 確認ダイアログが開いていれば閉じて true（Esc で画面を戻る前に呼ぶ） */
  closeDialog(): boolean {
    if (!this.confirm.open) return false;
    this.confirm.close();
    return true;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) {
      this.confirm.close();
      return;
    }
    this.notice.textContent = '';
    this.view(this.hangar.selectedId);
    this.entries.get(this.viewing)?.button.focus({ preventScroll: true });
  }

  /** 一覧で機体を選ぶ。所持している機体はそのまま出撃機にする */
  private view(id: string): void {
    this.viewing = id;
    this.hangar.select(id);
    this.notice.textContent = '';
    this.refresh();
  }

  private buy(): void {
    const m = this.hangar.model(this.viewing);
    if (!m || this.hangar.canBuy(m.id) !== 'ok') return;
    this.withConfirm(`${m.name} を ${formatCredits(m.price)} で購入しますか？`, m.price, () => {
      if (this.hangar.buy(m.id) === 'ok') {
        this.notice.textContent = `${m.name} を購入しました`;
        notifyPurchase();
      }
      this.refresh();
    });
  }

  private upgrade(kind: UpgradeKind): void {
    const id = this.viewing;
    const price = this.hangar.upgradePrice(id, kind);
    if (price === null || this.hangar.canUpgrade(id, kind) !== 'ok') return;
    this.withConfirm(`${formatCredits(price)} で強化しますか？`, price, () => {
      if (this.hangar.upgrade(id, kind) === 'ok') notifyPurchase();
      this.notice.textContent = '';
      this.refresh();
    });
  }

  /** 高額（confirmPrice 以上）なら確認してから、それ以外はすぐ action */
  private withConfirm(message: string, price: number, action: () => void): void {
    if (price >= HANGAR_CONFIG.confirmPrice) this.confirm.show(message, action);
    else action();
  }

  private refresh(): void {
    const h = this.hangar;
    const credits = h.credits;
    this.balance.textContent = `残高 ${formatCredits(credits)}`;
    for (const m of h.models) {
      const entry = this.entries.get(m.id);
      if (!entry) continue;
      const status = h.status(m.id);
      entry.button.classList.toggle('is-viewing', m.id === this.viewing);
      entry.button.classList.toggle('is-locked', status === 'locked');
      entry.status.textContent =
        m.id === h.selectedId
          ? '出撃機'
          : status === 'owned'
            ? '所持'
            : status === 'buyable'
              ? formatCredits(m.price)
              : this.lockText(m);
    }
    const m = h.model(this.viewing);
    if (!m) return;
    const status = h.status(m.id);
    const levels = h.levels(m.id);
    this.name.textContent = m.name;
    this.role.textContent = m.role;
    const base = resolveLoadout(m, initialUpgrades());
    const now = resolveLoadout(m, levels);
    this.bars.update(loadoutStats(base), loadoutStats(now), statTexts(now));
    this.payload.textContent = `ミサイル ${now.missiles} / ロケット ${now.rockets} / 爆弾 ${now.bombs} / フレア ${now.flares}`;
    const owned = status === 'owned';
    for (const [kind, row] of this.upgrades)
      row.update(levels[kind], nextUpgradePrice(levels[kind]), owned, credits);
    this.upgradeWrap.classList.toggle('is-disabled', !owned);
    this.action.hidden = owned;
    if (status === 'buyable') {
      this.action.textContent = `購入する ${formatCredits(m.price)}`;
      this.action.disabled = credits < m.price;
    } else if (status === 'locked') {
      this.action.textContent = this.lockText(m);
      this.action.disabled = true;
    }
    this.handlers.onView(m);
  }

  private lockText(m: AircraftModel): string {
    return m.unlockMission ? this.handlers.unlockText(m.unlockMission) : '未解放';
  }
}

function statTexts(l: Loadout): StatTexts {
  const s = loadoutStats(l);
  return {
    speed: `${Math.round(s.speed)} m/s`,
    turn: `${Math.round(s.turn)}°/s`,
    durability: `HP ${s.durability}`,
    payload: `×${s.payload.toFixed(2)}`,
  };
}

/** バーの右端: 全機体を全系統 Lv5 にしたときの最大 */
function maxStats(models: readonly AircraftModel[]): AircraftStats {
  const full: UpgradeLevels = initialUpgrades();
  for (const k of UPGRADE_KINDS) full[k] = UPGRADE_LEVELS.max;
  const max = { speed: 0, turn: 0, durability: 0, payload: 0 };
  for (const m of models) {
    const s = loadoutStats(resolveLoadout(m, full));
    for (const k of STAT_KEYS) max[k] = Math.max(max[k], s[k]);
  }
  return max;
}

/** 購入・強化の成功を音（4-4）に知らせる */
function notifyPurchase(): void {
  document.dispatchEvent(new Event(UI_SOUND_EVENTS.purchase));
}
