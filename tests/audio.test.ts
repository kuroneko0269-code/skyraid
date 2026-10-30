import { describe, expect, it } from 'vitest';
import {
  AUDIO_CONFIG,
  ENGINE_SOUND,
  EXPLOSION_SOUNDS,
  SPATIAL_CONFIG,
  WARNING_SOUND,
  WIND_SOUND,
} from '../src/data/audio';
import { EXPLOSION_SCALES } from '../src/data/fx';
import { AudioEngine } from '../src/audio/engine';
import { limiterMakeupCompensation } from '../src/audio/params';
import { BgmPlayer } from '../src/audio/bgm';
import {
  beepOn,
  bgmTrackFor,
  distanceGain,
  engineParams,
  lockTone,
  masterGain,
  pickWarning,
  sanitizeVolume,
  warningTone,
  windParams,
} from '../src/audio/params';
import { OneShots } from '../src/audio/sfx/oneshots';
import { FlightLoops } from '../src/audio/sfx/loops';
import { asContext, MockAudioContext, type MockNode } from './audio-mock';

function readyEngine(): { engine: AudioEngine; ctx: MockAudioContext } {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => asContext(ctx));
  engine.unlock();
  return { engine, ctx };
}

describe('エンジン音のパラメータ（スロットル → ピッチ・音量）', () => {
  it('スロットル 0 / 1 で idle / full の値', () => {
    const idle = engineParams(0, false);
    const full = engineParams(1, false);
    expect(idle.sawFreq).toBeCloseTo(ENGINE_SOUND.sawFreq.idle);
    expect(full.sawFreq).toBeCloseTo(ENGINE_SOUND.sawFreq.full);
    expect(idle.noiseGain).toBeCloseTo(ENGINE_SOUND.noiseGain.idle);
    expect(full.noiseCutoff).toBeCloseTo(ENGINE_SOUND.noiseCutoff.full);
    expect(idle.afterburnerGain).toBe(0);
  });

  it('スロットルを上げるほどピッチ・音量・ノイズの周波数が上がる（単調）', () => {
    let prev = engineParams(0, false);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const p = engineParams(t, false);
      expect(p.sawFreq).toBeGreaterThan(prev.sawFreq);
      expect(p.sawGain).toBeGreaterThan(prev.sawGain);
      expect(p.noiseCutoff).toBeGreaterThan(prev.noiseCutoff);
      prev = p;
    }
  });

  it('ピッチは対数で補間する（中点は幾何平均）', () => {
    const s = ENGINE_SOUND.sawFreq;
    expect(engineParams(0.5, false).sawFreq).toBeCloseTo(Math.sqrt(s.idle * s.full));
  });

  it('アフターバーナーで高域ノイズが加わり、ピッチが上がる', () => {
    const off = engineParams(1, false);
    const on = engineParams(1, true);
    expect(on.afterburnerGain).toBe(ENGINE_SOUND.afterburner.gain);
    expect(on.sawFreq).toBeCloseTo(off.sawFreq * ENGINE_SOUND.afterburner.pitch);
  });

  it('範囲外・不正な値は 0〜1 に収める', () => {
    expect(engineParams(2, false).sawFreq).toBeCloseTo(ENGINE_SOUND.sawFreq.full);
    expect(engineParams(-1, false).sawFreq).toBeCloseTo(ENGINE_SOUND.sawFreq.idle);
    expect(engineParams(Number.NaN, false).sawFreq).toBeCloseTo(ENGINE_SOUND.sawFreq.idle);
  });
});

describe('風切り音のパラメータ（速度 → フィルタ）', () => {
  it('低速・高速の端で cutoff と音量が設定の値', () => {
    const w = WIND_SOUND;
    const low = windParams(w.speed.low, 0);
    const high = windParams(w.speed.high, 0);
    expect(low.cutoff).toBeCloseTo(w.cutoff.low);
    expect(high.cutoff).toBeCloseTo(w.cutoff.high);
    expect(low.gain).toBeCloseTo(w.gain.low);
    expect(high.gain).toBeCloseTo(w.gain.high);
    // 範囲の外は頭打ち
    expect(windParams(0, 0).cutoff).toBeCloseTo(w.cutoff.low);
    expect(windParams(1000, 0).cutoff).toBeCloseTo(w.cutoff.high);
  });

  it('速いほど高く大きい（巡航 250 は 80 と 400 の間）', () => {
    const a = windParams(80, 0);
    const b = windParams(250, 0);
    const c = windParams(400, 0);
    expect(b.cutoff).toBeGreaterThan(a.cutoff);
    expect(c.cutoff).toBeGreaterThan(b.cutoff);
    expect(c.gain).toBeGreaterThan(b.gain);
  });

  it('失速で周波数が下がり Q が上がる（こもって揺れる）', () => {
    const normal = windParams(120, 0);
    const stall = windParams(120, 1);
    expect(stall.cutoff).toBeCloseTo(normal.cutoff * WIND_SOUND.stall.cutoffScale);
    expect(stall.q).toBe(WIND_SOUND.stall.q);
    expect(stall.gain).toBeGreaterThan(normal.gain);
  });
});

