// 7-4: マイグレーション（supabase/migrations/skyraid_0001_init.sql）の静的な確認。規約 v1.0 の決まりと、
// クライアント（src/data/online.ts・src/online/records.ts）と同じ数値を使っているか。実際の挙動は人間がダッシュボードで確かめる
import { describe, expect, it } from 'vitest';
import sqlRaw from '../supabase/migrations/skyraid_0001_init.sql?raw';
import { ONLINE_CONFIG, RECORD_KINDS } from '../src/data/online';
import { raceFloorMs, validKeys } from '../src/online/records';

/** コメントを除いた SQL（文字列の中の -- は使っていない） */
const sql = sqlRaw.replace(/--[^\n]*/g, '');
const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

describe('マイグレーションの形（規約 4 章）', () => {
  it('begin で始まり commit で終わる。最初の文はスキーマの作成', () => {
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('commit');
    expect(statements[1]).toBe('create schema if not exists skyraid');
  });

  it('スキーマの権限・説明（用途 / リポジトリ / 規約 v1.0）・適用の記録', () => {
    expect(sql).toContain('grant usage on schema skyraid to anon, authenticated');
    expect(sql).toContain(
      'alter default privileges in schema skyraid revoke execute on functions from public',
    );
    expect(sqlRaw).toMatch(
      /comment on schema skyraid is 'SkyRaid: [^']+ \/ 管理: https:\/\/github\.com\/kuroneko0269-code\/skyraid \/ 規約 v1\.0'/,
    );
    expect(sql).toMatch(
      /insert into skyraid\.schema_migrations \(version\) values \('skyraid_0001_init'\) on conflict do nothing/,
    );
  });

  it('alter default privileges は必ず in schema skyraid 付き', () => {
    for (const m of sql.matchAll(/alter default privileges[^;]*/g))
      expect(m[0]).toContain('in schema skyraid');
  });

  it('冪等: create は if not exists / or replace、ポリシーとトリガは drop if exists の直後に作る', () => {
    for (const s of statements) {
      if (/^create (table|index|schema)/.test(s)) expect(s).toMatch(/if not exists/);
      if (/^create (function|view)/.test(s)) expect(s).toMatch(/^create or replace/);
    }
    const objs = [...sql.matchAll(/create (policy|trigger) (\w+) on ([\w.]+)/g)];
    expect(objs.length).toBeGreaterThan(10);
    for (const [, kind, name, table] of objs)
      expect(sql, `${kind ?? ''} ${name ?? ''}`).toContain(
        `drop ${kind ?? ''} if exists ${name ?? ''} on ${table ?? ''}`,
      );
  });

  it('他アプリに触れない: skyraid の外にオブジェクトを作らない・壊す操作をしない（規約 4.3）', () => {
    for (const m of sql.matchAll(
      /(create|alter|drop|grant|revoke|comment|insert into|update|delete from)\s[^;]*/g,
    )) {
      const s = m[0];
      expect(s).not.toMatch(/\b(public|storage|extensions)\.\w/);
      expect(s).not.toMatch(/\bauth\.(users|identities|sessions)\b/);
    }
    expect(sql).not.toMatch(/drop schema|truncate|cascade|drop extension|alter extension/);
    expect(sql).not.toMatch(/storage\.buckets|storage\.objects/);
    expect(sql).not.toMatch(/references auth\./);
  });

  it('Storage は使わない・anon に公開する関数も作らない', () => {
    expect(sql).not.toMatch(/grant execute[^;]*\banon\b/);
    expect(sql).not.toMatch(/grant (select|insert|update|delete|all)[^;]*\bto anon\b/);
  });
});

