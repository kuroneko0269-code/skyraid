// ハンガーの売り買い（3-3、Three.js・DOM 非依存）: 機体の状態（所持 / 購入可 / 未解放）、購入・強化の残高判定、
// 機体の選択、選択中の機体の装備（loadout）。書き換えたらすぐ保存する（SaveStore.transact）
import {
  AIRCRAFT_MODELS,
  STARTER_AIRCRAFT,
  findAircraftModel,
  type AircraftModel,
} from '../data/aircraft';
import { UPGRADE_KINDS, UPGRADE_LEVELS, UPGRADE_PRICES, type UpgradeKind } from '../data/upgrades';
import { resolveLoadout, type Loadout } from './loadout';
import { initialUpgrades, type SaveData, type UpgradeLevels } from './save';

/** owned: 所持 / buyable: 解放済みで未購入 / locked: 解放条件をまだ満たしていない */
export type AircraftStatus = 'owned' | 'buyable' | 'locked';

/** 購入・強化の結果。ok 以外は何も変えていない */
export type PurchaseResult = 'ok' | 'insufficient' | 'locked' | 'owned' | 'maxed' | 'unknown';

/** Hangar が読み書きするセーブの部分（SaveStore が満たす。テストでは偽物でもよい） */
export interface HangarSave {
  readonly snapshot: Readonly<SaveData>;
  /** data を書き換える。fn が true を返したら保存する */
  transact(fn: (data: SaveData) => boolean): boolean;
}

/** Lv level の次の強化の価格。最大なら null */
export function nextUpgradePrice(level: number): number | null {
  if (level >= UPGRADE_LEVELS.max) return null;
  return UPGRADE_PRICES[Math.max(0, level)] ?? null;
}

/** 解放条件を満たしているか（unlockMission がなければ最初から） */
export function isModelUnlocked(
  model: AircraftModel,
  isCleared: (missionId: string) => boolean,
): boolean {
  return model.unlockMission === null || isCleared(model.unlockMission);
}

export class Hangar {
  constructor(
    private readonly save: HangarSave,
    /** ミッションをクリア済みか（CampaignProgress.isCleared） */
    private readonly isCleared: (missionId: string) => boolean,
    readonly models: readonly AircraftModel[] = AIRCRAFT_MODELS,
  ) {}

  get credits(): number {
    return this.save.snapshot.credits;
  }

  get selectedId(): string {
    return this.save.snapshot.aircraft.selected;
  }

  get selectedModel(): AircraftModel {
    return this.model(this.selectedId) ?? starterModel();
  }

  model(id: string): AircraftModel | null {
    return this.models.find((m) => m.id === id) ?? null;
  }

  status(id: string): AircraftStatus {
    if (this.save.snapshot.aircraft.owned[id]) return 'owned';
    const m = this.model(id);
    return m && isModelUnlocked(m, this.isCleared) ? 'buyable' : 'locked';
  }

  /** 機体の強化 Lv（未所持は Lv0） */
  levels(id: string): Readonly<UpgradeLevels> {
    return this.save.snapshot.aircraft.owned[id] ?? initialUpgrades();
  }

  /** 機体 id の装備（強化込み）。未所持なら Lv0 */
  loadout(id: string = this.selectedId): Loadout {
    const m = this.model(id) ?? starterModel();
    return resolveLoadout(m, this.levels(m.id));
  }

  canBuy(id: string): PurchaseResult {
    const m = this.model(id);
    if (!m) return 'unknown';
    const status = this.status(id);
    if (status !== 'buyable') return status;
    return this.credits >= m.price ? 'ok' : 'insufficient';
  }

  /** 購入する。買えたら選択中の機体にする */
  buy(id: string): PurchaseResult {
    const result = this.canBuy(id);
    const m = this.model(id);
    if (result !== 'ok' || !m) return result;
    this.save.transact((d) => {
      d.credits -= m.price;
      d.aircraft.owned[id] = initialUpgrades();
      d.aircraft.selected = id;
      return true;
    });
    return 'ok';
  }

  /** 次の強化の価格（未所持・最大なら null） */
  upgradePrice(id: string, kind: UpgradeKind): number | null {
    const owned = this.save.snapshot.aircraft.owned[id];
    return owned ? nextUpgradePrice(owned[kind]) : null;
  }

  canUpgrade(id: string, kind: UpgradeKind): PurchaseResult {
    if (!this.model(id)) return 'unknown';
    const owned = this.save.snapshot.aircraft.owned[id];
    if (!owned) return this.status(id) === 'locked' ? 'locked' : 'insufficient';
    const price = nextUpgradePrice(owned[kind]);
    if (price === null) return 'maxed';
    return this.credits >= price ? 'ok' : 'insufficient';
  }

  upgrade(id: string, kind: UpgradeKind): PurchaseResult {
    const result = this.canUpgrade(id, kind);
    const price = this.upgradePrice(id, kind);
    if (result !== 'ok' || price === null) return result;
    this.save.transact((d) => {
      const levels = d.aircraft.owned[id];
      if (!levels) return false;
      d.credits -= price;
      levels[kind] += 1;
      return true;
    });
    return 'ok';
  }

  /** 所持している機体を選ぶ（出撃する機体）。未所持なら false */
  select(id: string): boolean {
    if (this.status(id) !== 'owned') return false;
    if (this.selectedId === id) return true;
    return this.save.transact((d) => {
      d.aircraft.selected = id;
      return true;
    });
  }

  /**
   * 今の解放状況で買える物（未購入の解放済み機体と、所持機体の次の強化）の価格。
   * リザルトの「ハンガーで新しい装備が買えます」の判定に使う
   */
  purchasablePrices(): number[] {
    const prices: number[] = [];
    for (const m of this.models) {
      const status = this.status(m.id);
      if (status === 'buyable') prices.push(m.price);
      if (status !== 'owned') continue;
      for (const k of UPGRADE_KINDS) {
        const p = this.upgradePrice(m.id, k);
        if (p !== null) prices.push(p);
      }
    }
    return prices;
  }

  /** 残高が before → after に増えて、新しく買えるようになった物があるか（before では買えず after で買える） */
  newlyAffordable(before: number, after: number): boolean {
    return this.purchasablePrices().some((p) => p > before && p <= after);
  }
}

function starterModel(): AircraftModel {
  const m = findAircraftModel(STARTER_AIRCRAFT.id);
  if (!m) throw new Error('初期機が AIRCRAFT_MODELS にない');
  return m;
}
