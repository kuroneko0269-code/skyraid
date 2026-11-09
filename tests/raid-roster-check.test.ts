// 10-6: 5 体を通した点検（怪獣選び・解放の条件・勲章・ランキングと記録のキー・画像・文言・協力の設定・体への衝突）。怪獣ごとの細かい
// 確かめは各怪獣のテストにあり、ここは「5 体とも同じ扱いになっているか」を登録簿から並べて見る
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasMessage } from '../src/core/i18n';
import { BADGE_LIST } from '../src/data/badges-order';
import { KAIJU_RAM } from '../src/data/kaiju-ram';
import { NET_CONFIG } from '../src/data/net';
import { rankedOf } from '../src/data/online';
import {
  RAID_KAIJU,
  RAID_KEY_PATTERN,
  XENOLITH_UNLOCK,
  raidKaijuIndex,
  raidRecordKey,
} from '../src/data/raid-kaiju';
import { ByteReader, ByteWriter } from '../src/net/codec';
import { readSettings, writeSettings } from '../src/net/codec-lobby';
import { initialSettings } from '../src/net/lobby-rules';
import { useLocale } from './i18n-helpers';

describe('10-6: 5 体を通した点検', () => {
  it('5 体とも公開・協力あり・画像（正方形の WebP）がある', () => {
    expect(RAID_KAIJU.map((k) => k.id)).toEqual([
      'vorgas',
      'nephirga',
      'albion',
      'gourai',
      'xenolith',
    ]);
    for (const k of RAID_KAIJU) {
      expect(k.dev).toBeNull();
      expect(k.coop).toBe(true);
      const art = readFileSync(new URL(`../public/${k.art}`, import.meta.url));
      expect(art.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(art.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect(art.length).toBeGreaterThan(10_000);
    }
  });

  it('怪獣選びの文言（一言・大きさ・動き・部位・攻めどき・難易度・攻撃）が日本語・英語ともにある', () => {
    for (const locale of ['ja', 'en'] as const) {
      useLocale(locale);
      for (const k of RAID_KAIJU) {
        for (const f of ['tagline', 'size', 'motion', 'parts', 'opening', 'normal', 'hard'])
          expect(hasMessage(`raidSelect.kaiju.${k.id}.${f}`), `${locale} ${k.id}.${f}`).toBe(true);
        for (const a of k.attacks)
          for (const f of ['name', 'note'])
            expect(hasMessage(`raidSelect.kaiju.${k.id}.attacks.${a}.${f}`), `${k.id} ${a}`).toBe(
              true,
            );
      }
    }
    useLocale('ja');
  });

  it('解放の条件はゼノリスだけ（ほかの 4 体のうち 2 体を通常でクリア）', () => {
    for (const k of RAID_KAIJU) expect(k.unlock).toBe(k.id === 'xenolith' ? XENOLITH_UNLOCK : null);
    expect(XENOLITH_UNLOCK.count).toBe(2);
    expect([...XENOLITH_UNLOCK.kaiju].sort()).toEqual(['albion', 'gourai', 'nephirga', 'vorgas']);
  });

  it('記録のキー・ランキング: 5 体 × 2 難易度のキーが重ならず、SQL 0006 の後は 5 体とも送る', () => {
    const keys = RAID_KAIJU.flatMap((k) => [
      raidRecordKey(k.id, 'normal'),
      raidRecordKey(k.id, 'hard'),
    ]);
    expect(new Set(keys).size).toBe(10);
    for (const key of keys.slice(2)) expect(key).toMatch(RAID_KEY_PATTERN);
    expect(rankedOf(RAID_KAIJU, true)).toEqual(RAID_KAIJU.map((k) => k.id));
  });

  it('勲章: 5 体とも標準の 10 個 + 怪獣ごとの勲章がレイドのカテゴリにある', () => {
    const raid = BADGE_LIST.filter((b) => b.group === 'raid').map((b) => b.id);
    for (const k of RAID_KAIJU) {
      const own = raid.filter((id) => id.toLowerCase().includes(k.id));
      expect(own.length, k.id).toBeGreaterThanOrEqual(10 + k.badges.length);
      for (const b of k.badges) expect(raid).toContain(b.id);
    }
  });

  it('協力: 5 体とも部屋の設定に入り、往復しても同じ（2〜4 人の部屋）', () => {
    expect(NET_CONFIG.maxPlayers).toBe(4);
    for (const k of RAID_KAIJU) {
      const s = initialSettings(true, null, raidKaijuIndex(k.id));
      if (!s) throw new Error('settings');
      const w = new ByteWriter();
      writeSettings(w, s);
      expect(readSettings(new ByteReader(w.finish())).raidKaiju).toBe(raidKaijuIndex(k.id));
    }
  });

  it('体への衝突: 5 体とも共通の扱い（最大 HP の約 8 割・跳ねない・1.5 秒は続けて当たらない）', () => {
    expect(KAIJU_RAM).toEqual({ hpShare: 0.8, invulnerable: 1.5 });
  });
});