describe('RLS と権限（規約 3 章）', () => {
  const tables = [...sql.matchAll(/create table if not exists (skyraid\.\w+)/g)].map(
    (m) => m[1] ?? '',
  );

  it('全テーブルで enable と force', () => {
    expect(tables).toEqual([
      'skyraid.schema_migrations',
      'skyraid.profiles',
      'skyraid.saves',
      'skyraid.records',
    ]);
    for (const t of tables) {
      expect(sql, t).toContain(`alter table ${t} enable row level security`);
      expect(sql, t).toContain(`alter table ${t} force row level security`);
    }
  });

  it('ポリシーの名前は <テーブル>_<ロール>_<操作>。authenticated のポリシーはすべて has_app_access を確かめ、auth.uid() は (select auth.uid())', () => {
    const policies = [
      ...sql.matchAll(/create policy (\w+) on skyraid\.(\w+) for (\w+) to (\w+)([^;]*)/g),
    ];
    expect(policies.length).toBe(12);
    for (const [, name, table, op, role, body] of policies) {
      expect(name).toBe(`${table ?? ''}_${role ?? ''}_${op ?? ''}`);
      if (role === 'authenticated')
        expect(body, name).toContain('(select skyraid.has_app_access())');
      expect((body ?? '').replace(/\(select auth\.uid\(\)\)/g, ''), name).not.toContain(
        'auth.uid()',
      );
    }
  });

  it('delete はどのテーブルも authenticated に与えない。records の update もしない', () => {
    expect(sql).not.toMatch(/grant [^;]*delete[^;]*to authenticated/);
    expect(sql).toContain('grant select, insert on table skyraid.records to authenticated');
    expect(sql).not.toMatch(
      /create policy \w+ on skyraid\.\w+ for (delete|update) to authenticated[^;]*records/,
    );
    expect(sql).not.toMatch(/records_authenticated_(update|delete)/);
  });

  it('has_app_access は規約 3.3 の形（API 非公開: public から revoke、authenticated だけ execute）', () => {
    expect(sql).toContain(
      "select coalesce((auth.jwt() -> 'app_metadata' -> 'apps') ? 'skyraid', false)",
    );
    expect(sql).toContain('revoke all on function skyraid.has_app_access() from public');
    expect(sql).toContain('grant execute on function skyraid.has_app_access() to authenticated');
  });

  it('関数はすべて search_path を固定し、public から execute を取り上げる', () => {
    const fns = [
      ...sql.matchAll(/create or replace function (skyraid\.\w+)\(([^)]*)\)([^$]*)\$\$/g),
    ];
    expect(fns.length).toBe(5);
    for (const [, name, , head] of fns) {
      expect(head, name).toContain("set search_path = ''");
      expect(sql, name).toMatch(
        new RegExp(
          `revoke all on function ${(name ?? '').replace('.', '\\.')}\\([^)]*\\) from public`,
        ),
      );
    }
  });

  it('ランキングのビューは security invoker（見る人の RLS を通す）で上位 100', () => {
    for (const v of ['race_best', 'raid_best', 'defense_best']) {
      expect(sql).toContain(`create or replace view skyraid.${v} with (security_invoker = true)`);
    }
    expect(sql.match(/where x\.n <= 100/g)?.length).toBe(3);
    expect(ONLINE_CONFIG.rankingTop).toBe(100);
  });
});

describe('クライアントと同じ数値', () => {
  it('レースの下限（理論最短 × 0.5）', () => {
    for (const key of validKeys('race'))
      expect(sql).toContain(`when '${key}' then ${String(raceFloorMs(key))}`);
  });

  it('受け付ける key・種類', () => {
    expect(sql).toContain(`kind in (${RECORD_KINDS.map((k) => `'${k}'`).join(', ')})`);
    for (const kind of RECORD_KINDS)
      expect(sql).toContain(
        `kind = '${kind}' and key in (${validKeys(kind)
          .map((k) => `'${k}'`)
          .join(', ')})`,
      );
  });

  it('セーブ 256KB・表示名 1〜16・1 分 20 行・最良 3 件・防衛戦 10 波・値の上限', () => {
    expect(sql).toContain(`octet_length(data::text) <= ${String(ONLINE_CONFIG.saveMaxBytes)}`);
    expect(sql).toContain(
      `char_length(display_name) between ${String(ONLINE_CONFIG.displayName.min)} and ${String(ONLINE_CONFIG.displayName.max)}`,
    );
    expect(sql).toContain(`>= ${String(ONLINE_CONFIG.recordsPerMinute)} then`);
    expect(sql).toContain(`limit ${String(ONLINE_CONFIG.keepPerKey)}`);
    expect(sql).toContain(`(detail ->> 'waves')::int <= ${String(ONLINE_CONFIG.defenseMaxWaves)}`);
    expect(sql).toContain(`value_ms between 1 and ${String(ONLINE_CONFIG.valueMaxMs)}`);
  });
});
