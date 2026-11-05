// 塗装の売り買い（7-3、Three.js・DOM 非依存）: パターン・デカールの状態（所持 / 購入可 / 未解放）・購入・
// 機体ごとの塗装の読み書き。解放条件（全ミッション S・PvP 10 撃墜・レース全コース A 以上）もここで判定する。
// 色・機体番号・置き方は無料。持っていないパターン・デカールは塗装に保存しない（ハンガーの試し塗りだけ）
import { t, tn } from '../core/i18n';
import { AIRCRAFT_MODELS, findAircraftModel } from '../data/aircraft';
import { COURSES } from '../data/courses';
import { MISSIONS } from '../data/missions';
import { RANKS, type Rank } from '../data/ranking';
import {
  findDecal,
  findSkinPattern,
  type DecalId,
  type SkinPatternId,
  type SkinUnlock,
} from '../data/skins';
import type { HangarSave } from './hangar';
import { clonePaint, defaultPaint, type Paint } from './paint';
import type { SaveData } from './save';

/** owned: 所持 / buyable: 買える（解放済み） / locked: 解放条件をまだ満たしていない */
export type SkinItemStatus = 'owned' | 'buyable' | 'locked';
export type SkinPurchaseResult = 'ok' | 'insufficient' | 'locked' | 'owned' | 'unknown';

function rankAtLeast(rank: Rank | null, target: Rank): boolean {
  return rank !== null && RANKS.indexOf(rank) <= RANKS.indexOf(target);
}

/**
 * 「全ミッション S」の対象（9-7: M1〜M5 のまま。M6〜M8 を足しても、もう解放した人の条件が戻らないように）
 */
const SKIN_MISSION_IDS: readonly string[] = MISSIONS.slice(0, 5).map((m) => m.id);

/** 「レース 4 コース全部 A 以上」の対象（9-8: 初めの 4 本のまま。新しいコースを足しても、もう解放した人の条件が戻らないように） */
const SKIN_COURSE_IDS: readonly string[] = COURSES.slice(0, 4).map((c) => c.id);

/** 解放条件を満たしているか（null は最初から） */
export function isSkinUnlocked(
  unlock: SkinUnlock | null,
  save: Readonly<SaveData>,
  missionIds: readonly string[] = SKIN_MISSION_IDS,
  courseIds: readonly string[] = SKIN_COURSE_IDS,
): boolean {
  if (unlock === null) return true;
  switch (unlock.kind) {
    case 'allMissionsS':
      return missionIds.every((id) => save.missions[id]?.bestRank === 'S');
    case 'pvpKills':
      return save.skins.pvpKills >= unlock.count;
    case 'allRacesA':
      return courseIds.every((id) => rankAtLeast(save.races[id]?.bestRank ?? null, 'A'));
  }
}

/** 解放条件の説明（ハンガーの表示） */
export function unlockLabel(unlock: SkinUnlock, save: Readonly<SaveData>): string {
  switch (unlock.kind) {
    case 'allMissionsS':
      return t('skins.unlock.allMissionsS');
    case 'pvpKills':
      return tn('skins.unlock.pvpKills', unlock.count, {
        have: Math.min(unlock.count, save.skins.pvpKills),
      });
    case 'allRacesA':
      return t('skins.unlock.allRacesA');
  }
}

export class Paintshop {
  constructor(
    private readonly save: HangarSave,
    private readonly rng: () => number = Math.random,
  ) {}

  private get data(): Readonly<SaveData> {
    return this.save.snapshot;
  }

  /** セーブの今のデータ（解放条件の表示） */
  get snapshot(): Readonly<SaveData> {
    return this.save.snapshot;
  }

  get credits(): number {
    return this.data.credits;
  }

  patternStatus(id: SkinPatternId): SkinItemStatus {
    if (this.data.skins.patterns.includes(id)) return 'owned';
    const def = findSkinPattern(id);
    return def && isSkinUnlocked(def.unlock, this.data) ? 'buyable' : 'locked';
  }

  decalStatus(id: DecalId): SkinItemStatus {
    return this.data.skins.decals.includes(id) ? 'owned' : 'buyable';
  }

  buyPattern(id: SkinPatternId): SkinPurchaseResult {
    const def = findSkinPattern(id);
    if (!def) return 'unknown';
    const status = this.patternStatus(id);
    if (status !== 'buyable') return status;
    if (this.credits < def.price) return 'insufficient';
    this.save.transact((d) => {
      d.credits -= def.price;
      d.skins.patterns.push(id);
      return true;
    });
    return 'ok';
  }

  buyDecal(id: DecalId): SkinPurchaseResult {
    const def = findDecal(id);
    if (!def) return 'unknown';
    if (this.decalStatus(id) === 'owned') return 'owned';
    if (this.credits < def.price) return 'insufficient';
    this.save.transact((d) => {
      d.credits -= def.price;
      d.skins.decals.push(id);
      return true;
    });
    return 'ok';
  }

  /** PvP（個人戦・チーム戦）の撃墜を累計に足して保存する（海洋迷彩の解放条件） */
  addPvpKills(kills: number): void {
    if (!(kills > 0)) return;
    this.save.transact((d) => {
      d.skins.pvpKills += Math.floor(kills);
      return true;
    });
  }

  /** 塗装が持っているものだけでできているか（持っていないパターン・デカールは保存できない） */
  isOwnedPaint(p: Readonly<Paint>): boolean {
    const s = this.data.skins;
    const decalOk = (d: DecalId | null): boolean => d === null || s.decals.includes(d);
    return s.patterns.includes(p.pattern) && decalOk(p.wing.decal) && decalOk(p.fin.decal);
  }

  /**
   * 機体の今の塗装（コピー）。まだなければ初期の塗装（機体番号はランダム）を作って保存する。
   * 知らない機体は初期機の形で作る（保存しない）
   */
  paint(aircraftId: string): Paint {
    const saved = this.data.skins.paints[aircraftId];
    if (saved) return clonePaint(saved);
    const model = findAircraftModel(aircraftId);
    const shape = (model ?? AIRCRAFT_MODELS[0])?.shape;
    if (!shape) throw new Error('No aircraft model defined');
    const fresh = defaultPaint(shape, null, this.rng);
    if (model)
      this.save.transact((d) => {
        d.skins.paints[aircraftId] = clonePaint(fresh);
        return true;
      });
    return fresh;
  }

  /** 機体の塗装を保存する。持っていないパターン・デカールを含むなら保存せず false */
  setPaint(aircraftId: string, p: Readonly<Paint>): boolean {
    if (!findAircraftModel(aircraftId) || !this.isOwnedPaint(p)) return false;
    return this.save.transact((d) => {
      d.skins.paints[aircraftId] = clonePaint(p);
      return true;
    });
  }
}
