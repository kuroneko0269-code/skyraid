import { describe, expect, it } from 'vitest';
import { OnlineError } from '../src/online/backend';
import {
  CODE_FAILURE_TEXT,
  checkCode,
  codeFailure,
  sanitizeCodeInput,
  type CodeFailure,
} from '../src/online/otp';
import { ONLINE_CONFIG } from '../src/data/online';

const EXPIRY_MS = ONLINE_CONFIG.otp.expirySec * 1000;

describe('メールのコード（7-4c）', () => {
  it('入力は数字だけにする（全角は半角に、空白・ハイフン・文字は落とす、10 桁まで）', () => {
    expect(sanitizeCodeInput('12345678')).toBe('12345678');
    expect(sanitizeCodeInput('１２３４ ５６７８')).toBe('12345678');
    expect(sanitizeCodeInput('1234-5678')).toBe('12345678');
    expect(sanitizeCodeInput('ab12cd34')).toBe('1234');
    expect(sanitizeCodeInput('123456789012')).toBe('1234567890');
  });

  it('桁数の検証: 空・4 桁未満は送らない。4〜10 桁は送る', () => {
    expect(checkCode('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkCode('  -- ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkCode('123')).toEqual({ ok: false, reason: 'short' });
    expect(checkCode('1234')).toEqual({ ok: true, code: '1234' });
    expect(checkCode('123456')).toEqual({ ok: true, code: '123456' });
    expect(checkCode('12345678')).toEqual({ ok: true, code: '12345678' });
    expect(checkCode('1234567890')).toEqual({ ok: true, code: '1234567890' });
  });

  it('失敗の種類: 不一致 / 期限切れ（送ってからの時間）/ 回数超過 / 通信エラー', () => {
    const code = new OnlineError('code', 'Token has expired or is invalid');
    expect(codeFailure(code, 60_000)).toBe('mismatch');
    expect(codeFailure(code, EXPIRY_MS + 1)).toBe('expired');
    expect(codeFailure(new OnlineError('rate', '429'), 0)).toBe('attempts');
    expect(codeFailure(new OnlineError('network', 'fetch'), 0)).toBe('network');
    expect(codeFailure(new OnlineError('denied', 'x'), 0)).toBe('unknown');
    expect(codeFailure(new Error('x'), 0)).toBe('unknown');
  });

  it('エラー文言の対応表: すべての種類に短い日本語の一言がある', () => {
    const kinds: CodeFailure[] = [
      'empty',
      'short',
      'mismatch',
      'expired',
      'attempts',
      'network',
      'unknown',
    ];
    expect(Object.keys(CODE_FAILURE_TEXT).sort()).toEqual([...kinds].sort());
    for (const k of kinds) {
      const t = CODE_FAILURE_TEXT[k];
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(40);
      expect(/[ぁ-んァ-ン]/.test(t)).toBe(true);
    }
    expect(CODE_FAILURE_TEXT.short).toContain('4〜10');
  });
});
