// OnlineBackend の本物（7-4）: @supabase/supabase-js。スキーマは skyraid だけ（規約 1.2）。
// 環境変数があるときだけ動的 import で読み込む（無ければバンドルの別チャンクのまま読まない）。
// 返ってくる行は any なので unknown で受けて形を確かめてから使う
import { createClient, type User } from '@supabase/supabase-js';
import { ONLINE_CONFIG } from '../data/online';
import {
  OnlineError,
  type OnlineBackend,
  type OnlineUser,
  type RankingQuery,
  type RankingRow,
  type RemoteSave,
  type SaveRow,
} from './backend';
import type { OnlineEnv } from './env';
import { classifyError, classifySendCodeError, type ErrorLike } from './errors';
import {
  isJoinStatus,
  parseMemberRows,
  roleFromMetadata,
  type JoinStatus,
  type MemberRow,
} from './members';
import type { RecordInput } from './records';
import type { RemoteSaveInfo } from './sync-rules';
import { parseRankingRows, parseRemoteSave, parseSaveInfo } from './parse';
import { parseDailyRows, type DailyRankingRow, type DailyScoreInput } from './daily-scores';
import { DAILY_CONFIG } from '../data/daily';

/** 申請の表示名が使えなかったときの名前（service の既定と同じ） */
const FALLBACK_NAME = 'PILOT';
const VIEWS = { race: 'race_best', raid: 'raid_best', defense: 'defense_best' } as const;
const RANKING_COLUMNS = 'user_id,display_name,aircraft_id,value_ms,detail,created_at,place';
const DAILY_COLUMNS = 'user_id,display_name,value,preset,aircraft_id,created_at,place';

function fail(e: ErrorLike): OnlineError {
  return new OnlineError(classifyError(e), e.message ?? 'error');
}

function toUser(u: User | null | undefined): OnlineUser | null {
  if (!u) return null;
  // ログイン直後のトークンに app_metadata が無い・apps が無いときは「承認待ち」（apps = []）として扱う（7-4d）
  const meta: unknown = u.app_metadata;
  const apps: unknown =
    typeof meta === 'object' && meta !== null
      ? Object.getOwnPropertyDescriptor(meta, 'apps')?.value
      : undefined;
  return {
    id: u.id,
    email: u.email ?? '',
    apps: Array.isArray(apps) ? apps.filter((a): a is string => typeof a === 'string') : [],
    role: roleFromMetadata(meta, ONLINE_CONFIG.schema),
  };
}

