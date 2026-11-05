// 8-1 公開チェック: どの版（v1〜v10）のセーブから起動しても今の版まで移行して読めること（JSON の文字列から）。
// 各版で足した項目は、その版のセーブに「遊んだ跡」を入れて、後の移行で消えないことも確かめる。
// 移行の 1 段ずつの中身は save / hangar / difficulty-assist / controls / race-save / replay-save-v7 / skins / menu の各テスト
import { describe, expect, it } from 'vitest';
import { SAVE_CONFIG } from '../src/data/save';
import { SAVE_MIGRATIONS, parseSave } from '../src/progression/save';

type Json = Record<string, unknown>;

/** 3-1 の v1 のセーブ（初期機 starter・Lv1 が未強化・設定は画質など 6 つ） */
const V1: Json = {
  version: 1,
  pilotName: 'ACE',
  credits: 12345,
  missions: { m1: { unlocked: true, bestRank: 'A' }, m2: { unlocked: true, bestRank: null } },
  aircraft: {
    selected: 'starter',
    owned: { starter: { engine: 3, airframe: 1, weapons: 2, avionics: 1 } },
  },
  settings: {
    quality: 'medium',
    qualityAuto: false,
    touchControls: 'auto',
    enemies: true,
    difficulty: 'hard',
    hud: true,
  },
};

/** レースのベスト 5 の 1 行（7-1） */
const lap = (time: number): Json => ({
  time,
  aircraftId: 'kestrel',
  aircraftName: 'KESTREL',
  date: '2026-10-31',
  loadoutHash: 'abcd',
  missed: 0,
});

/** 版 v のセーブを作る: v1 から移行を通し、その版で足した項目に遊んだ跡を入れる */
function saveAt(v: number): Json {
  let d: Json = structuredClone(V1);
  for (let k = 1; k < v; k++) {
    const step = SAVE_MIGRATIONS[k];
    if (!step) throw new Error(`v${k} の移行がありません`);
    d = step(d);
    d.version = k + 1;
    const settings = d.settings as Json;
    if (k + 1 === 3) settings.volume = { master: 0.5, sfx: 0.4, bgm: 0.3 };
    if (k + 1 === 5) (d.flags as Json).tutorialDone = true;
    if (k + 1 === 6)
      d.races = {
        coast: { bestRank: 'S', clears: 2, times: [lap(61000), lap(65000)], ghost: null },
      };
    if (k + 1 === 9) d.records = { defenseWaves: { 'island:normal': 7 }, raidBestMs: {} };
    if (k + 1 === 10) d.badges = { earned: { loop: [1700000000000] }, backfilled: true };
  }
  return d;
}

describe('セーブの移行の通し（v1〜v10）', () => {
  it('今の版は 10（版を上げたらこのテストに v11 の跡を足す）', () => {
    expect(SAVE_CONFIG.version).toBe(10);
  });

  for (let v = 1; v <= SAVE_CONFIG.version; v++) {
    it(`v${v} のセーブ（JSON）から読むと v${SAVE_CONFIG.version} になり、遊んだ跡が残る`, () => {
      const save = parseSave(JSON.stringify(saveAt(v)));
      expect(save, `v${v}`).not.toBeNull();
      if (!save) return;
      expect(save.version).toBe(SAVE_CONFIG.version);
      expect(save.pilotName).toBe('ACE');
      expect(save.credits).toBe(12345);
      expect(save.missions.m1).toEqual({ unlocked: true, bestRank: 'A' });
      // v1 → v2: starter → kestrel、Lv を 1 下げる
      expect(save.aircraft.selected).toBe('kestrel');
      expect(save.aircraft.owned.kestrel).toEqual({
        engine: 2,
        airframe: 0,
        weapons: 1,
        avionics: 0,
      });
      expect(save.settings.quality).toBe('medium');
      if (v >= 3) expect(save.settings.volume).toEqual({ master: 0.5, sfx: 0.4, bgm: 0.3 });
      if (v >= 5) expect(save.flags.tutorialDone).toBe(true);
      if (v >= 6) {
        expect(save.races.coast?.bestRank).toBe('S');
        expect(save.races.coast?.times.map((t) => t.time)).toEqual([61000, 65000]);
      }
      if (v >= 9) expect(save.records.defenseWaves['island:normal']).toBe(7);
      // 9-10: v10 で足した勲章。それより前の版は空（記録からの判定は起動のときに SaveStore の外で）
      if (v >= 10)
        expect(save.badges).toEqual({ earned: { loop: [1700000000000] }, backfilled: true });
      else expect(save.badges).toEqual({ earned: {}, backfilled: false });
    });
  }

  it('今より新しい版・版番号が数でないものは読まない（初期化の扱い）', () => {
    expect(parseSave(JSON.stringify({ ...saveAt(10), version: 11 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...saveAt(10), version: '10' }))).toBeNull();
  });
});
