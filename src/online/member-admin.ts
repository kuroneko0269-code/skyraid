// メンバー管理（7-4b、DOM・Supabase 非依存）: owner が承認待ちを承認・却下し、承認済みを取り消す。
// 一覧は list_members() を読み、操作が成功したら読み直さずに手元の一覧を更新する（転送量を抑える）。
// 権限はサーバー（SQL の is_owner）が確かめる。ここでの owner の確認は無駄な呼び出しを避けるためだけ
import { OnlineError, type OnlineBackend } from './backend';
import { applyMemberAction, nextJoinStatus, type MemberAction, type MemberRow } from './members';

export class MemberAdmin {
  private list: MemberRow[] = [];

  constructor(
    private readonly backend: OnlineBackend,
    private readonly isOwner: () => boolean,
  ) {}

  get rows(): readonly MemberRow[] {
    return this.list;
  }

  /** 一覧を読む */
  async load(): Promise<readonly MemberRow[]> {
    if (!this.isOwner()) throw new OnlineError('denied', 'owner only');
    this.list = await this.backend.listMembers();
    return this.list;
  }

  /** 承認・却下・取り消し。その行の今の状態でできない操作は何もしない（false） */
  async act(userId: string, action: MemberAction): Promise<boolean> {
    if (!this.isOwner()) throw new OnlineError('denied', 'owner only');
    const row = this.list.find((r) => r.userId === userId);
    if (!row || nextJoinStatus(row.status, action) === null) return false;
    if (action === 'approve') await this.backend.approveMember(userId);
    else if (action === 'reject') await this.backend.rejectMember(userId);
    else await this.backend.revokeMember(userId);
    this.list = applyMemberAction(this.list, userId, action);
    return true;
  }

  clear(): void {
    this.list = [];
  }
}
