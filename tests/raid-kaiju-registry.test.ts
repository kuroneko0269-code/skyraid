// 10-2: レイドの怪獣の登録簿（src/data/raid-kaiju.ts）: 9-6c までの id・番号・記録のキーが変わらない、記録のキーの決まり
// （SQL 0006 と同じ形）、ランキングに送る怪獣、解放の条件、勲章のまとまり、未公開の怪獣は ?dev= のときだけ
import { describe, expect, it } from 'vitest';
import sql0006 from '../supabase/migrations/skyraid_0006_raid_key_rule.sql?raw';
import { BADGE_LIST } from '../src/data/badges-order';
import { KAIJU_PROFILES } from '../src/data/kaiju-profiles';
import { RAID_KEY_RULE_ENABLED, RANKED_RAID_KAIJU, rankedOf } from '../src/data/online';
import {
  RAID_KAIJU,
  RAID_KAIJU_IDS,
  RAID_KEY_PATTERN,
  raidKaijuIndex,
  raidKaijuOf,
  raidKaijuOfKey,
  raidKaijuShown,
  raidRecordKey,
  type RaidKaijuDef,
} from '../src/data/raid-kaiju';
import { checkRecord, validKeys } from '../src/online/records';
import { raidCleared, raidUnlockState, raidUnlockText } from '../src/progression/raid-unlock';
import { createInitialSave } from '../src/progression/save';
import { useLocale } from './i18n-helpers';