/** クライアントを作る（スキーマは skyraid だけ。規約 1.2） */
function makeClient(env: OnlineEnv) {
  return createClient(env.url, env.anonKey, {
    db: { schema: ONLINE_CONFIG.schema },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export class SupabaseBackend implements OnlineBackend {
  private readonly client: ReturnType<typeof makeClient>;

  constructor(env: OnlineEnv) {
    this.client = makeClient(env);
  }

  async currentUser(): Promise<OnlineUser | null> {
    const { data } = await this.client.auth.getSession();
    return toUser(data.session?.user);
  }

  onAuthChange(fn: (user: OnlineUser | null) => void): void {
    this.client.auth.onAuthStateChange((_event, session) => {
      // コールバックの中で他の Supabase の呼び出しを待つと固まるので、次のタスクに回す
      setTimeout(() => {
        fn(toUser(session?.user));
      }, 0);
    });
  }

  async sendCode(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      // メールのテンプレートがリンクだけのときに備え、リンクの戻り先をこのページにする（リダイレクト URL に足してあれば使える）
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
      },
    });
    if (error) {
      console.warn('[skyraid] signInWithOtp failed', error.status, error.code, error.message);
      throw new OnlineError(classifySendCodeError(error), error.message);
    }
  }

  async verifyCode(email: string, code: string): Promise<OnlineUser> {
    const { data, error } = await this.client.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw fail(error);
    const user = toUser(data.user);
    if (!user) throw new OnlineError('auth', 'no user');
    return user;
  }

  async refresh(): Promise<OnlineUser | null> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error) throw fail(error);
    return toUser(data.user);
  }

  async signOut(): Promise<void> {
    // この端末だけ（他の端末のログインは残す）
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) throw fail(error);
  }

  async fetchSaveInfo(): Promise<RemoteSaveInfo | null> {
    const { data, error } = await this.client
      .from('saves')
      .select('version,updated_at')
      .maybeSingle();
    if (error) throw fail(error);
    const row: unknown = data;
    return row === null ? null : parseSaveInfo(row);
  }

  async fetchSave(): Promise<RemoteSave | null> {
    const { data, error } = await this.client
      .from('saves')
      .select('version,data,updated_at')
      .maybeSingle();
    if (error) throw fail(error);
    const row: unknown = data;
    return row === null ? null : parseRemoteSave(row);
  }

  async insertSave(row: SaveRow): Promise<RemoteSaveInfo> {
    const { data, error } = await this.client
      .from('saves')
      .insert({ version: row.version, data: row.data })
      .select('version,updated_at')
      .single();
    if (error) throw fail(error);
    const out: unknown = data;
    return parseSaveInfo(out);
  }

  async updateSave(row: SaveRow, expectedAt: string): Promise<RemoteSaveInfo> {
    const { data, error } = await this.client
      .from('saves')
      .update({ version: row.version, data: row.data })
      .eq('updated_at', expectedAt)
      .select('version,updated_at');
    if (error) throw fail(error);
    const rows: unknown = data;
    // 0 行 = サーバーのセーブが前回の同期の後に変わっていた（他の端末が先に送った）
    if (!Array.isArray(rows) || rows.length === 0) throw new OnlineError('conflict', 'changed');
    return parseSaveInfo(rows[0]);
  }

  async insertRecord(r: RecordInput): Promise<void> {
    const { error } = await this.client.from('records').insert({
      kind: r.kind,
      key: r.key,
      aircraft_id: r.aircraftId,
      value_ms: r.valueMs,
      detail: r.detail,
      client_version: r.clientVersion,
    });
    if (error) throw fail(error);
  }

  async fetchRanking(q: RankingQuery): Promise<RankingRow[]> {
    let req = this.client.from(VIEWS[q.kind]).select(RANKING_COLUMNS).eq('key', q.key);
    if (q.kind === 'race' && q.aircraftId) req = req.eq('aircraft_id', q.aircraftId);
    const { data, error } = await req.order('place').limit(ONLINE_CONFIG.rankingTop);
    if (error) throw fail(error);
    const rows: unknown = data;
    return parseRankingRows(rows);
  }

  // ---- 日替わりチャレンジ（9-9。SQL 0005）
  async insertDailyScore(r: DailyScoreInput): Promise<void> {
    const { error } = await this.client.from('daily_scores').insert({
      day: r.day,
      spec: r.spec,
      kind: r.kind,
      value: r.value,
      preset: r.preset,
      aircraft_id: r.aircraftId,
      client_version: r.clientVersion,
    });
    if (error) throw fail(error);
  }

  async fetchDailyRanking(day: string, spec: string): Promise<DailyRankingRow[]> {
    const { data, error } = await this.client
      .from('daily_best')
      .select(DAILY_COLUMNS)
      .eq('day', day)
      .eq('spec', spec)
      .order('place')
      .limit(DAILY_CONFIG.rankingTop);
    if (error) throw fail(error);
    const rows: unknown = data;
    return parseDailyRows(rows);
  }

  async fetchDisplayName(): Promise<string | null> {
    const user = await this.currentUser();
    if (!user) return null;
    const { data, error } = await this.client
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw fail(error);
    const row: unknown = data;
    if (typeof row !== 'object' || row === null || !('display_name' in row)) return null;
    return typeof row.display_name === 'string' ? row.display_name : null;
  }

  async saveDisplayName(name: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new OnlineError('auth', 'signed out');
    const { error } = await this.client
      .from('profiles')
      .upsert({ user_id: user.id, display_name: name }, { onConflict: 'user_id' });
    if (error) throw fail(error);
  }

  async deleteSave(): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new OnlineError('auth', 'signed out');
    const { error } = await this.client.from('saves').delete().eq('user_id', user.id);
    if (error) throw fail(error);
  }

  async requestJoin(displayName: string): Promise<JoinStatus | null> {
    // セッション（JWT）が確立していなければ送らない（anon のまま送ると RLS で拒否される。7-4d）
    const { data: auth } = await this.client.auth.getSession();
    const user = auth.session?.user;
    if (!user) throw new OnlineError('auth', 'no session');
    const insert = async (name: string) =>
      // on conflict do nothing（もう申請していれば何もしない。却下された人も上書きしない）
      this.client
        .from('join_requests')
        .upsert(
          { user_id: user.id, display_name: name },
          { onConflict: 'user_id', ignoreDuplicates: true },
        );
    let { error } = await insert(displayName);
    // 表示名が SQL の check（1〜16 文字・制御文字なし）に通らなかったら、既定の名前で送り直す（7-4d）
    if (error && classifyError(error) === 'invalid' && displayName !== FALLBACK_NAME) {
      console.warn('[skyraid] join_requests insert rejected the name; retrying', error.message);
      ({ error } = await insert(FALLBACK_NAME));
    }
    if (error) {
      console.error('[skyraid] join_requests insert failed', error.code, error.message, error.hint);
      throw fail(error);
    }
    const { data, error: readError } = await this.client
      .from('join_requests')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) {
      console.error('[skyraid] join_requests select failed', readError.code, readError.message);
      throw fail(readError);
    }
    const row: unknown = data;
    if (typeof row !== 'object' || row === null || !('status' in row)) return null;
    return isJoinStatus(row.status) ? row.status : null;
  }

  async listMembers(): Promise<MemberRow[]> {
    const res = await this.client.rpc('list_members');
    if (res.error) throw fail(res.error);
    const rows: unknown = res.data;
    return parseMemberRows(rows);
  }

  async approveMember(userId: string): Promise<void> {
    const { error } = await this.client.rpc('approve_member', { p_user: userId });
    if (error) throw fail(error);
  }

  async rejectMember(userId: string): Promise<void> {
    const { data, error } = await this.client
      .from('join_requests')
      .update({ status: 'rejected' })
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('user_id');
    if (error) throw fail(error);
    const rows: unknown = data;
    // 0 行 = もう承認待ちではない（他の端末で操作した）か、owner ではない
    if (!Array.isArray(rows) || rows.length === 0) throw new OnlineError('conflict', 'not pending');
  }

  async revokeMember(userId: string): Promise<void> {
    const { error } = await this.client.rpc('revoke_member', { p_user: userId });
    if (error) throw fail(error);
  }
}
