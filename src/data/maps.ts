// マップ（戦域）の定義（2-4）。今は島 1 つ。距離は m、時間は秒
// 戦域の境界は水平の円（中心・半径）。出ると HUD に「RETURN TO BATTLEFIELD」と returnSeconds のカウントを出す

export interface MapDef {
  readonly id: string;
  readonly name: string;
  /** 戦域の中心（水平）と半径 */
  readonly center: { readonly x: number; readonly z: number };
  readonly radius: number;
  /** 境界を出てから戻るまでの猶予。ミッションではこれを過ぎると失敗、フリーフライトでは警告だけ */
  readonly returnSeconds: number;
}

/**
 * 島。半径 6000m は海岸線（平均 2900m、最大 約 3400m）の約 2 倍、起動位置（中心から 4500m）より 1.5km 外。
 * 巡航（250 m/s）で境界の外へ 10 秒飛ぶと 2.5km 出る。旋回して戻るには十分な猶予
 */
export const ISLAND_MAP: MapDef = {
  id: 'island',
  name: '島',
  center: { x: 0, z: 0 },
  radius: 6000,
  returnSeconds: 10,
};

export const MAPS: Readonly<Record<string, MapDef>> = {
  [ISLAND_MAP.id]: ISLAND_MAP,
};
