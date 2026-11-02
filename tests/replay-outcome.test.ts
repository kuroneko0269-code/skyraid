// リプレイの結果の表示（8-5 の事前修正）: 新しい記録は種類と数値から今の言語で組み立て、古い記録（文字列だけ）はそのまま出す。
// .skyreplay は古い版の記録も読め、新しい記録も形式の版を変えない（古い版のゲームは label を読む）
import { describe, expect, it } from 'vitest';
import { REPLAY_CONFIG } from '../src/data/replay';
import { decodeReplay, encodeReplay } from '../src/replay/codec';
import { replayOutcomeLabel } from '../src/replay/outcome';
import type { ReplayData, ReplayOutcome } from '../src/replay/types';
import { useLocale } from './i18n-helpers';
import { BASE_START, createWorld, record } from './replay-helpers';

const base = record(createWorld(), BASE_START, { seconds: 1 }).data;

/** 結果を差し替えた記録を書き出して読み直す */
function roundTrip(outcome: ReplayOutcome | null, format = REPLAY_CONFIG.format): ReplayData {
  const data: ReplayData = { ...base, header: { ...base.header, outcome, format } };
  const bytes = encodeReplay(data);
  // 書き出しの 5 バイト目が形式の版（'SKYR' + 版）。古い版のファイルを作る
  bytes[4] = format;
  return decodeReplay(bytes);
}

describe('リプレイの結果の表示', () => {
  it('8-5 より前の記録（文字列だけ）は記録した文字列をどの言語でもそのまま出す', () => {
    const old = roundTrip({ label: '成功 S', success: true }, 1);
    useLocale('en');
    expect(replayOutcomeLabel(old.header.outcome)).toBe('成功 S');
    useLocale('ja');
    expect(replayOutcomeLabel(old.header.outcome)).toBe('成功 S');
  });

  it('新しい記録は種類と数値から今の言語で組み立てる（label も古い版のために残る）', () => {
    const cases: [ReplayOutcome, string, string][] = [
      [
        { label: '1:23.456 A', success: true, result: { kind: 'race', time: 83.456, rank: 'A' } },
        '1:23.456 A',
        '1:23.456 A',
      ],
      [
        { label: '成功 S', success: true, result: { kind: 'success', rank: 'S' } },
        '成功 S',
        'Success S',
      ],
      [
        { label: '撃墜 3', success: true, result: { kind: 'kills', count: 3 } },
        '撃墜 3',
        '3 kills',
      ],
      [
        { label: '陥落（1 波）', success: false, result: { kind: 'fallen', count: 1 } },
        '陥落（1 波）',
        'Fallen (1 wave)',
      ],
      [{ label: '中断', success: false, result: { kind: 'aborted' } }, '中断', 'Aborted'],
      [
        { label: 'TIME OVER', success: false, result: { kind: 'timeout' } },
        'TIME OVER',
        'TIME OVER',
      ],
    ];
    for (const [outcome, ja, en] of cases) {
      const back = roundTrip(outcome);
      expect(back.header.outcome).toEqual(outcome);
      useLocale('ja');
      expect(replayOutcomeLabel(back.header.outcome)).toBe(ja);
      useLocale('en');
      expect(replayOutcomeLabel(back.header.outcome)).toBe(en);
    }
  });

  it('読めない種類・数値（壊れた・手で書き換えたファイル）は記録した文字列に戻す', () => {
    const bad = [
      { kind: 'kills', count: -1 },
      { kind: 'kills', count: 'x' },
      { kind: 'race', time: Number.NaN, rank: 'A' },
      { kind: 'success', rank: '<b>S</b>' },
      { kind: 'unknown' },
      'success',
    ];
    useLocale('en');
    for (const result of bad) {
      const o = { label: 'saved text', success: true, result } as unknown as ReplayOutcome;
      expect(replayOutcomeLabel(o)).toBe('saved text');
    }
    expect(replayOutcomeLabel(null)).toBeNull();
  });
});
