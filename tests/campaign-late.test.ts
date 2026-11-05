// 9-7: キャンペーン M6〜M8（夜間迎撃・対空陣地・決戦）のデータ・解放・M8 のキャンペーン版のネフィルガ・リプレイ・ボットの通し
import { describe, expect, it } from 'vitest';
import { CITY_CONFIG } from '../src/data/city';
import { KAIJU2_RAID_CONFIG as R } from '../src/data/kaiju2-raid';
import { HARBOR_MAP } from '../src/data/maps';
import {
  FINALE_MISSION,
  FLAK_LINE_MISSION,
  MISSIONS,
  NIGHT_INTERCEPT_MISSION,
} from '../src/data/missions';
import { SKIN_PATTERNS } from '../src/data/skins';
import { FINALE_WEATHER, findWeather, missionWeather } from '../src/data/weather';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { CampaignProgress } from '../src/progression/campaign-progress';
import { isSkinUnlocked } from '../src/progression/paintshop';
import { createInitialSave } from '../src/progression/save';
import { SaveStore } from '../src/progression/save-store';
import { createHeightField } from '../src/render/terrain-height';
import { missionDifficultyText } from '../src/ui/mission-text';
import { runCampaignBot } from './campaign-bots';
import { createKaiju2World, runKaiju2Bot } from './kaiju2-raid-bots';
import { replay } from './replay-helpers';
import './i18n-setup';

const harborGround = createHeightField(HARBOR_TERRAIN).getGroundHeight;
const LATE = [NIGHT_INTERCEPT_MISSION, FLAK_LINE_MISSION, FINALE_MISSION];

describe('M6〜M8 のデータ（9-7）', () => {
  it('M5 の後に M6 夜間迎撃・M7 対空陣地・M8 決戦。失敗は撃墜・時間切れ・戦域離脱（残機なし）、ミサイルの補充あり', () => {
    expect(MISSIONS.slice(5)).toEqual(LATE);
    for (const m of LATE) {
      expect(m.failConditions).toEqual(['playerDown', 'timeUp', 'outOfBounds']);
      expect(m.lives).toBeUndefined();
      expect(m.missileResupplySeconds).toBe(8);
      expect(m.timeLimitSeconds).toBeGreaterThan(m.parTimeSeconds);
      // ランクの報酬（レイドの式ではない）
      expect(m.reward.raid).toBeUndefined();
    }
    expect(LATE.map((m) => missionDifficultyText(m))).toEqual(['易', '易', '決戦']);
  });

  it('天候: M6 夜・M7 早朝の霧・M8 曇り（嵐で雨、撃破で夕方・快晴へ移る）', () => {
    expect(findWeather(missionWeather('night-intercept')).time).toBe('night');
    expect(findWeather(missionWeather('flak-line')).sky).toBe('fog');
    expect(findWeather(missionWeather('finale')).sky).toBe('overcast');
    expect(findWeather(FINALE_WEATHER.storm).sky).toBe('rain');
    expect(findWeather(FINALE_WEATHER.cleared)).toMatchObject({ time: 'evening', sky: 'clear' });
  });

  it('M6: 敵機 6 機が 3 波（0 / 75 / 150 秒、2 機目は 30 秒遅れ）。波の目標は始めから 3 つとも数える', () => {
    const fighters = NIGHT_INTERCEPT_MISSION.spawns.filter((s) => s.kind === 'enemyFighter');
    expect(fighters.map((s) => (s.trigger.type === 'time' ? s.trigger.seconds : 0))).toEqual([
      0, 30, 75, 105, 150, 180,
    ]);
    expect(NIGHT_INTERCEPT_MISSION.objectives.map((o) => o.start)).toEqual([
      'withPrevious',
      'withPrevious',
      'withPrevious',
    ]);
  });

  it('M7: 施設 4 つ（必須）と対空砲 4 門（任意）が港湾都市の陸の上（街の外・地表 300m 未満）。開始は湾の沖で、海面から 300m 以上', () => {
    const r = CITY_CONFIG.rect;
    let depots = 0;
    let guns = 0;
    for (const s of FLAK_LINE_MISSION.spawns) {
      if (s.kind !== 'groundTarget') continue;
      for (const p of s.positions) {
        const g = harborGround(p.x, p.z);
        expect([p.x, p.z, g > 0 && g < 300]).toEqual([p.x, p.z, true]);
        const inCity = p.x > r.minX - 100 && p.x < r.maxX + 100 && p.z > r.minZ - 100;
        expect([p.x, p.z, inCity && p.z < r.maxZ + 100]).toEqual([p.x, p.z, false]);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(HARBOR_MAP.radius - 1500);
        if (s.group === 'flak-depots') depots++;
        else guns++;
      }
    }
    expect([depots, guns]).toEqual([4, 4]);
    const s = FLAK_LINE_MISSION.start;
    expect(s.y - Math.max(0, harborGround(s.x, s.z))).toBeGreaterThan(300);
    expect(FLAK_LINE_MISSION.objectives.map((o) => o.required)).toEqual([true, false]);
  });

  it('M8: キャンペーン版のネフィルガ（skyKaiju）を港湾都市で倒す', () => {
    expect(FINALE_MISSION.skyKaiju).toBe('nephirga');
    expect(FINALE_MISSION.mapId).toBe('harbor');
    expect(FINALE_MISSION.objectives).toHaveLength(1);
    expect(FINALE_MISSION.objectives[0]).toMatchObject({ type: 'kaiju', damageRatio: 1 });
  });
});

