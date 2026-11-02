// キャンペーン（M1〜M5）の共通のルール（8-6d）。値は各ミッションの定義（src/data/missions.ts・missions-special.ts）が使う。
// レイド・防衛戦・レース・フリーフライトには使わない

/**
 * ミサイルの補充: 撃ち尽くして（自機が飛んでいる間に）この秒数たつと満タンに戻し、お知らせを出す。
 * 8-6b で M1 だけに入れたものを、8-6d でキャンペーン全ミッション共通にした（実機の M2 でミサイルを外し切ると、
 * 機銃だけでは勝てなかった。docs/decisions.md の 8-6d）
 */
export const CAMPAIGN_MISSILE_RESUPPLY_SECONDS = 8;
