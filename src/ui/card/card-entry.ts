// 記録カード（8-5）の入口: 結果画面（ミッション・ソロのレイド・レース・ソロの防衛戦）の「記録カード」のボタン。
// 押すとその時点の場面を 1 枚撮り（結果の画面の後ろは飛行の終わりの場面のまま）、カードの画面（card-dialog.ts。別のチャンク）を
// 読んで開く。結果画面を出すときに先読みもする。チュートリアル・マルチの結果には出さない（set(null)）
import type { CardSource } from '../../core/card-source';
import { t } from '../../core/i18n';
import { lazyChunk } from '../../core/lazy-chunk';
import { CARD_SIZE, CARD_SIZES } from '../../data/card';
import type { RaidDifficulty } from '../../data/raid';
import type { MissionResult } from '../../missions/events';
import type { Paint } from '../../progression/paint';
import type { SaveStore } from '../../progression/save-store';
import { loadChunk, prefetchChunk } from '../lazy-load';
import { createButton } from '../screen';
import type { CardDialog } from './card-dialog';

/** 場面を width × height で撮る（撮れなければ null）。起動時に flight-runtime.ts が渡す */
type SceneCapture = (width: number, height: number) => HTMLCanvasElement | null;

let captureScene: SceneCapture | null = null;
let dialog: CardDialog | null = null;
const chunk = lazyChunk(() => import('./card-dialog'));

export function setCardSceneCapture(fn: SceneCapture): void {
  captureScene = fn;
}

/** 機体の今の塗装（まだ塗っていなければ null）。オンライン連携の情報は読まない */
export function cardPaint(save: SaveStore, aircraftId: string): Readonly<Paint> | null {
  return save.snapshot.skins.paints[aircraftId] ?? null;
}

/** キャンペーンのミッション・ソロのレイド（raid はレイドの難易度。ミッションは null）の結果 → カードの元 */
export function missionCardSource(
  r: MissionResult,
  raid: RaidDifficulty | null,
  hangar: { readonly selectedId: string },
  save: SaveStore,
): CardSource {
  const aircraftId = hangar.selectedId;
  const common = {
    aircraftId,
    paint: cardPaint(save, aircraftId),
    pilotName: save.pilotName,
    date: Date.now(),
    success: r.outcome === 'success',
    rank: r.rank,
    seconds: r.elapsedSeconds,
  };
  if (raid)
    return {
      ...common,
      mode: 'raid',
      difficulty: raid,
      protectedBuildings: r.protectedBuildings ?? null,
    };
  return { ...common, mode: 'mission', missionId: r.missionId };
}

function sceneNow(): HTMLCanvasElement | null {
  if (!captureScene) return null;
  try {
    const size = CARD_SIZES[CARD_SIZE];
    return captureScene(size.width, size.height);
  } catch {
    return null;
  }
}

const onResult = (): boolean => document.documentElement.dataset.screen === 'result';

async function openCard(source: CardSource): Promise<void> {
  // 読み込みを待つ前に撮る（結果の時点の場面）
  const scene = sceneNow();
  if (!dialog) {
    const m = await loadChunk(chunk);
    if (!m || !onResult()) return;
    dialog ??= new m.CardDialog(document.body);
  }
  await dialog.open(source, scene);
}

/** 結果画面の追加の欄に置くボタン */
export class RecordCardButton {
  private readonly box: HTMLDivElement;
  private source: CardSource | null = null;

  constructor(parent: HTMLElement) {
    const box = document.createElement('div');
    box.className = 'result-card';
    parent.prepend(box);
    createButton(box, 'ui-button result-card-open', t('card.open'), () => {
      if (this.source) void openCard(this.source);
    });
    this.box = box;
    this.set(null);
  }

  /** 結果画面を出すたび: カードの元（作れない結果は null でボタンを隠す） */
  set(source: CardSource | null): void {
    this.source = source;
    this.box.hidden = source === null;
    if (source) prefetchChunk(chunk);
  }
}
