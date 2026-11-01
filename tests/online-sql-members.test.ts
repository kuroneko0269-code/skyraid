// 7-4b: マイグレーション 0002（supabase/migrations/skyraid_0002_members.sql）の静的な確認。
// 実際の挙動（2 回流せる・owner 以外の拒否・他アプリの値の保持）は手元の Postgres 16 で確かめ、本番は人間がダッシュボードで確かめる
import { describe, expect, it } from 'vitest';
import sqlRaw from '../supabase/migrations/skyraid_0002_members.sql?raw';
import sql1Raw from '../supabase/migrations/skyraid_0001_init.sql?raw';

const strip = (s: string): string => s.replace(/--[^\n]*/g, '');
const sql = strip(sqlRaw);
const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
const OWNER_EXPR = "((select auth.jwt()) -> 'app_metadata' -> 'roles' ->> 'skyraid') = 'owner'";

/** 関数の本体（$$ 〜 $$） */
function body(name: string): string {
  const m = new RegExp(
    `create or replace function skyraid\\.${name}\\([^$]*\\$\\$([\\s\\S]*?)\\$\\$`,
  ).exec(sql);
  return m?.[1] ?? '';
}

describe('0002 の形（規約 4 章）', () => {
  it('begin で始まり commit で終わる。適用の記録を残す', () => {
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('commit');
    expect(sql).toContain(
      "insert into skyraid.schema_migrations (version) values ('skyraid_0002_members') on conflict do nothing",
    );
  });

  it('冪等: create は if not exists / or replace、ポリシーとトリガは drop if exists の直後に作る', () => {
    for (const s of statements) {
      if (/^create (table|index|schema)/.test(s)) expect(s).toMatch(/if not exists/);
      if (/^create (function|view)/.test(s)) expect(s).toMatch(/^create or replace/);
    }
    const objs = [...sql.matchAll(/create (policy|trigger) (\w+) on ([\w.]+)/g)];
    expect(objs.length).toBeGreaterThan(5);
    for (const [, kind, name, table] of objs)
      expect(sql, `${kind ?? ''} ${name ?? ''}`).toContain(
        `drop ${kind ?? ''} if exists ${name ?? ''} on ${table ?? ''}`,
      );
  });

  it('作るのはスキーマ skyraid の中だけ。壊す操作をしない', () => {
    for (const m of sql.matchAll(/create (table|function|view|policy|trigger)[^;(]*/g)) {
      if (m[1] === 'policy' || m[1] === 'trigger') expect(m[0]).toMatch(/on skyraid\./);
      else expect(m[0]).toMatch(/skyraid\.\w+/);
    }
    expect(sql).not.toMatch(/\b(public|storage|extensions)\.\w/);
    expect(sql).not.toMatch(/drop schema|truncate|cascade|drop extension|alter extension/);
    expect(sql).not.toMatch(/references auth\./);
    expect(sql).not.toMatch(/alter table auth\.|delete from auth\.|insert into auth\./);
  });

  it('0001 は変えていない（0002 の内容を含まない）', () => {
    expect(sql1Raw).not.toContain('join_requests');
    expect(sql1Raw).not.toContain('is_owner');
  });
});

describe('auth.users に触れるのは承認・取り消しの関数の中だけ（設計書の「規約からの逸脱」）', () => {
  it('auth.users の update は 2 か所だけで、どちらも raw_app_meta_data の apps の skyraid を足す・除く', () => {
    const updates = [...sql.matchAll(/update auth\.users[^;]*/g)].map((m) => m[0]);
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(u).toMatch(/^update auth\.users\s+set raw_app_meta_data = jsonb_set\(/);
      expect(u).toContain("'{apps}'");
      expect(u).toMatch(/where id = p_user$/);
    }
    // 付与は規約 3.3 の式（配列に足して distinct。他アプリの値は保持）
    expect(body('approve_member')).toContain(
      "jsonb_array_elements_text(coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || '[\"skyraid\"]'::jsonb) v",
    );
    // 取り消しは規約 3.3 の式（skyraid だけ除く）
    expect(body('revoke_member')).toContain(
      "coalesce((raw_app_meta_data -> 'apps') - 'skyraid', '[]'::jsonb)",
    );
    // roles には触れない（owner の付与は持ち主が SQL で 1 回だけ）
    for (const u of updates) expect(u).not.toContain('roles');
  });

  it('承認・取り消し・一覧は、最初に is_owner() を確かめて違えば例外（42501）', () => {
    for (const fn of ['approve_member', 'revoke_member', 'list_members']) {
      const b = body(fn).trim();
      expect(b, fn).toMatch(
        /^begin\s+if not skyraid\.is_owner\(\) then\s+raise exception '[^']+' using errcode = '42501';\s+end if;/,
      );
    }
    expect(body('revoke_member')).toContain('if p_user = auth.uid() then');
  });

  it('一覧はメールを返さない', () => {
    const head =
      /create or replace function skyraid\.list_members\(\)\s+returns table \(([^)]*)\)/.exec(sql);
    expect(head?.[1]).toBe(
      'user_id uuid, display_name text, status text, requested_at timestamptz',
    );
    expect(body('list_members')).not.toMatch(/email/);
  });
});

