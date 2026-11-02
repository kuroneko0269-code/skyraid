// 記録カード（8-5）: 各モード・両言語で載せる項目がそろい、文字が枠に収まって重ならない（配置の計算。描画そのものは
// ui-audit の --release でブラウザで確かめる）。パイロット名を載せない選択・共有の文面・遊べる URL
import { describe, expect, it } from 'vitest';
import {
  fitText,
  layoutCard,
  textBox,
  type CardMeasure,
  type CardTextOp,
} from '../src/core/card-layout';
import type { CardSource } from '../src/core/card-source';
import { CARD_SIZES } from '../src/data/card';
import type { Paint } from '../src/progression/paint';
import { buildCardModel, cardShareText, displayUrl } from '../src/ui/card/card-model';
import { useLocale } from './i18n-helpers';

/** 文字の幅の近似（日本語は全角 1 字 = 文字の大きさ、ほかは 0.62 倍。実際のフォントより広めに見積もる） */
const measure: CardMeasure = (text, size) =>
  Array.from(text).reduce(
    (w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? size : size * 0.62),
    0,
  );

const PAINT: Paint = {
  pattern: 'splitter',
  base: 1,
  accent: 2,
  marking: 7,
  number: 27,
  wing: { decal: null, x: 0.5, y: 0.5, size: 1, rotation: 0 },
  fin: { decal: null, x: 0.5, y: 0.5, size: 1, rotation: 0 },
};
const DATE = new Date(2026, 10, 2, 13, 5).getTime();
const common = { aircraftId: 'kestrel', paint: PAINT, pilotName: 'ACE', date: DATE };
const URL_ = 'https://skyraid.example/';

const SOURCES: Readonly<Record<string, CardSource>> = {
  mission: {
    ...common,
    mode: 'mission',
    missionId: 'first-sortie',
    success: true,
    rank: 'S',
    seconds: 192,
  },
  missionFailed: {
    ...common,
    mode: 'mission',
    missionId: 'training',
    success: false,
    rank: null,
    seconds: 61,
  },
  raid: {
    ...common,
    mode: 'raid',
    difficulty: 'hard',
    success: true,
    rank: 'A',
    seconds: 754,
    protectedBuildings: 87,
  },
  race: {
    ...common,
    mode: 'race',
    courseId: 'harbor-speed',
    finished: true,
    rank: 'B',
    time: 83.456,
    newBest: true,
  },
  defense: {
    ...common,
    mode: 'defense',
    mapId: 'harbor',
    difficulty: 'normal',
    cleared: false,
    waves: 7,
    kills: 42,
  },
};

function texts(ops: readonly { kind: string }[]): CardTextOp[] {
  return ops.filter((o): o is CardTextOp => o.kind === 'text');
}

function overlaps(a: CardTextOp, b: CardTextOp): boolean {
  const p = textBox(a);
  const q = textBox(b);
  return p.x0 < q.x1 - 0.5 && q.x0 < p.x1 - 0.5 && p.y0 < q.y1 - 0.5 && q.y0 < p.y1 - 0.5;
}

