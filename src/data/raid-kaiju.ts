// 10-2: レイドの怪獣の登録簿（一本化）。怪獣を 1 体足すときは RAID_KAIJU に 1 件足す（docs/kaiju-roster.md の「怪獣を 1 体足す手順」）:
// 紹介（怪獣選びの画像・英字の名前・攻撃の並び・画像の場面）・名前と題の文言のキー・記録のキーの形・ランキング・解放の条件・
// 勲章のまとまり・遅延チャンクの有無・未公開の ?dev= の名前。怪獣選び・ブリーフィング・結果・記録カード・リプレイ・ランキング・
// 勲章・ロビーはここから並べる。並びは協力の設定（GameSettings.raidKaiju）の番号なので、足すのは最後だけ（9-6c の番号を変えない）。
// 9-6c までの id・記録のキー・番号はそのまま。Three.js・DOM 非依存（起動時に読まないが、小さく保つ）
import { t } from '../core/i18n';
import { parseDevFlags } from '../core/debug-flags';
import type { RaidDifficulty } from './raid';

/** 画像の場面: 天候とカメラ（怪獣の基準点からの相対。m。9-10d の KaijuArtScene） */
export interface KaijuArtScene {
  readonly weather: string;
  /** カメラの位置（怪獣の向きの前 = +forward、右 = +right、上 = +up。怪獣の基準点から） */
  readonly camera: { readonly forward: number; readonly right: number; readonly up: number };
  /** 見る点（同じく怪獣の基準点から） */
  readonly look: { readonly forward: number; readonly right: number; readonly up: number };
  /** 縦の画角（度） */
  readonly fov: number;
  /** 出撃してから撮るまでの秒数（上陸・飛び立ちを待つ） */
  readonly waitSeconds: number;
}

/**
 * 解放の条件: kaiju のうち count 体を difficulty 以上（高難度のクリアは通常にも数える）でクリアした（ソロの自己ベストか、
 * 通算の記録の「win.of.raid-<怪獣>」がある）。null はいつでも遊べる
 */
export interface RaidUnlock {
  readonly kaiju: readonly string[];
  readonly count: number;
  readonly difficulty: RaidDifficulty;
}

/** 怪獣ごとの勲章（レイドのカテゴリの怪獣のまとまりの最後に足す。判定は各怪獣のタスクで足す） */
export interface RaidKaijuBadge {
  readonly id: string;
  readonly reward: number;
  /** 10-3b: 通算の記録の合計で取る（keys の合計が goal 以上。記録からさかのぼれる）。無ければ飛行の中で判定する */
  readonly stat?: { readonly keys: readonly string[]; readonly goal: number };
}

export interface RaidKaijuDef {
  readonly id: string;
  /** 名前の文言のキー（今の言語は raidKaijuName） */
  readonly nameKey: string;
  /** 画像（public/ からの相対パス。正方形 960 × 960 の webp。怪獣を真ん中に置く） */
  readonly art: string;
  /** 画像の下の帯の英字の名前 */
  readonly latinName: string;
  /** 攻撃の並び（文は raidSelect.kaiju.<id>.attacks.<攻撃>） */
  readonly attacks: readonly string[];
  /** 狭い枠に切り取るときの中心（CSS の object-position） */
  readonly focus: string;
  /** 画像を作るときの場面（scripts/render-kaiju-art.js・src/ui/kaiju-art.ts） */
  readonly scene: KaijuArtScene;
  /**
   * 記録のキーの形（ローカルの自己ベスト records.raidBestMs・オンラインの records.key）: 'difficulty' は難易度だけ（ヴォルガス。
   * 7-4 からの記録のまま）、'kaiju' は「id:難易度」（9-6c から。新しい怪獣はこれ）
   */
  readonly recordKey: 'difficulty' | 'kaiju';
  /**
   * オンラインのランキングに送るか（サーバーの準備ができたか）。SQL 0006（キーの決まり）を流してからは、'kaiju' の形の怪獣は
   * これに関わらず送る（src/data/online.ts の RAID_KEY_RULE_ENABLED）
   */
  readonly ranked: boolean;
  readonly unlock: RaidUnlock | null;
  /** 怪獣ごとの勲章（クリア・速攻・撃墜されず・被弾なし・補助むずかしいの 10 個の後に足す。番号がずれるのは収集だけ） */
  readonly badges: readonly RaidKaijuBadge[];
  /** 判定・形・HUD・音・文言が遅延チャンクか（始める前・再生の前に読む。src/ui/raid-kaiju-link.ts） */
  readonly lazy: boolean;
  /** 未公開（?dev=<名前> のときだけ怪獣選び・ロビー・勲章・ランキングに出す）。公開したら null */
  readonly dev: string | null;
  /** 協力できるか（ロビーの怪獣の選択に出す） */
  readonly coop: boolean;
  /** 街の建物を壊すか（結果の「守った建物」を出す） */
  readonly city: boolean;
  /** 協力の結果の題の文言のキー（クリア） */
  readonly coopClearKey: string;
}

