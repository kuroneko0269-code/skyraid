// ポーズメニューの設定「オンライン連携」（7-4）: 状態（未連携 / 承認待ち / 連携中 / エラー）、メール → コード（4〜10 桁。7-4c）→ ログイン、
// 表示名、オンライン連携の ON/OFF（OFF は送信・同期・ランキングを止める。ログインは保持）、ログアウト。
// 環境変数が無いとき（オフライン）はこのセクション自体を作らない（ui/online-link.ts）
import './online.css';
import { errorMessage } from '../online/messages';
import { isEmail } from '../online/format';
import {
  CODE_FAILURE_TEXT,
  CODE_PLACEHOLDER,
  checkCode,
  codeFailure,
  sanitizeCodeInput,
} from '../online/otp';
import type { OnlineService, OnlineStatus } from '../online/service';
import { el } from './hud-dom';
import { isolateKeys } from './pilot-name';
import { createToggleButton } from './mobile';
import { isStandaloneDisplay } from './standalone';

const SPAM_HINT = 'メールが届かない場合は迷惑メールフォルダを確認してください';
const STANDALONE_HINT =
  'ホーム画面のアプリではメールのリンクは使えません。コードを入力してください';

const STATE_LABELS = {
  signedOut: '未連携',
  pending: '承認待ち',
  linked: '連携中',
  error: 'エラー',
} as const;

const PENDING_PREFIX = '【承認待ち】';

/** 承認待ちの案内（7-4b: 申請は自動で送り、承認されれば 5 分以内に自動で連携中になる） */
function pendingText(s: OnlineStatus): string {
  const who = `ログイン中: ${s.email ?? ''}`;
  if (s.join === 'rejected')
    return `${PENDING_PREFIX}管理者に承認されませんでした。必要なら管理者に連絡してください（${who}）`;
  return `${PENDING_PREFIX}管理者が承認すると遊べます。承認されると自動で「連携中」に変わります（${who}）`;
}

function button(parent: HTMLElement, label: string): HTMLButtonElement {
  const b = el('button', 'ui-toggle settings-item settings-button', parent, label);
  b.type = 'button';
  return b;
}

function field(parent: HTMLElement, type: string, placeholder: string): HTMLInputElement {
  const f = el('input', 'ui-field online-field', parent);
  f.type = type;
  f.placeholder = placeholder;
  f.spellcheck = false;
  isolateKeys(f);
  return f;
}

