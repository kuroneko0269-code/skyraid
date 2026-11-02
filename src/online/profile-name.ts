// サーバーの表示名（profiles.display_name）の扱い（7-4 / 8-1 の事前修正、DOM・Supabase 非依存）。service.ts から分けた。
// - 連携中になったら読む。無ければパイロット名で作る
// - 設定の「表示名を保存」で変える
// - 設定の「パイロット名を変更」で、連携中ならサーバーの表示名も変える。送れなかった（通信の失敗・OFF）ときは
//   端末（OnlineMeta.pendingName）に覚えておき、次に連携したとき（起動・ログイン・ON に戻す）に送る。
//   ローカルのパイロット名は変えたまま（戻さない）。決定は docs/decisions.md の 8-1
import type { OnlineBackend } from './backend';
import { sanitizeDisplayName } from './format';
import type { OnlineMeta } from './meta';

/** パイロット名の変更をサーバーへ反映した結果 */
export type PilotRenameResult =
  /** 連携していない（承認待ち・未連携）か、表示名にできない名前。サーバーは変えない */
  | 'none'
  /** サーバーの表示名も変えた */
  | 'saved'
  /** 送れなかった（失敗・オンライン連携 OFF）。次に連携したときに送る */
  | 'deferred';

export class ProfileName {
  /** サーバーの表示名（連携中に読む。まだ読んでいなければ null） */
  name: string | null = null;

  constructor(
    private readonly backend: OnlineBackend,
    private readonly meta: OnlineMeta,
    private readonly persist: () => void,
    /** 連携中かつ ON のときのユーザー id */
    private readonly activeUserId: () => string | null,
    /** プロフィールが無いときの表示名（パイロット名） */
    private readonly defaultName: () => string,
    /** 表示名を読んだ・変えた（画面を直す）。renamed は変えたとき（ランキングのキャッシュを捨てる） */
    private readonly changed: (renamed: boolean) => void,
  ) {}

  /** 連携中になった: 送れていないパイロット名の変更があれば送り、無ければ読む（無ければパイロット名で作る） */
  async ensure(): Promise<void> {
    try {
      if (await this.pushPending()) return;
      let name = await this.backend.fetchDisplayName();
      if (name === null) {
        name = sanitizeDisplayName(this.defaultName()) ?? 'PILOT';
        await this.backend.saveDisplayName(name);
      }
      this.name = name;
      this.changed(false);
    } catch {
      // 次のログインでまた試す
    }
  }

  /** 設定の「表示名を保存」。整えた名前を返す（空・連携していなければ null で何もしない） */
  async setManual(raw: string): Promise<string | null> {
    const clean = sanitizeDisplayName(raw);
    const id = this.activeUserId();
    if (clean === null || id === null) return null;
    await this.backend.saveDisplayName(clean);
    // 手で決めた表示名を、前に送れなかったパイロット名で上書きしない
    if (this.meta.pendingName?.user === id) this.setPending(null);
    this.apply(clean);
    return clean;
  }

  /**
   * 設定の「パイロット名を変更」。userId は承認済みのログイン中のユーザー（OFF でもよい。承認待ち・未連携は null）。
   * 失敗しても例外にせず 'deferred' を返す
   */
  async renameFromPilot(pilot: string, userId: string | null): Promise<PilotRenameResult> {
    const clean = sanitizeDisplayName(pilot);
    if (clean === null || userId === null) return 'none';
    this.setPending({ user: userId, name: clean });
    try {
      return (await this.pushPending()) ? 'saved' : 'deferred';
    } catch {
      return 'deferred';
    }
  }

  /** 覚えている変更を送る。送れたら true（送るものが無い・連携していなければ false。通信の失敗は例外） */
  private async pushPending(): Promise<boolean> {
    const pending = this.meta.pendingName;
    const id = this.activeUserId();
    if (!pending || id === null || pending.user !== id) return false;
    await this.backend.saveDisplayName(pending.name);
    // 送っている間に別の名前に変えていたら、その名前は残す（次に送る）
    if (this.meta.pendingName === pending) this.setPending(null);
    this.apply(pending.name);
    return true;
  }

  private apply(name: string): void {
    this.name = name;
    this.changed(true);
  }

  private setPending(p: OnlineMeta['pendingName']): void {
    this.meta.pendingName = p;
    this.persist();
  }
}