const DEFS = [
  {
    id: 'vorgas',
    nameKey: 'kaiju.name',
    art: 'kaiju-art/vorgas.webp',
    latinName: 'VORGAS',
    attacks: ['sweep', 'roar', 'beam', 'throw'],
    focus: '50% 45%',
    // 夕方の湾: 海面すれすれの低い所から、上陸して街へ歩く姿を斜め前から見上げる
    scene: {
      weather: 'evening-clear',
      camera: { forward: 200, right: -115, up: 6 },
      look: { forward: 0, right: 0, up: 84 },
      fov: 56,
      waitSeconds: 26,
    },
    recordKey: 'difficulty',
    ranked: true,
    unlock: null,
    badges: [],
    lazy: false,
    dev: null,
    coop: true,
    city: true,
    coopClearKey: 'pvp.title.raidClear',
  },
  {
    id: 'nephirga',
    nameKey: 'kaiju2.name',
    art: 'kaiju-art/nephirga.webp',
    latinName: 'NEPHIRGA',
    attacks: ['orb', 'gust', 'dive', 'tail'],
    focus: '50% 50%',
    // 嵐の空: 翼を広げて飛ぶ姿を斜め下から見上げる
    scene: {
      weather: 'day-rain',
      camera: { forward: 310, right: -240, up: -95 },
      look: { forward: 0, right: 0, up: 0 },
      fov: 52,
      waitSeconds: 14,
    },
    recordKey: 'kaiju',
    ranked: true,
    unlock: null,
    badges: [{ id: 'nephirgaParts', reward: 2000 }],
    lazy: true,
    dev: null,
    coop: true,
    city: false,
    coopClearKey: 'pvp.title.raid2Clear',
  },
  {
    id: 'albion',
    nameKey: 'albion.name',
    art: 'kaiju-art/albion.webp',
    latinName: 'ALBION',
    attacks: ['minion', 'geyser', 'sonar', 'roll', 'spout', 'cloud'],
    focus: '50% 50%',
    // 10-3b: 晴れた昼の湾: 腹の赤い巣と子分の群れを、斜め下から見上げる（白い巨体が青空に浮かぶ）
    scene: {
      weather: 'day-clear',
      camera: { forward: 380, right: -520, up: -260 },
      look: { forward: -10, right: 0, up: -40 },
      fov: 54,
      // 子分が巣から出た直後・最初の攻撃（潮吹き）の前（撮る時計はミッションの経過で、怪獣の時計より数秒遅れる）
      waitSeconds: 5,
    },
    recordKey: 'kaiju',
    // SQL 0006（キーの決まり）で受け付ける（0003 の一覧には無い）
    ranked: false,
    unlock: null,
    badges: [
      { id: 'albionNests', reward: 2000 },
      // 10-3c: 人を狙う攻撃（水柱・歌・横転・呼び声）と体に一度も当たらずに倒した
      { id: 'albionUntouched', reward: 2000 },
      { id: 'albionMinions100', reward: 100, stat: { keys: ['kill.t.minion'], goal: 100 } },
      { id: 'albionMinions500', reward: 100, stat: { keys: ['kill.t.minion'], goal: 500 } },
    ],
    lazy: true,
    dev: null,
    coop: true,
    city: false,
    coopClearKey: 'pvp.title.raid3Clear',
  },
] as const satisfies readonly RaidKaijuDef[];

