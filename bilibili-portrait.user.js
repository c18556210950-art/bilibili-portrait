// ==UserScript==
// @name         B站 · 手机竖屏网页版
// @namespace    local.bilibili.portrait
// @version      1.6.2
// @description  手机竖屏浏览 B 站，适配首页、空间、热门分区、图文、历史动态、番剧影视和课程，补充直播消息等独立站点布局。
// @match        https://www.bilibili.com/*
// @match        https://search.bilibili.com/*
// @match        https://m.bilibili.com/*
// @match        https://t.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://live.bilibili.com/*
// @match        https://message.bilibili.com/*
// @match        https://account.bilibili.com/*
// @match        https://member.bilibili.com/*
// @match        https://show.bilibili.com/*
// @match        https://manga.bilibili.com/*
// @match        https://love.bilibili.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const KEY = 'bili-portrait-settings-v1';
  const DEFAULT_CHANNELS = ['番剧', '电影', '国创', '电视剧'];
  const CHANNEL_CATALOG = '番剧,电影,国创,电视剧,综艺,纪录片,动画,游戏,鬼畜,音乐,舞蹈,影视,娱乐,知识,科技数码,资讯,美食,小剧场,汽车,时尚美妆,体育运动,动物,vlog,绘画,人工智能,家装房产,户外,健身,手工,旅游出行,三农,亲子,健康,情感,生活兴趣,生活经验,公益,超高清,视频播客'.split(',');
  const DEFAULTS = { mode: 'auto', columns: 2, sameTab: true, speed: 1, autoNext: null };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const ROOT_CLASS = 'bpm-active';
  const HOST_ID = 'bpm-toolbar-host';
  const root = document.documentElement;
  let saved = {};
  try { saved = GM_getValue(KEY, {}); } catch { /* 支持不提供存储 API 的管理器。 */ }
  const settings = {
    mode: ['auto', 'on', 'off'].includes(saved?.mode) ? saved.mode : DEFAULTS.mode,
    columns: saved?.columns === 1 ? 1 : 2,
    sameTab: typeof saved?.sameTab === 'boolean' ? saved.sameTab : true,
    speed: SPEEDS.includes(saved?.speed) ? saved.speed : 1,
    autoNext: typeof saved?.autoNext === 'boolean' ? saved.autoNext : DEFAULTS.autoNext,
    channels: Array.isArray(saved?.channels)
      ? [...new Set(saved.channels.filter(name => typeof name === 'string' && name.length <= 30))].slice(0, 60)
      : [...DEFAULT_CHANNELS],
  };

  let active = false;
  let host, ui, panel, status, searchForm, searchInput, searchBackdrop, pullIndicator, toast;
  let video = null;
  let videoController = null;
  let viewportRecords = new Map();
  let createdViewport = null;
  let pending = 0;
  let lastURL = location.href;
  let toastTimer = 0;
  let lastRefresh = 0;
  const movedCollections = new Map();
  const commentRoots = new Map();
  const hiddenChannels = new Set();
  let channelNames = [...CHANNEL_CATALOG];
  let pull = null;
  let pullBusy = false;
  const COLLECTION_SELECTOR = '.video-pod, .base-video-sections, .video-sections, .multi-page, .action-list-container';

  // 只覆盖布局；不重建播放器、不请求播放 API、不修改登录信息。
  const css = `
    html.bpm-active {
      --bpm-columns: 2;
      --bpm-video-ratio: 16 / 9;
      --bpm-gap: 12px;
      --bpm-pad: 12px;
      min-width: 0 !important;
      width: 100% !important;
      overflow-x: clip !important;
      scroll-padding-bottom: 90px;
      -webkit-text-size-adjust: 100%;
    }
    html.bpm-active body {
      min-width: 0 !important;
      width: 100% !important;
      margin: 0 !important;
      overflow-x: clip !important;
      padding-bottom: calc(78px + env(safe-area-inset-bottom, 0px)) !important;
    }
    html.bpm-active #app { min-width: 0 !important; max-width: 100% !important; }
    html.bpm-active :is(button, a, input, select, textarea) { touch-action: manipulation; }
    html.bpm-active :is(input, textarea, select) { font-size: 16px !important; }
    html.bpm-active :is(.bili-header, #biliMainHeader, .mini-header) {
      min-width: 0 !important; width: 100% !important; height: auto !important;
      position: relative !important; inset: auto !important; z-index: 100 !important;
      transform: none !important;
    }
    html.bpm-active :is(.bili-header__bar, .bili-header__menu, .mini-header__content) {
      min-width: 0 !important; width: 100% !important; height: auto !important;
      min-height: 56px !important; padding: 8px 12px !important;
      box-sizing: border-box !important; gap: 10px !important;
      flex-wrap: wrap !important; background: var(--bg1, #fff) !important;
      position: relative !important; inset: auto !important; transform: none !important;
    }
    html.bpm-active :is(.bili-header .left-entry, .mini-header .nav-link, .bili-header .b-logo,
      .bili-header .animated-banner, .bili-header .header-banner, .bili-header__banner,
      .bili-header .upload-btn, .bili-header .right-entry__outside) { display: none !important; }
    html.bpm-active .bili-header .center-search-container {
      flex: 1 1 160px !important; width: auto !important; min-width: 100px !important;
      max-width: none !important; margin: 0 !important;
    }
    html.bpm-active .bili-header :is(.right-entry, .right-entry-main, .right-entry__main) {
      gap: 6px !important; margin: 0 !important; flex-shrink: 0 !important;
    }
    html.bpm-active .bili-header .right-entry > .right-entry-item {
      min-width: 36px !important; margin: 0 !important;
    }
    html.bpm-active .bili-header :is(.vip-entry, .right-entry--vip) { display: none !important; }
    html.bpm-active .bili-header :is(.trigger-icon, .right-entry__item-trigger) {
      color: var(--text1, #18191c) !important;
    }
    html.bpm-active .bili-header .right-entry { position: relative !important; z-index: 1 !important; }
    html.bpm-active .bili-header .center-search-container { position: relative !important; z-index: 2 !important; }
    html.bpm-active :is(.bili-header .search-panel, .bili-header .nav-search-panel) {
      position: fixed !important; left: 12px !important; right: 12px !important;
      top: var(--bpm-search-bottom, 60px) !important; bottom: auto !important;
      width: auto !important; max-width: none !important; box-sizing: border-box !important;
      max-height: calc(100dvh - var(--bpm-search-bottom, 60px) - 80px) !important;
      overflow-y: auto !important; background: var(--bg1, #fff) !important; z-index: 110 !important;
    }
    html.bpm-active .bili-header .dynamic-entry .v-popover {
      position: fixed !important; left: 12px !important; right: 12px !important;
      top: var(--bpm-header-bottom, 108px) !important; bottom: auto !important;
      width: auto !important; margin: 0 !important; padding: 0 !important;
      transform: none !important; z-index: 105 !important;
    }
    html.bpm-active .dynamic-panel-popover {
      width: 100% !important; min-width: 0 !important; box-sizing: border-box !important;
      max-height: calc(100dvh - var(--bpm-header-bottom, 108px) - 80px) !important;
      overflow-y: auto !important; overscroll-behavior: contain;
    }
    html.bpm-active .dynamic-panel-popover .living-up-list {
      display: flex !important; justify-content: flex-start !important; gap: 12px !important;
      overflow-x: auto !important; padding: 8px 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active .dynamic-panel-popover .living-up-list .up-item {
      flex: 0 0 52px !important; min-width: 0 !important; margin: 0 !important;
    }
    html.bpm-active .dynamic-panel-popover .dynamic-header { padding: 12px !important; }
    html.bpm-active .dynamic-panel-popover .v-popover-content { max-width: 100% !important; }
    html.bpm-active .bili-header .dynamic-entry .v-popover-content {
      width: 100% !important; min-width: 0 !important; box-sizing: border-box !important;
    }

    /* 首页：推荐卡片变为可选的一列或两列。仅给首页容器加覆盖。 */
    html.bpm-active[data-bpm-page="home"] :is(.bili-header__channel, .bili-header .channel) {
      min-width: 0 !important; width: 100% !important; height: auto !important;
      padding: 10px 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="home"] .right-channel-container {
      width: 100% !important; min-width: 0 !important; gap: 0 !important;
    }
    html.bpm-active[data-bpm-page="home"] .channel-items__left {
      display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      grid-auto-flow: row !important; grid-template-rows: none !important; overflow: visible !important;
      min-width: 0 !important; height: auto !important; gap: 8px !important;
    }
    html.bpm-active[data-bpm-page="home"] .channel-items__left > a.channel-link {
      width: auto !important; min-width: 0 !important; max-width: 100% !important;
      min-height: 36px !important; height: auto !important; padding: 6px 2px !important;
      display: flex !important; justify-content: center !important; box-sizing: border-box !important;
      white-space: normal !important; font-size: 13px !important;
    }
    html.bpm-active[data-bpm-page="home"] .channel-items__left > a.channel-link.bpm-channel-hidden { display: none !important; }
    html.bpm-active[data-bpm-page="home"] :is(.channel-items__left > .channel-link__more,
      .header-channel-fixed, .fixed-channel-shim, .palette-button-outer, .feed-roll-btn) { display: none !important; }
    html.bpm-active[data-bpm-page="home"] { overscroll-behavior-y: contain; }
    html.bpm-active[data-bpm-page="home"] :is(.channel-icons, .channel-items__right) { display: none !important; }
    html.bpm-active[data-bpm-page="home"] .channel-items__left { width: 100% !important; padding: 0 !important; border: 0 !important; }
    html.bpm-active[data-bpm-page="home"] :is(.bili-header__channel .channel-items, .bili-header__channel .channel-links) {
      flex: 1 !important; min-width: 0 !important;
    }
    html.bpm-active[data-bpm-page="home"] :is(.bili-feed4, .bili-feed4-layout, .bili-feed4 .container, .recommended-container_floor-aside) {
      width: 100% !important; min-width: 0 !important; max-width: none !important;
      box-sizing: border-box !important; margin: 0 !important; padding: 0 !important;
    }
    html.bpm-active[data-bpm-page="home"] :is(.bili-feed4 .container, .recommended-container_floor-aside .container) {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important;
      gap: var(--bpm-gap) !important; padding: 12px !important;
    }
    html.bpm-active[data-bpm-page="home"] :is(.feed-card, .bili-feed-card, .bili-video-card) {
      width: 100% !important; min-width: 0 !important; margin: 0 !important;
      grid-column: auto !important; grid-row: auto !important;
    }
    html.bpm-active[data-bpm-page="home"] :is(.recommended-swipe, .recommended-swipe-shim) {
      grid-column: 1 / -1 !important; grid-row: auto !important;
      width: 100% !important; min-width: 0 !important; height: auto !important;
    }
    html.bpm-active[data-bpm-page="home"] .recommended-swipe { aspect-ratio: 16 / 9; }
    html.bpm-active[data-bpm-page="home"] :is(.roll-btn, .feed-roll-btn) {
      position: static !important; grid-column: 1 / -1 !important;
      width: 100% !important; min-height: 44px !important; writing-mode: horizontal-tb !important;
    }
    html.bpm-active[data-bpm-page="home"] :is(.bili-video-card__info--tit, .bili-video-card__info--tit a) {
      font-size: 14px !important; line-height: 1.5 !important;
    }

    /* 搜索：保留原站的分类、排序、分页和输入框。 */
    html.bpm-active[data-bpm-page="search"] :is(.search-layout, .search-header, .search-content,
      .search-page-wrapper, .search-page, .i_wrapper, .search-input, .search-input-container) {
      width: 100% !important; min-width: 0 !important; max-width: none !important;
      box-sizing: border-box !important; margin-left: 0 !important; margin-right: 0 !important;
    }
    html.bpm-active[data-bpm-page="search"] .search-header { padding: 14px 12px 0 !important; }
    html.bpm-active[data-bpm-page="search"] .search-input-container { padding: 0 !important; }
    html.bpm-active[data-bpm-page="search"] .i_wrapper { padding: 12px 0 !important; }
    html.bpm-active[data-bpm-page="search"] :is(.search-tabs, .search-conditions) { padding: 12px !important; }
    html.bpm-active[data-bpm-page="search"] :is(.search-logo, .international-footer) { display: none !important; }
    html.bpm-active[data-bpm-page="search"] .search-input-wrap { width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="search"] .search-input-el { min-width: 0 !important; width: 100% !important; }
    html.bpm-active[data-bpm-page="search"] .search-button { min-width: 64px !important; height: 44px !important; }
    html.bpm-active[data-bpm-page="search"] :is(.search-tabs, .search-condition-row) {
      overflow-x: auto !important; overscroll-behavior-x: contain;
      display: flex !important; flex-wrap: nowrap !important;
    }
    html.bpm-active[data-bpm-page="search"] .search-tabs ul { display: flex !important; min-width: max-content !important; }
    html.bpm-active[data-bpm-page="search"] :is(.search-tabs li, .search-condition-row > *) { flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="search"] .search-page { padding: 12px !important; }
    html.bpm-active[data-bpm-page="search"] .video-list.row {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important;
      gap: 16px 12px !important; margin: 0 !important;
    }
    html.bpm-active[data-bpm-page="search"] .video-list.row > * {
      width: 100% !important; max-width: 100% !important; min-width: 0 !important;
      padding: 0 !important; margin: 0 !important; flex: none !important;
    }
    html.bpm-active[data-bpm-page="search"] .bili-video-card { min-width: 0 !important; width: 100% !important; }
    html.bpm-active[data-bpm-page="search"] :is(.vui_pagenation, .vui_pagination, .pagination, [aria-label="分页"]) {
      max-width: 100% !important; display: flex !important; flex-wrap: wrap !important; gap: 6px !important;
    }
    html.bpm-active[data-bpm-page="search"] .bangumi-pgc-list {
      display: flex !important; flex-direction: column !important; gap: 16px !important;
    }
    html.bpm-active[data-bpm-page="search"] .bangumi-pgc-list > * { width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="search"] .bangumi-pgc-list .media-item {
      display: flex !important; flex-direction: column !important; gap: 16px !important; margin: 0 !important;
    }
    html.bpm-active[data-bpm-page="search"] .bangumi-pgc-list .media-item-col {
      width: 100% !important; max-width: 100% !important; padding: 0 !important;
    }
    html.bpm-active[data-bpm-page="search"] .media-card-image { width: 100px !important; min-width: 100px !important; }
    html.bpm-active[data-bpm-page="search"] .media-card { min-width: 0 !important; height: auto !important; }
    html.bpm-active[data-bpm-page="search"] .vui_tabs { width: max-content !important; }
    html.bpm-active[data-bpm-page="search"] .btn-to-top-wrap { display: none !important; }
    html.bpm-active :is(.bili-video-card__stats, .bili-video-card__stats--left) { min-width: 0 !important; }
    html.bpm-active .bili-video-card__stats--left { flex: 1 !important; overflow: hidden !important; }
    html.bpm-active .bili-video-card__stats__duration { flex-shrink: 0 !important; margin-left: 4px !important; }

    /* 稍后再看：解除桌面最小宽度，筛选栏换行，保留卡片的进度和管理操作。 */
    html.bpm-active[data-bpm-page="watchlater"] :is(.watchlater-list, .watchlater-list-slim,
      .watchlater-list-title, .watchlater-list-nav, .breadcrums-nav, .watchlater-list-container) {
      --layout-padding: 12px; --menu-padding: 12px;
      min-width: 0 !important; width: 100% !important; max-width: 100% !important;
      margin-left: 0 !important; margin-right: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .watchlater-list { padding-top: 16px !important; }
    html.bpm-active[data-bpm-page="watchlater"] .watchlater-list-title {
      padding: 0 12px !important; font-size: 22px !important; line-height: 1.5 !important;
      gap: 8px !important; flex-wrap: wrap !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .watchlater-list-title__count { font-size: 15px !important; }
    html.bpm-active[data-bpm-page="watchlater"] .watchlater-list-nav {
      position: relative !important; top: auto !important; z-index: auto !important; box-shadow: none !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .breadcrums-nav { padding: 0 12px !important; }
    html.bpm-active[data-bpm-page="watchlater"] :is(.list-header-main, .list-header-filter, .list-header-options) {
      min-width: 0 !important; flex-wrap: wrap !important; gap: 8px !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .list-header { margin-top: 0 !important; padding: 12px 0 !important; }
    html.bpm-active[data-bpm-page="watchlater"] .list-header-filter__more { margin-left: 0 !important; padding-left: 8px !important; }
    html.bpm-active[data-bpm-page="watchlater"] :is(.list-header-filter__btn, .list-header-filter .vui_button) {
      width: auto !important; min-width: 0 !important; padding-left: 10px !important; padding-right: 10px !important;
      min-height: 40px !important; font-size: 14px !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .list-header-options { width: 100% !important; }
    html.bpm-active[data-bpm-page="watchlater"] .watchlater-list-container { padding: 0 12px !important; }
    html.bpm-active[data-bpm-page="watchlater"] .watchlater-list-grid {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important;
      gap: 20px 12px !important; min-width: 0 !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] :is(.video-card, .video-card__left, .video-card__right, .bili-video-card) {
      min-width: 0 !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .video-card { flex-direction: column !important; }
    html.bpm-active[data-bpm-page="watchlater"] .video-card__right { margin: 8px 0 0 !important; }
    html.bpm-active[data-bpm-page="watchlater"] .bili-video-card {
      --bili-video-card-title-font-size: 14px;
      --bili-video-card-title-line-height: 21px;
      --bili-video-card-subtitle-font-size: 12px;
    }
    html.bpm-active[data-bpm-page="watchlater"] .video-card__right .title {
      font-size: 14px !important; line-height: 21px !important; -webkit-line-clamp: 2 !important;
    }
    html.bpm-active[data-bpm-page="watchlater"] .video-card__stats { flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="watchlater"] :is(.fixed-side-menu, .bili-footer) { display: none !important; }

    /* 历史记录：日期留在每组卡片上方，筛选和管理控件仍使用原站节点。 */
    html.bpm-active[data-bpm-page="history"] :is(.history-record, .main-head, .main-breadcrumbs,
      .breadcrumbs-nav, .main-content, .history-list, .history-timeline, .history-section) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      margin-left: 0 !important; margin-right: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="history"] .history-record { padding-top: 16px !important; }
    html.bpm-active[data-bpm-page="history"] :is(.main-head, .breadcrumbs-nav, .main-content) { padding: 12px !important; }
    html.bpm-active[data-bpm-page="history"] .main-content { margin-top: 0 !important; }
    html.bpm-active[data-bpm-page="history"] :is(.main-head, .main-actions, .breadcrumbs__top,
      .breadcrumbs__top > .left, .breadcrumbs__top > .right, .tabs, .filter-item, .radio-filter) {
      flex-wrap: wrap !important; gap: 8px !important; min-width: 0 !important;
    }
    html.bpm-active[data-bpm-page="history"] .main-title { font-size: 22px !important; }
    html.bpm-active[data-bpm-page="history"] .main-breadcrumbs { position: relative !important; top: auto !important; z-index: auto !important; }
    html.bpm-active[data-bpm-page="history"] .breadcrumbs__top > :is(.left, .right) { width: 100% !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="history"] :is(.filter-switcher, .action-btn, .selected-tips) {
      width: auto !important; min-width: 0 !important; min-height: 40px !important;
      margin: 0 !important; padding: 6px 10px !important;
    }
    html.bpm-active[data-bpm-page="history"] :is(.search-bar, .search-input) {
      --search-bar-width: 100%; flex: 1 1 100% !important; width: 100% !important; min-width: 0 !important;
    }
    html.bpm-active[data-bpm-page="history"] .search-bar .input-wrap { max-width: none !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="history"] .search-bar-input { min-width: 0 !important; width: 100% !important; }
    html.bpm-active[data-bpm-page="history"] :is(.filters, .radio-filter, .date-picker-filter) { max-width: 100% !important; }
    html.bpm-active[data-bpm-page="history"] .history-timeline-item { display: block !important; }
    html.bpm-active[data-bpm-page="history"] :is(.history-timeline-label, .section-label, .section-title) {
      position: static !important; inset: auto !important; transform: none !important; height: auto !important;
    }
    html.bpm-active[data-bpm-page="history"] .history-timeline-label { display: block !important; padding: 8px 0 12px !important; }
    html.bpm-active[data-bpm-page="history"] .section-cards.grid-mode {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 20px 12px !important;
    }
    html.bpm-active[data-bpm-page="history"] .section-cards.list-mode { grid-template-columns: minmax(0, 1fr) !important; }
    html.bpm-active[data-bpm-page="history"] .section-cards { padding-bottom: 24px !important; }
    html.bpm-active[data-bpm-page="history"] :is(.history-card, .history-card__left, .history-card__main,
      .history-skeleton-card, .history-skeleton-card__left, .history-skeleton-card__main, .bili-video-card) {
      min-width: 0 !important; max-width: 100% !important;
    }
    html.bpm-active[data-bpm-page="history"] :is(.history-card.grid-mode, .history-card.grid-mode .history-card__main) { width: 100% !important; }
    html.bpm-active[data-bpm-page="history"] .history-card.list-mode .history-card__main { width: 120px !important; }
    html.bpm-active[data-bpm-page="history"] .history-card__right { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="history"] :is(.bili-video-card__title, .history-card__right .title) {
      font-size: 14px !important; line-height: 21px !important; -webkit-line-clamp: 2 !important;
    }
    html.bpm-active[data-bpm-page="history"] .history-card__right .title { margin-right: 28px !important; }
    html.bpm-active[data-bpm-page="history"] :is(.fixed-label-con, .history-timeline-anchor, .section-anchor-icon,
      .history-start, .fixed-nav-shim, .fixed-side-menu, .bili-footer) { display: none !important; }

    /* 番剧、国创、电影等频道：模块在屏幕内排列，保留分页和原生推荐切换。 */
    html.bpm-active[data-bpm-page="channel"] #app { padding-top: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.inner-content-wrapper, .home-banner-wrapper,
      .time-line-wrapper, .home-recommand-feed-wrapper, .home-recommand-feed-body) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      margin: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="channel"] :is(.inner-content-wrapper, .time-line-wrapper) { padding: 16px 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .home-banner-wrapper .banner-item-ratio-scale-container { padding-top: 33.33% !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group {
      position: relative !important; inset: auto !important; width: 100% !important;
      padding: 12px !important; margin: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group-title { width: 100% !important; min-width: 0 !important; padding: 0 !important; margin: 0 0 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group-title .is-hover-title { min-width: 0 !important; max-width: calc(100% - 56px) !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group-title .title-group { min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group-title .hover-title { white-space: normal !important; font-size: 16px !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group-body { overflow-x: auto !important; padding: 8px 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-hover-group-item {
      flex: 0 0 140px !important; width: 140px !important; margin-right: 10px !important;
    }
    html.bpm-active[data-bpm-page="channel"] :is(.hover-item-ratio-scale-inner.is-progressing, .hover-item-ratio-scale-inner) {
      top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important;
    }
    html.bpm-active[data-bpm-page="channel"] .inner-content-head { flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="channel"] .module-title-name { font-size: 20px !important; }
    html.bpm-active[data-bpm-page="channel"] .inner-content-body-container { min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .home-page-switch-wrapper .inner-content-body {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important;
      gap: 16px 12px !important; overflow: visible !important;
    }
    html.bpm-active[data-bpm-page="channel"] :is(.inner-content-item, .inner-content-item-v5, .inner-content-item-v7) {
      min-width: 0 !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; flex: none !important;
    }
    html.bpm-active[data-bpm-page="channel"] .ranking-cell-index { font-size: 30px !important; width: 22px !important; line-height: 42px !important; height: 42px !important; margin-right: 6px !important; }
    html.bpm-active[data-bpm-page="channel"] .hotranking-content-item-desc { padding-right: 0 !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.home-cell-desc-title, .timeline-item-title) { font-size: 14px !important; line-height: 21px !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.home-page-switch-wrapper .next-page, .home-page-switch-wrapper .prev-page) {
      position: relative !important; inset: auto !important; display: inline-flex !important;
      width: 44px !important; height: 44px !important; margin: 0 8px 0 0 !important;
    }
    html.bpm-active[data-bpm-page="channel"] .home-index-wrapper .inner-content-body { flex-direction: column !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="channel"] .inner-content-item-index { width: 100% !important; flex: none !important; margin: 0 !important; padding: 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .index-categary-content-container { height: auto !important; overflow: visible !important; }
    html.bpm-active[data-bpm-page="channel"] .index-categary-content-inner { flex-wrap: wrap !important; gap: 8px 16px !important; }
    html.bpm-active[data-bpm-page="channel"] .vertical-items-group { height: auto !important; gap: 8px !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .home-recommand-feed-body { padding: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .feenline-vcard-wrapper {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 16px 12px !important;
      overflow: visible !important;
    }
    html.bpm-active[data-bpm-page="channel"] .recommend-feed-line-rank-wrapper { margin: 16px 0 !important; padding: 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .feed-line-rank-body-container { display: flex !important; flex-direction: column !important; padding: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .subject-picture { display: none !important; }
    html.bpm-active[data-bpm-page="channel"] .subject-titles { position: static !important; width: 100% !important; margin-bottom: 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .feed-line-rank-body-inner { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 16px 12px !important; width: 100% !important; flex: none !important; }
    html.bpm-active[data-bpm-page="channel"] .new-hot-wrap .wrap { display: flex !important; flex-direction: column !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.new-hot-wrap .content-wrap, .new-hot-wrap .video-wrap) { width: 100% !important; height: auto !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .new-hot-wrap .video-area { width: 100% !important; height: auto !important; padding-bottom: 0 !important; aspect-ratio: 16 / 9; }
    html.bpm-active[data-bpm-page="channel"] .new-hot-wrap .info-wrap { position: relative !important; inset: auto !important; width: 100% !important; height: auto !important; justify-content: flex-start !important; }
    html.bpm-active[data-bpm-page="channel"] .new-hot-wrap .info-content-wrap { width: 100% !important; min-width: 0 !important; padding: 16px !important; }
    html.bpm-active[data-bpm-page="channel"] .new-hot-wrap .info-content-wrap .title { font-size: 20px !important; height: auto !important; line-height: 1.5 !important; white-space: normal !important; padding: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .time-line-head { width: 100% !important; min-width: 0 !important; flex-wrap: wrap !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .week-day-wrapper { width: 100% !important; min-width: 0 !important; flex: 0 0 100% !important; max-width: 100% !important; display: flex !important; overflow-x: auto !important; }
    html.bpm-active[data-bpm-page="channel"] .week-day-item { flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .time-line-body { display: block !important; width: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] .timeline-common-content { width: 100% !important; min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .timeline-common-content-list-container { overflow-x: auto !important; max-width: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] .timeline-weekday-item { flex: 0 0 140px !important; width: 140px !important; margin: 0 12px 0 0 !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.timeline-special-content-left, .timeline-special-content-right,
      .nav-tool-container, .bili-footer, .b-footer-wrap) { display: none !important; }
    /* 索引页：筛选放到结果上方，类型和年份换行，海报随列数设置。 */
    html.bpm-active[data-bpm-page="channel"] :is(.bangumi-index-crumb, .bangumi-index-body, .filter-body, .filter-wrapper) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; float: none !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="channel"] .bangumi-index-crumb { padding: 16px 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .bangumi-index-body { display: flex !important; flex-direction: column !important; padding: 0 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .filter-wrapper { order: -1 !important; padding: 0 0 16px !important; }
    html.bpm-active[data-bpm-page="channel"] .filter-list { width: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] .filter-block { display: flex !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .filter-name { width: 52px !important; flex: 0 0 52px !important; }
    html.bpm-active[data-bpm-page="channel"] .filter-item-wrapper { display: flex !important; flex: 1 !important; flex-wrap: wrap !important; width: auto !important; height: auto !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .sort-banner { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="channel"] .sort-item { margin: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .bangumi-list {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 20px 12px !important;
      width: 100% !important; margin: 0 !important;
    }
    html.bpm-active[data-bpm-page="channel"] .bangumi-item { width: 100% !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important; float: none !important; }
    html.bpm-active[data-bpm-page="channel"] .cover-wrapper { width: 100% !important; height: auto !important; aspect-ratio: 3 / 4; }
    html.bpm-active[data-bpm-page="channel"] .cover-wrapper .common-lazy-img { width: 100% !important; height: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] .pagelistbox { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; width: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.pagelistbox .custom-right, .pagelistbox .p) { float: none !important; margin: 0 !important; }

    /* 电影、电视剧、纪录片、综艺使用另一套频道模板。 */
    html.bpm-active[data-bpm-page="channel"] :is(.inner-c, .index-module, .banner-wrapper, .module) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="channel"] .inner-c { padding: 16px 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-wrapper { height: auto !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-wrapper .bg-container { position: relative !important; width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; }
    html.bpm-active[data-bpm-page="channel"] .banner-wrapper > .inner-c { height: auto !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-wrapper :is(.side-list-wrp, .bottom-group) { position: static !important; inset: auto !important; width: 100% !important; height: auto !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-wrapper .side-list { flex-direction: row !important; height: auto !important; overflow-x: auto !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="channel"] .banner-wrapper .side-item { flex: 0 0 160px !important; width: 160px !important; height: auto !important; padding: 8px !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .index-module .inner-c { flex-direction: column !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="channel"] .index-item { width: 100% !important; max-width: 100% !important; flex: none !important; }
    html.bpm-active[data-bpm-page="channel"] .index-item .value-c { height: auto !important; display: flex !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="channel"] .hot-module {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; grid-template-rows: none !important; gap: 16px 12px !important;
    }
    html.bpm-active[data-bpm-page="channel"] .hot-module > * { grid-column: auto !important; grid-row: auto !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .hot-module > .left { grid-column: 1 / -1 !important; width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; }
    html.bpm-active[data-bpm-page="channel"] .hot-module :is(.bpx-docker, .bpx-player-container, .bpx-player-primary-area, .bpx-player-video-area) { width: 100% !important; min-width: 0 !important; height: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] .hot-module .left .video-title { max-width: calc(100% - 128px) !important; left: 12px !important; font-size: 14px !important; }
    html.bpm-active[data-bpm-page="channel"] .hot-item-cover { width: 100% !important; height: auto !important; aspect-ratio: 3 / 4; }
    html.bpm-active[data-bpm-page="channel"] .module-imgv { display: flex !important; flex-direction: column !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .module-imgv > .col-2 { width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .list-c { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 16px 12px !important; width: 100% !important; min-width: 0 !important; overflow: visible !important; }
    html.bpm-active[data-bpm-page="channel"] .hover-c { width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; left: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .hover-item { height: auto !important; aspect-ratio: 3 / 4; }
    html.bpm-active[data-bpm-page="channel"] :is(.hover-c .title, .hover-c .desc, .hot-desc .title) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; font-size: 14px !important; }
    html.bpm-active[data-bpm-page="channel"] :is(.hover-c .title, .hot-desc .title) { height: auto !important; white-space: normal !important; line-height: 21px !important; -webkit-line-clamp: 2 !important; }
    html.bpm-active[data-bpm-page="channel"] .season-cover-c { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }
    html.bpm-active[data-bpm-page="channel"] .module-column { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="channel"] .column-item { width: 100% !important; min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="channel"] .promotion-c { flex-direction: column !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="channel"] .promotion-c :is(.img-c, .text) { width: 100% !important; min-width: 0 !important; }

    /* 动态：主内容一列，UP 列表和直播头像可横滑，文字与原生互动保留。 */
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-home--member, .bili-dyn-home--visitor, .bili-dyn-detail) {
      display: flex !important; flex-direction: column !important; width: 100% !important;
      min-width: 0 !important; max-width: 100% !important; margin: 0 !important; padding: 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-home--member, .bili-dyn-home--visitor) > :is(main, aside) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important;
      position: static !important; transform: none !important;
    }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-home--member, .bili-dyn-home--visitor) > .right { display: none !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-my-info, .bili-dyn-live-users) { padding: 12px !important; margin-bottom: 12px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-live-users__container { display: flex !important; gap: 12px !important; overflow-x: auto !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-live-users__item-container { flex: 0 0 156px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-publishing, .bili-dyn-up-list, .bili-dyn-list-tabs, .bili-dyn-list, .bili-dyn-list__items, .bili-dyn-list__item) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-publishing { padding: 12px !important; margin-bottom: 12px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-publishing__control { flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-up-list__content { transform: none !important; width: max-content !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-up-list__window { overflow-x: auto !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-up-list__nav, .bili-dyn-sidebar, .palette-button-outer) { display: none !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-list-tabs__list { display: flex !important; overflow-x: auto !important; max-width: 100% !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-list-tabs__item { flex-shrink: 0 !important; margin-right: 16px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item { min-width: 0 !important; max-width: 100% !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__main { width: 100% !important; padding: 0 12px !important; box-sizing: border-box !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__avatar { left: 12px !important; width: 40px !important; height: 40px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__avatar .bili-avatar { width: 36px !important; height: 36px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__header { padding-left: 48px !important; min-height: 44px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__body { min-width: 0 !important; max-width: 100% !important; overflow-wrap: anywhere; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__footer { padding: 0 12px !important; display: flex !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__action { flex: 1 !important; min-width: 0 !important; white-space: nowrap !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-card-video, .bili-dyn-card-live) { display: flex !important; flex-direction: column !important; height: auto !important; width: 100% !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-card-video__header, .bili-dyn-card-live__header) { width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-card-video__body, .bili-dyn-card-live__body) { min-width: 0 !important; width: 100% !important; box-sizing: border-box !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-card-video__title { white-space: normal !important; -webkit-line-clamp: 2 !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .dyn-card-opus__pics { max-width: 100% !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-album, .bili-album__preview) { max-width: 100% !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-album__preview:not(.single) { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 6px !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-album__preview:not(.single) .bili-album__preview__picture { width: 100% !important; height: auto !important; aspect-ratio: 1; margin: 0 !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-album__preview.single .bili-album__preview__picture { max-width: 100% !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-dyn-item__orig, .bili-dyn-item__orig__body,
      .bili-dyn-card-link-common, .bili-dyn-card-goods, .bili-dyn-card-article) { max-width: 100% !important; min-width: 0 !important; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) .bili-dyn-item__ornament { max-width: 40% !important; pointer-events: none; }
    html.bpm-active:is([data-bpm-page="dynamic"], [data-bpm-page="space"]) :is(.bili-at-popup, .bili-topic-search__popover, .bili-emoji) {
      max-width: calc(100vw - 48px) !important; box-sizing: border-box !important;
    }

    /* 自己与其他 UP 主空间：头图、资料、导航及内容分别占用真实高度。 */
    html.bpm-active[data-bpm-page="space"] :is(.space-header, .header-toutu, .header-upinfo,
      .space-navbar, .nav-bar__main, .space-main, .space-home, .space-upload, .space-lists,
      .space-favlist, .space-dynamic, .space-bangumi, .space-follow, .space-fans) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      margin-left: 0 !important; margin-right: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="space"] .space-header { display: flex !important; flex-direction: column !important; height: auto !important; min-height: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .header-toutu { position: relative !important; inset: auto !important; height: 110px !important; z-index: auto !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo-bg-shadow { display: none !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo { display: flex !important; flex-direction: column !important; height: auto !important; padding: 12px !important; gap: 12px !important; background: var(--bg1, #fff) !important; }
    html.bpm-active[data-bpm-page="space"] .upinfo__main { width: 100% !important; min-width: 0 !important; margin: 0 !important; gap: 12px !important; align-items: flex-start !important; }
    html.bpm-active[data-bpm-page="space"] .upinfo-avatar { width: 64px !important; height: 64px !important; margin: 0 !important; flex: 0 0 64px !important; }
    html.bpm-active[data-bpm-page="space"] .space-avatar { width: 64px !important; height: 64px !important; }
    html.bpm-active[data-bpm-page="space"] .space-avatar :is(.avatar, .b-avatar, .b-avatar__canvas) { width: 100% !important; height: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .upinfo-detail { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="space"] .upinfo-detail__top { flex-wrap: wrap !important; gap: 4px !important; }
    html.bpm-active[data-bpm-page="space"] .nickname { font-size: 20px !important; line-height: 1.4 !important; color: var(--text1, #18191c) !important; text-shadow: none !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="space"] .header-sign { min-width: 0 !important; width: 100% !important; height: auto !important; max-height: none !important; overflow: visible !important; }
    html.bpm-active[data-bpm-page="space"] .header-sign :is(.pure-text, .editable-input) { color: var(--text2, #61666d) !important; text-shadow: none !important; min-width: 0 !important; max-width: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .header-sign .pure-text { display: block !important; white-space: normal !important; height: auto !important; max-height: none !important; overflow: visible !important; text-overflow: clip !important; -webkit-line-clamp: unset !important; line-height: 1.6 !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="space"] .header-sign .editable-input { width: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo :is(.operations, .interactions) { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; width: 100% !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo :is(.message-btn, .space-follow-btn, .view-switcher__trigger) { min-height: 40px !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo :is(.message-btn, .view-switcher__trigger, .more-actions__trigger, .toutu-editor-trigger) { color: var(--text1, #18191c) !important; border-color: var(--line_regular, #e3e5e7) !important; text-shadow: none !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo .interactions > * { margin-left: 0 !important; margin-right: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo .space-head-follow { flex: 1 1 120px !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .space-head-follow :is(.follow-btn, .follow-btn-wrapper, .space-follow-btn) { width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo .message-btn { flex: 1 1 90px !important; width: auto !important; }
    html.bpm-active[data-bpm-page="space"] .header-upinfo .more-actions { flex: 0 0 40px !important; }
    html.bpm-active[data-bpm-page="space"] .space-navbar { position: relative !important; top: auto !important; height: auto !important; }
    html.bpm-active[data-bpm-page="space"] .nav-bar__main { height: auto !important; padding: 8px 12px !important; display: flex !important; flex-direction: column !important; gap: 10px !important; align-items: stretch !important; }
    html.bpm-active[data-bpm-page="space"] .nav-bar__main-left { display: flex !important; flex-wrap: wrap !important; min-width: 0 !important; width: 100% !important; margin: 0 !important; gap: 10px !important; }
    html.bpm-active[data-bpm-page="space"] .nav-tab { width: 100% !important; min-width: 0 !important; overflow-x: auto !important; overscroll-behavior-x: contain; }
    html.bpm-active[data-bpm-page="space"] .nav-tab__item { flex: 0 0 auto !important; height: 44px !important; margin-left: 12px !important; white-space: nowrap !important; }
    html.bpm-active[data-bpm-page="space"] .nav-tab__item:first-child { margin-left: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .nav-bar-search { width: 100% !important; margin: 0 !important; --search-width: 100%; }
    html.bpm-active[data-bpm-page="space"] .nav-bar-search .nav-search-input { width: 100% !important; height: 40px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="space"] .nav-statistics { display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; width: 100% !important; gap: 4px !important; }
    html.bpm-active[data-bpm-page="space"] .nav-statistics__item { min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .space-main { padding: 0 12px !important; }
    html.bpm-active[data-bpm-page="space"] :is(.space-home, .space-upload, .space-favlist,
      .space-dynamic, .space-follow, .space-fans, .space-dynamic-inner) { display: flex !important; flex-direction: column !important; gap: 16px !important; margin-top: 16px !important; }
    html.bpm-active[data-bpm-page="space"] :is(.space-home > .content, .space-home > .aside,
      .upload-content, .upload-sidenav, .favlist-main, .favlist-aside, .follow-main, .fans-main,
      .relation-aside, .space-dynamic__left, .space-dynamic__content, .space-dynamic__right,
      .space-dynamic-inner > .content, .home-section) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      margin: 0 !important; padding-left: 0 !important; padding-right: 0 !important;
      position: static !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="space"] :is(.upload-sidenav, .space-dynamic__left) { height: auto !important; }
    html.bpm-active[data-bpm-page="space"] :is(.favlist-aside, .relation-aside) { max-height: 240px !important; overflow-y: auto !important; }
    html.bpm-active[data-bpm-page="space"] .side-nav { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .side-nav__item { min-width: 0 !important; margin: 0 !important; flex: 0 1 auto !important; }
    html.bpm-active[data-bpm-page="space"] :is(.section-wrap__header, .video-header__top, .video-header__bottom,
      .video-list__header, .lists-header, .fav-list-header-filter, .relation-content-header,
      .favlist-info-detail__actions, .follow-main-title, .fans-main-title) { display: flex !important; flex-wrap: wrap !important; height: auto !important; gap: 8px !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .section-wrap__header .btns { margin-left: 0 !important; display: flex !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="space"] .top-video { flex-direction: column !important; }
    html.bpm-active[data-bpm-page="space"] .top-video__cover { width: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .top-video__info { min-width: 0 !important; padding: 10px 0 0 !important; }
    html.bpm-active[data-bpm-page="space"] .top-video__title { --top-video-card-title-lines: 2; font-size: 16px !important; }
    html.bpm-active[data-bpm-page="space"] :is(.video-section .items, .fav-section__content .items,
      .coin-section__content .items, .like-section__content .items, .lists-section .video-list__content,
      .video-body .video-list.grid-mode, .video-grid, .space-lists .video-list__content,
      .fav-list-main > .items, .masterpiece-block) {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important;
      gap: 20px 12px !important; min-width: 0 !important; width: 100% !important;
    }
    html.bpm-active[data-bpm-page="space"] :is(.video-body .video-list.list-mode, .relation-content .items) { grid-template-columns: minmax(0, 1fr) !important; }
    html.bpm-active[data-bpm-page="space"] :is(.masterpiece-block__item, .masterpiece-block__add,
      .bili-video-card, .upload-video-card.grid-mode, .folder-cover-card, .video-list__item) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .upload-video-card.grid-mode :is(.upload-video-card__left, .upload-video-card__main) { width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .upload-video-card.list-mode .upload-video-card__main { width: 120px !important; }
    html.bpm-active[data-bpm-page="space"] .upload-video-card__right { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="space"] :is(.bili-video-card__title, .upload-video-card__right .title) { font-size: 14px !important; line-height: 21px !important; -webkit-line-clamp: 2 !important; }
    html.bpm-active[data-bpm-page="space"] .bangumi-section .items { display: flex !important; flex-direction: column !important; gap: 16px !important; }
    html.bpm-active[data-bpm-page="space"] .bili-bangumi-card { min-width: 0 !important; width: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .bili-bangumi-card__cover { width: 90px !important; flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .bili-bangumi-card__details { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="space"] .favlist-info { display: flex !important; flex-direction: column !important; gap: 12px !important; padding-bottom: 16px !important; }
    html.bpm-active[data-bpm-page="space"] .favlist-info-file-card { width: 150px !important; }
    html.bpm-active[data-bpm-page="space"] .favlist-info-detail { width: 100% !important; min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="space"] .favlist-info-detail__title-row { flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="space"] .favlist-info-detail__title { white-space: normal !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="space"] :is(.fav-list-header-filter__left, .fav-list-header-filter__right, .relation-content-header__left, .relation-content-header__right) { min-width: 0 !important; width: 100% !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="space"] :is(.vui_input.fav-list-header-filter__search, .fav-list-header-filter__right .vui_input) { width: 100% !important; max-width: 100% !important; }
    html.bpm-active[data-bpm-page="space"] .relation-card { flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="space"] .relation-card-info { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="space"] .relation-card-info-option { margin-left: auto !important; }
    html.bpm-active[data-bpm-page="space"] :is(.vui_pagenation, .vui_pagenation--btns, .vui_pagenation-go) { flex-wrap: wrap !important; max-width: 100% !important; gap: 6px !important; }
    html.bpm-active[data-bpm-page="space"] .vui_pagenation { display: flex !important; }
    html.bpm-active[data-bpm-page="space"] :is(.space-float, .bili-footer) { display: none !important; }

    /* 番剧播放：用 display:contents 排序原节点，保留虚拟选集的高度和点击事件。 */
    html.bpm-active[data-bpm-page="pgc"] :is(.home-container, .main-container, .plp-layout) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      padding: 0 !important; margin: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="pgc"] .plp-layout { display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="pgc"] :is(.plp-left-wrap, .plp-l, .player-left-components, .plp-r-wrap, .plp-r) {
      display: contents !important; position: static !important; transform: none !important;
    }
    html.bpm-active[data-bpm-page="pgc"] .plp-player { order: 0; width: 100% !important; min-width: 0 !important; height: auto !important; }
    html.bpm-active[data-bpm-page="pgc"] :is([class*="video_playerNormal__"], [class*="video_playerInner__"], .big-nano-player) {
      width: 100% !important; min-width: 0 !important; height: auto !important; padding: 0 !important; margin: 0 !important;
    }
    html.bpm-active[data-bpm-page="pgc"] [class*="video_playerInner__"] { position: relative !important; inset: auto !important; }
    html.bpm-active[data-bpm-page="pgc"] .toolbar { order: 1; padding: 12px !important; flex-wrap: wrap !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="pgc"] :is(.toolbar-left, .toolbar-right) { flex-wrap: wrap !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="mediainfo_mediaInfoWrap__"] { order: 2; min-width: 0 !important; padding: 12px !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="mediainfo_mediaRight__"] { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="mediainfo_mediaTitle__"] { padding-right: 0 !important; height: auto !important; -webkit-line-clamp: unset !important; overflow-wrap: anywhere !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="mediainfo_mediaToolbar__"] { position: static !important; width: 100% !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="mediainfo_bottomBar__"] { flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="mediainfo_mediaCover__"] { flex: 0 0 80px !important; width: 80px !important; height: auto !important; aspect-ratio: 3 / 4; align-self: flex-start !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="PaginatedEpList_root__"] { order: 3; width: 100% !important; min-width: 0 !important; padding: 0 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="EpisodeVirtualList_copy__"] { min-width: 0 !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="DanmukuBox_wrap__"] { order: 4; padding: 0 12px !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="comment_comment_wrapper__"] { order: 5; padding: 12px !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="recommend_wrap__"] { order: 6; padding: 12px !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="pgc"] :is([class*="RecommendItem_right_wrap__"], [class*="SectionHeader_titleWrap__"]) { min-width: 0 !important; }
    html.bpm-active[data-bpm-page="pgc"] [class*="navTools_floatNav"] { display: none !important; }

    /* 视频：两栏改为上下布局；推荐和选集仍可使用。 */
    html.bpm-active[data-bpm-page="video"] :is(#mirror-vdcon, .video-container-v1, .video-container-v2, .playlist-container) {
      width: 100% !important; min-width: 0 !important; max-width: none !important;
      margin: 0 !important; padding: 0 !important; display: flex !important; flex-direction: column !important;
      box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.left-container, .right-container, .right-container-inner,
      .playlist-container--left, .playlist-container--right) {
      width: 100% !important; min-width: 0 !important; max-width: none !important;
      margin: 0 !important; padding: 0 !important; flex: none !important;
      position: static !important; transform: none !important;
      box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(#viewbox_report, .video-info-container, #arc_toolbar_report,
      #playlistToolbar, #v_desc, .video-desc-container, .video-tag-container, #commentapp,
      .right-container-inner, .playlist-container--right) {
      padding: 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.video-title, #viewbox_report h1) {
      width: 100% !important; height: auto !important; white-space: normal !important;
      font-size: 18px !important; line-height: 1.5 !important; overflow-wrap: anywhere;
    }
    html.bpm-active[data-bpm-page="video"] :is(.video-info-container, .video-info-title, .video-info-title-inner,
      .video-title, .video-title-href) {
      min-width: 0 !important; max-width: 100% !important; height: auto !important; max-height: none !important;
      white-space: normal !important; overflow: visible !important; text-overflow: clip !important;
      overflow-wrap: anywhere !important; -webkit-line-clamp: unset !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.video-info-title-inner, .video-title-href) { display: block !important; }
    html.bpm-active[data-bpm-page="video"] .video-title { margin: 0 !important; }
    html.bpm-active[data-bpm-page="video"] .video-title-href { font-size: inherit !important; line-height: inherit !important; }
    html.bpm-active[data-bpm-page="video"] .video-info-title .overflow-panel { display: none !important; }
    html.bpm-active[data-bpm-page="video"] :is(.video-info-detail, .video-info-meta) {
      display: flex !important; flex-wrap: wrap !important; height: auto !important; gap: 6px !important;
    }
    html.bpm-active[data-bpm-page="video"] #playerWrap {
      width: 100% !important; height: auto !important; min-width: 0 !important;
      margin: 0 !important; position: relative !important; inset: auto !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) :is(#bilibili-player, .bpx-docker) {
      width: 100% !important; height: auto !important; min-width: 0 !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] {
      width: 100% !important; height: auto !important; min-width: 0 !important;
    }
    /* mini 仍是主播放器：取消它的固定定位，让视频留在原来的文档位置，继续播放。 */
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="mini"] {
      position: relative !important; inset: auto !important; transform: none !important;
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      height: auto !important; z-index: auto !important; margin: 0 !important;
      box-shadow: none !important; border-radius: 0 !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="mini"] .bpx-player-primary-area {
      width: 100% !important; height: auto !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="mini"] .bpx-player-video-area {
      width: 100% !important; height: auto !important; aspect-ratio: var(--bpm-video-ratio);
      max-height: 72vh; max-height: 72svh;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-video-area {
      width: 100% !important; height: auto !important; aspect-ratio: var(--bpm-video-ratio);
      max-height: 72vh; max-height: 72svh;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-primary-area {
      width: 100% !important; height: auto !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-video-wrap video {
      object-fit: contain !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-control-bottom-right {
      gap: 2px !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] :is(.bpx-player-ctrl-wide,
      .bpx-player-ctrl-web, .bpx-player-ctrl-pip, .bpx-player-ctrl-playbackrate, .bpx-player-ctrl-volume) { display: none !important; }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-ctrl-btn {
      min-width: 32px !important; margin: 0 !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-sending-area {
      min-width: 0 !important; width: 100% !important; height: auto !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-sending-bar {
      min-width: 0 !important; padding: 4px 8px !important; gap: 6px !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-video-info { display: none !important; }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] .bpx-player-dm-root {
      flex: 1 !important; min-width: 0 !important; width: 100% !important;
    }
    html.bpm-active:is([data-bpm-page="video"], [data-bpm-page="pgc"]) .bpx-player-container[data-screen="normal"] :is(.bpx-player-video-inputbar, .bpx-player-video-inputbar-wrap) {
      flex: 1 !important; min-width: 0 !important; width: auto !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.video-toolbar-left, .video-toolbar-right) { flex-wrap: wrap !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="video"] .video-toolbar-left {
      min-width: 0 !important; width: 100% !important; flex: 1 1 100% !important;
    }
    html.bpm-active[data-bpm-page="video"] .video-toolbar-left-main {
      width: 100% !important; min-width: 0 !important; display: grid !important;
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 4px !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.toolbar-left-item-wrap, .video-toolbar-left-item) {
      min-width: 0 !important; margin: 0 !important; gap: 4px !important; font-size: 12px !important;
    }
    html.bpm-active[data-bpm-page="video"] .video-toolbar-left-item { min-height: 44px !important; }
    html.bpm-active[data-bpm-page="video"] .video-toolbar-item-icon {
      width: 24px !important; height: 24px !important; flex-shrink: 0 !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.video-toolbar-container, .video-tag-container) { height: auto !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="video"] .video-page-card-small .pic-box { flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="video"] .video-page-card-small .info { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="video"] :is(.video-pod, .video-episode-card, .base-video-sections) { max-width: 100% !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="video"] .bpm-before-comments {
      width: 100% !important; min-width: 0 !important; padding: 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="video"] .bpm-before-comments > * {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
      box-sizing: border-box !important; margin: 0 0 12px !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.reply-info, .sub-reply-info) {
      display: flex !important; flex-wrap: wrap !important; gap: 4px 10px !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.reply-time, .sub-reply-time, .reply-btn, .reply-info > *, .sub-reply-info > *) {
      white-space: nowrap !important; flex-shrink: 0 !important;
    }
    html.bpm-active[data-bpm-page="video"] .action-list-container { --side-padding: 12px; }
    html.bpm-active[data-bpm-page="video"] .action-list-container .action-list {
      max-height: 50vh !important; max-height: 50svh !important; overflow-y: auto !important;
    }
    html.bpm-active[data-bpm-page="video"] :is(.fixed-sidenav-storage, .fixed-sidenav) { display: none !important; }
    /* v1.6：热门、分区、阅读与独立站点。所有规则随适配开关一起撤销。 */
    html.bpm-active[data-bpm-page="popular"] :is(.popular-container, .popular-video-container, .rank-list-wrap) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; padding: 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="popular"] :is(.popular-header, .popular-tabs, .rank-tab, .rank-tabs, .rank-type, .weekly-header, .popular-tips) {
      height: auto !important; display: flex !important; flex-wrap: wrap !important; gap: 12px !important; min-width: 0 !important;
    }
    html.bpm-active[data-bpm-page="popular"] :is(.popular-header .nav-tabs, .rank-tab ul, .rank-tabs ul, .rank-type ul) {
      display: flex !important; flex-wrap: wrap !important; width: 100% !important; height: auto !important; gap: 10px !important;
    }
    html.bpm-active[data-bpm-page="popular"] :is(.video-list, .card-list, .rank-list) {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 16px 12px !important; margin-top: 16px !important;
    }
    html.bpm-active[data-bpm-page="popular"] :is(.video-card, .rank-item) { width: 100% !important; min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="popular"] :is(.video-card__content, .rank-item .content) { display: flex !important; flex-direction: column !important; padding: 0 !important; }
    html.bpm-active[data-bpm-page="popular"] :is(.video-card__content .video-card__cover, .video-card .video-card__content > a, .rank-item .content .img) {
      width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; flex: none !important; margin: 0 !important;
    }
    html.bpm-active[data-bpm-page="popular"] :is(.video-card__info, .rank-item .content .info) { min-width: 0 !important; width: 100% !important; margin: 8px 0 0 !important; padding: 0 !important; }
    html.bpm-active[data-bpm-page="popular"] :is(.video-card__info .video-name, .video-card__info .title, .rank-item .title) { white-space: normal !important; height: auto !important; line-height: 1.5 !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="popular"] :is(.popular-header, .popular-video-container .date-info) { position: relative !important; inset: auto !important; }
    html.bpm-active[data-bpm-page="popular"] :is(.date-select, .weekly-header .select-list) { max-width: calc(100vw - 48px) !important; max-height: 50dvh !important; overflow: auto !important; }
    html.bpm-active[data-bpm-page="popular"] :is(.to-top, .fixed-side-menu) { display: none !important; }

    html.bpm-active[data-bpm-page="partition"] :is(.feedchannel, .feedchannel-main, .channel-page, .channel-page__body) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; padding: 12px !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="partition"] :is(.head-cards, .feed-cards, .loading-cards) {
      display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 20px 12px !important; padding-bottom: 20px !important;
    }
    html.bpm-active[data-bpm-page="partition"] :is(.feed-card, .bili-video-card, .bili-skeleton-card) { width: 100% !important; min-width: 0 !important; grid-column: auto !important; grid-row: auto !important; }
    html.bpm-active[data-bpm-page="partition"] .channel-carousel { grid-column: 1 / -1 !important; grid-row: auto !important; width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; }
    html.bpm-active[data-bpm-page="partition"] .bili-video-card__title { font-size: 14px !important; line-height: 1.5 !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="partition"] .channel-page__head { height: auto !important; margin: 0 0 16px !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="partition"] .bili-header__channel { display: none !important; }
    html.bpm-active[data-bpm-page="partition"] :is(.fixed-side-menu, #biliMainFooter) { display: none !important; }

    /* 图文和旧版专栏：只约束正文媒体，不放大行内表情。 */
    html.bpm-active[data-bpm-page="reader"] :is(.opus-detail, .opus-detail-content, .opus-module-content, .article-container, .article-holder, .article-content, .article-list, .article-list-holder, .article-list-wrp, .read-container) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-detail, .article-container, .read-container) { padding: 16px 12px !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-content, .article-holder) { font-size: 17px !important; line-height: 1.85 !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-title, .article-title, .title-container h1) { white-space: normal !important; font-size: 23px !important; line-height: 1.5 !important; height: auto !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-content, .article-holder) :is(img, video, figure, .b-img, .b-img__inner) { max-width: 100% !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-content, .article-holder) :is(figure, video, img:not(.emoji):not(.bili-emoji):not([class*="emoji"])) { height: auto !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-content, .article-holder) :is(pre, table) { display: block; max-width: 100%; overflow-x: auto; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-detail-sidebar, .right-side, .article-right, .right-side-bar, .side-toolbar) { display: none !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-author, .article-up-info, .article-info) { flex-wrap: wrap !important; gap: 8px !important; height: auto !important; }
    html.bpm-active[data-bpm-page="reader"] .opus-module-bottom { position: relative !important; inset: auto !important; width: 100% !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.article-item, .article-card) { width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; }

    html.bpm-active[data-bpm-page="media"] :is(.media-info-content, .media-info-inner, .media-tab-nav ul, .media-tab-detail-wrp, .media-tab-detail-l-wrp, .media-tab-detail-r-wrp, .media-fold-wrp, .media-tab-module-wrp, .media-tab-module-content) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; float: none !important; margin: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="media"] .media-info-inner { padding: 16px 12px !important; }
    html.bpm-active[data-bpm-page="media"] .media-preview { float: none !important; position: relative !important; width: 100px !important; height: 134px !important; margin-bottom: 12px !important; }
    html.bpm-active[data-bpm-page="media"] .media-info-r { margin: 0 !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="media"] :is(.media-info-title, .media-info-title-t, .media-info-intro, .media-info-intro-text) { white-space: normal !important; max-height: none !important; height: auto !important; overflow: visible !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="media"] :is(.media-info-datas, .media-info-time, .media-info-state, .media-info-btns) { height: auto !important; display: flex !important; flex-wrap: wrap !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="media"] .media-info-score-wrp { float: none !important; padding-top: 12px !important; }
    html.bpm-active[data-bpm-page="media"] .media-tab-nav ul { display: flex !important; overflow-x: auto !important; white-space: nowrap; }
    html.bpm-active[data-bpm-page="media"] .media-tab-nav li { flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="media"] .media-tab-detail-wrp { padding: 12px !important; }
    html.bpm-active[data-bpm-page="media"] :is(.sl-ep-list, .v1-bangumi-list-view) { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="media"] :is(.sl-ep-list > *, .v1-bangumi-list-view > *) { min-width: 0 !important; width: 100% !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="media"] .nav-tools { display: none !important; }
    html.bpm-active[data-bpm-page="media"] :is(.short-review-content, .report-dialog-content) { width: calc(100vw - 24px) !important; max-height: 80dvh !important; height: auto !important; overflow-y: auto !important; margin: 0 !important; transform: translate(-50%, -50%) !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="media"] :is(.review-body-wrap, .review-body-wrap textarea) { width: 100% !important; box-sizing: border-box !important; }

    html.bpm-active[data-bpm-page="course"] :is(.edu-play-main-container, .edu-play-left, .edu-play-right) { width: 100% !important; max-width: 100% !important; min-width: 0 !important; margin: 0 !important; padding: 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="course"] .edu-play-main-container { flex-direction: column !important; padding: 0 !important; }
    html.bpm-active:not([data-bpm-fullscreen])[data-bpm-page="course"] :is(.player-box, #bilibili-player) { width: 100% !important; height: auto !important; aspect-ratio: var(--bpm-video-ratio); }
    html.bpm-active[data-bpm-page="course"] .archive-title-box-txt { white-space: normal !important; height: auto !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="course"] :is(.archive-tool-box, .archive-play-info-box, .publisher-pic-card) { height: auto !important; flex-wrap: wrap !important; gap: 10px !important; }
    html.bpm-active[data-bpm-page="course"] :is(.main-pay.fixed, .tab-choose-fixed) { position: relative !important; inset: auto !important; }
    html.bpm-active[data-bpm-page="course"] :is(.main-pay-wrapper, .main-pay, .season-catalogue-card) { width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="course"] .fixed-guide { display: none !important; }
    html.bpm-active[data-bpm-page="course"] :is(.pay-popup, .archive-tool-share-pannel-wrp, .error-page p) { max-width: 100% !important; width: 100% !important; box-sizing: border-box !important; }

    /* 直播保留原播放器、礼物和登录提示；上下排列，不更改付费行为。 */
    html.bpm-active[data-bpm-page="live"] :is(.live-app, .live-main, .app-content, .main-container, .area-detail-ctnr, .title-text, .grid-focus-highlight-area, .area-banner-ctnr, .flip-view, .player-area-ctnr, .room-container, .room-content, .aside-area, .live-room-app) {
      width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; box-sizing: border-box !important;
    }
    html.bpm-active[data-bpm-page="live"] :is(.player-area-ctnr, .room-content, .grid-focus-highlight-area) { display: flex !important; flex-direction: column !important; }
    html.bpm-active:not([data-bpm-fullscreen])[data-bpm-page="live"] :is(.player-ctnr, .player-section, #live-player, .live-player-mounter) { width: 100% !important; min-width: 0 !important; height: auto !important; aspect-ratio: 16 / 9; }
    html.bpm-active[data-bpm-page="live"] :is(.player-aside, .aside-area) { position: relative !important; inset: auto !important; width: 100% !important; height: 380px !important; }
    html.bpm-active[data-bpm-page="live"] :is(.live-room-app .room-info-ctnr, .room-info-ctnr .upper-row, .room-info-ctnr .lower-row) { height: auto !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="live"] :is(.room-list, .list-container, .room-list-wrapper) { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 12px !important; padding: 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="live"] :is(.room-list > *, .list-container > *, .room-list-wrapper > *) { width: 100% !important; min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="live"] :is(.link-navbar, .area-nav, .sec-areas) { max-width: 100% !important; overflow-x: auto !important; }
    html.bpm-active[data-bpm-page="live"] :is(.ad-aside, .side-bar-popup, .small-banner-ctnr) { display: none !important; }

    /* 消息：分类横排；会话列表在聊天上方，两个区域分别可滚动。 */
    html.bpm-active[data-bpm-page="message"] :is(#message-pc-app, .message-layout, .message-aside, .message-main, .message-content, .message-content__wrapper) { min-width: 0 !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="message"] .message-layout { height: auto !important; min-height: calc(100dvh - 200px); flex-direction: column !important; }
    html.bpm-active[data-bpm-page="message"] .message-sidebar { display: flex !important; flex-wrap: wrap !important; padding: 12px !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="message"] :is(.message-sidebar__title, .message-sidebar__div) { display: none !important; }
    html.bpm-active[data-bpm-page="message"] .message-sidebar__item { height: auto !important; min-height: 40px; margin: 0 !important; padding: 8px !important; }
    html.bpm-active[data-bpm-page="message"] :is(.message-content, .message-content__wrapper, .message-header) { padding: 12px !important; height: auto !important; }
    html.bpm-active[data-bpm-page="message"] .im-container { display: flex !important; flex-direction: column !important; height: auto !important; min-width: 0 !important; }
    html.bpm-active[data-bpm-page="message"] [class*="_ChatList_"] { width: 100% !important; flex: none !important; max-height: 220px !important; overflow-y: auto !important; }
    html.bpm-active[data-bpm-page="message"] [class*="_ChatWindow_"] { width: 100% !important; min-width: 0 !important; flex: none !important; height: 65dvh !important; min-height: 360px; }
    html.bpm-active[data-bpm-page="message"] :is(.interaction-item, .interaction-item__content, .message-text-nodes) { min-width: 0 !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="message"] .interaction-item__left { width: 36px !important; flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="message"] .interaction-item__metadata { flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="message"] .message-header__actions { flex-wrap: wrap !important; }

    /* 空间子页及非视频搜索结果。 */
    html.bpm-active[data-bpm-page="space"] :is(.setting, .setting-container, .setting-content, .article-list, .audio-list, .bangumi-list, .bangumi-content, .bangumi-wrapper) { min-width: 0 !important; width: 100% !important; max-width: 100% !important; margin-left: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="space"] :is(.bangumi-list, .audio-list) { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="space"] :is(.bangumi-item, .audio-item, .article-item) { width: 100% !important; min-width: 0 !important; margin: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="space"] :is(.setting-item, .setting-row, .form-item) { display: flex !important; flex-wrap: wrap !important; height: auto !important; gap: 8px !important; }
    html.bpm-active[data-bpm-page="search"] :is(.user-list, .live-user-list, .article-list, .photo-list) { width: 100% !important; min-width: 0 !important; padding: 0 !important; }
    html.bpm-active[data-bpm-page="search"] :is(.user-item, .live-user-item, .article-item) { width: 100% !important; min-width: 0 !important; height: auto !important; margin: 0 !important; padding: 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="search"] :is(.user-item .info-wrap, .article-item .text-area) { min-width: 0 !important; width: auto !important; overflow-wrap: anywhere; }

    /* 账号/创作/购票等独立站点的基础布局，不触发任何提交。 */
    html.bpm-active[data-bpm-page="account"] :is(.security_content, .security-right, .security-left) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="account"] .security_content { flex-direction: column !important; margin: 12px 0 !important; }
    html.bpm-active[data-bpm-page="account"] :is(.security-left ul, .security-list) { display: flex !important; flex-wrap: wrap !important; padding: 8px !important; }
    html.bpm-active[data-bpm-page="account"] :is(.security-right, .user-setting-warp, .user-setting-wrap) { padding: 12px !important; }
    html.bpm-active[data-bpm-page="account"] :is(.el-form-item__content, .form-item-content) { margin-left: 0 !important; max-width: 100% !important; }
    html.bpm-active[data-bpm-page="account"] :is(.el-form-item, .setting-item) { height: auto !important; display: flex !important; flex-wrap: wrap !important; }
    html.bpm-active[data-bpm-page="creator"] :is(#app, .cc-body, .cc-content, .cc-main, .bcc-layout, .bcc-layout__main, .bcc-layout__content) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin-left: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="creator"] :is(.cc-body, .bcc-layout) { flex-direction: column !important; }
    html.bpm-active[data-bpm-page="creator"] :is(.cc-nav, .cc-sidenav, .bcc-layout__sider) { position: relative !important; inset: auto !important; width: 100% !important; max-height: 200px !important; overflow: auto !important; }
    html.bpm-active[data-bpm-page="creator"] :is(.cc-content, .cc-main, .bcc-layout__content) { padding: 12px !important; }
    html.bpm-active[data-bpm-page="shop"] :is(.ticket-system-container, .project-list-wrapper, .project-list, .selector-wrapper .wrapper, .nav-header-wrapper .nav-header) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="shop"] .project-list { padding: 12px !important; }
    html.bpm-active[data-bpm-page="shop"] .project-list-item { width: 100% !important; height: auto !important; min-width: 0 !important; float: none !important; margin: 16px 0 !important; }
    html.bpm-active[data-bpm-page="shop"] :is(.project-list-item .project-info, .project-list-item .project-info-name) { width: auto !important; min-width: 0 !important; white-space: normal !important; overflow-wrap: anywhere; }
    html.bpm-active[data-bpm-page="shop"] :is(.selector-wrapper .wrapper, .nav-header) { height: auto !important; flex-wrap: wrap !important; gap: 8px !important; padding: 12px !important; }
    html.bpm-active[data-bpm-page="shop"] :is(.toolbar-wrapper, .code-container, .footer) { display: none !important; }
    html.bpm-active[data-bpm-page="manga"] :is(main, .app-layout, .main-content, .manga-container, .manga-detail, .manga-list, .index-banner) { min-width: 0 !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="manga"] [class~="w-[1160px]"], html.bpm-active[data-bpm-page="manga"] [class~="w-[1200px]"] { width: 100% !important; min-width: 0 !important; padding: 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="manga"] .index-banner .banner-item { width: 100% !important; height: auto !important; aspect-ratio: 931 / 398; }
    html.bpm-active[data-bpm-page="manga"] :is(.manga-reader img, .comic-reader img) { max-width: 100% !important; height: auto !important; }
    html.bpm-active[data-bpm-page="charity"] :is(.page-width, .main-container, .project-list) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; padding: 12px !important; box-sizing: border-box !important; }
    /* 专题使用各自画布，保留内部结构，仅允许在受限容器中横向浏览。 */
    html.bpm-active[data-bpm-page="event"] :is(#app, #app > div, .international-home) { min-width: 0 !important; max-width: 100% !important; overflow-x: auto !important; }
    html.bpm-active[data-bpm-page="popular"] .video-card { display: flex !important; flex-direction: column !important; height: auto !important; }
    html.bpm-active[data-bpm-page="popular"] .video-card__content { width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; margin: 0 !important; }
    html.bpm-active[data-bpm-page="popular"] .video-card__content .cover-picture { height: 100% !important; aspect-ratio: auto !important; }
    html.bpm-active[data-bpm-page="popular"] .nav-tabs { height: auto !important; display: flex !important; flex-wrap: wrap !important; gap: 12px !important; padding: 12px 0 !important; }
    html.bpm-active[data-bpm-page="popular"] .nav-tabs__item { height: 44px !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="popular"] .no-more { grid-column: 1 / -1; }
    html.bpm-active:is([data-bpm-page="reader"], [data-bpm-page="media"], [data-bpm-page="course"]) :is(.reply-info, .sub-reply-info) { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; }
    html.bpm-active:is([data-bpm-page="reader"], [data-bpm-page="media"], [data-bpm-page="course"]) :is(.reply-time, .reply-btn, .sub-reply-time) { white-space: nowrap !important; flex-shrink: 0 !important; }

    html.bpm-active[data-bpm-page="message"] [class*="_IM_"] { flex-direction: column !important; height: auto !important; }
    html.bpm-active[data-bpm-page="message"] :is([class*="_Sidebar_"], [class*="_Main_"]) { width: 100% !important; min-width: 0 !important; height: auto !important; }
    html.bpm-active[data-bpm-page="message"] [class*="_Sidebar_"] { max-height: 280px !important; overflow-y: auto !important; }
    html.bpm-active[data-bpm-page="message"] .interaction-item__right { width: calc(100% - 48px) !important; padding-right: 0 !important; }
    html.bpm-active[data-bpm-page="message"] .interaction-item__panel { width: 100% !important; margin-left: 0 !important; }
    html.bpm-active[data-bpm-page="live"] .room-ctnr { display: grid !important; grid-template-columns: repeat(var(--bpm-columns), minmax(0, 1fr)) !important; gap: 16px 12px !important; padding: 12px !important; }
    html.bpm-active[data-bpm-page="live"] .room-card-wrapper { width: 100% !important; min-width: 0 !important; margin: 0 !important; }
    html.bpm-active[data-bpm-page="live"] .focus-content-ctnr { max-width: 100% !important; overflow-x: auto !important; }
    html.bpm-active[data-bpm-page="manga"] :is([class~="min-w-[1300px]"], [class~="min-w-[1160px]"], [class~="min-w-[1000px]"]) { min-width: 0 !important; max-width: 100% !important; }
    html.bpm-active[data-bpm-page="manga"] [class~="min-w-[1300px]"] > div { overflow-x: auto !important; }
    html.bpm-active[data-bpm-page="manga"] :is([class~="min-w-[1160px]"].flex, [class~="max-w-[1200px]"].flex) { overflow-x: auto !important; justify-content: flex-start !important; gap: 12px !important; }
    html.bpm-active[data-bpm-page="manga"] .content-container { overflow-x: auto !important; }

    html.bpm-active[data-bpm-page="partition"] :is(.channel-page, .channel-page__body) { padding: 0 !important; }
    html.bpm-active[data-bpm-page="live"] .player-aside { margin: 0 !important; padding: 12px !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.opus-module-content, .article-holder) figure { margin: 16px 0 !important; }
    html.bpm-active[data-bpm-page="manga"] .index-banner { height: auto !important; }
    html.bpm-active[data-bpm-page="manga"] .index-banner :is(.swiper-container-wrapper, .banner-swiper) { height: auto !important; }
    html.bpm-active[data-bpm-page="manga"] .index-banner .swiper-wrapper { display: flex !important; transform: none !important; overflow-x: auto !important; scroll-snap-type: x mandatory; }
    html.bpm-active[data-bpm-page="manga"] .index-banner .banner-item { flex: 0 0 100% !important; opacity: 1 !important; scroll-snap-align: start; }
    html.bpm-active[data-bpm-page="manga"] .index-banner .banner-img { position: relative !important; display: flex !important; height: 100% !important; overflow-x: auto !important; }
    html.bpm-active[data-bpm-page="manga"] .index-banner :is(.big-card, .second-banner, .fourth-banner) { flex-shrink: 0 !important; }
    html.bpm-active[data-bpm-page="manga"] .index-banner :is(.control-button, .mask, .swiper-pagination) { display: none !important; }
    html.bpm-active[data-bpm-page="manga"] .content-container { min-height: 0 !important; padding: 12px !important; }
    html.bpm-active[data-bpm-page="manga"] .content-container > :is(h3, p, div:not(.absolute)) { width: 100% !important; margin-left: 0 !important; white-space: normal !important; height: auto !important; }
    html.bpm-active[data-bpm-page="manga"] .content-container > a[class~="w-[562px]"] { position: relative !important; inset: auto !important; width: 100% !important; height: auto !important; aspect-ratio: 16 / 9; margin: 12px 0 !important; }
    html.bpm-active[data-bpm-page="manga"] .content-container > a[class~="w-[562px]"] img { width: 100% !important; height: 100% !important; }

    html.bpm-active[data-bpm-page="reader"] :is(.page-home, .page-home .main, .page-home .main .content, .page-ranking .content, .page-ranking .banner-content, .page-ranking .list-item) { width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; }
    html.bpm-active[data-bpm-page="reader"] .page-home .main { padding: 12px !important; display: block !important; }
    html.bpm-active[data-bpm-page="reader"] .page-home .side { display: none !important; }
    html.bpm-active[data-bpm-page="reader"] :is(.article-item__left, .article-item__details) { min-width: 0 !important; flex: 1 !important; }
    html.bpm-active[data-bpm-page="reader"] .article-item__right { width: 100px !important; flex: 0 0 100px !important; margin-left: 12px !important; }
    html.bpm-active[data-bpm-page="reader"] .article-item__title { font-size: 16px !important; white-space: normal !important; line-height: 1.5 !important; }
    html.bpm-active[data-bpm-page="reader"] .article-item__meta { flex-wrap: wrap !important; gap: 6px !important; }

    html.bpm-active[data-bpm-fullscreen] #${HOST_ID} { display: none !important; }
    @media (prefers-reduced-motion: reduce) {
      html.bpm-active { scroll-behavior: auto !important; }
    }
  `;
  const style = document.createElement('style');
  style.id = 'bpm-page-style';
  style.textContent = css;
  root.append(style);

  function persist() {
    try { GM_setValue(KEY, { ...settings }); } catch { showToast('设置未能保存，本页仍可使用'); }
  }

  function isLandscape() {
    // 手机优先读取物理方向，避免竖屏弹出键盘后误判；桌面窄窗口按视口方向。
    const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
    if (touch) {
      if (screen.orientation?.type) return screen.orientation.type.startsWith('landscape');
      if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
    }
    return window.innerWidth >= 480 && matchMedia('(orientation: landscape)').matches;
  }

  function wantsMobile() {
    if (isLandscape()) return false;
    if (settings.mode !== 'auto') return settings.mode === 'on';
    // “桌面版网站”的初始布局视口可能为 980px，另用触屏与实际屏幕检测。
    const phone = (navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches)
      && Math.min(screen.width, screen.height) <= 600;
    return phone || window.innerWidth <= 900;
  }

  function pageType() {
    const sites = { 'live.bilibili.com': 'live', 'message.bilibili.com': 'message',
      'account.bilibili.com': 'account', 'member.bilibili.com': 'creator', 'show.bilibili.com': 'shop',
      'manga.bilibili.com': 'manga', 'love.bilibili.com': 'charity' };
    if (sites[location.hostname]) return sites[location.hostname];
    if (/^\/v\/popular(?:\/|$)/i.test(location.pathname)) return 'popular';
    if (/^\/(?:c|v)\/[\w-]+(?:\/|$)/i.test(location.pathname)) return 'partition';
    if (/^\/(?:opus|read)(?:\/|$)/i.test(location.pathname)) return 'reader';
    if (/^\/bangumi\/media\/md\d+/i.test(location.pathname)) return 'media';
    if (/^\/cheese(?:\/|$)/i.test(location.pathname)) return 'course';
    if (/^\/(?:blackboard|festival|activity|match)(?:\/|$)/i.test(location.pathname)) return 'event';
    if (location.hostname === 'search.bilibili.com') return 'search';
    if (location.hostname === 't.bilibili.com') return 'dynamic';
    if (location.hostname === 'space.bilibili.com') return 'space';
    if (/^\/(?:history|account\/history)(?:\/|$)/i.test(location.pathname)) return 'history';
    if (/^\/bangumi\/play\/(?:ep|ss)\d+/i.test(location.pathname)) return 'pgc';
    if (/^\/(?:anime|guochuang|movie|tv|documentary|variety)(?:\/|$)/i.test(location.pathname)
      || /^\/bangumi\/index(?:\/|$)/i.test(location.pathname)) return 'channel';
    if (/^\/video\/(?:BV[\w]+|av\d+)/i.test(location.pathname)
      || /^\/list\/(?:watchlater|ml\d+)(?:\/|$)/i.test(location.pathname)) return 'video';
    if (/^\/watchlater(?:\/|$)/i.test(location.pathname)) return 'watchlater';
    if (/^\/(?:index.html|en\/?)?$/.test(location.pathname)) return 'home';
    if (document.querySelector('.search-layout')) return 'search';
    if (document.querySelector('.watchlater-list')) return 'watchlater';
    if (document.querySelector('.space-main')) return 'space';
    if (document.querySelector('.history-record')) return 'history';
    if (document.querySelector('.bili-dyn-home--member, .bili-dyn-home--visitor, .bili-dyn-detail')) return 'dynamic';
    if (document.querySelector('.plp-layout')) return 'pgc';
    if (document.querySelector('#mirror-vdcon, #playerWrap')) return 'video';
    return 'other';
  }

  function syncCollections() {
    // 移动原节点，保留原站选集事件。用占位标记记录位置，关闭适配后还原。
    for (const [node, marker] of movedCollections) {
      if (!node.isConnected || !marker.isConnected) {
        if (!marker.isConnected && node.parentElement?.classList.contains('bpm-before-comments')) node.remove();
        marker.remove();
        movedCollections.delete(node);
      }
    }
    if (!active || root.dataset.bpmPage !== 'video') {
      for (const [node, marker] of movedCollections) marker.replaceWith(node);
      movedCollections.clear();
      document.querySelectorAll('.bpm-before-comments').forEach(slot => slot.remove());
      return;
    }
    const left = document.querySelector(`#mirror-vdcon .left-container, .video-container-v1 .left-container,
      .video-container-v2 .left-container, .playlist-container .playlist-container--left`);
    let comments = left?.querySelector('#commentapp, #comment, .comment-container');
    if (!left || !comments) return;
    while (comments.parentElement !== left) comments = comments.parentElement;
    let slot = left.querySelector(':scope > .bpm-before-comments');
    const candidates = [...document.querySelectorAll(`:is(.right-container, .playlist-container--right) :is(${COLLECTION_SELECTOR})`)]
      .filter(node => !node.parentElement.closest(COLLECTION_SELECTOR));
    if (!slot && !candidates.length) return;
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'bpm-before-comments';
      left.insertBefore(slot, comments);
    } else if (slot.nextElementSibling !== comments) left.insertBefore(slot, comments);
    for (const node of candidates) {
      if (!movedCollections.has(node)) {
        const marker = document.createComment('bpm-original-collection');
        node.before(marker);
        movedCollections.set(node, marker);
      }
      slot.append(node);
    }
    if (!slot.children.length) slot.remove();
  }

  function syncViewport() {
    if (!document.head) return;
    const metas = [...document.head.querySelectorAll('meta[name="viewport" i]')];
    if (!active) {
      for (const [meta, content] of viewportRecords) {
        if (meta === createdViewport) continue;
        if (content === null) meta.removeAttribute('content');
        else meta.setAttribute('content', content);
      }
      createdViewport?.remove();
      createdViewport = null;
      viewportRecords.clear();
      return;
    }
    if (!metas.length) {
      createdViewport = document.createElement('meta');
      createdViewport.name = 'viewport';
      document.head.append(createdViewport);
      metas.push(createdViewport);
    }
    for (const meta of metas) {
      if (!viewportRecords.has(meta)) viewportRecords.set(meta, meta.getAttribute('content'));
      const content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
    }
  }

  function syncHeader() {
    if (!active) {
      root.style.removeProperty('--bpm-header-bottom');
      root.style.removeProperty('--bpm-search-bottom');
      return;
    }
    const bar = document.querySelector('.bili-header__bar, .mini-header__content');
    const input = document.querySelector('.bili-header .nav-search-input, .bili-header input');
    if (bar) root.style.setProperty('--bpm-header-bottom', `${Math.max(0, bar.getBoundingClientRect().bottom)}px`);
    const search = input?.closest('form') || input;
    if (search) root.style.setProperty('--bpm-search-bottom', `${Math.max(0, search.getBoundingClientRect().bottom)}px`);
  }

  function syncChannels() {
    const enabled = active && root.dataset.bpmPage === 'home';
    for (const link of hiddenChannels) {
      if (!enabled || !link.isConnected) { link.classList.remove('bpm-channel-hidden'); hiddenChannels.delete(link); }
    }
    if (!enabled) return;
    const links = [...document.querySelectorAll('.channel-items__left > a.channel-link')];
    if (!links.length) return;
    channelNames = [...new Set(links.map(link => link.textContent.replace(/\s+/g, '').trim()).filter(Boolean))];
    for (const link of links) {
      const name = link.textContent.replace(/\s+/g, '').trim();
      const hidden = !settings.channels.includes(name);
      link.classList.toggle('bpm-channel-hidden', hidden);
      if (hidden) hiddenChannels.add(link); else hiddenChannels.delete(link);
    }
  }

  function updateChannelEditor() {
    const editor = ui.querySelector('.channel-editor');
    const names = [...new Set([...channelNames, ...settings.channels])];
    // 不重建已经显示的编辑器，避免勾选时丢失键盘焦点。
    if (editor.dataset.names !== JSON.stringify(names)) {
      editor.replaceChildren();
      for (const name of names) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox'; input.name = 'channel'; input.value = name;
        label.append(input, document.createTextNode(name));
        editor.append(label);
      }
      editor.dataset.names = JSON.stringify(names);
    }
    for (const input of editor.querySelectorAll('input')) input.checked = settings.channels.includes(input.value);
    ui.querySelector('[data-channel-summary]').textContent = `首页分类 · 编辑（已选 ${settings.channels.length} 项）`;
  }

  // 新版评论使用开放的 Shadow DOM；样式跟随异步加载，并在关闭适配时清理。
  const commentCSS = {
    'bili-comment-renderer': `#body { padding-left: 44px !important; }
      #user-avatar { left: 0 !important; width: 36px !important; height: 36px !important; transform: none !important; }
      #user-avatar bili-avatar { --avatar-width: 36px !important; --avatar-height: 36px !important; }
      #main { min-width: 0 !important; }`,
    'bili-comment-thread-renderer': '#div { margin-left: 44px !important; }',
    'bili-comment-replies-renderer': '#expander { padding-left: 44px !important; }',
    'bili-comment-reply-renderer': '#footer { padding-right: 0 !important; }',
    'bili-comment-action-buttons-renderer': `:host { display: flex !important; flex-wrap: wrap !important; gap: 2px 10px !important; }
      :host > * { flex-shrink: 0 !important; margin-left: 0 !important; white-space: nowrap !important; }
      #pubdate, #reply, #reply button { white-space: nowrap !important; word-break: normal !important; }
      #pubdate { flex: 0 0 auto !important; }
      #more { margin-left: auto !important; margin-right: 0 !important; }`,
  };
  const commentSelector = ['bili-comments', ...Object.keys(commentCSS)].join(',');
  function syncComments() {
    for (const [shadow, record] of commentRoots) {
      if (!active || !['video', 'pgc', 'dynamic', 'space', 'reader', 'media', 'course'].includes(root.dataset.bpmPage) || !shadow.host.isConnected) {
        record.observer.disconnect(); record.style?.remove(); commentRoots.delete(shadow);
      }
    }
    if (!active || !['video', 'pgc', 'dynamic', 'space', 'reader', 'media', 'course'].includes(root.dataset.bpmPage)) return;
    const visit = element => {
      const shadow = element.shadowRoot;
      if (!shadow) return;
      if (!commentRoots.has(shadow)) {
        const observer = new MutationObserver(records => {
          if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && node.localName !== 'style'))) schedule();
        });
        const record = { observer, style: null };
        commentRoots.set(shadow, record);
        if (commentCSS[element.localName]) {
          record.style = document.createElement('style');
          record.style.dataset.bpmCommentStyle = '';
          record.style.textContent = commentCSS[element.localName];
          shadow.append(record.style);
        }
        observer.observe(shadow, { childList: true, subtree: true });
      }
      shadow.querySelectorAll(commentSelector).forEach(visit);
    };
    document.querySelectorAll(commentSelector).forEach(visit);
  }

  function nativeAutoNext() {
    try {
      const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
      const player = page.player;
      const kinds = page.nano?.HandoffKind;
      if (typeof player?.getHandoff === 'function' && typeof player?.setHandoff === 'function'
        && kinds?.Auto !== undefined && kinds?.Abort !== undefined) {
        return { on: player.getHandoff() === kinds.Auto,
          set: on => player.setHandoff(on ? kinds.Auto : kinds.Abort) };
      }
    } catch { /* 播放器初始化中时尝试原站可见开关。 */ }
    const button = document.querySelector('.continuous-btn');
    const toggle = button?.querySelector('.switch-btn');
    return toggle ? { on: toggle.classList.contains('on'), set: () => button.click() } : null;
  }

  function syncAutoNext() {
    if (!active || !['video', 'pgc'].includes(root.dataset.bpmPage)) return null;
    const native = nativeAutoNext();
    if (native && settings.autoNext !== null && native.on !== settings.autoNext) {
      try { native.set(settings.autoNext); native.on = settings.autoNext; }
      catch { return null; }
    }
    return native;
  }

  function setSearch(open) {
    if (!searchForm) return;
    searchForm.hidden = !open;
    searchBackdrop.hidden = !open;
    if (open) {
      document.activeElement?.blur?.();
      searchInput.focus();
    }
  }

  function resetPull() {
    pull = null;
    if (!pullBusy && pullIndicator) pullIndicator.hidden = true;
  }
  document.addEventListener('touchstart', event => {
    resetPull();
    if (!active || pageType() !== 'home' || pullBusy || window.scrollY > 2 || event.touches.length !== 1
      || !panel?.hidden || !searchForm?.hidden
      || event.target.closest?.('input, textarea, select, [contenteditable], .dynamic-panel-popover, .nav-search-panel, #bpm-toolbar-host')) return;
    const touch = event.touches[0];
    pull = { x: touch.clientX, y: touch.clientY, distance: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!pull) return;
    if (!active || pageType() !== 'home' || event.touches.length !== 1 || window.scrollY > 2) { resetPull(); return; }
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - pull.x);
    const dy = touch.clientY - pull.y;
    if (dx > 12 && dx > Math.abs(dy)) { resetPull(); return; }
    if (dy <= 8 || dy <= dx * 1.3) { pull.distance = 0; pullIndicator.hidden = true; return; }
    if (event.cancelable) event.preventDefault();
    pull.distance = Math.min(100, dy * 0.5);
    pullIndicator.hidden = false;
    pullIndicator.textContent = pull.distance >= 70 ? '松开刷新' : '下拉刷新';
    pullIndicator.style.transform = `translateY(${Math.min(32, pull.distance / 2)}px)`;
  }, { passive: false });
  document.addEventListener('touchend', () => {
    const ready = pull?.distance >= 70 && active && pageType() === 'home' && window.scrollY <= 2;
    resetPull();
    if (!ready || pullBusy) return;
    pullBusy = true;
    pullIndicator.hidden = false;
    pullIndicator.textContent = '正在刷新…';
    const button = document.querySelector('.feed-roll-btn .roll-btn, button.roll-btn');
    if (button && !button.disabled) button.click();
    else if (!button) location.reload();
    else pullIndicator.textContent = '请稍后再试';
    setTimeout(() => { pullBusy = false; resetPull(); }, 1600);
  }, { passive: true });
  document.addEventListener('touchcancel', resetPull, { passive: true });

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function setPanel(open) {
    if (!ui) return;
    panel.hidden = !open;
    ui.querySelector('[data-action="menu"]').setAttribute('aria-expanded', String(open));
    if (open) ui.querySelector('[name="mode"]').focus();
  }

  function scrollToPlayer() {
    const target = document.querySelector('#playerWrap, #bilibili-player, .plp-player, .big-nano-player, .bpx-player-container');
    if (!target) { showToast('当前页面没有可用播放器'); return; }
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }

  function seek(delta) {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      showToast('视频加载后才能快进／快退'); return;
    }
    try {
      video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration);
      showToast(delta < 0 ? '后退 10 秒' : '前进 10 秒');
    } catch { showToast('此视频暂不支持跳转'); }
  }

  async function playPause() {
    if (!video) { showToast('视频尚未加载，请先点击原站播放按钮'); return; }
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch { showToast('请先点击原站播放按钮，或检查登录／视频权限'); }
    updatePlayback();
  }

  async function fullScreen() {
    if (!video) { showToast('视频尚未加载'); return; }
    // 优先原播放器按钮，让站内控件与弹幕一同进入全屏。
    const button = document.querySelector('.bpx-player-ctrl-full');
    if (button) { button.click(); return; }
    try {
      const player = document.querySelector('.bpx-player-container') || video;
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else showToast('当前浏览器不支持网页全屏');
    } catch { showToast('无法进入全屏，请使用原站的全屏按钮'); }
  }

  function updatePlayback() {
    if (!ui) return;
    host.hidden = isLandscape();
    ui.querySelector('[data-action="play"]').textContent = video && !video.paused ? '暂停' : '播放';
    ui.querySelector('[name="speed"]').value = String(video?.playbackRate ?? settings.speed);
    for (const button of ui.querySelectorAll('[data-needs-video]')) button.disabled = !video;
  }

  function updateVideoRatio() {
    if (video?.videoWidth && video?.videoHeight) {
      root.style.setProperty('--bpm-video-ratio', `${video.videoWidth} / ${video.videoHeight}`);
    } else root.style.removeProperty('--bpm-video-ratio');
  }

  function bindVideo() {
    const next = active ? document.querySelector('#bilibili-player video, .bpx-player-container video') : null;
    if (next === video) return;
    videoController?.abort();
    video = next;
    updateVideoRatio();
    if (video) {
      videoController = new AbortController();
      const options = { signal: videoController.signal };
      const applySpeed = () => {
        if (!active || !video) return;
        try { video.playbackRate = settings.speed; } catch { /* 某些直播或视频限制倍速。 */ }
      };
      video.addEventListener('loadedmetadata', () => { updateVideoRatio(); applySpeed(); updatePlayback(); }, options);
      video.addEventListener('resize', updateVideoRatio, options);
      video.addEventListener('webkitbeginfullscreen', () => root.setAttribute('data-bpm-fullscreen', ''), options);
      video.addEventListener('webkitendfullscreen', () => root.removeAttribute('data-bpm-fullscreen'), options);
      for (const type of ['play', 'pause', 'ended', 'ratechange']) video.addEventListener(type, updatePlayback, options);
      applySpeed();
    }
    updatePlayback();
  }

  function createUI() {
    if (host?.isConnected) return;
    if (!document.body) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    ui = host.attachShadow({ mode: 'open' });
    // 内容全部是脚本内置的静态字符串；站内数据只通过 textContent 显示。
    ui.innerHTML = `
      <style>
        :host { all: initial; position: fixed; z-index: 2147483000; inset: auto 0 0;
          font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
          color: #1f2937; font-size: 14px; line-height: 1.5; pointer-events: none;
          color-scheme: light; }
        * { box-sizing: border-box; }
        :host([hidden]), [hidden] { display: none !important; }
        .search-backdrop { pointer-events: auto; position: fixed; inset: 0; background: #0006; z-index: -1; }
        .pull-indicator { position: fixed; top: env(safe-area-inset-top, 0px); left: 50%; margin-left: -52px;
          min-width: 104px; padding: 8px 12px; border-radius: 20px; background: #fff; color: #007ba8;
          box-shadow: 0 2px 14px #0002; text-align: center; }
        button, input, select, a { font: inherit; touch-action: manipulation; }
        button, a, select { min-height: 44px; }
        button { cursor: pointer; border: 0; background: #f2f5f8; color: #1f2937; border-radius: 10px; padding: 8px 12px; }
        button:disabled { opacity: .45; cursor: default; }
        a { color: inherit; text-decoration: none; }
        button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible { outline: 3px solid #00a1d6; outline-offset: 2px; }
        .dock { pointer-events: auto; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 6px; padding: 8px max(10px, env(safe-area-inset-left, 0px)) calc(8px + env(safe-area-inset-bottom, 0px));
          background: #ffffff; border-top: 1px solid #e5e7eb; box-shadow: 0 -3px 18px #0000000a; }
        .dock > * { display: flex; align-items: center; justify-content: center; border-radius: 10px; white-space: nowrap; }
        .dock [data-action="menu"] { color: #007ba8; background: #e8f7fc; }
        .sheet { pointer-events: auto; max-width: 540px; margin: 0 auto 8px;
          padding: 16px; border: 1px solid #e5e7eb; border-radius: 20px 20px 8px 8px;
          background: #fff; box-shadow: 0 -8px 30px #00000018;
          max-height: min(72vh, 650px); overflow-y: auto; overscroll-behavior: contain; }
        .heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
        .heading strong { font-size: 17px; }
        .status, .note { font-size: 12px; color: #64748b; margin: 6px 0; }
        .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
        select { background: #f2f5f8; color: #1f2937; border: 1px solid #dde3eb; border-radius: 8px; padding: 6px 10px; font-size: 16px; max-width: 65%; }
        input[type="checkbox"] { width: 22px; height: 22px; accent-color: #00a1d6; }
        .buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
        .links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .links a { padding: 10px 14px; border-radius: 8px; background: #f2f5f8; }
        .channel-settings { margin: 8px 0; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; }
        .channel-settings summary { cursor: pointer; padding: 8px 0; }
        .channel-editor { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
        .channel-editor label { display: flex; align-items: center; gap: 5px; min-height: 44px; font-size: 13px; }
        .channel-editor input { flex: 0 0 20px; margin: 0; }
        form { pointer-events: auto; display: flex; max-width: 540px; gap: 8px; padding: 12px; margin: 0 auto 8px; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 -4px 20px #00000012; }
        input[type="search"] { flex: 1; min-width: 0; border: 1px solid #dde3eb; border-radius: 9px; padding: 10px; font-size: 16px; color: #1f2937; background: #fff; }
        form button { background: #00a1d6; color: #fff; }
        .toast { pointer-events: none; width: max-content; max-width: calc(100% - 24px); margin: 0 auto 10px;
          padding: 10px 14px; border-radius: 12px; color: #fff; background: #1f2937ee; text-align: center; }
        .restore { pointer-events: auto; position: absolute; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          background: #00a1d6; color: #fff; box-shadow: 0 3px 16px #0002; }
        @media (prefers-color-scheme: dark) {
          :host { color: #e5e7eb; color-scheme: dark; }
          .dock, .sheet, form { background: #17212f; border-color: #334155; }
          button, select, .links a { color: #e5e7eb; background: #263448; border-color: #475569; }
          .status, .note { color: #a4b0c2; }
          input[type="search"] { background: #263448; border-color: #475569; color: #fff; }
          .dock [data-action="menu"] { background: #10374a; color: #82d7f4; }
        }
      </style>
      <div class="search-backdrop" data-action="close-search" hidden></div>
      <div class="pull-indicator" role="status" hidden></div>
      <div class="toast" role="status" hidden></div>
      <form role="search" action="https://search.bilibili.com/all" method="get" hidden>
        <input name="keyword" type="search" aria-label="搜索 B 站" placeholder="搜索视频、UP 主…" autocomplete="off" required>
        <button type="submit">搜索</button>
        <button type="button" data-action="close-search" aria-label="关闭搜索">×</button>
      </form>
      <section class="sheet" aria-label="竖屏助手设置" hidden>
        <div class="heading"><strong>B站 · 竖屏助手</strong><button data-action="close" aria-label="关闭设置">×</button></div>
        <div class="status" role="status"></div>
        <label class="row">布局模式<select name="mode"><option value="auto">自动：手机／窄窗口</option><option value="on">始终开启</option><option value="off">关闭适配</option></select></label>
        <label class="row">视频列表<select name="columns"><option value="2">两列</option><option value="1">一列 · 大封面</option></select></label>
        <details class="channel-settings"><summary data-channel-summary>首页分类 · 编辑</summary>
          <p class="note">默认一行四项；多选会自动换行，也可全部取消。</p>
          <div class="channel-editor"></div><button data-action="reset-channels">恢复默认一行</button>
        </details>
        <label class="row">站内视频在当前页打开<input name="sameTab" type="checkbox"></label>
        <label class="row">自动连播<input name="autoNext" type="checkbox" aria-describedby="auto-next-note"></label>
        <p class="note" id="auto-next-note"></p>
        <div class="buttons"><button data-action="seek-back" data-needs-video>−10 秒</button><button data-action="play" data-needs-video>播放</button><button data-action="seek-forward" data-needs-video>＋10 秒</button></div>
        <label class="row">播放倍速<select name="speed">${SPEEDS.map(speed => `<option value="${speed}">${speed}×</option>`).join('')}</select></label>
        <div class="buttons"><button data-action="full" data-needs-video>全屏</button><button data-action="comment">评论</button><button data-action="top">回顶部</button></div>
        <div class="links"><a href="https://www.bilibili.com/v/popular/all">热门</a><a href="https://www.bilibili.com/watchlater/list/">稍后再看</a><a href="https://www.bilibili.com/history">历史</a><a href="https://t.bilibili.com/">动态</a><a href="https://www.bilibili.com/anime/">番剧</a><a href="https://www.bilibili.com/guochuang/">国创</a><a data-space-link hidden>我的主页</a><a href="https://www.bilibili.com/">首页</a><a data-desktop-link hidden>电脑网页版</a></div>
        <p class="note">首次播放请点击原站播放按钮。清晰度、字幕、弹幕及账号操作使用原站控件。</p>
        <p class="note">被跳转到移动版时，请在浏览器中开启“桌面版网站”，再刷新。</p>
      </section>
      <nav class="dock" aria-label="竖屏助手导航"><a href="https://www.bilibili.com/">首页</a><button data-action="search">搜索</button><button data-action="player">播放器</button><button data-action="menu" aria-expanded="false">设置</button></nav>
      <button class="restore" data-action="restore" hidden>竖屏助手</button>
    `;
    document.body.append(host);
    panel = ui.querySelector('.sheet');
    status = ui.querySelector('.status');
    toast = ui.querySelector('.toast');
    searchForm = ui.querySelector('form');
    searchInput = ui.querySelector('input[type="search"]');
    searchBackdrop = ui.querySelector('.search-backdrop');
    pullIndicator = ui.querySelector('.pull-indicator');
    ui.addEventListener('click', async event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      switch (action) {
        case 'menu': setPanel(panel.hidden); setSearch(false); break;
        case 'close': setPanel(false); ui.querySelector('[data-action="menu"]').focus(); break;
        case 'restore': settings.mode = 'on'; persist(); refresh(); setPanel(true); break;
        case 'reset-channels': settings.channels = [...DEFAULT_CHANNELS]; persist(); refresh(); break;
        case 'search': setSearch(searchForm.hidden); setPanel(false); break;
        case 'close-search': setSearch(false); break;
        case 'player': setPanel(false); scrollToPlayer(); break;
        case 'seek-back': seek(-10); break;
        case 'seek-forward': seek(10); break;
        case 'play': await playPause(); break;
        case 'full': setPanel(false); await fullScreen(); break;
        case 'comment': {
          const comments = document.querySelector('#commentapp, #comment, .comment-container, .comment_body, bili-comments');
          if (comments) { setPanel(false); comments.scrollIntoView({ block: 'start', behavior: 'auto' }); }
          else showToast('当前页面未加载评论');
          break;
        }
        case 'top': setPanel(false); window.scrollTo({ top: 0, behavior: 'auto' }); break;
      }
    });
    ui.addEventListener('change', event => {
      const { name, value, checked } = event.target;
      if (name === 'mode' && ['auto', 'on', 'off'].includes(value)) settings.mode = value;
      if (name === 'columns') settings.columns = value === '1' ? 1 : 2;
      if (name === 'sameTab') settings.sameTab = checked;
      if (name === 'autoNext') settings.autoNext = checked;
      if (name === 'channel') settings.channels = [...ui.querySelectorAll('input[name="channel"]:checked')].map(input => input.value);
      if (name === 'speed' && SPEEDS.includes(Number(value))) {
        settings.speed = Number(value);
        if (video) {
          try { video.playbackRate = settings.speed; } catch { showToast('此视频暂不支持倍速'); }
        }
      }
      persist();
      refresh();
    });
    ui.addEventListener('keydown', event => {
      if (event.key === 'Escape') { setPanel(false); setSearch(false); }
    });
    searchForm.addEventListener('submit', event => {
      searchInput.value = searchInput.value.trim();
      if (!searchInput.value) { event.preventDefault(); searchInput.focus(); }
    });
  }

  function updateUI() {
    if (!ui) return;
    ui.querySelector('[name="mode"]').value = settings.mode;
    ui.querySelector('[name="columns"]').value = String(settings.columns);
    ui.querySelector('[name="sameTab"]').checked = settings.sameTab;
    updateChannelEditor();
    const native = syncAutoNext();
    const autoNext = ui.querySelector('[name="autoNext"]');
    autoNext.checked = settings.autoNext ?? native?.on ?? false;
    autoNext.indeterminate = settings.autoNext === null && !native;
    ui.querySelector('#auto-next-note').textContent = settings.autoNext === null
      ? '首次使用沿用 B 站设置；选择后会记住。'
      : `播放结束${settings.autoNext ? '自动播放下一条' : '停留在当前视频'}。${native ? '' : '播放器加载后生效。'}`;
    ui.querySelector('.dock').hidden = !active;
    ui.querySelector('.restore').hidden = active;
    const desktopLink = ui.querySelector('[data-desktop-link]');
    const spaceLink = ui.querySelector('[data-space-link]');
    spaceLink.hidden = true;
    // 从导航栏的登录头像链接取得自己的空间，避免把正在访问的 UP 主当成自己。
    for (const anchor of document.querySelectorAll('.bili-header .right-entry a[href]')) {
      try {
        const url = new URL(anchor.href, location.href);
        if (url.protocol === 'https:' && url.hostname === 'space.bilibili.com' && /^\/\d+\/?$/.test(url.pathname)) {
          spaceLink.href = url.origin + url.pathname; spaceLink.hidden = false; break;
        }
      } catch { /* 忽略非网页链接。 */ }
    }
    const canSwitch = location.hostname === 'm.bilibili.com' && (pageType() === 'video' || location.pathname === '/');
    desktopLink.hidden = !canSwitch;
    if (canSwitch) {
      const url = new URL(location.href);
      url.hostname = 'www.bilibili.com';
      desktopLink.href = url.href;
    }
    const names = { home: '首页', search: '搜索页', watchlater: '稍后再看', history: '历史记录',
      channel: '番剧／影视频道', dynamic: '动态页', space: '个人空间', pgc: '番剧／影视播放页', video: '视频页', popular: '热门／排行榜', partition: '内容分区', reader: '图文／专栏', media: '作品资料',
      course: '课程', live: '直播', message: '消息／私信', account: '账号中心（基础）', creator: '创作中心（基础）',
      shop: '会员购（基础）', manga: '漫画（基础）', charity: '公益（基础）', event: '活动专题（基础）', other: '此页面采用基础适配' };
    status.textContent = active ? `适配已开启 · ${names[root.dataset.bpmPage]}` : '适配已关闭';
    if (!active) { setPanel(false); setSearch(false); resetPull(); }
    updatePlayback();
  }

  function refresh() {
    lastRefresh = Date.now();
    const previous = active;
    active = wantsMobile();
    root.classList.toggle(ROOT_CLASS, active);
    root.dataset.bpmPage = pageType();
    root.style.setProperty('--bpm-columns', String(settings.columns));
    syncViewport();
    syncCollections();
    syncComments();
    syncHeader();
    syncChannels();
    if (active || host || settings.mode === 'off') createUI();
    bindVideo();
    if (!active) root.style.removeProperty('--bpm-video-ratio');
    updateUI();
    // 只有布局模式改变时通知站内重新测量，避免 resize 自触发循环。
    if (previous !== active && document.body) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function schedule() {
    if (pending) return;
    pending = window.setTimeout(() => { pending = 0; refresh(); }, Math.max(80, 250 - (Date.now() - lastRefresh)));
  }

  // 只对普通左键/触屏点击临时更改 target，保留 Ctrl/⌘ 点击和外部链接的行为。
  document.addEventListener('click', event => {
    if (!active || !settings.sameTab || event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || link.target !== '_blank') return;
    let url;
    try { url = new URL(link.href, location.href); } catch { return; }
    const internal = url.hostname === 'search.bilibili.com'
      || (['www.bilibili.com', 'm.bilibili.com'].includes(url.hostname) && /^\/(?:video|list|bangumi\/play)\//.test(url.pathname));
    if (!internal || !['http:', 'https:'].includes(url.protocol)) return;
    link.target = '_self';
    setTimeout(() => { if (link.target === '_self') link.target = '_blank'; }, 0);
  }, true);

  function syncFullscreen() {
    const fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement || video?.webkitDisplayingFullscreen);
    root.toggleAttribute('data-bpm-fullscreen', fullscreen);
  }
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  screen.orientation?.addEventListener?.('change', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  document.addEventListener('focusin', syncHeader);
  window.addEventListener('scroll', () => {
    if (active) requestAnimationFrame(syncHeader);
  }, { passive: true });

  // 动态列表、SPA 切页和替换的播放器都重新识别；忽略弹幕逐帧 DOM 更新。
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (element?.closest('.bpx-player-container')) {
        return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
          && (node.matches('video') || node.querySelector('video')));
      }
      return record.addedNodes.length || record.removedNodes.length;
    });
    if (relevant) schedule();
  });
  observer.observe(root, { childList: true, subtree: true });
  // 不覆盖 history 方法，兼容管理器隔离环境与原站路由。
  setInterval(() => {
    if (location.href !== lastURL) { lastURL = location.href; schedule(); }
    // 评论元素可能升级后才创建 Shadow Root；播放器也可能延后初始化。
    if (active && ['video', 'pgc', 'dynamic', 'space', 'reader', 'media', 'course'].includes(root.dataset.bpmPage)) { syncComments(); updateUI(); }
  }, 1000);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('B站竖屏：打开设置／启用', () => {
      settings.mode = 'on'; persist(); refresh(); setPanel(true);
    });
    GM_registerMenuCommand('B站竖屏：恢复自动模式', () => { settings.mode = 'auto'; persist(); refresh(); });
    GM_registerMenuCommand('B站竖屏：关闭适配', () => { settings.mode = 'off'; persist(); refresh(); });
  }
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  refresh();
})();