/** セクションを作る。before があればその前に（セーブデータの欄の上） */
export function createOnlineSettings(
  panel: HTMLElement,
  service: OnlineService,
  before: Element | null,
): { readonly say: (text: string) => void } {
  const box = document.createElement('div');
  box.className = 'save-settings online-settings';
  panel.insertBefore(box, before);
  el('div', 'save-settings-heading', box, 'オンライン連携');
  const state = el('div', 'online-state', box);
  const note = el('div', 'save-settings-status online-note', box);

  // 未連携: メール → コード
  const signIn = el('div', 'online-form', box);
  const email = field(signIn, 'email', 'メールアドレス');
  email.autocomplete = 'email';
  const sendRow = el('div', 'save-settings-row', signIn);
  const send = button(sendRow, 'コードを送る');
  const codeRow = el('div', 'online-form', box);
  const code = field(codeRow, 'text', CODE_PLACEHOLDER);
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.pattern = '[0-9]*';
  code.setAttribute('aria-label', CODE_PLACEHOLDER);
  // 失敗はコード欄のすぐ下に出す（7-4c: 上の案内は背の低い画面だとスクロールの外で見えなかった）
  const codeError = el('div', 'online-code-error', codeRow);
  codeError.setAttribute('role', 'alert');
  codeError.hidden = true;
  const verifyRow = el('div', 'save-settings-row', codeRow);
  const verify = button(verifyRow, 'ログイン');
  const resend = button(verifyRow, 'メールを入れ直す');
  // ホーム画面のアプリ（PWA）ではメールのリンクが Safari で開き、別の保存領域になる → コード入力が唯一の経路
  if (isStandaloneDisplay()) el('div', 'online-hint is-strong', codeRow, STANDALONE_HINT);
  el('div', 'online-hint', codeRow, SPAM_HINT);

  const showCodeError = (text: string): void => {
    codeError.textContent = text;
    codeError.hidden = text === '';
  };
  // 数字以外は入力したそばから落とす（日本語入力の変換中は待つ）
  const cleanCode = (): void => {
    const v = sanitizeCodeInput(code.value);
    if (v !== code.value) code.value = v;
    showCodeError('');
  };
  code.addEventListener('input', (e) => {
    if (!(e instanceof InputEvent && e.isComposing)) cleanCode();
  });
  code.addEventListener('compositionend', cleanCode);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) verify.click();
  });

  // 承認待ち: 案内・再確認
  const pendingRow = el('div', 'save-settings-row', box);
  const recheck = button(pendingRow, '承認を再確認');

  // 連携中: 表示名
  const nameRow = el('div', 'online-form', box);
  const name = field(nameRow, 'text', '表示名（1〜16 文字。ランキングに出ます）');
  name.maxLength = 32;
  const nameButtons = el('div', 'save-settings-row', nameRow);
  const saveName = button(nameButtons, '表示名を保存');

  const toggle = createToggleButton(box, 'オンライン連携', service.status.enabled, () => {
    service.setEnabled(!service.status.enabled);
    return service.status.enabled;
  });
  const signOut = button(box, 'ログアウト');

  let codeSentTo: string | null = null;
  let codeSentAt = 0;
  let message = '';
  const say = (text: string): void => {
    message = text;
    note.textContent = text;
    note.hidden = text === '';
  };

  const render = (s: OnlineStatus): void => {
    const signedIn = s.state === 'pending' || s.state === 'linked' || s.userId !== null;
    state.textContent = `状態: ${STATE_LABELS[s.state]}${s.state === 'linked' && !s.enabled ? '（OFF: 送信・同期・ランキングを停止中）' : ''}`;
    state.dataset.state = s.state;
    signIn.hidden = signedIn || codeSentTo !== null;
    codeRow.hidden = signedIn || codeSentTo === null;
    pendingRow.hidden = s.state !== 'pending';
    nameRow.hidden = !(s.state === 'linked' && s.enabled);
    toggle.button.hidden = !signedIn;
    toggle.sync(s.enabled);
    signOut.hidden = !signedIn;
    if (s.state === 'pending') say(pendingText(s));
    else if (s.state === 'error') say(errorMessage(s.error ?? 'unknown'));
    else if (message.startsWith(PENDING_PREFIX)) say('');
  };

  send.addEventListener('click', () => {
    const v = email.value.trim();
    if (!isEmail(v)) {
      say('メールアドレスを確かめてください');
      return;
    }
    send.disabled = true;
    say('送信中…');
    service
      .sendCode(v)
      .then(
        () => {
          codeSentTo = v;
          codeSentAt = Date.now();
          code.value = '';
          showCodeError('');
          say(
            isStandaloneDisplay()
              ? `${v} にコードを送りました。メールのコードを入力してください`
              : `${v} にコードを送りました。メールのコードを入力してください（メールのリンクを開いても連携できます）`,
          );
          render(service.status);
          code.focus({ preventScroll: true });
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        send.disabled = false;
      });
  });

  verify.addEventListener('click', () => {
    if (codeSentTo === null) return;
    const checked = checkCode(code.value);
    if (!checked.ok) {
      showCodeError(CODE_FAILURE_TEXT[checked.reason]);
      return;
    }
    code.value = checked.code;
    verify.disabled = true;
    showCodeError('');
    say('確認中…');
    service
      .verifyCode(codeSentTo, checked.code)
      .then(
        () => {
          codeSentTo = null;
          say('');
          render(service.status);
        },
        (e: unknown) => {
          say('');
          showCodeError(CODE_FAILURE_TEXT[codeFailure(e, Date.now() - codeSentAt)]);
        },
      )
      .finally(() => {
        verify.disabled = false;
      });
  });

  resend.addEventListener('click', () => {
    codeSentTo = null;
    showCodeError('');
    say('');
    render(service.status);
  });

  recheck.addEventListener('click', () => {
    recheck.disabled = true;
    void service.recheck().finally(() => {
      recheck.disabled = false;
      if (service.status.state === 'pending') say(`${pendingText(service.status)}（まだです）`);
    });
  });

  saveName.addEventListener('click', () => {
    saveName.disabled = true;
    service
      .setDisplayName(name.value)
      .then(
        (clean) => {
          if (clean === null) say('表示名は 1〜16 文字で入力してください');
          else {
            name.value = clean;
            say('表示名を保存しました');
          }
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        saveName.disabled = false;
      });
  });

  signOut.addEventListener('click', () => {
    void service.signOut().catch(() => undefined);
    say('ログアウトしました（このページのセーブはそのまま残ります）');
  });

  service.onStatus((s) => {
    render(s);
    // 表示名（入力中は書き換えない）
    if (document.activeElement !== name) name.value = service.profileName ?? '';
  });
  render(service.status);
  return { say };
}
