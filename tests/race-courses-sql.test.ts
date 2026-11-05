// 9-8: 新しいコース 2 本のランキング: 流すまでは送らない・ランキングに出さない（RANKED_COURSES）と、
// マイグレーション supabase/migrations/skyraid_0004_race_courses.sql（key と下限の check を作り直すだけ）
import { describe, expect, it } from 'vitest';
import sqlRaw from '../supabase/migrations/skyraid_0004_race_courses.sql?raw';
import { COURSES } from '../src/data/courses';
import { RANKED_COURSES, rankedCourse } from '../src/data/online';
import { raceRecord } from '../src/online/outbox';
import { checkRecord, raceFloorMs, validKeys } from '../src/online/records';
import './i18n-setup';

const sql = sqlRaw.replace(/--[^\n]*/g, '');

const finished = (courseId: string, time: number) => ({
  courseId,
  outcome: 'finished',
  time,
  missed: 0,
  thinPassed: 0,
});

describe('新しいコースのランキング（9-8）', () => {
  it('0004 を流したので、6 本すべてを送る・受け付ける（9-9 の事前修正）', () => {
    const all = ['coast', 'canyon', 'harbor-speed', 'acro', 'night-harbor', 'peak-spiral'];
    expect(RANKED_COURSES).toEqual(all);
    expect(validKeys('race')).toEqual(all);
    for (const id of ['night-harbor', 'peak-spiral']) {
      expect(COURSES.some((c) => c.id === id)).toBe(true);
      expect(rankedCourse(id)).toBe(true);
      const rec = raceRecord(finished(id, 60), 'kestrel');
      expect(rec).not.toBeNull();
      if (rec) expect(checkRecord(rec)).toBeNull();
    }
  });
});

describe('マイグレーション 0004（新しいコースのランキング）', () => {
  it('begin / commit・records の key と下限の check を作り直すだけ・適用の記録', () => {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('commit');
    expect(sql).toContain('alter table skyraid.records drop constraint if exists records_key');
    expect(sql).toContain(
      'alter table skyraid.records drop constraint if exists records_race_floor',
    );
    expect(sql).toMatch(
      /insert into skyraid\.schema_migrations \(version\) values \('skyraid_0004_race_courses'\) on conflict do nothing/,
    );
    expect(sql).not.toMatch(/\b(drop table|truncate|delete from)\b/i);
    expect(sql).not.toMatch(/\b(public|auth|storage)\./);
  });

  it('レースの key は全コース（クライアントの並び）・レイドと防衛戦は今のまま', () => {
    expect(sql).toContain(
      `kind = 'race' and key in (${COURSES.map((c) => `'${c.id}'`).join(', ')})`,
    );
    expect(sql).toContain(
      `kind = 'raid' and key in (${validKeys('raid')
        .map((k) => `'${k}'`)
        .join(', ')})`,
    );
    expect(sql).toContain(
      `kind = 'defense' and key in (${validKeys('defense')
        .map((k) => `'${k}'`)
        .join(', ')})`,
    );
  });

  it('レースの下限は全コースでクライアント（理論最短 × 0.5）と同じ', () => {
    for (const c of COURSES)
      expect(sql).toContain(`when '${c.id}' then ${String(raceFloorMs(c.id))}`);
  });
});
