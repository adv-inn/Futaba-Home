/**
 * Futaba Static Page — Theme Switcher + i18n + Scroll Animations
 */

(function () {
  'use strict';

  // ========== Theme Management ==========

  var STORAGE_KEY = 'futaba-static-theme';
  var THEME_ORDER = ['clean-light', 'clean-dark', 'persona5'];

  // z-index lookup: for each active theme, assign z-index to all 3 cards
  // so that adjacent non-active card is always in front of the farther one
  var Z_INDEX_MAP = {
    'light': { 'light': 10, 'dark': 5, 'p5': 4 },
    'dark':  { 'light': 4, 'dark': 10, 'p5': 5 },
    'p5':    { 'light': 4, 'dark': 5, 'p5': 10 },
  };

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'clean-light';
    } catch (e) {
      return 'clean-light';
    }
  }

  function applyTheme(themeName, skipAnimation) {
    var root = document.documentElement;

    // Remove all theme classes
    root.classList.remove('theme-persona5', 'theme-clean', 'dark');

    switch (themeName) {
      case 'persona5':
        root.classList.add('theme-persona5');
        break;
      case 'clean-light':
        root.classList.add('theme-clean');
        break;
      case 'clean-dark':
        root.classList.add('theme-clean', 'dark');
        break;
    }

    // background-color is driven by CSS theme classes + transition
    // Clear any inline backgroundColor so CSS takes over
    if (!skipAnimation) {
      root.style.removeProperty('background-color');
    }

    // Persist choice
    try {
      localStorage.setItem(STORAGE_KEY, themeName);
    } catch (e) {
      // localStorage unavailable
    }

    // Update cascade cards — active card + dynamic z-index
    var cascadeMap = { 'clean-light': 'light', 'clean-dark': 'dark', 'persona5': 'p5' };
    var activeKey = cascadeMap[themeName];
    var zMap = Z_INDEX_MAP[activeKey];
    document.querySelectorAll('.cascade-card').forEach(function (card) {
      var key = card.dataset.theme;
      var isActive = key === activeKey;
      var wasActive = card.classList.contains('active');
      // Only re-trigger pop animation when newly becoming active
      if (isActive && !wasActive && !skipAnimation) {
        card.style.animation = 'none';
        // Force reflow to restart animation
        void card.offsetWidth;
        card.style.animation = '';
      }
      card.classList.toggle('active', isActive);
      card.style.zIndex = zMap[key];
    });
  }

  function cycleTheme(direction) {
    var current = getStoredTheme();
    var idx = THEME_ORDER.indexOf(current);
    if (idx === -1) idx = 0;
    var next = (idx + direction + THEME_ORDER.length) % THEME_ORDER.length;
    applyTheme(THEME_ORDER[next]);
  }

  // ========== i18n ==========

  var LANG_KEY = 'futaba-static-lang';
  var LANGS = {
    zh: {
      'hero.subtitle': '一款使用 Tauri 开发的支持双端操作的英雄联盟客户端，简洁，高效',
      'features.title': 'Features',
      'features.subtitle': '从选人阶段到对局结束，全流程智能辅助',
      // Feature cards
      'feature.accept.title': '自动接受对局',
      'feature.accept.desc': '匹配成功后自动接受对局，无需手动操作，再也不会错过匹配',
      'feature.history.title': '战绩查询',
      'feature.history.desc': '查看详细对局历史记录，包括KDA、伤害数据和装备详情',
      'feature.friends.title': '好友交互',
      'feature.friends.desc': '聊天、邀请好友组队、预约邀请，社交功能一应俱全',
      'feature.opgg.title': 'OP.GG 集成',
      'feature.opgg.desc': '自动应用版本强势出装、符文和召唤师技能，支持排位、大乱斗、斗魂竞技场等多模式',
      'feature.counter.title': 'Counter 对位分析',
      'feature.counter.desc': '自动计算选中英雄的克制与被克制关系，经典模式下展示对位推荐',
      'feature.ai.title': 'AI 智能分析',
      'feature.ai.desc': 'AI 实时局势分析与出装推荐，对局结束后提供复盘评价与改进建议',
      'feature.auto.title': '自动应用',
      'feature.auto.desc': '选人阶段自动应用符文、召唤师技能和装备集，告别手动配置',
      'feature.overlay.title': '游戏内悬浮窗',
      'feature.overlay.desc': '透明无边框悬浮窗覆盖在游戏画面上，快捷键一键切换，不影响游戏操作',
      'feature.mobile.title': '移动端支持',
      'feature.mobile.desc': '局域网数据共享，手机扫码即可操控选人、查看出装和海克斯推荐',
      // Showcase sections
      'showcase.app.title': '主程序',
      'showcase.app.subtitle': '启动英雄联盟客户端后，使用 Futaba 接管所有其他功能',
      'showcase.opgg.title': 'OP.GG 集成',
      'showcase.opgg.subtitle': '自动应用版本强势装备与符文，经典模式展示 Counter 对位推荐，大乱斗展示海克斯强化',
      'showcase.mobile.title': '移动端',
      'showcase.mobile.subtitle': '局域网内扫码访问，接受对局、抢英雄、查出装，拿外卖上厕所也不耽误',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': '现代技术栈，原生性能',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
    },
    en: {
      'hero.subtitle': 'A dual-platform League of Legends client built with Tauri — simple and efficient',
      'features.title': 'Features',
      'features.subtitle': 'Intelligent assistance from champion select to post-game',
      // Feature cards
      'feature.accept.title': 'Auto Accept',
      'feature.accept.desc': 'Automatically accept matches when a game is found — never miss a queue pop again',
      'feature.history.title': 'Match History',
      'feature.history.desc': 'Browse detailed match history including KDA, damage stats, and item builds',
      'feature.friends.title': 'Friends & Social',
      'feature.friends.desc': 'Chat, invite friends to party, schedule invites — all social features in one place',
      'feature.opgg.title': 'OP.GG Integration',
      'feature.opgg.desc': 'Auto-apply meta builds, runes, and summoner spells across Ranked, ARAM, Arena, and more',
      'feature.counter.title': 'Counter Analysis',
      'feature.counter.desc': 'Automatically calculate counter and favorable matchups for your selected champion',
      'feature.ai.title': 'AI Analysis',
      'feature.ai.desc': 'Real-time AI situation analysis and build advice, plus post-game review with improvement tips',
      'feature.auto.title': 'Auto Apply',
      'feature.auto.desc': 'Automatically apply runes, summoner spells, and item sets during champion select',
      'feature.overlay.title': 'In-Game Overlay',
      'feature.overlay.desc': 'Transparent borderless overlay on top of the game, toggle with a hotkey without interrupting gameplay',
      'feature.mobile.title': 'Mobile Support',
      'feature.mobile.desc': 'LAN data sharing — scan QR code on your phone to pick champions, view builds, and more',
      // Showcase sections
      'showcase.app.title': 'Main App',
      'showcase.app.subtitle': 'Launch the LoL client, then let Futaba handle everything else',
      'showcase.opgg.title': 'OP.GG Integration',
      'showcase.opgg.subtitle': 'Auto-apply meta builds and runes, show counter matchups in Classic mode, augments in ARAM',
      'showcase.mobile.title': 'Mobile',
      'showcase.mobile.subtitle': 'Scan to access on your local network — accept matches, pick champions, and check builds on the go',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': 'Modern stack, native performance',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
    },
    ja: {
      'hero.subtitle': 'Tauri で開発されたデュアルプラットフォーム対応の LoL クライアント — シンプルで高効率',
      'features.title': 'Features',
      'features.subtitle': 'チャンピオン選択から試合終了まで、全行程をスマートにサポート',
      // Feature cards
      'feature.accept.title': '自動マッチ承認',
      'feature.accept.desc': 'マッチング成功後に自動で対戦を承認。手動操作不要で、マッチを見逃しません',
      'feature.history.title': '戦績検索',
      'feature.history.desc': 'KDA、ダメージデータ、アイテム詳細を含む詳細な試合履歴を閲覧',
      'feature.friends.title': 'フレンド機能',
      'feature.friends.desc': 'チャット、フレンド招待、予約招待など、ソーシャル機能が充実',
      'feature.opgg.title': 'OP.GG 連携',
      'feature.opgg.desc': 'メタビルド・ルーン・サモナースペルを自動適用。ランク・ARAM・アリーナなど複数モードに対応',
      'feature.counter.title': 'カウンター分析',
      'feature.counter.desc': '選択チャンピオンのカウンターと有利マッチアップを自動計算',
      'feature.ai.title': 'AI 分析',
      'feature.ai.desc': 'AIによるリアルタイム局勢分析とビルド提案、試合後の振り返りと改善アドバイス',
      'feature.auto.title': '自動適用',
      'feature.auto.desc': 'チャンピオン選択時にルーン・サモナースペル・アイテムセットを自動適用',
      'feature.overlay.title': 'ゲーム内オーバーレイ',
      'feature.overlay.desc': '透明なボーダーレスオーバーレイをゲーム画面上に表示。ホットキーで切り替え、操作を妨げません',
      'feature.mobile.title': 'モバイル対応',
      'feature.mobile.desc': 'LAN共有でスマホからQRスキャン。チャンピオン選択・ビルド確認・ヘクステック推薦をモバイルで',
      // Showcase sections
      'showcase.app.title': 'メインアプリ',
      'showcase.app.subtitle': 'LoLクライアント起動後、Futabaがすべての機能を引き継ぎます',
      'showcase.opgg.title': 'OP.GG 連携',
      'showcase.opgg.subtitle': 'メタビルドとルーンを自動適用、クラシックモードでカウンター表示、ARAMでオーグメント表示',
      'showcase.mobile.title': 'モバイル',
      'showcase.mobile.subtitle': 'LAN内でQRスキャン。対戦承認・チャンピオン選択・ビルド確認を外出先でも',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': 'モダンな技術スタック、ネイティブパフォーマンス',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
    },
  };

  function getStoredLang() {
    try {
      return localStorage.getItem(LANG_KEY) || 'zh';
    } catch (e) {
      return 'zh';
    }
  }

  function applyLang(lang) {
    var dict = LANGS[lang];
    if (!dict) return;

    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja' : 'en';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.dataset.i18n;
      if (dict[key] !== undefined) {
        el.textContent = dict[key];
      }
    });

    // Update lang switcher buttons
    document.querySelectorAll('#langSwitcher button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      // localStorage unavailable
    }
  }

  // ========== Scroll Reveal (IntersectionObserver) ==========

  function initScrollReveal() {
    var elements = document.querySelectorAll('.scroll-reveal');
    if (!elements.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    elements.forEach(function (el) { observer.observe(el); });
  }

  // ========== Smooth Scroll for Anchor Links ==========

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var target = document.querySelector(link.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ========== Init ==========

  function init() {
    // Bind cascade nav buttons
    var prevBtn = document.getElementById('cascadePrev');
    var nextBtn = document.getElementById('cascadeNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { cycleTheme(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { cycleTheme(1); });

    // Bind language switcher
    document.querySelectorAll('#langSwitcher button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyLang(btn.dataset.lang);
      });
    });

    // Apply stored theme — skip animation on initial load
    applyTheme(getStoredTheme(), true);

    // Apply stored language
    applyLang(getStoredLang());

    // Init scroll animations
    initScrollReveal();

    // Init smooth scroll
    initSmoothScroll();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