describe('爆発の音の規模テーブル', () => {
  it('4 段階すべてにあり、規模が大きいほど低く・長く・大きい', () => {
    const list = EXPLOSION_SCALES.map((s) => EXPLOSION_SOUNDS[s]);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (!prev || !cur) throw new Error('規模が足りない');
      expect(cur.lowStart).toBeLessThan(prev.lowStart);
      expect(cur.cutoff).toBeLessThan(prev.cutoff);
      expect(cur.noiseDecay).toBeGreaterThan(prev.noiseDecay);
      expect(cur.gain).toBeGreaterThanOrEqual(prev.gain);
    }
  });
});

describe('ビープ・警告・ロックオン', () => {
  it('ビープは周期の先頭 duty の間だけ鳴る', () => {
    expect(beepOn(0, 2, 0.5)).toBe(true);
    expect(beepOn(0.2, 2, 0.5)).toBe(true);
    expect(beepOn(0.3, 2, 0.5)).toBe(false);
    expect(beepOn(0.5, 2, 0.5)).toBe(true);
  });

  it('警告は MISSILE > PULL UP > AAA > STALL の順で 1 つ。種類で周波数が違う', () => {
    const none = { missile: false, pullUp: false, aaa: false, stall: false };
    expect(pickWarning(none)).toBeNull();
    expect(pickWarning({ ...none, stall: true, aaa: true })).toBe('aaa');
    expect(pickWarning({ missile: true, pullUp: true, aaa: true, stall: true })).toBe('missile');
    const freqs = new Set(Object.values(WARNING_SOUND.tones).map((t) => t.freq));
    expect(freqs.size).toBe(4);
    expect(warningTone('stall', 0).freq).toBe(WARNING_SOUND.tones.stall.freq);
  });

  it('ロックオンは進行中 2Hz のビープ、完了で連続音、何もなければ鳴らさない', () => {
    expect(lockTone(0, false, 0).on).toBe(false);
    const on = [0, 0.1, 0.2].map((t) => lockTone(0.5, false, t).on);
    const off = [0.3, 0.4].map((t) => lockTone(0.5, false, t).on);
    expect(on.every(Boolean)).toBe(true);
    expect(off.some(Boolean)).toBe(false);
    for (const t of [0.3, 0.4, 0.7]) expect(lockTone(1, true, t).on).toBe(true);
  });
});

describe('音量・距離減衰・BGM の曲', () => {
  it('ポーズ中はマスターを 30%（ミュートしない）', () => {
    expect(masterGain(0.8, false)).toBeCloseTo(0.8);
    expect(masterGain(0.8, true)).toBeCloseTo(0.8 * AUDIO_CONFIG.pausedVolume);
    expect(masterGain(0.8, true)).toBeGreaterThan(0);
  });

  it('音量は 0〜1 に収め、不正なら既定値', () => {
    expect(sanitizeVolume(1.5, 0.5)).toBe(1);
    expect(sanitizeVolume(-1, 0.5)).toBe(0);
    expect(sanitizeVolume('x', 0.5)).toBe(0.5);
  });

  it('距離減衰は refDistance まで 1、その先は inverse で減る', () => {
    const r = SPATIAL_CONFIG.refDistance;
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(r)).toBe(1);
    expect(distanceGain(r * 2)).toBeCloseTo(0.5);
    expect(distanceGain(r * 10)).toBeLessThan(distanceGain(r * 5));
  });

  it('画面 → BGM: メニューは title、飛行・ポーズは flight、リザルトは result', () => {
    expect(bgmTrackFor('boot')).toBeNull();
    expect(bgmTrackFor('title')).toBe('title');
    expect(bgmTrackFor('hangar')).toBe('title');
    expect(bgmTrackFor('flight')).toBe('flight');
    expect(bgmTrackFor('pause')).toBe('flight');
    expect(bgmTrackFor('result')).toBe('result');
  });
});

