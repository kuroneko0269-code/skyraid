#!/usr/bin/env bash
# 手元の Postgres 16 で Supabase のロールを模し、マイグレーションを 2 回ずつ流して join_requests（7-4d）・日替わりのスコア（9-9）・
# レイドの記録のキーの決まり（10-2）のテストを流す。
# 使い方: PGHOST=<ソケットのディレクトリ> PGPORT=<ポート> supabase/tests/run.sh <空のデータベース名>
# 前提: スーパーユーザー supabase_admin と、BYPASSRLS の無いログインロール postgres（データベースの所有者）があること
#   create role supabase_admin superuser login;
#   alter role postgres rename to bootstrap_su;   -- 既定の postgres（スーパーユーザー）は別の名前にしておく
#   create role postgres login createrole nosuperuser nobypassrls;
#   create database <名前> owner postgres;
set -euo pipefail
db="${1:?database name}"
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../migrations"
export PGOPTIONS='-c client_min_messages=warning'
psql_as() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" -U "$1" "${@:2}"; }
psql_as supabase_admin -f "$here/sim-setup.sql"
for _ in 1 2; do
  for f in "$mig"/skyraid_*.sql; do psql_as postgres -f "$f"; done
done
psql_as supabase_admin -tA -c "select version from skyraid.schema_migrations order by version"
psql_as supabase_admin -o /dev/null -f "$here/join-requests.sql"
psql_as supabase_admin -o /dev/null -f "$here/daily-scores.sql"
# 10-2: レイドの記録のキーの決まり（0006）
psql_as supabase_admin -o /dev/null -f "$here/raid-key-rule.sql"
