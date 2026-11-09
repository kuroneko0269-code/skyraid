// 10-6: ヴォルガス・ネフィルガの体の当たりの形の数値（ほかの 3 体と同じ扱いにそろえる。ぶつかったときの扱いは共通の KAIJU_RAM）。
// 骨の静止姿勢は描画の骨（src/render/kaiju-model/skeleton.ts・src/render/kaiju2-model/skeleton.ts）と同じ値（tests/kaiju-hulls.test.ts が
// 突き合わせる）。形は今の見た目（src/render/kaiju-model/parts.ts・src/render/kaiju2-model/parts.ts の管・楕円体・膜）をなぞった管と
// 三角形。判定は src/ai/kaiju-hull/

/** 骨: 名前・親の番号・静止姿勢の位置（x, y, z） */
export type HullBoneDef = readonly [string, number, number, number, number];

/** 管の端: 静止姿勢の位置・付いている骨（b があれば w で混ぜる） */
export type HullEnd = readonly [number, number, number, string, string?, number?];
/** 管: 端 a・端 b・半径 a・半径 b */
export type HullTubeDef = readonly [HullEnd, HullEnd, number, number];

/** 共通: 衝突の余裕（m）と、移動の線分を調べる間隔（m）。アルビオン・ゴウライ・ゼノリスと同じ */
export const KAIJU_HULL_COLLISION = { margin: 6, sampleStep: 4 } as const;

/** ヴォルガス（足元が原点・前方 −Z。描画の skeleton.ts の BONE_DEFS と同じ） */
export const VORGAS_HULL = {
  bones: [
    ['root', -1, 0, 0, 0],
    ['pelvis', 0, 0, 58, 8],
    ['chest', 1, 0, 86, -22],
    ['neck', 2, 0, 94, -40],
    ['head', 3, 0, 97, -52],
    ['jaw', 4, 0, 92, -56],
    ['armLUpper', 2, -20, 80, -30],
    ['armLFore', 6, -25, 60, -38],
    ['armRUpper', 2, 20, 80, -30],
    ['armRFore', 8, 25, 60, -38],
    ['thighL', 1, -16, 54, 8],
    ['shinL', 10, -19, 28, 0],
    ['footL', 11, -19, 6, 2],
    ['thighR', 1, 16, 54, 8],
    ['shinR', 13, 19, 28, 0],
    ['footR', 14, 19, 6, 2],
    ['tail0', 1, 0, 54, 28],
    ['tail1', 16, 0, 46, 56],
    ['tail2', 17, 0, 36, 86],
    ['tail3', 18, 0, 24, 114],
    ['tail4', 19, 0, 14, 140],
  ] satisfies readonly HullBoneDef[],
  /**
   * 管（半径は parts.ts の断面の横と縦の平均 × 筋肉の起伏の分 1.05）。胴は尾の付け根 → 骨盤 → 胸 → 首、頭は後頭部・鼻先・下あご、
   * 腕は肩 → 肘 → 手 → 爪、脚は股 → 膝 → 足首 → 足、尾は付け根 → 先、結晶の塊
   */
  tubes: [
    // 胴
    [[0, 52, 30, 'pelvis'], [0, 60, 10, 'pelvis'], 24.5, 29.4],
    [[0, 60, 10, 'pelvis'], [0, 78, -14, 'chest'], 29.4, 26.4],
    [[0, 78, -14, 'chest'], [0, 90, -32, 'chest'], 26.4, 16.8],
    [[0, 90, -32, 'chest'], [0, 92.5, -39, 'chest', 'neck', 0.5], 16.8, 8.7],
    [[0, 92.5, -39, 'chest', 'neck', 0.5], [0, 95, -46, 'neck'], 8.7, 7.4],
    // 頭
    [[0, 99, -50, 'head'], [0, 98, -62, 'head'], 10.5, 10.5],
    [[0, 97, -63, 'head'], [0, 96, -77, 'head'], 6.8, 6.8],
    [[0, 91, -53, 'jaw'], [0, 91, -75, 'jaw'], 4.5, 4.5],
    // 腕
    [[-20, 80, -30, 'armLUpper'], [-25, 60, -38, 'armLUpper', 'armLFore', 0.5], 6.3, 5.0],
    [[-25, 60, -38, 'armLUpper', 'armLFore', 0.5], [-28, 40, -55, 'armLFore'], 5.0, 3.8],
    [[-28, 40, -55, 'armLFore'], [-28, 30, -62, 'armLFore'], 2.2, 1.6],
    [[20, 80, -30, 'armRUpper'], [25, 60, -38, 'armRUpper', 'armRFore', 0.5], 6.3, 5.0],
    [[25, 60, -38, 'armRUpper', 'armRFore', 0.5], [28, 40, -55, 'armRFore'], 5.0, 3.8],
    [[28, 40, -55, 'armRFore'], [28, 30, -62, 'armRFore'], 2.2, 1.6],
    // 脚
    [[-16, 54, 8, 'thighL'], [-22, 28, 0, 'thighL', 'shinL', 0.5], 15.8, 12.6],
    [[-22, 28, 0, 'thighL', 'shinL', 0.5], [-19, 6, 2, 'footL'], 12.1, 9.5],
    [[-19, 4, 4, 'footL'], [-19, 3, -20, 'footL'], 7, 5],
    [[16, 54, 8, 'thighR'], [22, 28, 0, 'thighR', 'shinR', 0.5], 15.8, 12.6],
    [[22, 28, 0, 'thighR', 'shinR', 0.5], [19, 6, 2, 'footR'], 12.1, 9.5],
    [[19, 4, 4, 'footR'], [19, 3, -20, 'footR'], 7, 5],
    // 尾
    [[0, 54, 28, 'tail0'], [0, 46, 56, 'tail1'], 19.6, 15.7],
    [[0, 46, 56, 'tail1'], [0, 36, 86, 'tail2'], 15.7, 11.7],
    [[0, 36, 86, 'tail2'], [0, 24, 114, 'tail3'], 11.7, 8.2],
    [[0, 24, 114, 'tail3'], [0, 14, 140, 'tail4'], 8.2, 4.4],
    [[0, 14, 140, 'tail4'], [0, 8, 162, 'tail4'], 4.4, 1.3],
    // 結晶の塊（肩・首の付け根・前腕。parts.ts の CLUSTERS の 1 本目（一番大きい）の根元 → 先。根元の半径は散らばりの分を足す）
    [
      [-19.6, 88, -30.5, 'chest', 'armLUpper', 0.35],
      [-39.6, 117, -23.2, 'chest', 'armLUpper', 0.35],
      11.2,
      2,
    ],
    [
      [20.7, 86.5, -27.6, 'chest', 'armRUpper', 0.35],
      [39.2, 108, -19.2, 'chest', 'armRUpper', 0.35],
      9.2,
      1.6,
    ],
    [
      [-3.5, 98.3, -35.8, 'chest', 'neck', 0.3],
      [-10.9, 137.4, -24.3, 'chest', 'neck', 0.3],
      12.9,
      2.3,
    ],
    [
      [7.3, 97.6, -28.5, 'chest', 'neck', 0.15],
      [16.7, 118.2, -21.4, 'chest', 'neck', 0.15],
      7.4,
      1.3,
    ],
    [[-27.8, 52.7, -44.4, 'armLFore'], [-45.1, 56.9, -38.7, 'armLFore'], 5.8, 1],
    [[-29.2, 44.9, -50.5, 'armLFore'], [-40.3, 46.2, -43.9, 'armLFore'], 4, 1],
    [[28.6, 49.5, -46.3, 'armRFore'], [48.5, 56.6, -41.5, 'armRFore'], 6.7, 1.2],
  ] satisfies readonly HullTubeDef[],
} as const;

