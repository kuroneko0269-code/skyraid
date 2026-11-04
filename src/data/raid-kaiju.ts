// 9-6c: レイドの怪獣（ヴォルガス / ネフィルガ）の id・協力の設定の番号・記録のキー。起動時に読むので小さく保つ
// （ネフィルガの判定・形・HUD・文言は遅延チャンク。src/ui/kaiju2-link.ts）。Three.js・DOM 非依存
import { t } from '../core/i18n';
import type { RaidDifficulty } from './raid';

/** 協力の設定（GameSettings.raidKaiju）の番号の順 */
export const RAID_KAIJU_IDS = ['vorgas', 'nephirga'] as const;
export type RaidKaijuId = (typeof RAID_KAIJU_IDS)[number];

export const VORGAS_ID: RaidKaijuId = 'vorgas';
export const NEPHIRGA_ID: RaidKaijuId = 'nephirga';

export function isRaidKaijuId(v: unknown): v is RaidKaijuId {
  return typeof v === 'string' && (RAID_KAIJU_IDS as readonly string[]).includes(v);
}

/** 協力の設定の番号 → id（知らない番号はヴォルガス） */
export function raidKaijuOf(index: number): RaidKaijuId {
  return RAID_KAIJU_IDS[index] ?? VORGAS_ID;
}

export function raidKaijuIndex(id: string | undefined): number {
  const i = (RAID_KAIJU_IDS as readonly string[]).indexOf(id ?? VORGAS_ID);
  return i < 0 ? 0 : i;
}

/** 名前（今の言語） */
export function raidKaijuName(id: RaidKaijuId): string {
  return id === NEPHIRGA_ID ? t('kaiju2.name') : t('kaiju.name');
}

/**
 * 記録のキー（ローカルの自己ベスト records.raidBestMs・オンラインの records.key）: ヴォルガスは難易度だけ（今までの記録のまま）、
 * ほかの怪獣は「id:難易度」
 */
export function raidRecordKey(kaiju: RaidKaijuId, difficulty: RaidDifficulty): string {
  return kaiju === VORGAS_ID ? difficulty : `${kaiju}:${difficulty}`;
}

/** 記録のキー → 怪獣（「id:」が無ければヴォルガス） */
export function raidKaijuOfKey(key: string): RaidKaijuId | null {
  const i = key.indexOf(':');
  if (i < 0) return VORGAS_ID;
  const id = key.slice(0, i);
  return isRaidKaijuId(id) ? id : null;
}
