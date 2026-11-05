// 7-D: メニューの再設計（自己ベスト（セーブ v9）・カードの進捗・更新履歴・情報画面の版とライセンス）。設定画面の戻り先は tests/game-state.test.ts
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from 'virtual:app-info';
import { LICENSES } from 'virtual:app-licenses';
import changelogText from '../docs/changelog.md?raw';
import packageText from '../package.json?raw';
import { parseChangelog } from '../src/core/changelog';
import { SAVE_CONFIG } from '../src/data/save';
import { formatMinutes, modeProgress } from '../src/progression/mode-progress';
import { createInitialSave, migrateSave } from '../src/progression/save';
import {
  bestDefenseWaves,
  bestRaidMs,
  normalizeRecords,
  recordDefenseWaves,
  recordRaidTime,
} from '../src/progression/save-records';
import { GLYPH_KINDS, glyphShapeCount } from '../src/ui/glyphs';

describe('自己ベスト（セーブ v9）', () => {
  it('v8 のデータに空の記録を足す。ほかはそのまま', () => {
    expect(SAVE_CONFIG.version).toBe(10);
    const v8: Record<string, unknown> = { ...createInitialSave(), version: 8, credits: 777 };
    delete v8.records;
    const save = migrateSave(v8);
    expect(save?.version).toBe(SAVE_CONFIG.version);
    expect(save?.records).toEqual({
      defenseWaves: {},
      raidBestMs: {},
      practice: {},
      tutorial: [],
      daily: { days: {}, streak: { last: null, count: 0 } },
    });
    expect(save?.credits).toBe(777);
  });

  it('防衛戦は多いときだけ、レイドは速いときだけ更新する', () => {
    const r = normalizeRecords(null);
    expect(recordDefenseWaves(r, 'island:normal', 4)).toBe(true);
    expect(recordDefenseWaves(r, 'island:normal', 3)).toBe(false);
    expect(recordDefenseWaves(r, 'harbor:hard', 7)).toBe(true);
    expect(recordDefenseWaves(r, 'island:normal', 12)).toBe(true);
    expect(r.defenseWaves['island:normal']).toBe(10);
    expect(bestDefenseWaves(r)).toBe(10);
    expect(recordRaidTime(r, 'normal', 600_000)).toBe(true);
    expect(recordRaidTime(r, 'normal', 700_000)).toBe(false);
    expect(recordRaidTime(r, 'hard', 540_400)).toBe(true);
    expect(recordRaidTime(r, 'hard', 0)).toBe(false);
    expect(bestRaidMs(r)).toBe(540_400);
  });

  it('壊れた値は捨てる', () => {
    const r = normalizeRecords({
      defenseWaves: { a: 3, b: -1, c: 11, d: 'x' },
      raidBestMs: { normal: 5000, hard: 0, x: Number.NaN },
    });
    expect(r).toEqual({
      defenseWaves: { a: 3 },
      raidBestMs: { normal: 5000 },
      practice: {},
      tutorial: [],
      daily: { days: {}, streak: { last: null, count: 0 } },
    });
  });
});

describe('モード選択のカードの進捗', () => {
  it('キャンペーンのクリア数・レースのランクの数・防衛戦の最高波・レイドの最速', () => {
    const save = createInitialSave();
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
    expect(modeProgress(save, ids)).toEqual({ campaign: '0/5 クリア' });
    save.missions.m1 = { unlocked: true, bestRank: 'A' };
    save.missions.m2 = { unlocked: true, bestRank: 'S' };
    save.missions.m3 = { unlocked: true, bestRank: 'C' };
    save.missions.m4 = { unlocked: true, bestRank: null };
    const race = (bestRank: 'S' | 'A' | null) => ({ bestRank, clears: 1, times: [], ghost: null });
    save.races = { coast: race('S'), canyon: race('A'), harbor: race('S'), dusk: race(null) };
    save.records.defenseWaves['island:normal'] = 7;
    save.records.raidBestMs.normal = 754_900;
    expect(modeProgress(save, ids)).toEqual({
      campaign: '3/5 クリア',
      race: 'S×2・A×1',
      defense: '最高 7 波',
      raid: '最速 12:34',
    });
  });

  it('分:秒', () => {
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(65_999)).toBe('1:05');
    expect(formatMinutes(3_725_000)).toBe('62:05');
  });
});

describe('情報画面（版・更新履歴・ライセンス）', () => {
  it('版は package.json の version', () => {
    const pkg: unknown = JSON.parse(packageText);
    expect(pkg).toMatchObject({ version: APP_VERSION });
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('更新履歴は「## 見出し」ごとに項目を読み、続きの行をつなぐ', () => {
    const entries = parseChangelog(
      '# 題\n説明\n\n## 1.1.0（2026-11-02）\n- 新しい\n  続き\n* 2 つ目\n\n## 1.0.0\n- 最初\n',
    );
    expect(entries).toEqual([
      { title: '1.1.0（2026-11-02）', items: ['新しい 続き', '2 つ目'] },
      { title: '1.0.0', items: ['最初'] },
    ]);
    const real = parseChangelog(changelogText);
    expect(real[0]?.title).toContain(APP_VERSION);
    expect(real[0]?.items.length).toBeGreaterThan(0);
  });

  it('ライセンスの一覧は配信する依存（three・peerjs・supabase とその依存・SW の workbox）を含み、本文がある', () => {
    const names = LICENSES.map((l) => l.name);
    for (const n of ['three', 'peerjs', '@supabase/supabase-js', 'workbox-precaching'])
      expect(names, n).toContain(n);
    // peerjs の依存もたどる
    expect(names).toContain('eventemitter3');
    // ビルドだけに使うものは入れない
    for (const n of ['vite', 'typescript', 'vitest', 'eslint']) expect(names).not.toContain(n);
    for (const l of LICENSES) {
      expect(l.license, l.name).not.toBe('');
      expect(l.version, l.name).toMatch(/^\d/);
    }
    expect(LICENSES.find((l) => l.name === 'three')?.text).toMatch(/MIT|Permission is hereby/);
  });
});

describe('背景グリフ', () => {
  it('15 種類（9-5 で練習場の的・9-9 で日めくり・9-10 で勲章）それぞれに線がある', () => {
    expect(GLYPH_KINDS).toHaveLength(15);
    for (const k of GLYPH_KINDS) expect(glyphShapeCount(k), k).toBeGreaterThan(0);
  });
});
