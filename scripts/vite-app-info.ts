// 7-D: 「情報」画面の中身をビルド時に作る仮想モジュール virtual:app-info（版と使用ライブラリのライセンス一覧）。
// 版は package.json の version。ライセンスは package.json の dependencies から依存をたどり（実行時に配信される JS に入るもの）、
// Service Worker（vite-plugin-pwa の generateSW）が埋め込む workbox を足す。各パッケージの package.json と LICENSE を読む
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

export interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly url: string;
  readonly text: string;
}

const VIRTUAL_ID = 'virtual:app-info';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
/** Service Worker に入る workbox（generateSW の出力が import するもの） */
export const SW_PACKAGES = [
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
] as const;

type Json = Record<string, unknown>;

function isJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null;
}

function readJson(path: string): Json {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return isJson(v) ? v : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 依存のディレクトリ（入れ子の node_modules を先に探す） */
function packageDir(root: string, from: string, name: string): string | null {
  for (const base of [from, root]) {
    const dir = `${base}/node_modules/${name}`;
    if (existsSync(`${dir}/package.json`)) return dir;
  }
  return null;
}

function licenseText(dir: string): string {
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(`${dir}/${file}`, 'utf8').trim() : '';
}

function repoUrl(pkg: Json): string {
  const repo = pkg.repository;
  const raw = isJson(repo) ? str(repo.url) : str(repo);
  const home = str(pkg.homepage);
  const url = (home || raw).replace(/^git\+/, '').replace(/\.git$/, '');
  return url.startsWith('http') ? url : '';
}

function deps(pkg: Json): string[] {
  const d = pkg.dependencies;
  return isJson(d) ? Object.keys(d) : [];
}

/** package.json の dependencies（と SW の workbox）から推移的にたどったライセンスの一覧（名前順） */
export function collectLicenses(root: string): LicenseEntry[] {
  const seen = new Map<string, LicenseEntry>();
  const queue: { name: string; from: string }[] = [
    ...deps(readJson(`${root}/package.json`)),
    ...SW_PACKAGES,
  ].map((name) => ({ name, from: root }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.name)) continue;
    const dir = packageDir(root, next.from, next.name);
    if (!dir) continue;
    const pkg = readJson(`${dir}/package.json`);
    const lic = pkg.license;
    seen.set(next.name, {
      name: next.name,
      version: str(pkg.version),
      license: isJson(lic) ? str(lic.type) : str(lic),
      url: repoUrl(pkg),
      text: licenseText(dir),
    });
    for (const d of deps(pkg)) queue.push({ name: d, from: dir });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function appInfo(root: string): Plugin {
  return {
    name: 'skyraid-app-info',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const version = str(readJson(`${root}/package.json`).version);
      return [
        `export const APP_VERSION = ${JSON.stringify(version)};`,
        `export const LICENSES = ${JSON.stringify(collectLicenses(root))};`,
      ].join('\n');
    },
  };
}
