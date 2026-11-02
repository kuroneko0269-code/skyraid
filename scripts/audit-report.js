/* global console */
// 公開前の点検の結果の表示（8-1 の ui-audit-release.js から 8-3 で分けた）。report.ok に全体の合否を入れる
export function printReleaseReport(report) {
  const checks = [
    ['firstRun', report.firstRun],
    ['pwa', report.pwa],
    ['onlineHidden', report.onlineHidden],
    ['info', report.info],
    ...Object.entries(report.compat).map(([k, v]) => [`compat.${k}`, v]),
    ...Object.entries(report.card ?? {}).map(([k, v]) => [`card.${k}`, v]),
  ];
  const all = [...report.modes, ...checks.map(([, r]) => r)];
  // 8-3: WebGL が無い環境の点検では、three が描画を作れなかったことを console に出す（想定どおり）。数えない
  const expected = (name, e) =>
    /^compat\.noWebGL/.test(name) && /Error creating WebGL context/.test(e);
  const errors = [
    ...report.modes.flatMap((r) => r.errors),
    ...checks.flatMap(([name, r]) => r.errors.filter((e) => !expected(name, e))),
  ];
  const csp = all.flatMap((r) => r.csp);
  report.ok = all.every((r) => r.ok) && errors.length === 0 && csp.length === 0;
  console.log(`browser\t${report.browser.name} ${report.browser.version}`);
  for (const m of report.modes)
    console.log(
      `mode\t${m.mode}\t${m.ok ? 'OK' : 'NG'}\t${m.detail}\terrors ${m.errors.length}\tcsp ${m.csp.length}`,
    );
  for (const [name, r] of checks) {
    console.log(`${name}\t${r.ok ? 'OK' : 'NG'}`);
    for (const s of r.steps) console.log(`    ${s}`);
  }
  console.log(`console errors\t${errors.length}`);
  for (const e of [...new Set(errors)]) console.log(`    ${e}`);
  console.log(`CSP violations\t${csp.length}`);
  for (const v of [...new Set(csp)]) console.log(`    ${v}`);
  console.log(`total\t${report.ok ? 'OK' : 'NG'}`);
}