/** ネフィルガ（体の中心が原点・右 +x・上 +y・前 −z。描画の skeleton.ts の BONE_DEFS と同じ） */
export const KAIJU2_HULL = {
  bones: [
    ['root', -1, 0, 0, 0],
    ['chest', 0, 0, 2, -18],
    ['neck0', 1, 0, 5, -38],
    ['neck1', 2, 0, 9, -54],
    ['head', 3, 0, 11, -68],
    ['tail0', 0, 0, 0, 18],
    ['tail1', 5, 0, -1, 34],
    ['tail2', 6, 0, -2, 50],
    ['tail3', 7, 0, -2, 64],
    ['tail4', 8, 0, -2, 76],
    ['wingL0', 1, -12, 6, -20],
    ['wingL1', 10, -50, 9, -12],
    ['wingL2', 11, -84, 11, -24],
    ['wingR0', 1, 12, 6, -20],
    ['wingR1', 13, 50, 9, -12],
    ['wingR2', 14, 84, 11, -24],
    ['legL', 0, -8, -6, 12],
    ['legR', 0, 8, -6, 12],
  ] satisfies readonly HullBoneDef[],
  /** 翼の先（指の先。右翼。左は x を反転）。描画の WING_TIP と同じ */
  wingTip: [120, 9, 8] as readonly [number, number, number],
  /** 管（半径は parts.ts の断面の横と縦の平均）: 胴・首・頭・くちばし・尾・翼の骨（左右は kaiju2-hull.ts が作る） */
  tubes: [
    [[0, -1, 26, 'tail0'], [0, 0, 10, 'root', 'tail0', 0.3], 6.5, 12],
    [[0, 0, 10, 'root', 'tail0', 0.3], [0, 1, -8, 'root'], 12, 14.5],
    [[0, 1, -8, 'root'], [0, 3, -26, 'root', 'chest', 0.7], 14.5, 11.5],
    [[0, 3, -26, 'root', 'chest', 0.7], [0, 5, -38, 'chest', 'neck0', 0.6], 11.5, 7],
    [[0, 5, -38, 'chest', 'neck0', 0.6], [0, 9, -54, 'neck1'], 7, 5.2],
    [[0, 9, -54, 'neck1'], [0, 11, -64, 'neck1', 'head', 0.7], 5.2, 5],
    [[0, 12, -64, 'head'], [0, 12, -78, 'head'], 7, 7],
    [[0, 10, -79, 'head'], [0, 7, -94, 'head'], 3, 0.8],
    [[0, -1, 24, 'tail0'], [0, -1, 34, 'tail1'], 6, 4.4],
    [[0, -1, 34, 'tail1'], [0, -2, 50, 'tail2'], 4.4, 3.2],
    [[0, -2, 50, 'tail2'], [0, -2, 64, 'tail3'], 3.2, 2.3],
    [[0, -2, 64, 'tail3'], [0, -2, 84, 'tail4'], 2.3, 1.2],
    // 尾の先のひれ（菱形の縦の板。管で近づける）
    [[0, -2, 76, 'tail4'], [0, -2, 92, 'tail4'], 4, 1],
  ] satisfies readonly HullTubeDef[],
  /** 翼の骨の管（右翼。肩 → 骨の付け根 → 肘 → 手首 → 指の先の半径） */
  wingRadii: [6, 5.5, 4, 3, 1] as readonly number[],
  /** 翼の膜: 付け根 → 先の分け方（区間）と、前縁 → 後縁の分け方。膜の片側の厚み（m。たるみ 3m を含む） */
  membrane: { span: 12, chord: 2, half: 2 },
} as const;
