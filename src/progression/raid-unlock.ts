// 10-2: レイドの怪獣の解放（登録簿 src/data/raid-kaiju.ts の unlock）。条件は「挙げた怪獣のうち N 体を、その難易度以上でクリア」。
// クリアは、ソロの自己ベスト（records.raidBestMs）か、通算の記録の成功（stats の win.of.raid-<怪獣>。ソロの成功）があること。
// 高難度のクリアは通常にも数える。?dev=raid-lock のときは、条件の無い怪獣（ヴォルガスを除く）に「ヴォルガスを高難度でクリア」の
// 仮の条件を付ける（鍵の付いた見た目を確かめるため。遊ぶ人には出ない）。Three.js・DOM 非依存
import { t } from '../core/i18n';
import { parseDevFlags } from '../core/debug-flags';
import { RAID_DIFFICULTY_LABELS, type RaidDifficulty } from '../data/raid';
import {
  isRaidKaijuId,
  raidKaijuDef,
  raidKaijuName,
  raidRecordKey,
  VORGAS_ID,
  type RaidKaijuDef,
  type RaidKaijuId,
  type RaidUnlock,
} from '../data/raid-kaiju';
import type { SaveData } from './save';
import { statKey, statOf } from './stats';

/** ?dev=raid-lock の仮の条件 */
const DEV_LOCK: RaidUnlock = { kaiju: [VORGAS_ID], count: 1, difficulty: 'hard' };

/**
 * その怪獣の解放の条件（無ければ null）。search は ?dev= を見る URL（省くと今の URL）。?dev=kaiju-art（画像を描く
 * scripts/render-kaiju-art.js）のときは鍵を付けない
 */
export function unlockOf(
  def: Pick<RaidKaijuDef, 'id' | 'unlock'>,
  search = typeof location === 'undefined' ? '' : location.search,
): RaidUnlock | null {
  const dev = parseDevFlags(search);
  if (dev.has('kaiju-art')) return null;
  if (def.unlock) return def.unlock;
  return def.id !== VORGAS_ID && dev.has('raid-lock') ? DEV_LOCK : null;
}

type Progress = Pick<Readonly<SaveData>, 'records' | 'stats'>;

/** kaiju を difficulty 以上でクリアしたか */
export function raidCleared(save: Progress, kaiju: string, difficulty: RaidDifficulty): boolean {
  if (!isRaidKaijuId(kaiju)) return false;
  const best = save.records.raidBestMs;
  if (best[raidRecordKey(kaiju, 'hard')] !== undefined) return true;
  if (difficulty === 'normal' && best[raidRecordKey(kaiju, 'normal')] !== undefined) return true;
  // 通算の記録は難易度を分けないので、通常の条件だけに数える
  return difficulty === 'normal' && statOf(save.stats, statKey.winOf(`raid-${kaiju}`)) > 0;
}

export interface UnlockState {
  readonly unlocked: boolean;
  /** 条件を満たした数 / 要る数（条件が無ければ 0 / 0） */
  readonly have: number;
  readonly need: number;
  readonly unlock: RaidUnlock | null;
}

export function raidUnlockState(
  save: Progress,
  def: Pick<RaidKaijuDef, 'id' | 'unlock'>,
  search?: string,
): UnlockState {
  const unlock = unlockOf(def, search);
  if (!unlock) return { unlocked: true, have: 0, need: 0, unlock: null };
  const have = unlock.kaiju.filter((k) => raidCleared(save, k, unlock.difficulty)).length;
  const need = Math.min(unlock.count, unlock.kaiju.length);
  return { unlocked: have >= need, have, need, unlock };
}

/** 登録簿の怪獣の解放の状態（怪獣選び） */
export function raidUnlockOfId(save: Progress, id: RaidKaijuId): UnlockState {
  return raidUnlockState(save, raidKaijuDef(id));
}

/** 条件の文（今の言語）。例「ヴォルガスを高難度でクリア」「ヴォルガス・ネフィルガのうち 1 体を通常でクリア（0 / 1）」 */
export function raidUnlockText(s: UnlockState): string {
  const u = s.unlock;
  if (!u) return '';
  const names = u.kaiju.filter(isRaidKaijuId).map(raidKaijuName);
  const difficulty = RAID_DIFFICULTY_LABELS[u.difficulty];
  if (names.length === 1) return t('raidSelect.unlock.one', { kaiju: names[0] ?? '', difficulty });
  return t('raidSelect.unlock.some', {
    kaiju: names.join(t('raidSelect.unlock.separator')),
    count: String(s.need),
    difficulty,
    have: String(s.have),
  });
}
