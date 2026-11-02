// 古いブラウザの案内（8-3）: アプリのモジュール（src/main.ts）が動くと <html data-app="started"> を付ける。
// 読み込みが終わっても付いていなければ、構文（ES2022）・モジュールを読めない古いブラウザとみなして案内を出す（真っ黒にしない）。
// どのブラウザでも動くよう ES5 だけで書く。文面は文言の表（src/data/i18n の compat.*）から、ビルド時に
// scripts/vite-legacy-check.ts が下の置き換え用の印（LEGACY_STRINGS を _ 2 つで挟んだもの）を { ja: {...}, en: {...} } に置き換えて埋め込む（8-4）。
// 言語の決め方は src/core/locale.ts と同じ（?lang= > セーブの settings.language > ブラウザの言語が ja で始まれば日本語）
(function () {
  'use strict';
  var STRINGS = __LEGACY_STRINGS__;
  function isLang(v) {
    return v === 'ja' || v === 'en';
  }
  function pickLang() {
    try {
      var m = /[?&]lang=([a-zA-Z]+)/.exec(window.location.search || '');
      var p = m ? m[1].toLowerCase() : '';
      if (isLang(p)) return p;
      if (p !== 'auto') {
        var raw = window.localStorage.getItem('skyraid.save');
        var data = raw ? JSON.parse(raw) : null;
        var saved = data && data.settings ? data.settings.language : null;
        if (isLang(saved)) return saved;
      }
    } catch (e) {
      // 保存が読めない・壊れているときはブラウザの言語
    }
    var nav = window.navigator || {};
    var first = nav.languages && nav.languages[0];
    var lang = String(first || nav.language || nav.userLanguage || '');
    return lang.toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
  }
  function show() {
    if (document.documentElement.getAttribute('data-app')) return;
    if (document.querySelector('.compat-notice')) return;
    var s = STRINGS[pickLang()];
    var root = document.createElement('div');
    root.className = 'compat-notice';
    root.setAttribute('role', 'alert');
    var box = document.createElement('div');
    box.className = 'compat-notice-box';
    root.appendChild(box);
    function add(tag, cls, text) {
      var e = document.createElement(tag);
      e.className = cls;
      e.textContent = text;
      box.appendChild(e);
      return e;
    }
    add('div', 'compat-notice-app', 'SkyRaid: Titan Skies');
    add('h1', 'compat-notice-title', s.title);
    add('p', 'compat-notice-text', s.body);
    add('h2', 'compat-notice-sub', s.environment);
    var list = document.createElement('ul');
    list.className = 'compat-notice-list';
    for (var i = 0; i < s.items.length; i++) {
      var li = document.createElement('li');
      li.textContent = s.items[i];
      list.appendChild(li);
    }
    box.appendChild(list);
    add('p', 'compat-notice-note', s.note);
    document.body.appendChild(root);
  }
  // モジュールは読み込みの終わり（load）より前に動く。念のため少し待ってから確かめる
  window.addEventListener('load', function () {
    setTimeout(show, 500);
  });
})();