describe('関数の権限', () => {
  const fns = [...sql.matchAll(/create or replace function (skyraid\.\w+)\(([^)]*)\)([^$]*)\$\$/g)];

  it('すべて search_path を固定し、public から execute を取り上げる', () => {
    expect(fns.map((f) => f[1])).toEqual([
      'skyraid.is_owner',
      'skyraid.join_requests_touch',
      'skyraid.approve_member',
      'skyraid.revoke_member',
      'skyraid.list_members',
    ]);
    for (const [, name, , head] of fns) {
      expect(head, name).toContain("set search_path = ''");
      expect(sql, name).toMatch(
        new RegExp(
          `revoke all on function ${(name ?? '').replace('.', '\\.')}\\([^)]*\\) from public`,
        ),
      );
    }
  });

  it('is_owner は API 非公開（誰にも execute を与えない）。中身は roles.skyraid = owner', () => {
    expect(sql).toContain(
      "select coalesce((auth.jwt() -> 'app_metadata' -> 'roles' ->> 'skyraid') = 'owner', false)",
    );
    expect(sql).toContain('revoke all on function skyraid.is_owner() from anon, authenticated');
    expect(sql).not.toMatch(/grant execute on function skyraid\.is_owner/);
  });

  it('承認・取り消し・一覧は security definer。anon には与えず authenticated にだけ execute', () => {
    for (const [fn, args] of [
      ['approve_member', 'uuid'],
      ['revoke_member', 'uuid'],
      ['list_members', ''],
    ] as const) {
      const head = fns.find((f) => f[1] === `skyraid.${fn}`)?.[3] ?? '';
      expect(head, fn).toContain('security definer');
      expect(sql).toContain(`revoke all on function skyraid.${fn}(${args}) from anon`);
      expect(sql).toContain(`grant execute on function skyraid.${fn}(${args}) to authenticated`);
    }
    expect(sql).not.toMatch(/grant [^;]*\bto anon\b/);
  });
});

describe('join_requests の RLS', () => {
  const policies = [
    ...sql.matchAll(/create policy (\w+) on skyraid\.(\w+) for (\w+) to (\w+)([^;]*)/g),
  ];
  const policy = (name: string): string => policies.find((p) => p[1] === name)?.[5] ?? '';

  it('enable と force。状態は 3 つだけ。anon にはテーブルの権限なし', () => {
    expect(sql).toContain('alter table skyraid.join_requests enable row level security');
    expect(sql).toContain('alter table skyraid.join_requests force row level security');
    expect(sql).toContain("check (status in ('pending', 'approved', 'rejected'))");
    expect(sql).toContain('revoke all on table skyraid.join_requests from anon');
    expect(sql).toContain('grant select, insert on table skyraid.join_requests to authenticated');
    expect(sql).toContain('grant update (status) on table skyraid.join_requests to authenticated');
  });

  it('ポリシーの名前は <テーブル>_<ロール>_<操作>。auth.uid() は (select auth.uid())', () => {
    for (const [, name, table, op, role, b] of policies) {
      expect(name).toBe(`${table ?? ''}_${role ?? ''}_${op ?? ''}`);
      expect((b ?? '').replace(/\(select auth\.uid\(\)\)/g, ''), name).not.toContain('auth.uid()');
      expect((b ?? '').replace(/\(select auth\.jwt\(\)\)/g, ''), name).not.toContain('auth.jwt()');
    }
  });

  it('本人は自分の行だけ（承認待ちとしてだけ）insert / select。has_app_access は確かめない（承認前のため）', () => {
    expect(policy('join_requests_authenticated_insert')).toContain(
      "with check (user_id = (select auth.uid()) and status = 'pending')",
    );
    expect(policy('join_requests_authenticated_select')).toContain('user_id = (select auth.uid())');
    for (const [name, table] of policies.map((p) => [p[1], p[2]]))
      if (table === 'join_requests') expect(policy(name ?? '')).not.toContain('has_app_access');
  });

  it('owner は全行を select / update（approved にはできない: 承認は関数だけ）', () => {
    expect(policy('join_requests_authenticated_select')).toContain(OWNER_EXPR);
    const upd = policy('join_requests_authenticated_update');
    expect(upd).toContain(`using (coalesce(${OWNER_EXPR}, false))`);
    expect(upd).toContain("status in ('pending', 'rejected')");
    expect(policies.some((p) => p[2] === 'join_requests' && p[3] === 'delete')).toBe(false);
  });

  it('セーブのバックアップは本人だけ消せる（has_app_access も確かめる）', () => {
    expect(sql).toContain('grant delete on table skyraid.saves to authenticated');
    expect(policy('saves_authenticated_delete').trim()).toBe(
      'using ((select skyraid.has_app_access()) and user_id = (select auth.uid()))',
    );
  });
});
