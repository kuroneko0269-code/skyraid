import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeQr, type QrCode } from '../src/core/qr';

/** QR コードを RGBA の画像にして jsQR で読む（余白 4 モジュール・1 モジュール 4px） */
function decode(qr: QrCode): string | null {
  const scale = 4;
  const quiet = 4;
  const w = (qr.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y * qr.size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, w, w)?.data ?? null;
}

describe('QR コード（5-4。ロビーの参加用 URL）', () => {
  it.each([
    'https://skyraid.pages.dev/?room=ABCDEF',
    'http://localhost:5173/?room=Z9K2QX',
    'A',
    'https://example.com/' + 'x'.repeat(60) + '?room=HJKLMN',
    'https://skyraid-preview-branch-name.skyraid.pages.dev/?room=PQRSTU&net=local',
  ])('作った QR コードを読むと元の文字列になる: %s', (text) => {
    const qr = encodeQr(text);
    expect(qr).not.toBeNull();
    if (!qr) return;
    expect(decode(qr)).toBe(text);
  });

  it('型番 1〜10 の全部（大きさ 21〜57）で読める', () => {
    const sizes = new Set<number>();
    for (let len = 1; len <= 213; len += 4) {
      const text = 'Q'.repeat(len);
      const qr = encodeQr(text);
      if (!qr) throw new Error(`encode ${len}`);
      sizes.add(qr.size);
      expect(decode(qr)).toBe(text);
    }
    expect(Math.min(...sizes)).toBe(21);
    expect(Math.max(...sizes)).toBe(57);
  });

  it('日本語（UTF-8）も読める・長すぎれば null', () => {
    const qr = encodeQr('部屋コード ABCDEF');
    if (!qr) throw new Error('encode');
    expect(decode(qr)).toBe('部屋コード ABCDEF');
    expect(encodeQr('x'.repeat(300))).toBeNull();
  });
});
