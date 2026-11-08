// ロビーの部屋の画面の部品（6-6。lobby-room.ts から分けた）: 選択肢のセグメント・押すと切り替わるボタン・モードの表示名
import {
  RAID_KAIJU,
  VORGAS_ID,
  raidKaijuShortName,
  raidKaijuOf,
  raidKaijuShown,
} from '../data/raid-kaiju';
import { t, tn } from '../core/i18n';
import type { PvpMode } from '../data/pvp';
import { RAID_DIFFICULTIES, RAID_DIFFICULTY_LABELS } from '../data/raid';
import type { GameSettings } from '../net/protocol';
import { createButton } from './screen';
import { Segmented } from './segmented';

/**
 * ホスト設定の選択肢（7-C で select からセグメントに。値は文字列、表示は text）。変えたら onChange。
 * extraClass は並び方の調整（天候は 4 個ずつ）
 */
export function ruleSegment(
  parent: HTMLElement,
  label: string,
  values: readonly (number | string)[],
  text: (v: number | string) => string,
  onChange: () => void,
  extraClass = '',
): Segmented {
  return new Segmented(
    parent,
    label,
    values.map((v) => ({ value: String(v), label: text(v) })),
    String(values[0] ?? ''),
    onChange,
    `lobby-rule ${extraClass}`.trim(),
  );
}

export function toggle(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = createButton(parent, 'ui-toggle lobby-toggle', label, onClick);
  b.setAttribute('aria-pressed', 'false');
  return b;
}

export function parseMode(v: string): PvpMode {
  return v === 'team' || v === 'raid' || v === 'defense' ? v : 'ffa';
}

/** 制限時間の表示（秒 → 「5 分」） */
export const minutes = (s: number): string => tn('lobby.minutes', Math.round(s / 60));

export type RuleToggle = 'noUpgrades' | 'rookieGuard' | 'aimAssist' | 'autoFire';

/** 補正の ON/OFF の並び（設定の項目・文言のキー） */
export const RULE_TOGGLES: readonly (readonly [RuleToggle, string])[] = [
  ['noUpgrades', 'lobby.rule.noUpgrades'],
  ['rookieGuard', 'lobby.rule.rookie'],
  ['aimAssist', 'lobby.rule.aimAssist'],
  ['autoFire', 'lobby.rule.autoFire'],
];

/** 9-6c: レイドの怪獣（ヴォルガス / ネフィルガ。値は設定の番号）と 6-6 の難易度の選択肢（レイドのときだけ出す） */
export function raidRuleSegments(
  parent: HTMLElement,
  onChange: () => void,
): [Segmented, Segmented] {
  const kaiju = ruleSegment(
    parent,
    t('lobby.rule.kaiju'),
    // 10-2: 登録簿の順の番号のうち、公開されていて協力できる怪獣だけ（未公開は ?dev=<名前> のときだけ）
    RAID_KAIJU.flatMap((k, i) => (k.coop && raidKaijuShown(k) ? [i] : [])),
    // 10-5b: 5 体になったので短い名前（アルビオン・ゴウライ・ゼノリス）を 3 個ずつ 2 段に（狭い画面で右へはみ出さない）
    (v) => raidKaijuShortName(raidKaijuOf(Number(v))),
    onChange,
    'lobby-seg-kaiju',
  );
  const difficulty = ruleSegment(
    parent,
    t('lobby.rule.difficulty'),
    RAID_DIFFICULTIES,
    (v) => (v === 'hard' ? RAID_DIFFICULTY_LABELS.hard : RAID_DIFFICULTY_LABELS.normal),
    onChange,
  );
  return [kaiju, difficulty];
}

/** レイドの定型文（6-6。頭・脚・結晶・避けて）はレイドのときだけ。9-6c: ネフィルガでは部位の 3 つを隠して「避けて」だけ */
export function syncRaidChat(buttons: readonly HTMLElement[], st: Readonly<GameSettings>): void {
  const raid = st.mode === 'raid';
  const nephirga = raidKaijuOf(st.raidKaiju) !== VORGAS_ID;
  buttons.forEach((b, i) => {
    b.hidden = !raid || (nephirga && i < buttons.length - 1);
  });
}
