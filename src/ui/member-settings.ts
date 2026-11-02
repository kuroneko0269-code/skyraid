// 設定の「メンバー管理」（7-4b）: owner（app_metadata.roles.skyraid = 'owner'）のときだけ出す。
// 承認待ちの一覧（承認 / 却下）と承認済みの一覧（取り消し）。承認・却下は 1 タップで確定、取り消しだけ確認のダイアログ。
// 権限はサーバー（SQL の is_owner）が確かめる。ここでの出し分けは見た目だけ。
// 8-6d: 1 人 1 行（名前・申請日・状態・操作）の詰めた表にし、設定の 2 列をまたいで横幅いっぱいに置く（online.css）。
// 承認待ち → 承認済みの順に 1 つの表に並べ、件数は見出しの横に出す
import './online.css';
import { t } from '../core/i18n';
import type { MemberAdmin } from '../online/member-admin';
import { memberLists, type MemberAction, type MemberLine } from '../online/members';
import { errorMessage } from '../online/messages';
import type { OnlineStatus } from '../online/service';
import { el } from './hud-dom';
import { createButton } from './screen';

function smallButton(parent: HTMLElement, label: string, extra = ''): HTMLButtonElement {
  const b = el('button', `ui-toggle settings-button member-button ${extra}`.trim(), parent, label);
  b.type = 'button';
  return b;
}

/** 取り消しの確認（どの画面の上にも出す） */
function confirmRevoke(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = el('div', 'mode-prompt online-sync-dialog', document.body);
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const box = el('div', 'ui-dialog mode-prompt-box', wrap);
    el('h3', 'ui-heading mode-prompt-title', box, t('members.confirmTitle', { name }));
    el('p', 'mode-prompt-text', box, t('members.confirmText'));
    const buttons = el('div', 'campaign-buttons', box);
    const done = (ok: boolean): void => {
      wrap.remove();
      resolve(ok);
    };
    const cancel = createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('members.cancel'),
      () => {
        done(false);
      },
    );
    createButton(buttons, 'ui-button is-danger campaign-go', t('members.confirmRevoke'), () => {
      done(true);
    });
    cancel.focus({ preventScroll: true });
  });
}

/** セクションを作る（オンライン連携の欄の直後）。owner でなければ隠したまま */
export function createMemberSettings(
  panel: HTMLElement,
  admin: MemberAdmin,
  before: Element | null,
): { readonly update: (s: OnlineStatus, selfName: string | null) => void } {
  const box = document.createElement('div');
  box.className = 'save-settings online-settings member-settings';
  box.hidden = true;
  panel.insertBefore(box, before);
  const head = el('div', 'member-head', box);
  el('div', 'save-settings-heading', head, t('members.heading'));
  const counts = el('div', 'member-counts', head);
  const reload = smallButton(head, t('members.reload'), 'member-reload');
  const note = el('div', 'save-settings-status online-note', box);
  note.hidden = true;
  const table = el('div', 'member-table', box);
  table.setAttribute('role', 'table');

  let selfId: string | null = null;
  let loaded = false;
  let busy = false;
  const say = (text: string): void => {
    note.textContent = text;
    note.hidden = text === '';
  };

  const act = async (line: MemberLine, action: MemberAction): Promise<void> => {
    if (busy) return;
    if (action === 'revoke' && !(await confirmRevoke(line.name))) return;
    busy = true;
    render();
    try {
      if (await admin.act(line.userId, action))
        say(t('members.result', { name: line.name, text: t(`members.done.${action}`) }));
    } catch (e) {
      say(t('members.result', { name: line.name, text: errorMessage(e) }));
    } finally {
      busy = false;
      render();
    }
  };

  const cell = (parent: HTMLElement, cls: string, text = ''): HTMLElement => {
    const c = el('div', `member-cell ${cls}`, parent, text);
    c.setAttribute('role', 'cell');
    return c;
  };

  const row = (
    line: MemberLine,
    status: 'pending' | 'approved',
    actions: readonly MemberAction[],
  ): void => {
    const r = el('div', `member-row is-${status}`, table);
    r.setAttribute('role', 'row');
    const name = cell(
      r,
      'member-name',
      line.self ? t('members.self', { name: line.name }) : line.name,
    );
    name.title = name.textContent;
    cell(r, 'member-date', line.requested);
    cell(r, 'member-status', t(`members.status.${status}`));
    const ops = cell(r, 'member-actions');
    for (const a of actions) {
      const b = smallButton(
        ops,
        t(`members.action.${a}`),
        a === 'approve' ? 'is-primary' : 'is-danger',
      );
      b.disabled = busy;
      b.addEventListener('click', () => {
        b.blur();
        void act(line, a);
      });
    }
  };

  function render(): void {
    const lists = memberLists(admin.rows, selfId);
    counts.textContent = `${t('members.pending', { count: lists.pending.length })}  ${t('members.approved', { count: lists.approved.length })}`;
    table.replaceChildren();
    const header = el('div', 'member-row member-header', table);
    header.setAttribute('role', 'row');
    for (const [cls, key] of [
      ['member-name', 'members.col.name'],
      ['member-date', 'members.col.requested'],
      ['member-status', 'members.col.status'],
      ['member-actions', 'members.col.actions'],
    ] as const)
      el('div', `member-cell ${cls}`, header, t(key)).setAttribute('role', 'columnheader');
    for (const l of lists.pending) row(l, 'pending', ['approve', 'reject']);
    for (const l of lists.approved) row(l, 'approved', l.self ? [] : ['revoke']);
    if (lists.pending.length + lists.approved.length === 0)
      el('div', 'member-empty', table, t('members.empty'));
    reload.disabled = busy;
  }

  const load = (): void => {
    if (busy) return;
    busy = true;
    say(t('members.loading'));
    render();
    admin
      .load()
      .then(
        () => {
          loaded = true;
          say('');
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        busy = false;
        render();
      });
  };
  reload.addEventListener('click', load);

  /** selfName はサーバーの表示名（= パイロット名。8-6）。変わっていれば自分の行を直す */
  const update = (s: OnlineStatus, selfName: string | null): void => {
    const show = s.owner && s.userId !== null;
    if (s.userId !== selfId) {
      selfId = s.userId;
      loaded = false;
      admin.clear();
    }
    if (selfId !== null && selfName !== null) admin.renameSelf(selfId, selfName);
    box.hidden = !show;
    if (show && !loaded && !busy) load();
    else render();
  };
  render();
  return { update };
}
