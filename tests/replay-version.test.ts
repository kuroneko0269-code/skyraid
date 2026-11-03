// リプレイの版（8-7 の事前修正）: 記録に作成時のゲームの版を持たせ（.skyreplay にも入る）、今の版と違う記録・版を持たない
// 古い記録は再生の始めに「前の版（vX）の記録なので、結果が変わることがあります」と断る（再生は止めない）
import { describe, expect, it } from 'vitest';
import { decodeReplay, encodeReplay } from '../src/replay/codec';
import { replayVersionNotice } from '../src/replay/outcome';
import { replayGameVersion, type ReplayData, type ReplayHeader } from '../src/replay/types';
import { useLocale } from './i18n-helpers';
import { BASE_START, createWorld, record } from './replay-helpers';

const base = record(createWorld(), BASE_START, { seconds: 1 }).data;

function withVersion(v: unknown): ReplayHeader {
  const header: Record<string, unknown> = { ...base.header };
  if (v === undefined) delete header.gameVersion;
  else header.gameVersion = v;
  // 書き出して読み直す（.skyreplay と同じ経路）
  const data: ReplayData = { ...base, header: header as unknown as ReplayHeader };
  return decodeReplay(encodeReplay(data)).header;
}

describe('リプレイの版', () => {
  it('記録に作成時のゲームの版が入り、書き出し・読み込みで残る', () => {
    expect(base.header.gameVersion).toBe('1.0.0');
    expect(replayGameVersion(withVersion('1.0.0'))).toBe('1.0.0');
  });

  it('同じ版なら断らない。違う版は版を出して断る', () => {
    useLocale('ja');
    expect(replayVersionNotice(withVersion('1.0.0'), '1.0.0')).toBeNull();
    expect(replayVersionNotice(withVersion('1.0.0'), '1.1.0')).toBe(
      '前の版（v1.0.0）の記録なので、結果が変わることがあります',
    );
    useLocale('en');
    expect(replayVersionNotice(withVersion('1.0.0'), '1.1.0')).toBe(
      'Recorded on an earlier version (v1.0.0), so the result may differ',
    );
    useLocale('ja');
  });

  it('版を持たない古い記録・形の違う版も前の版として断る', () => {
    useLocale('ja');
    const msg = '前の版（v0.9.0 以前）の記録なので、結果が変わることがあります';
    expect(replayVersionNotice(withVersion(undefined), '1.0.0')).toBe(msg);
    expect(replayVersionNotice(withVersion(42), '1.0.0')).toBe(msg);
    expect(replayVersionNotice(withVersion('<b>x</b>'), '1.0.0')).toBe(msg);
  });
});
