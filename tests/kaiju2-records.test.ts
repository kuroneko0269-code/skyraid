// 9-6c: ネフィルガの記録: ローカルの自己ベスト（ヴォルガスと別のキー）・モード選択のカード・オンラインの記録のキーと、
// ランキングのマイグレーション（supabase/migrations/skyraid_0003_raid_kaiju.sql）。流すまでは送らない
import { describe, expect, it } from 'vitest';
import sqlRaw from '../supabase/migrations/skyraid_0003_raid_kaiju.sql?raw';
import { RAID_DIFFICULTIES } from '../src/data/raid';
import { RANKED_RAID_KAIJU, rankedRaidKaiju } from '../src/data/online';
import { RAID_KAIJU_IDS, raidKaijuOfKey, raidRecordKey } from '../src/data/raid-kaiju';
import { raidRecord } from '../src/online/outbox';
import { checkRecord, validKeys } from '../src/online/records';
import { modeProgress } from '../src/progression/mode-progress';
import { createInitialSave } from '../src/progression/save';
import { bestRaidMs, recordRaidTime } from '../src/progression/save-records';
import './i18n-setup';

const sql = sqlRaw.replace(/--[^\n]*/g, '');

describe('ネフィルガの記録のキー', () => {
  it('ヴォルガスは難易度だけ（今までの記録のまま）、ネフィルガは「nephirga:難易度」', () => {
    expect(raidRecordKey('vorgas', 'hard')).toBe('hard');
    expect(raidRecordKey('nephirga', 'normal')).toBe('nephirga:normal');
    expect(raidKaijuOfKey('normal')).toBe('vorgas');
    expect(raidKaijuOfKey('nephirga:hard')).toBe('nephirga');
    expect(raidKaijuOfKey('zzz:hard')).toBeNull();
  });

  it('自己ベストは怪獣ごと（ヴォルガスの最速にネフィルガは混ざらない）・モード選択のカードは両方', () => {
    const save = createInitialSave();
    const r = save.records;
    recordRaidTime(r, raidRecordKey('vorgas', 'normal'), 200_000);
    expect(modeProgress(save, []).raid).toBe('最速 3:20');
    recordRaidTime(r, raidRecordKey('nephirga', 'normal'), 150_000);
    recordRaidTime(r, raidRecordKey('nephirga', 'hard'), 300_000);
    expect(bestRaidMs(r)).toBe(200_000);
    expect(bestRaidMs(r, 'nephirga')).toBe(150_000);
    expect(modeProgress(save, []).raid).toBe('最速 3:20 / 2:30');
  });

  it('オンライン: 0003 を流した後（9-5d の事前修正）はネフィルガも送る・受け付ける', () => {
    expect(RANKED_RAID_KAIJU).toEqual(['vorgas', 'nephirga']);
    expect(rankedRaidKaiju('nephirga')).toBe(true);
    expect(validKeys('raid')).toEqual(['normal', 'hard', 'nephirga:normal', 'nephirga:hard']);
    expect(checkRecord(raidRecord('nephirga:normal', 180, 'kestrel', 'A'))).toBeNull();
    expect(checkRecord(raidRecord('normal', 180, 'kestrel', 'A'))).toBeNull();
  });
});

describe('マイグレーション 0003（ネフィルガのランキング）', () => {
  it('begin / commit・records の key の check を作り直すだけ・適用の記録', () => {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('commit');
    expect(sql).toContain('alter table skyraid.records drop constraint if exists records_key');
    expect(sql).toMatch(
      /insert into skyraid\.schema_migrations \(version\) values \('skyraid_0003_raid_kaiju'\) on conflict do nothing/,
    );
    // スキーマ skyraid の外に触れない・消す操作をしない
    expect(sql).not.toMatch(/\b(drop table|truncate|delete from)\b/i);
    expect(sql).not.toMatch(/\b(public|auth|storage)\./);
  });

  it('レイドの key はすべての怪獣 × 難易度（クライアントのキーと同じ）', () => {
    const keys = RAID_KAIJU_IDS.flatMap((k) => RAID_DIFFICULTIES.map((d) => raidRecordKey(k, d)));
    expect(sql).toContain(`kind = 'raid' and key in (${keys.map((k) => `'${k}'`).join(', ')})`);
    for (const kind of ['race', 'defense'] as const)
      expect(sql).toContain(
        `kind = '${kind}' and key in (${validKeys(kind)
          .map((k) => `'${k}'`)
          .join(', ')})`,
      );
  });
});
