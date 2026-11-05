// 8-6c: レイドの文の難易度ごとの正しさ。脚のダウン中のダメージ 2 倍は高難度だけ（通常は 8-6b でなくした）。
// 最終フェーズの制限時間はデータ（通常 4.5 分・高難度 3.5 分）と同じ
import { describe, expect, it } from 'vitest';
import { tList } from '../src/core/i18n';
import { KAIJU_CONFIG } from '../src/data/kaiju';
import { RAID_BRIEFING, RAID_RULES, raidTuning } from '../src/data/raid';
import { useLocale } from './i18n-helpers';

const DOUBLE = /×2|2 倍|double/i;

describe('レイドの文（8-6c）', () => {
  it('データ: ダウン中の倍率は通常 ×1・高難度 ×2、最終フェーズは 330 / 210 秒（9-7 の事前修正で通常 270 → 330）', () => {
    expect(raidTuning(false).downDamageScale).toBe(1);
    expect(raidTuning(true).downDamageScale).toBe(2);
    expect(KAIJU_CONFIG.phases.finalSeconds).toBe(330);
    expect(RAID_RULES.hard.finalSeconds).toBe(210);
  });

  for (const locale of ['ja', 'en'] as const)
    it(`${locale}: 協力のブリーフィングは通常に 2 倍の記述なし・高難度にあり。ソロの説明は両方の難易度を書き分ける`, () => {
      useLocale(locale);
      expect(RAID_BRIEFING.linesFor(false).some((l) => DOUBLE.test(l))).toBe(false);
      expect(RAID_BRIEFING.linesFor(true).some((l) => DOUBLE.test(l))).toBe(true);
      expect(RAID_BRIEFING.linesFor(false)).toHaveLength(RAID_BRIEFING.linesFor(true).length);
      const solo = tList('missions.raid.briefing').join('\n');
      expect(solo).toMatch(/5\.5/);
      expect(solo).toMatch(/3\.5/);
      expect(solo).toMatch(locale === 'ja' ? /高難度[^。]*2 倍/ : /Hard[^.]*double/);
    });
});