describe('記録カードの配置', () => {
  for (const locale of ['ja', 'en'] as const) {
    for (const [name, source] of Object.entries(SOURCES)) {
      for (const sizeId of ['wide', 'square'] as const) {
        it(`${locale} / ${name} / ${sizeId}: 項目がそろい、枠に収まって重ならない`, () => {
          useLocale(locale);
          const size = CARD_SIZES[sizeId];
          const model = buildCardModel(source, { includePilot: true, url: URL_ });
          const layout = layoutCard(model, size, measure);
          const ops = texts(layout.ops);
          const byId = new Map(ops.map((o) => [o.id, o]));
          const required = [
            'game',
            'mode',
            'stage',
            'headline',
            'metricLabel',
            'metric',
            'machine',
            'pilot',
            'date',
            'url',
          ];
          for (const id of required) expect(byId.has(id), id).toBe(true);
          expect(byId.has('rank')).toBe(model.rank !== null);
          expect(byId.get('game')?.text).toBe('SkyRaid: Titan Skies');
          expect(byId.get('url')?.text).toBe('skyraid.example');
          expect(byId.get('date')?.text).toBe(locale === 'ja' ? '2026/11/02' : '11/02/2026');
          expect(byId.get('pilot')?.text).toContain('ACE');
          // 機体と塗装（Kestrel・スプリッター）
          expect(byId.get('machine')?.text).toContain(model.aircraft);
          expect(byId.get('machine')?.text).toContain(model.skin);
          for (const o of ops) {
            const b = textBox(o);
            expect(b.x0, o.id).toBeGreaterThanOrEqual(0);
            expect(b.x1, o.id).toBeLessThanOrEqual(size.width);
            expect(b.y0, o.id).toBeGreaterThanOrEqual(0);
            expect(b.y1, o.id).toBeLessThanOrEqual(size.height);
            const footer = ['machine', 'pilot', 'date', 'url'].includes(o.id);
            if (footer) expect(b.y0, o.id).toBeGreaterThanOrEqual(layout.footerTop);
            else expect(b.y1, o.id).toBeLessThanOrEqual(layout.footerTop);
            // 切れていない（短い名前なら「…」にならない）
            expect(o.text.endsWith('…'), o.id).toBe(false);
          }
          for (let i = 0; i < ops.length; i++)
            for (let j = i + 1; j < ops.length; j++) {
              const a = ops[i];
              const b = ops[j];
              if (a && b) expect(overlaps(a, b), `${a.id} × ${b.id}`).toBe(false);
            }
        });
      }
    }
  }

  it('モードごとの評価・スコアまたはタイム（両言語）', () => {
    useLocale('ja');
    const ja = (k: string) =>
      buildCardModel(SOURCES[k] as CardSource, { includePilot: true, url: URL_ });
    expect(ja('mission')).toMatchObject({
      mode: 'キャンペーン',
      headline: 'MISSION COMPLETE',
      rank: 'S',
    });
    expect(ja('mission').metric).toEqual({ label: 'タイム', value: '3:12' });
    expect(ja('missionFailed')).toMatchObject({
      headline: 'MISSION FAILED',
      rank: null,
      success: false,
    });
    expect(ja('raid')).toMatchObject({ mode: 'レイド', rank: 'A' });
    expect(ja('raid').facts).toEqual([{ label: '守った建物', value: '87%' }]);
    expect(ja('race').metric).toEqual({ label: 'タイム', value: '1:23.456' });
    expect(ja('defense')).toMatchObject({ mode: '防衛戦', headline: '基地陥落', rank: null });
    expect(ja('defense').metric).toEqual({ label: 'クリアした波', value: '7 / 10' });
    expect(ja('mission').skin).toBe('スプリッター・朱');
    useLocale('en');
    const en = (k: string) =>
      buildCardModel(SOURCES[k] as CardSource, { includePilot: true, url: URL_ });
    expect(en('mission').mode).toBe('Campaign');
    expect(en('defense')).toMatchObject({ headline: 'Base Fallen' });
    expect(en('defense').facts).toEqual([{ label: 'Kills', value: '42' }]);
    expect(en('raid').stage).toBe('Vorgas (Hard)');
    expect(en('mission').skin).toBe('Splinter · Vermilion');
  });

  it('パイロット名を載せない選択では、カードにも共有の文面にも名前が出ない', () => {
    for (const locale of ['ja', 'en'] as const) {
      useLocale(locale);
      const source = { ...(SOURCES.race as CardSource), pilotName: 'SECRETNAME' };
      const model = buildCardModel(source, { includePilot: false, url: URL_ });
      expect(model.pilot).toBeNull();
      const ops = texts(layoutCard(model, CARD_SIZES.wide, measure).ops);
      expect(ops.some((o) => o.id === 'pilot')).toBe(false);
      expect(ops.some((o) => o.text.includes('SECRETNAME'))).toBe(false);
      expect(cardShareText(model, URL_)).not.toContain('SECRETNAME');
      // 載せる選択なら出る
      const shown = buildCardModel(source, { includePilot: true, url: URL_ });
      expect(
        texts(layoutCard(shown, CARD_SIZES.wide, measure).ops).find((o) => o.id === 'pilot')?.text,
      ).toBe('PILOT  SECRETNAME');
    }
  });

  it('共有の文面は言語に合わせ、ハッシュタグと遊べる URL を付ける', () => {
    useLocale('ja');
    const ja = buildCardModel(SOURCES.mission as CardSource, { includePilot: true, url: URL_ });
    expect(cardShareText(ja, URL_)).toBe(
      'SkyRaid: Titan Skies のキャンペーン「First Sortie」で MISSION COMPLETE・ランク S・タイム 3:12 #SkyRaid\nhttps://skyraid.example/'.replace(
        'First Sortie',
        ja.stage,
      ),
    );
    useLocale('en');
    const en = buildCardModel(SOURCES.race as CardSource, { includePilot: true, url: URL_ });
    expect(cardShareText(en, URL_)).toBe(
      `Ring Race "${en.stage}" in SkyRaid: Titan Skies: FINISH · Rank B · Time 1:23.456 #SkyRaid\nhttps://skyraid.example/`,
    );
  });

  it('長いステージ名・パイロット名・機体名は縮めて、それでも入らなければ「…」で枠に収める', () => {
    for (const locale of ['ja', 'en'] as const) {
      useLocale(locale);
      const model = {
        ...buildCardModel(SOURCES.mission as CardSource, { includePilot: true, url: URL_ }),
        stage:
          locale === 'ja'
            ? 'とても長いステージの名前'.repeat(5)
            : 'A Very Long Stage Name '.repeat(5),
        aircraft: 'X'.repeat(80),
        pilot: 'WWWWWWWW',
      };
      const layout = layoutCard(model, CARD_SIZES.wide, measure);
      for (const o of texts(layout.ops)) {
        const b = textBox(o);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(1200);
      }
      const stage = texts(layout.ops).find((o) => o.id === 'stage');
      expect(stage?.text.endsWith('…')).toBe(true);
      const ops = texts(layout.ops);
      for (let i = 0; i < ops.length; i++)
        for (let j = i + 1; j < ops.length; j++) {
          const a = ops[i];
          const b = ops[j];
          if (a && b) expect(overlaps(a, b), `${a.id} × ${b.id}`).toBe(false);
        }
    }
  });

  it('fitText: 下限まで縮め、それでも入らなければ末尾を「…」に', () => {
    expect(fitText('ABCD', 10, 10, 100, 'body', measure)).toEqual({
      text: 'ABCD',
      size: 10,
      width: 24.8,
    });
    const shrunk = fitText('ABCDEFGHIJ', 20, 10, 100, 'body', measure);
    expect(shrunk.text).toBe('ABCDEFGHIJ');
    expect(shrunk.size).toBeLessThan(20);
    expect(shrunk.width).toBeLessThanOrEqual(100);
    const cut = fitText('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 20, 10, 100, 'body', measure);
    expect(cut.text.endsWith('…')).toBe(true);
    expect(cut.width).toBeLessThanOrEqual(100);
  });

  it('遊べる URL の表示は https:// と末尾の / を外す', () => {
    expect(displayUrl('https://skyraid.pages.dev/')).toBe('skyraid.pages.dev');
    expect(displayUrl('http://localhost:4174/')).toBe('localhost:4174');
  });
});
