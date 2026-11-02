// ポーズメニューの設定「オンライン連携」（7-4）: 状態（未連携 / 承認待ち / 連携中 / エラー）、メール → コード（4〜10 桁。7-4c）→ ログイン、
// パイロット名（8-6: 名前はパイロット名の 1 つ。設定 → データと同じ「今の名前 + 変更」）、オンライン連携の ON/OFF（OFF は送信・同期・ランキングを止める。ログインは保持）、ログアウト。
// 環境変数が無いとき（オフライン）はこのセクション自体を作らない（ui/online-link.ts）
import './online.css';
import { t } from '../core/i18n';
import { errorMessage, joinFailureText } from '../online/messages';
import { isEmail } from '../online/format';
import {
  CODE_FAILURE_TEXT,
  checkCode,
  codePlaceholder,
  codeFailure,
  sanitizeCodeInput,
} from '../online/otp';
import type { OnlineService, OnlineStatus } from '../online/service';
import { el } from './hud-dom';
import { isolateKeys } from './pilot-name';
import { createToggleButton } from './mobile';
import { createPilotRenameControls } from './pilot-rename';
import { isStandaloneDisplay } from './standalone';

/** 承認待ちの案内（7-4b: 申請は自動で送り、承認されれば 5 分以内に自動で連携中になる） */
function pendingText(s: OnlineStatus): string {
  const email = s.email ?? '';
  if (s.join === 'rejected') return t('online.pending.rejected', { email });
  // 申請が送れていない（7-4d）: 承認待ちの案内の代わりに失敗の種類を出す（管理者の一覧に載っていないため）
  if (s.joinError)
    return t('online.pending.joinError', {
      reason: joinFailureText(s.joinError.kind, s.joinError.detail),
      email,
    });
  return t('online.pending.waiting', { email });
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
  el('div', 'save-settings-heading', box, t('online.heading'));
  const state = el('div', 'online-state', box);
  const note = el('div', 'save-settings-status online-note', box);

  // 未連携: メール → コード
  const signIn = el('div', 'online-form', box);
  const email = field(signIn, 'email', t('online.emailPlaceholder'));
  email.autocomplete = 'email';
  const sendRow = el('div', 'save-settings-row', signIn);
  const send = button(sendRow, t('online.sendCode'));
  const codeRow = el('div', 'online-form', box);
  const placeholder = codePlaceholder();
  const code = field(codeRow, 'text', placeholder);
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.pattern = '[0-9]*';
  code.setAttribute('aria-label', placeholder);
  // 失敗はコード欄のすぐ下に出す（7-4c: 上の案内は背の低い画面だとスクロールの外で見えなかった）
  const codeError = el('div', 'online-code-error', codeRow);
  codeError.setAttribute('role', 'alert');
  codeError.hidden = true;
  const verifyRow = el('div', 'save-settings-row', codeRow);
  const verify = button(verifyRow, t('online.signIn'));
  const resend = button(verifyRow, t('online.reenterEmail'));
  // ホーム画面のアプリ（PWA）ではメールのリンクが Safari で開き、別の保存領域になる → コード入力が唯一の経路
  if (isStandaloneDisplay())
    el('div', 'online-hint is-strong', codeRow, t('online.standaloneHint'));
  el('div', 'online-hint', codeRow, t('online.spamHint'));

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
  const recheck = button(pendingRow, t('online.recheck'));

  // 連携中: パイロット名（8-6。前は別の「表示名」を入れられ、パイロット名と食い違った）
  const nameRow = el('div', 'online-form online-pilot', box);
  el('div', 'online-hint', nameRow, t('online.nameHint'));
  createPilotRenameControls(nameRow);

  const toggle = createToggleButton(box, t('online.toggle'), service.status.enabled, () => {
    service.setEnabled(!service.status.enabled);
    return service.status.enabled;
  });
  const signOut = button(box, t('online.signOut'));

  let codeSentTo: string | null = null;
  let codeSentAt = 0;
  // 今の案内が承認待ちの案内か（承認待ちを抜けたら消す）
  let pendingShown = false;
  const say = (text: string, pending = false): void => {
    pendingShown = pending;
    note.textContent = text;
    note.hidden = text === '';
  };

  const render = (s: OnlineStatus): void => {
    const signedIn = s.state === 'pending' || s.state === 'linked' || s.userId !== null;
    const label = t(`online.state.${s.state}`);
    state.textContent =
      s.state === 'linked' && !s.enabled
        ? t('online.statusOff', { state: label })
        : t('online.status', { state: label });
    state.dataset.state = s.state;
    signIn.hidden = signedIn || codeSentTo !== null;
    codeRow.hidden = signedIn || codeSentTo === null;
    pendingRow.hidden = s.state !== 'pending';
    nameRow.hidden = !(s.state === 'linked' && s.enabled);
    toggle.button.hidden = !signedIn;
    toggle.sync(s.enabled);
    signOut.hidden = !signedIn;
    if (s.state === 'pending') say(pendingText(s), true);
    else if (s.state === 'error') say(errorMessage(s.error ?? 'unknown'));
    else if (pendingShown) say('');
  };

  send.addEventListener('click', () => {
    const v = email.value.trim();
    if (!isEmail(v)) {
      say(t('online.checkEmail'));
      return;
    }
    send.disabled = true;
    say(t('online.sending'));
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
              ? t('online.codeSent', { email: v })
              : t('online.codeSentLink', { email: v }),
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
    say(t('online.verifying'));
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
      if (service.status.state === 'pending')
        say(t('online.pending.notYet', { text: pendingText(service.status) }), true);
    });
  });

  signOut.addEventListener('click', () => {
    void service.signOut().catch(() => undefined);
    say(t('online.signedOut'));
  });

  service.onStatus(render);
  render(service.status);
  return { say };
}