describe('解放と記録（M1〜M5 と同じ）', () => {
  it('M5 をクリアすると M6、M6 で M7、M7 で M8。今の利用者（M5 までクリア済み・M6 の記録なし）も M6 を選べる', () => {
    const { store } = SaveStore.open(null);
    const p = new CampaignProgress(
      MISSIONS.map((m) => m.id),
      store,
    );
    expect(p.isUnlocked('night-intercept')).toBe(false);
    p.recordClear('encounter', 'A');
    expect(p.isUnlocked('night-intercept')).toBe(true);
    expect(p.isUnlocked('flak-line')).toBe(false);
    p.recordClear('night-intercept', 'S');
    p.recordClear('flak-line', 'B');
    expect(p.isUnlocked('finale')).toBe(true);
  });

  it('塗装の「全ミッション S」は M1〜M5 のまま（M6〜M8 を足しても、解放した人の条件が戻らない）', () => {
    const metal = SKIN_PATTERNS.find((x) => x.id === 'metal')?.unlock ?? null;
    expect(metal).toEqual({ kind: 'allMissionsS' });
    const save = createInitialSave();
    for (const m of MISSIONS.slice(0, 5)) save.missions[m.id] = { unlocked: true, bestRank: 'S' };
    expect(isSkinUnlocked(metal, save)).toBe(true);
  });
});

describe('M8 のキャンペーン版のネフィルガ', () => {
  it('数値は KAIJU2_RAID_CONFIG.campaign（段階で強くなる）。嵐・全体の制限時間は使わず、止まり木は街の上に選ばない', () => {
    const world = createKaiju2World();
    const perches: { x: number; z: number }[] = [];
    let checked = false;
    const r = runKaiju2Bot(
      {
        role: 'skilled',
        seed: 3,
        missionId: 'finale',
        preset: 'easy',
        onStep: (dev) => {
          const raid = dev.raid;
          const k = raid.body;
          if (!checked) {
            checked = true;
            expect(raid.campaign).toBe(true);
            expect(raid.maxHp).toBe(R.campaign.hp);
            expect(k.damageScale).toBe(R.campaign.damageScale[0]);
            expect(k.windupScale).toBe(R.campaign.windupScale);
            expect(raid.timeLeft).toBe(Infinity);
            // 登場: 高い所に出る
            expect(k.position.y).toBeGreaterThan(R.campaign.spawnAltitude - 50);
          }
          expect(raid.timeUp).toBeNull();
          expect(k.damageScale).toBe(R.campaign.damageScale[k.phase - 1]);
          if (k.state === 'perched' && perches.length < 20)
            perches.push({ x: k.perch.x, z: k.perch.z });
        },
      },
      world,
    );
    expect(r.status).toBe('success');
    const a = R.campaign.perchAvoid;
    for (const p of perches)
      expect(p.x >= a.minX && p.x <= a.maxX && p.z >= a.minZ && p.z <= a.maxZ).toBe(false);
  }, 120_000);

  it('レイドのネフィルガは今までどおり（キャンペーン版の数値・止まり木の制限を使わない）', () => {
    const world = createKaiju2World();
    let checked = false;
    runKaiju2Bot(
      {
        role: 'skilled',
        seed: 1,
        maxSeconds: 5,
        onStep: (dev) => {
          if (checked) return;
          checked = true;
          expect(dev.raid.campaign).toBe(false);
          expect(dev.raid.maxHp).toBe(R.hp);
          expect(dev.body.perchAvoid).toBeNull();
          expect(dev.body.damageScale).toBe(1);
        },
      },
      world,
    );
    expect(checked).toBe(true);
  });

  it('決定性: 同じ種のボットは同じ結果、記録を再生すると同じ結果（リプレイ）', () => {
    const o = {
      role: 'skilled',
      seed: 2,
      missionId: 'finale',
      preset: 'easy',
      record: true,
    } as const;
    const a = runKaiju2Bot(o);
    const b = runKaiju2Bot(o);
    expect(a.status).toBe('success');
    expect(b.hash).toBe(a.hash);
    const data = a.data;
    if (!data) throw new Error('no data');
    expect([data.header.mode, data.header.missionId]).toEqual(['mission', 'finale']);
    const { w, dev } = createKaiju2World();
    const back = replay(w, data, 600);
    expect(back.player.ended).toBe(true);
    expect(w.play.runner?.status).toBe('success');
    expect(dev.raid.dead).toBe(true);
  }, 120_000);
});

describe('ボットの通し（9-7。表は tests/campaign-tune.test.ts）', () => {
  for (const m of LATE)
    it(`${m.id}: 熟練・かんたんで 3 シードとも成功（3〜6 分の範囲の中か、それより速い）`, () => {
      for (const seed of [0, 1, 2]) {
        const r = runCampaignBot({ missionId: m.id, role: 'skilled', preset: 'easy', seed });
        expect([seed, r.status]).toEqual([seed, 'success']);
        expect(r.seconds).toBeLessThan(6 * 60);
      }
    }, 120_000);
});