describe('10-2: レイドの怪獣の登録簿', () => {
  it('9-6c までの id・協力の番号・記録のキーのまま', () => {
    // 10-3b: アルビオンは最後に足した（協力の番号 2）
    expect(RAID_KAIJU_IDS).toEqual(['vorgas', 'nephirga', 'albion']);
    expect(raidKaijuIndex('albion')).toBe(2);
    expect(raidRecordKey('albion', 'hard')).toBe('albion:hard');
    expect(raidKaijuOf(0)).toBe('vorgas');
    expect(raidKaijuOf(1)).toBe('nephirga');
    expect(raidKaijuOf(9)).toBe('vorgas');
    expect(raidKaijuIndex('nephirga')).toBe(1);
    expect(raidRecordKey('vorgas', 'hard')).toBe('hard');
    expect(raidRecordKey('nephirga', 'normal')).toBe('nephirga:normal');
    expect(raidKaijuOfKey('normal')).toBe('vorgas');
    expect(raidKaijuOfKey('nephirga:hard')).toBe('nephirga');
    expect(raidKaijuOfKey('nobody:hard')).toBeNull();
    // 怪獣選びの紹介は登録簿そのもの
    expect(KAIJU_PROFILES).toBe(RAID_KAIJU);
  });

  it('記録のキーの決まり: SQL 0006 の正規表現と同じ。今の怪獣のキーは全部合う', () => {
    const m = /key ~ '([^']+)'/.exec(sql0006);
    expect(m?.[1]).toBe(RAID_KEY_PATTERN.source);
    for (const k of RAID_KAIJU)
      if (k.recordKey === 'kaiju') {
        expect(RAID_KEY_PATTERN.test(raidRecordKey(k.id, 'normal'))).toBe(true);
        expect(RAID_KEY_PATTERN.test(raidRecordKey(k.id, 'hard'))).toBe(true);
      }
    expect(RAID_KEY_PATTERN.test('albion:normal')).toBe(true);
    expect(RAID_KEY_PATTERN.test('albion:easy')).toBe(false);
    expect(RAID_KEY_PATTERN.test('Albion:normal')).toBe(false);
  });

  it('ランキング: SQL 0006 を流した（10-3a）。流す前は ranked の怪獣だけ、流した後は「id:難易度」の怪獣も。未公開は送らない', () => {
    expect(RAID_KEY_RULE_ENABLED).toBe(true);
    expect(RANKED_RAID_KAIJU).toEqual(['vorgas', 'nephirga', 'albion']);
    expect(validKeys('raid')).toEqual([
      'normal',
      'hard',
      'nephirga:normal',
      'nephirga:hard',
      'albion:normal',
      'albion:hard',
    ]);
    const base = RAID_KAIJU[1] as RaidKaijuDef;
    const list: RaidKaijuDef[] = [
      ...RAID_KAIJU,
      { ...base, id: 'gourai', ranked: false },
      { ...base, id: 'xenolith', ranked: false, dev: 'kaiju5' },
    ];
    expect(rankedOf(list, false)).toEqual(['vorgas', 'nephirga']);
    expect(rankedOf(list, true)).toEqual(['vorgas', 'nephirga', 'albion', 'gourai']);
    expect(
      checkRecord({
        kind: 'raid',
        key: 'albion:normal',
        aircraftId: 'kestrel',
        valueMs: 300000,
        detail: {},
        clientVersion: 'v',
      }),
    ).toBeNull();
    expect(
      checkRecord({
        kind: 'raid',
        key: 'gourai:normal',
        aircraftId: 'kestrel',
        valueMs: 300000,
        detail: {},
        clientVersion: 'v',
      }),
    ).toBe('key');
  });

  it('未公開の怪獣は ?dev=<名前> のときだけ出す', () => {
    expect(raidKaijuShown({ dev: null }, '')).toBe(true);
    expect(raidKaijuShown({ dev: 'kaiju3' }, '')).toBe(false);
    expect(raidKaijuShown({ dev: 'kaiju3' }, '?dev=kaiju3')).toBe(true);
    expect(raidKaijuShown({ dev: 'kaiju3' }, '?dev=photo,kaiju3')).toBe(true);
  });

  it('解放の条件: 挙げた怪獣のうち N 体を、その難易度以上でクリア（高難度は通常にも数える）。条件の文', () => {
    useLocale('ja');
    const save = createInitialSave();
    const def = {
      id: 'xenolith',
      unlock: { kaiju: ['vorgas', 'nephirga'], count: 1, difficulty: 'normal' as const },
    };
    expect(raidUnlockState(save, def, '').unlocked).toBe(false);
    expect(raidUnlockText(raidUnlockState(save, def, ''))).toBe(
      'ヴォルガス・ネフィルガのうち 1 体を通常でクリア（0 / 1）',
    );
    save.records.raidBestMs['nephirga:hard'] = 400000;
    expect(raidCleared(save, 'nephirga', 'normal')).toBe(true);
    expect(raidUnlockState(save, def, '')).toMatchObject({ unlocked: true, have: 1, need: 1 });
    // 通算の記録の成功（難易度を分けない）は通常の条件だけ
    const save2 = createInitialSave();
    save2.stats.counts['win.of.raid-vorgas'] = 1;
    expect(raidCleared(save2, 'vorgas', 'normal')).toBe(true);
    expect(raidCleared(save2, 'vorgas', 'hard')).toBe(false);
    // 条件の無い怪獣はいつでも。?dev=raid-lock で仮の条件（ヴォルガスを高難度）。?dev=kaiju-art は鍵なし
    const nephirga = { id: 'nephirga', unlock: null };
    expect(raidUnlockState(save2, nephirga, '').unlocked).toBe(true);
    const locked = raidUnlockState(save2, nephirga, '?dev=raid-lock');
    expect(locked.unlocked).toBe(false);
    expect(raidUnlockText(locked)).toBe('ヴォルガスを高難度でクリア');
    expect(raidUnlockState(save2, def, '?dev=kaiju-art').unlocked).toBe(true);
    expect(raidUnlockState(save2, { id: 'vorgas', unlock: null }, '?dev=raid-lock').unlocked).toBe(
      true,
    );
  });

  it('勲章: 怪獣のまとまりはレイドのカテゴリの中で登録簿の順・怪獣ごとの勲章はまとまりの最後（ネフィルガの部位・アルビオンの巣と子分）', () => {
    const raid = BADGE_LIST.filter((b) => b.group === 'raid').map((b) => b.id);
    const first = (s: string): number => raid.findIndex((id) => id.includes(s));
    expect(first('vorgas')).toBeLessThan(first('nephirga'));
    expect(first('nephirga')).toBeLessThan(first('albion'));
    const nephirga = raid.filter((id) => id.includes('nephirga'));
    expect(nephirga.at(-1)).toBe('nephirgaParts');
    expect(raid.indexOf('nephirgaParts')).toBeLessThan(first('albion'));
    expect(raid.slice(-4)).toEqual([
      'albionNests',
      'albionUntouched',
      'albionMinions100',
      'albionMinions500',
    ]);
    // 収集はレイドの後（怪獣を足すと番号がずれるのは収集だけ）
    const collect = BADGE_LIST.findIndex((b) => b.group === 'collect');
    const lastRaid = BADGE_LIST.findLastIndex((b) => b.group === 'raid');
    expect(collect).toBe(lastRaid + 1);
  });
});