describe('AudioEngine（モックの AudioContext）', () => {
  it('ユーザー操作（unlock）まで AudioContext を作らない。作ったら resume し、無音を 1 回鳴らす', () => {
    const ctx = new MockAudioContext();
    let made = 0;
    const engine = new AudioEngine(() => {
      made++;
      return asContext(ctx);
    });
    expect(engine.ready).toBe(false);
    expect(made).toBe(0);
    engine.unlock();
    engine.unlock();
    expect(made).toBe(1);
    expect(ctx.resumed).toBeGreaterThanOrEqual(1);
    expect(ctx.sources.some((s) => s.started)).toBe(true);
  });

  it('効果音のバスの末尾にリミッター（-3dB・20:1・2ms・80ms・knee 0）と、メイクアップを打ち消すゲイン（4-11）', () => {
    const { engine } = readyEngine();
    // モックのノード（connections で配線をたどる）
    const sfx = engine.sfx as unknown as MockNode;
    const l = sfx.connections[0] as Record<
      'threshold' | 'ratio' | 'attack' | 'release' | 'knee',
      { value: number }
    > & { connections: { gain: { value: number }; connections: unknown[] }[] };
    expect([
      l.threshold.value,
      l.ratio.value,
      l.attack.value,
      l.release.value,
      l.knee.value,
    ]).toEqual([-3, 20, 0.002, 0.08, 0]);
    const makeup = l.connections[0];
    expect(makeup?.connections[0]).toBe(engine.master);
    // -3dB・20:1 の自動メイクアップは +1.71dB（Chromium で実測）。打ち消すので 0.821 倍
    expect(20 * Math.log10(makeup?.gain.value ?? 1)).toBeCloseTo(-1.71, 2);
    expect(limiterMakeupCompensation(-3, 20)).toBeCloseTo(0.821, 3);
  });

  it('マスター / 効果音 / BGM の 3 本のゲイン。ポーズで 30%、裏に回ると suspend', () => {
    const { engine, ctx } = readyEngine();
    engine.setVolumes({ master: 0.5, sfx: 0.4, bgm: 0.3 });
    expect(engine.master?.gain.value).toBeCloseTo(0.5);
    expect(engine.sfx?.gain.value).toBeCloseTo(0.4);
    expect(engine.bgm?.gain.value).toBeCloseTo(0.3);
    engine.setPaused(true);
    expect(engine.master?.gain.value).toBeCloseTo(0.5 * AUDIO_CONFIG.pausedVolume);
    engine.setPaused(false);
    expect(engine.master?.gain.value).toBeCloseTo(0.5);
    engine.setHidden(true);
    expect(ctx.suspended).toBe(1);
    engine.setHidden(false);
    expect(ctx.state).toBe('running');
  });

  it('同時発音は 16（常時鳴る 4 + 単発 12）。単発のボイスが足りなければ一番早く終わるものを止めて使う', () => {
    const { engine, ctx } = readyEngine();
    const loops = new FlightLoops(engine);
    expect(loops).toBeDefined();
    const pool = engine.voices;
    if (!pool) throw new Error('ボイスがない');
    expect(pool.size + AUDIO_CONFIG.loopVoices).toBe(AUDIO_CONFIG.maxVoices);
    const shots = new OneShots(engine, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) shots.explosion('fuel', { x: 10, y: 0, z: 0 });
    expect(pool.active).toBe(pool.size);
    expect(pool.stolen).toBe(40 - pool.size);
    // 盗まれたボイスの音源は止めてある
    expect(ctx.sources.filter((s) => s.stopped).length).toBeGreaterThan(0);
    // 時間が進めば空く
    ctx.currentTime = 10;
    expect(pool.active).toBe(0);
  });

  it('遠すぎる音（cullDistance の外）はボイスを使わない', () => {
    const { engine } = readyEngine();
    const shots = new OneShots(engine, { x: 0, y: 0, z: 0 });
    shots.explosion('small', { x: SPATIAL_CONFIG.cullDistance + 1, y: 0, z: 0 });
    expect(engine.voices?.played).toBe(0);
    shots.gun();
    expect(engine.voices?.played).toBe(1);
  });
});

describe('BGM の受け口', () => {
  it('ファイルが無ければ無音、あれば読み込めたときに流す', async () => {
    const { engine } = readyEngine();
    const asked: string[] = [];
    const bgm = new BgmPlayer(engine, '/', (url) => {
      asked.push(url);
      return Promise.resolve(url.endsWith('flight.mp3') ? new ArrayBuffer(8) : null);
    });
    // onReady は登録時に呼ばれる（エンジンはもう使える）
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toEqual([
      '/audio/bgm/title.mp3',
      '/audio/bgm/flight.mp3',
      '/audio/bgm/result.mp3',
    ]);
    expect(bgm.has('title')).toBe(false);
    expect(bgm.has('flight')).toBe(true);
    bgm.play('title');
    bgm.play('flight');
    bgm.play(null);
  });
});