export type RaidKaijuId = (typeof DEFS)[number]['id'];

/** 登録簿（並びは協力の設定の番号。型は広げて持つ: 条件の分岐を怪獣の値に縛らない） */
export const RAID_KAIJU: readonly (RaidKaijuDef & { readonly id: RaidKaijuId })[] = DEFS;

/** 協力の設定（GameSettings.raidKaiju）の番号の順 */
export const RAID_KAIJU_IDS: readonly RaidKaijuId[] = RAID_KAIJU.map((k) => k.id);

export const VORGAS_ID: RaidKaijuId = 'vorgas';
export const NEPHIRGA_ID: RaidKaijuId = 'nephirga';
export const ALBION_RAID_ID: RaidKaijuId = 'albion';

export function isRaidKaijuId(v: unknown): v is RaidKaijuId {
  return typeof v === 'string' && (RAID_KAIJU_IDS as readonly string[]).includes(v);
}

export function findRaidKaiju(id: string | undefined): (typeof RAID_KAIJU)[number] | null {
  return RAID_KAIJU.find((k) => k.id === id) ?? null;
}

/** 登録簿の 1 件（知らない id はヴォルガス） */
export function raidKaijuDef(id: RaidKaijuId): RaidKaijuDef {
  return findRaidKaiju(id) ?? DEFS[0];
}

/** 協力の設定の番号 → id（知らない番号はヴォルガス） */
export function raidKaijuOf(index: number): RaidKaijuId {
  return RAID_KAIJU_IDS[index] ?? VORGAS_ID;
}

export function raidKaijuIndex(id: string | undefined): number {
  const i = (RAID_KAIJU_IDS as readonly string[]).indexOf(id ?? VORGAS_ID);
  return i < 0 ? 0 : i;
}

/** 名前（今の言語） */
export function raidKaijuName(id: RaidKaijuId): string {
  return t(raidKaijuDef(id).nameKey);
}

/**
 * 公開されているか（未公開は ?dev=<名前> のときだけ）。search を省くと今の URL（テスト・Node では公開済みだけ）
 */
export function raidKaijuShown(def: Pick<RaidKaijuDef, 'dev'>, search = currentSearch()): boolean {
  return def.dev === null || parseDevFlags(search).has(def.dev);
}

function currentSearch(): string {
  return typeof location === 'undefined' ? '' : location.search;
}

/** 遊べる（出す）怪獣（登録の順） */
export function shownRaidKaiju(search?: string): typeof RAID_KAIJU {
  return RAID_KAIJU.filter((k) => raidKaijuShown(k, search));
}

/**
 * 記録のキー（ローカルの自己ベスト records.raidBestMs・オンラインの records.key）: ヴォルガスは難易度だけ（今までの記録のまま）、
 * ほかの怪獣は「id:難易度」
 */
export function raidRecordKey(kaiju: RaidKaijuId, difficulty: RaidDifficulty): string {
  return raidKaijuDef(kaiju).recordKey === 'difficulty' ? difficulty : `${kaiju}:${difficulty}`;
}

/** 記録のキー → 怪獣（「id:」が無ければヴォルガス） */
export function raidKaijuOfKey(key: string): RaidKaijuId | null {
  const i = key.indexOf(':');
  if (i < 0) return VORGAS_ID;
  const id = key.slice(0, i);
  return isRaidKaijuId(id) ? id : null;
}

/** 10-2: 記録のキーの決まり（SQL 0006 の check と同じ。「怪獣の id:難易度」。id は英小文字・数字・-、2〜24 文字） */
export const RAID_KEY_PATTERN = /^[a-z][a-z0-9-]{1,23}:(normal|hard)$/;
