/* =====================================================================
 * amssync shim — 资产盘点系统（v1.10.7 原件）存储拦截 + 云同步垫片
 *
 * 由 tools/inject-shim.js 注入：原件中最大的 <script>（React bundle）被抽出为
 * app.bundle.js，原位替换为本文件。因此本文件先于 bundle 执行，负责：
 *   1. 挡住 bundle（登录 + 对账完成后才 appendChild 放行）
 *   2. 凭据：localStorage amssync.rt(refreshToken) / amssync.devid；无则登录浮层
 *   3. GET /api/ams/snapshot 首次对账（本地/云端 空、不一致三情形）
 *   4. 运行期包装 Storage.prototype.setItem/removeItem，白名单 key 脏集合
 *      防抖 2s POST /api/ams/push；冲突→服务端值覆盖+刷新+toast，被覆盖值留底
 *   5. 30s + focus 增量拉取 /api/ams/changes；IndexedDB ams-files 对账制同步；
 *      /api/ams/presence 60s 心跳 + 多设备黄条提示
 *   6. 登录对账按每份数据上次同步的版本 + 指纹判断：本机只是旧了 → 直接用云端；
 *      本机改过、云端没变 → 推本机；两边都变了才弹窗（显示两边条数，覆盖云端要二次确认）
 *   7. 日期统一成 YYYY-MM-DD：包装 XLSX.utils.sheet_to_csv（Excel 导入），App 写资产 / 流转时、
 *      拉到云端数据时、启动时都把旧写法（5/6/23、2023/5/6、2023年5月6日、45052…）改过来
 *
 * 无任何依赖，接口契约见 medops/docs/api-contract.md §0/§5。
 * ===================================================================== */
(function () {
  'use strict';
  var API = '/api';
  var BUNDLE_SRC = 'app.bundle.js';
  var BLUE = '#2F6BFF';

  /* ---------- 同步 key 白名单（契约 §5） ---------- */
  var WL = ['sites', 'areas', 'assets', 'movements', 'inventories', 'users', 'roles',
    'approvals', 'cats', 'catCodes', 'otherCats', 'otherCatCodes', 'otherAssets',
    'depreCfg', 'locations', 'tags', 'changelog'];
  var EXCL = { 'ams:session': 1, 'ams:_ts': 1, 'ams:_lastBackup': 1 };
  function syncable(key) {
    if (typeof key !== 'string' || key.indexOf('ams:') !== 0) return false;
    if (EXCL[key] || key.indexOf('ams:ui:') === 0 || key.indexOf('ams:migrated:') === 0) return false;
    var rest = key.slice(4);
    for (var i = 0; i < WL.length; i++) {
      if (rest === WL[i] || rest.indexOf(WL[i] + ':') === 0) return true;
    }
    return false;
  }

  /* ---------- 原生 Storage + 立即包装（必须先于 bundle） ---------- */
  var rawSet = Storage.prototype.setItem;
  var rawRemove = Storage.prototype.removeItem;
  var applying = false;   // shim 自身灌入云端数据时置位，不进脏集合
  var engineOn = false;   // 对账完成、放行 bundle 后才开始收集脏 key
  var dirty = new Set();

  Storage.prototype.setItem = function (key, value) {
    // App 写资产 / 流转：日期字段先统一成 YYYY-MM-DD（CSV 导入等进来的 2023/5/6 之类），再让 App 重读
    if (this === window.localStorage && !applying && typeof DATE_FIELDS !== 'undefined' && DATE_FIELDS[key]) {
      var fixed = normStored(key, value);
      if (fixed !== value) { value = fixed; notifyLater(key); }
    }
    rawSet.call(this, key, value);
    if (this === window.localStorage && !applying && syncable(key)) markDirty(key);
  };
  Storage.prototype.removeItem = function (key) {
    rawRemove.call(this, key);
    if (this === window.localStorage && !applying && syncable(key)) markDirty(key);
  };
  function lsSet(k, v) { rawSet.call(window.localStorage, k, v); }
  function lsDel(k) { rawRemove.call(window.localStorage, k); }
  function lsGet(k) { return window.localStorage.getItem(k); }

  function readJSON(k, dft) {
    try { var v = lsGet(k); return v == null ? dft : JSON.parse(v); } catch (e) { return dft; }
  }
  function writeJSON(k, obj) { try { lsSet(k, JSON.stringify(obj)); } catch (e) { } }

  /* ---------- 每份数据「上次和云端一致」时的版本 + 内容指纹 ----------
     amssync.synced = { key: { v: 云端版本, h: 指纹 } }。登录对账靠它分清：
       本机这份和上次同步时一样（只是旧了）→ 直接用云端；云端没变、本机改过（没来得及推）→ 推本机；
       两边都变了才问人。以前只要两边不一样就弹窗，一台很久没开的电脑一选「使用本机数据」，
       全院的资产数据就被它的旧数据整份覆盖了。 */
  function fp(s) { // 53 位字符串哈希（cyrb53），null 单独记
    if (s == null) return 'null';
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return s.length + ':' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  var synced = readJSON('amssync.synced', {});
  if (!synced || typeof synced !== 'object') synced = {};
  function markSynced(k, version, value) {
    if (value == null) delete synced[k]; else synced[k] = { v: version, h: fp(value) };
    writeJSON('amssync.synced', synced);
  }

  /* ---------- 日期统一成 YYYY-MM-DD ----------
     资产的签收 / 采购 / 维保 / 保修日期在编辑框里是 <input type="date">，只认 2023-05-06；
     「保修到期早于采购日期」「日期晚于今天」这些提示、按年月算折旧也都假定是这个格式。
     Excel 导入进来的却是单元格自己的显示格式：Excel 里直接敲 2023/5/6（内置日期格式）
     经 SheetJS 转出来是 5/6/23，还有 2023/5/6、2023年5月6日、20230506、粘贴成数字的 45052……
     结果编辑框是空的，提示却说「保修到期早于采购日期」（'4/27/26' < '4/28/23'），也不折旧。 */
  var DATE_FIELDS = {
    'ams:assets': ['receiveDate', 'purchaseDate', 'lastMaintain', 'warrantyEnd', 'disposeDate'],
    'ams:otherAssets': ['receiveDate', 'purchaseDate', 'lastMaintain', 'warrantyEnd', 'disposeDate'],
    'ams:movements': ['date']
  };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null; // 2 月 30 日这种不存在的
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function localYmd(d) { return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function serialToYmd(n) { // Excel 日期序号（1900 体系）；只认 1954～2119 年，别把别的数字当日期
    if (!(n >= 20000 && n <= 80000)) return null;
    var t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  // 两位年份：今年往后 20 年以内算 20xx（保修到期常在几年后），再往后算 19xx
  function fullYear(yy) { var cut = (new Date().getFullYear() % 100) + 20; return yy <= cut ? 2000 + yy : 1900 + yy; }
  function normDate(v) {
    if (v == null) return v;
    var s = String(v).trim(), m;
    if (!s) return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if ((m = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(s))) { var dt = new Date(s); return isNaN(dt) ? v : (localYmd(dt) || v); }
    // 2023-5-6、2023/5/6、2023.5.6、2023年5月6日，后面可以跟时间
    if ((m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s))) return ymd(+m[1], +m[2], +m[3]) || v;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ymd(+m[1], +m[2], +m[3]) || v;
    // 月/日/年：SheetJS 把 Excel 内置日期格式显示成 5/6/23、5/6/23 0:00；13/5/2023 这种只能是 日/月
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s))) {
      var a = +m[1], b = +m[2], y = m[3].length === 2 ? fullYear(+m[3]) : +m[3];
      if (a > 12 && b <= 12) { var t2 = a; a = b; b = t2; }
      return ymd(y, a, b) || v;
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) return serialToYmd(+s) || v; // 粘贴成数字的日期
    return v; // 认不出来的原样保留，不瞎猜
  }
  // 一份数据（JSON 数组串）里的日期字段统一；没改动返回原串
  function normStored(key, s) {
    var fields = DATE_FIELDS[key];
    if (!fields || typeof s !== 'string' || !s) return s;
    var arr;
    try { arr = JSON.parse(s); } catch (e) { return s; }
    if (!Array.isArray(arr)) return s;
    var changed = false;
    arr.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      fields.forEach(function (f) {
        var v = it[f];
        if (typeof v !== 'string' && typeof v !== 'number') return;
        var nv = normDate(v);
        if (nv != null && nv !== v && String(nv) !== String(v)) { it[f] = nv; changed = true; }
      });
    });
    return changed ? JSON.stringify(arr) : s;
  }
  var notifyPending = {};
  function notifyLater(key) { // App 内存里还是旧写法：让它从 localStorage 重新读一遍
    if (notifyPending[key]) return;
    notifyPending[key] = setTimeout(function () { delete notifyPending[key]; notifyApp(key); }, 0);
  }

  /* 导入：SheetJS 的 sheet_to_csv 按单元格自己的显示格式输出日期，把日期单元格的显示文本先改成 YYYY-MM-DD；
     表头带「日期 / 到期」的列里，文本写的日期、粘贴成数字的日期也一并统一 */
  function dateCellText(d) {
    // SheetJS 0.18 按本地时区造日期，有的时区会差几十秒（上海是前一天 23:59:17），离零点 10 分钟以内的按零点算
    var ms = ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
    var t = ms > 86400000 - 600000 ? new Date(d.getTime() + (86400000 - ms)) : d;
    return localYmd(t);
  }
  function fixSheetDates(ws) {
    var X = window.XLSX;
    if (!ws || !ws['!ref'] || !X || !X.utils) return;
    var rg = X.utils.decode_range(ws['!ref']), dateCols = {}, c, r, cell;
    for (c = rg.s.c; c <= rg.e.c; c++) {
      var hc = ws[X.utils.encode_cell({ r: rg.s.r, c: c })];
      if (hc && /日期|到期/.test(String(hc.w != null ? hc.w : hc.v))) dateCols[c] = 1;
    }
    for (r = rg.s.r + 1; r <= rg.e.r; r++) {
      for (c = rg.s.c; c <= rg.e.c; c++) {
        cell = ws[X.utils.encode_cell({ r: r, c: c })];
        if (!cell) continue;
        if (cell.t === 'd' && cell.v instanceof Date && !isNaN(cell.v)) { var tx = dateCellText(cell.v); if (tx) cell.w = tx; continue; }
        if (!dateCols[c]) continue;
        if (cell.t === 'n') { var sy = serialToYmd(cell.v); if (sy) cell.w = sy; }
        else if (cell.t === 's') { var nd = normDate(cell.v); if (nd && nd !== cell.v) cell.w = nd; }
      }
    }
  }
  (function wrapXlsx() {
    var X = window.XLSX;
    if (!X || !X.utils || typeof X.utils.sheet_to_csv !== 'function' || X.utils.sheet_to_csv.__amsDates) return;
    var raw = X.utils.sheet_to_csv;
    var wrapped = function (ws) { try { fixSheetDates(ws); } catch (e) { } return raw.apply(this, arguments); };
    wrapped.__amsDates = true;
    X.utils.sheet_to_csv = wrapped;
  })();

  /* ---------- 凭据与设备 id ---------- */
  var auth = { access: null, user: null };
  function getRT() { return lsGet('amssync.rt'); }
  function setRT(v) { if (v) lsSet('amssync.rt', v); else lsDel('amssync.rt'); }
  var devid = lsGet('amssync.devid');
  if (!devid) {
    devid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    lsSet('amssync.devid', devid);
  }

  /* ---------- HTTP 封装：Bearer + 401 自动 refresh 重试一次 ---------- */
  var refreshing = null; // 单飞
  function refreshTokens() {
    if (refreshing) return refreshing;
    refreshing = (async function () {
      var rt = getRT();
      if (!rt) return false;
      try {
        var res = await fetch(API + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-Id': devid },
          body: JSON.stringify({ refreshToken: rt })
        });
        if (!res.ok) { if (res.status === 401 || res.status === 403) { setRT(null); auth.access = null; } return false; }
        var j = await res.json();
        auth.access = j.accessToken; setRT(j.refreshToken); auth.user = j.user || auth.user;
        return true;
      } catch (e) { return false; }
    })();
    var p = refreshing;
    p.finally(function () { refreshing = null; });
    return p;
  }

  // body: undefined | 普通对象(JSON) ; opts:{raw:Blob, headers:{}, noRetry}
  async function apiFetch(method, path, body, opts) {
    opts = opts || {};
    async function doFetch() {
      var h = { 'X-Device-Id': devid };
      if (auth.access) h['Authorization'] = 'Bearer ' + auth.access;
      var init = { method: method, headers: h };
      if (opts.raw) { init.body = opts.raw; }
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      if (opts.headers) for (var k in opts.headers) h[k] = opts.headers[k];
      return fetch(API + path, init);
    }
    var res = await doFetch();
    if (res.status === 401 && !opts.noRetry && getRT()) {
      if (await refreshTokens()) res = await doFetch();
    }
    return res;
  }

  /* ---------- UI：样式、登录浮层、对话框、toast、黄条 ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#amssync-login{position:fixed;inset:0;z-index:99990;background:#F5F7FB;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
    '#amssync-login .as-card{width:340px;max-width:calc(100vw - 48px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(15,40,110,.12);padding:32px 28px}' +
    '#amssync-login h1{margin:0 0 4px;font-size:20px;color:#111827;font-weight:600}' +
    '#amssync-login p.as-sub{margin:0 0 20px;font-size:13px;color:#6B7280}' +
    '#amssync-login input{display:block;width:100%;box-sizing:border-box;margin:0 0 12px;padding:10px 12px;font-size:14px;border:1px solid #D1D5DB;border-radius:10px;outline:none}' +
    '#amssync-login input:focus{border-color:' + BLUE + ';box-shadow:0 0 0 3px rgba(47,107,255,.15)}' +
    '#amssync-login .as-err{min-height:18px;margin:0 0 10px;font-size:13px;color:#DC2626}' +
    '#amssync-login button{width:100%;padding:11px 0;font-size:15px;font-weight:600;color:#fff;background:' + BLUE + ';border:0;border-radius:10px;cursor:pointer}' +
    '#amssync-login button:disabled{opacity:.6;cursor:default}' +
    '.as-modal-mask{position:fixed;inset:0;z-index:99991;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
    '.as-modal{width:400px;max-width:calc(100vw - 48px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(15,40,110,.18);padding:24px}' +
    '.as-modal h2{margin:0 0 10px;font-size:17px;color:#111827}' +
    '.as-modal .as-body{font-size:14px;color:#374151;line-height:1.7;margin:0 0 18px;white-space:pre-line}' +
    '.as-modal .as-btns{display:flex;gap:10px;flex-direction:column}' +
    '.as-modal button{padding:10px 14px;font-size:14px;border-radius:10px;cursor:pointer;border:1px solid #D1D5DB;background:#fff;color:#374151;text-align:left}' +
    '.as-modal button.as-primary{background:' + BLUE + ';border-color:' + BLUE + ';color:#fff;font-weight:600}' +
    '.as-modal button small{display:block;font-weight:400;font-size:12px;opacity:.75;margin-top:2px}' +
    '#amssync-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99995;background:rgba(17,24,39,.92);color:#fff;font-size:13px;padding:9px 18px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .3s;font-family:system-ui,sans-serif}' +
    '#amssync-banner{position:fixed;top:0;left:0;right:0;z-index:99980;background:#FEF3C7;color:#92400E;border-bottom:1px solid #FDE68A;font-size:13px;text-align:center;padding:6px 12px;font-family:system-ui,sans-serif}';
  (document.head || document.documentElement).appendChild(css);

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('amssync-toast');
    if (!el) { el = document.createElement('div'); el.id = 'amssync-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 350); }, 3200);
  }

  function showBanner(on) {
    var el = document.getElementById('amssync-banner');
    if (on && !el) {
      el = document.createElement('div'); el.id = 'amssync-banner';
      el.textContent = '另一台设备正在使用，建议避免同时录入';
      document.body.appendChild(el);
    } else if (!on && el) el.remove();
  }

  // 通用二选一/确认对话框，resolve 按钮 value
  function modal(title, body, buttons) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div'); mask.className = 'as-modal-mask';
      var box = document.createElement('div'); box.className = 'as-modal';
      var h = document.createElement('h2'); h.textContent = title;
      var b = document.createElement('div'); b.className = 'as-body'; b.textContent = body;
      var btns = document.createElement('div'); btns.className = 'as-btns';
      buttons.forEach(function (cfg) {
        var btn = document.createElement('button');
        if (cfg.primary) btn.className = 'as-primary';
        btn.innerHTML = '';
        btn.appendChild(document.createTextNode(cfg.label));
        if (cfg.hint) { var s = document.createElement('small'); s.textContent = cfg.hint; btn.appendChild(s); }
        btn.onclick = function () { mask.remove(); resolve(cfg.value); };
        btns.appendChild(btn);
      });
      box.appendChild(h); box.appendChild(b); box.appendChild(btns); mask.appendChild(box);
      document.body.appendChild(mask);
      var pri = btns.querySelector('.as-primary'); if (pri) pri.focus();
    });
  }

  /* ---------- 登录浮层 ---------- */
  var ERR_TEXT = {
    UNAUTHORIZED: '账号或密码不正确',
    KICKED: '您的账户已被禁用，请联系设备科',
    PROBE_COOLDOWN: '尝试过于频繁，请稍后再试',
    RATE_LIMITED: '请求过于频繁，请稍后再试',
    FORBIDDEN: '该账号无权使用资产系统云同步（需设备科/管理员账号）',
    BAD_INPUT: '请输入账号和密码',
    NETWORK: '网络异常，请检查连接后重试'
  };
  function errText(code, retryAfter) {
    if (code === 'FROZEN') return '登录已冻结，请 ' + (retryAfter || 60) + ' 秒后重试';
    return ERR_TEXT[code] || ('登录失败（' + (code || '未知错误') + '）');
  }

  // resolve 时 auth.access / amssync.rt 已就绪
  function showLogin(presetErr) {
    return new Promise(function (resolve) {
      var old = document.getElementById('amssync-login');
      if (old) old.remove();
      var wrap = document.createElement('div'); wrap.id = 'amssync-login';
      var card = document.createElement('div'); card.className = 'as-card';
      var h1 = document.createElement('h1'); h1.textContent = '资产盘点管理系统';
      var sub = document.createElement('p'); sub.className = 'as-sub'; sub.textContent = '云同步已启用，请使用设备科 / 管理员账号登录';
      var u = document.createElement('input'); u.placeholder = '账号'; u.autocomplete = 'username';
      var p = document.createElement('input'); p.placeholder = '密码'; p.type = 'password'; p.autocomplete = 'current-password';
      var err = document.createElement('div'); err.className = 'as-err'; err.textContent = presetErr || '';
      var btn = document.createElement('button'); btn.textContent = '登 录';
      card.appendChild(h1); card.appendChild(sub); card.appendChild(u); card.appendChild(p); card.appendChild(err); card.appendChild(btn);
      wrap.appendChild(card); document.body.appendChild(wrap);
      u.focus();

      async function submit() {
        var uv = u.value.trim(), pv = p.value;
        if (!uv || !pv) { err.textContent = ERR_TEXT.BAD_INPUT; return; }
        btn.disabled = true; err.textContent = '';
        try {
          var res = await fetch(API + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Device-Id': devid },
            body: JSON.stringify({ username: uv, password: pv })
          });
          var j = null; try { j = await res.json(); } catch (e) { }
          if (res.ok && j && j.accessToken) {
            auth.access = j.accessToken; auth.user = j.user; setRT(j.refreshToken);
            wrap.remove(); resolve(); return;
          }
          var e2 = (j && j.error) || {};
          err.textContent = errText(e2.code, e2.retryAfter);
        } catch (e) { err.textContent = ERR_TEXT.NETWORK; }
        btn.disabled = false;
      }
      btn.onclick = submit;
      p.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
      u.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') p.focus(); });
    });
  }

  /* ---------- JSON 留底导出 ---------- */
  function downloadJSON(name, obj) {
    try {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    } catch (e) { }
  }
  function collectLocal() {
    var out = {};
    for (var i = 0; i < window.localStorage.length; i++) {
      var k = window.localStorage.key(i);
      if (syncable(k)) out[k] = lsGet(k);
    }
    return out;
  }
  function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

  /* ---------- 同步引擎状态 ---------- */
  var ver = {};      // key -> 服务端 version（push baseVersion 用）
  var seq = 0;       // changes 增量游标
  var flushTimer = null, flushing = false;

  function markDirty(key) {
    dirty.add(key);
    if (!engineOn) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 2000);
  }

  function buildChanges() {
    var changes = [];
    dirty.forEach(function (k) {
      changes.push({ key: k, value: lsGet(k), baseVersion: ver[k] || 0 });
    });
    dirty.clear();
    return changes;
  }

  // push 响应兼容 数组 / {results:[...]} / {changes:[...]}
  function pushResults(j) {
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.results)) return j.results;
    if (j && Array.isArray(j.changes)) return j.changes;
    return [];
  }

  async function flush() {
    if (flushing) { // 上一轮在途，稍后再试，避免丢排队 key
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 500);
      return;
    }
    if (!dirty.size) return;
    flushing = true;
    var changes = buildChanges();
    var sent = {};
    changes.forEach(function (c) { sent[c.key] = c.value; });
    try {
      var res = await apiFetch('POST', '/ams/push', { deviceId: devid, changes: changes });
      if (!res.ok) throw new Error('push http ' + res.status);
      var j = await res.json();
      if (j && typeof j.seq === 'number') seq = Math.max(seq, j.seq);
      var conflicted = [];
      pushResults(j).forEach(function (r) {
        if (r.ok) { ver[r.key] = r.newVersion; markSynced(r.key, r.newVersion, sent[r.key]); }
        else if (r.conflict) conflicted.push(r);
      });
      if (conflicted.length) applyConflicts(conflicted);
    } catch (e) {
      // 失败重排队（保留最新本地值，5s 后重试）
      changes.forEach(function (c) { dirty.add(c.key); });
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 5000);
    }
    flushing = false;
    if (dirty.size) { // 在途期间又有新改动
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 500);
    }
  }

  /* ---------- 冲突：服务端覆盖本地 + 留底 + 通知 App 刷新 ---------- */
  function stashPush(entry) {
    var a = readJSON('amssync.stash', []);
    a.unshift(entry);
    writeJSON('amssync.stash', a.slice(0, 5)); // 只留 5 条
  }

  function applyConflicts(list) {
    applying = true;
    list.forEach(function (r) {
      stashPush({ key: r.key, value: lsGet(r.key), serverVersion: r.conflict.version, at: new Date().toISOString(), reason: 'conflict' });
      if (r.conflict.value == null) lsDel(r.key); else lsSet(r.key, r.conflict.value);
      ver[r.key] = r.conflict.version;
      markSynced(r.key, r.conflict.version, r.conflict.value);
    });
    lsSet('ams:_ts', String(Date.now()));
    applying = false;
    notifyApp(list[0].key);
    toast('云端有更新，页面已刷新');
  }

  // 手造 StorageEvent 触发 App 自刷新。
  // 注：bundle 的 storage 监听显式忽略 key==='ams:_ts'，故除按约发 'ams:_ts' 外，
  // 再补发实际业务 key 的事件才能真正触发其 _sync 重载。
  function notifyApp(bizKey) {
    function fire(key) {
      try {
        window.dispatchEvent(new StorageEvent('storage', {
          key: key, newValue: key ? lsGet(key) : null,
          storageArea: window.localStorage, url: location.href
        }));
      } catch (e) { }
    }
    fire('ams:_ts');
    fire(bizKey || null);
  }

  /* ---------- 增量拉取 ---------- */
  var polling = false;
  async function pollChanges() {
    if (polling || !engineOn) return;
    polling = true;
    try {
      var res = await apiFetch('GET', '/ams/changes?since=' + seq);
      if (res.ok) {
        var j = await res.json();
        var changed = [];
        var keys = (j && j.keys) || {};
        applying = true;
        var fixedKeys = [];
        Object.keys(keys).forEach(function (k) {
          if (!syncable(k)) return;
          var e = keys[k];
          ver[k] = e.version;
          if (dirty.has(k)) return; // 本地有待推改动，冲突交给 push 端裁决
          markSynced(k, e.version, e.value);
          var cur = lsGet(k);
          var val = e.value == null ? null : normStored(k, e.value); // 别的电脑（旧版页面）推上来的旧写法日期
          if (val !== e.value) fixedKeys.push(k);
          if (val == null) { if (cur != null) { lsDel(k); changed.push(k); } }
          else if (cur !== val) { lsSet(k, val); changed.push(k); }
        });
        if (changed.length) lsSet('ams:_ts', String(Date.now()));
        applying = false;
        fixedKeys.forEach(markDirty); // 统一后的写法推回云端
        if (j && typeof j.seq === 'number') seq = j.seq;
        if (changed.length) { notifyApp(changed[0]); toast('云端有更新，页面已刷新'); }
        if (j && j.files && j.files.length) scheduleFileSync(1000);
      }
    } catch (e) { }
    polling = false;
  }

  /* ---------- 首次对账 ---------- */
  async function pushAll(entries) { // entries: [{key,value,baseVersion}]
    if (!entries.length) return;
    var sent = {};
    entries.forEach(function (c) { sent[c.key] = c.value; });
    try {
      var res = await apiFetch('POST', '/ams/push', { deviceId: devid, changes: entries });
      if (!res.ok) { entries.forEach(function (c) { dirty.add(c.key); }); return; } // 稍后由同步引擎重推
      var j = await res.json();
      if (j && typeof j.seq === 'number') seq = Math.max(seq, j.seq);
      pushResults(j).forEach(function (r) {
        if (r.ok) { ver[r.key] = r.newVersion; markSynced(r.key, r.newVersion, sent[r.key]); }
        else if (r.conflict) { // 并发抢先，按服务端为准
          applying = true;
          if (r.conflict.value == null) lsDel(r.key); else lsSet(r.key, r.conflict.value);
          applying = false;
          ver[r.key] = r.conflict.version;
          markSynced(r.key, r.conflict.version, r.conflict.value);
        }
      });
    } catch (e) { entries.forEach(function (c) { dirty.add(c.key); }); }
  }

  // 只换指定的几份数据（keys 省略 = 全部换成云端；云端没有的本机 key 一并清掉）
  function applyCloudAll(cloudKeys, keys) {
    applying = true;
    var local = collectLocal();
    var only = keys ? {} : null;
    if (keys) keys.forEach(function (k) { only[k] = 1; });
    Object.keys(cloudKeys).forEach(function (k) {
      if (!syncable(k) || (only && !only[k])) return;
      var v = cloudKeys[k].value;
      if (v == null) lsDel(k); else lsSet(k, v);
      markSynced(k, cloudKeys[k].version, v);
    });
    Object.keys(local).forEach(function (k) { // 云端没有的本地 key 一并清掉
      if (!(k in cloudKeys) && (!only || only[k])) { lsDel(k); delete synced[k]; }
    });
    writeJSON('amssync.synced', synced);
    lsSet('ams:_ts', String(Date.now()));
    applying = false;
  }

  /* 几份主要数据各有多少条，给人看：「电脑台账 220 台 · 部门 18 个 · 流转记录 340 条」 */
  var SUM = [['ams:assets', '电脑台账', '台'], ['ams:otherAssets', '其他资产', '件'], ['ams:sites', '部门', '个'],
    ['ams:movements', '流转记录', '条'], ['ams:inventories', '盘点任务', '个']];
  function summarize(get) {
    var out = [];
    SUM.forEach(function (x) {
      var v = get(x[0]), n = 0;
      if (v != null) { try { var j = JSON.parse(v); n = Array.isArray(j) ? j.length : 0; } catch (e) { n = 0; } }
      if (n || x[0] === 'ams:assets') out.push(x[1] + ' ' + n + ' ' + x[2]);
    });
    return out.join(' · ');
  }

  async function reconcile(snap) {
    var cloudKeys = {};
    Object.keys((snap && snap.keys) || {}).forEach(function (k) {
      if (syncable(k)) { cloudKeys[k] = snap.keys[k]; ver[k] = snap.keys[k].version; }
    });
    var local = collectLocal();
    var cloudHas = Object.keys(cloudKeys).length > 0;
    var localHas = Object.keys(local).length > 0;

    if (localHas && !cloudHas) {
      var up = await modal('首次同步', '检测到本机已有数据，而云端为空。\n是否将本机数据全量上传到云端？', [
        { label: '上传到云端', hint: '推荐：以本机数据初始化云端', value: 'up', primary: true },
        { label: '暂不上传', hint: '继续使用，本机后续改动仍会同步', value: 'skip' }
      ]);
      if (up === 'up') {
        await pushAll(Object.keys(local).map(function (k) { return { key: k, value: local[k], baseVersion: 0 }; }));
      }
      return;
    }
    if (cloudHas && !localHas) { applyCloudAll(cloudKeys); return; }
    if (!cloudHas && !localHas) return;

    // 两边都有：逐份数据看本机是「旧了」「改过」还是「两边都改了」（见 amssync.synced 的说明）
    var take = [], send = [], clash = [];
    var union = {};
    Object.keys(local).forEach(function (k) { union[k] = 1; });
    Object.keys(cloudKeys).forEach(function (k) { union[k] = 1; });
    for (var k in union) {
      var lv = k in local ? local[k] : null;
      var cv = k in cloudKeys ? cloudKeys[k].value : null;
      var cVer = k in cloudKeys ? cloudKeys[k].version : 0;
      if (lv === cv) { if (cv != null) markSynced(k, cVer, cv); continue; }
      var s = synced[k];
      if (s && s.h === fp(lv)) take.push(k);            // 本机没改过，只是旧了 → 用云端
      else if (s && s.v === cVer && cVer) send.push(k); // 云端没变过，本机有没推上去的改动 → 推本机
      else clash.push(k);                               // 两边都变了，或者这台电脑以前没记录（旧版页面）
    }
    if (take.length) applyCloudAll(cloudKeys, take);
    if (send.length) {
      await pushAll(send.map(function (k2) {
        return { key: k2, value: k2 in local ? local[k2] : null, baseVersion: cloudKeys[k2] ? cloudKeys[k2].version : 0 };
      }));
    }
    if (!clash.length) return;

    var sumC = summarize(function (k2) { return k2 in cloudKeys ? cloudKeys[k2].value : null; });
    var sumL = summarize(function (k2) { return k2 in local ? local[k2] : null; });
    var pick = await modal('数据不一致',
      '这台电脑上的资产数据和云端（大家共用的那一份）对不上。\n一般应选「使用云端数据」：这台电脑多半是很久没打开、数据旧了。\n\n' +
      '云端：' + sumC + '\n本机：' + sumL + '\n\n被换掉的那一份会先自动下载一个 JSON 文件留底。', [
      { label: '使用云端数据（推荐）', hint: '这台电脑上的数据先下载备份，再换成云端的', value: 'cloud', primary: true },
      { label: '用本机数据覆盖云端…', hint: '所有电脑看到的都会变成这台电脑的数据，下一步还要再确认', value: 'local' }
    ]);
    if (pick === 'local') {
      var sure = await modal('确定用本机数据覆盖云端？',
        '覆盖以后，所有电脑上看到的资产数据都会变成这台电脑上的这一份。\n\n云端现在：' + sumC + '\n这台电脑：' + sumL +
        '\n\n只有确定这台电脑上的才是最新、最全的数据时才这样做。拿不准就选「不覆盖」。', [
        { label: '不覆盖，使用云端数据', value: 'cloud', primary: true },
        { label: '确定覆盖云端', hint: '云端这份会先下载备份；服务器也保留着最近的版本，可让管理员还原', value: 'local' }
      ]);
      if (sure !== 'local') pick = 'cloud';
    }
    if (pick === 'local') {
      var cloudDump = {};
      Object.keys(cloudKeys).forEach(function (k2) { cloudDump[k2] = cloudKeys[k2].value; });
      downloadJSON('ams-cloud-backup-' + ts() + '.json', { type: 'ams-cloud-backup', at: new Date().toISOString(), keys: cloudDump });
      await pushAll(clash.map(function (k2) {
        return { key: k2, value: k2 in local ? local[k2] : null, baseVersion: (cloudKeys[k2] && cloudKeys[k2].version) || 0 };
      }));
    } else { // 默认云端
      downloadJSON('ams-local-backup-' + ts() + '.json', { type: 'ams-local-backup', at: new Date().toISOString(), keys: local });
      applyCloudAll(cloudKeys, clash);
    }
  }

  /* 本机已有数据里的旧写法日期统一一遍（统一后的会推回云端，其他电脑跟着更新） */
  function normalizeAllStored() {
    Object.keys(DATE_FIELDS).forEach(function (k) {
      var cur = lsGet(k);
      var fixed = normStored(k, cur);
      if (fixed !== cur) { lsSet(k, fixed); markDirty(k); }
    });
  }

  /* ---------- 鉴权 + snapshot 主循环 ---------- */
  async function ensureAuthAndSnapshot() {
    for (; ;) {
      if (!getRT()) { await showLogin(); }
      else if (!auth.access) {
        var ok = await refreshTokens();
        if (!ok) { if (!getRT()) continue; await new Promise(function (r) { setTimeout(r, 3000); }); continue; }
      }
      var res;
      try { res = await apiFetch('GET', '/ams/snapshot'); }
      catch (e) { await new Promise(function (r) { setTimeout(r, 3000); }); continue; }
      if (res.status === 200) return res.json();
      if (res.status === 403) { setRT(null); auth.access = null; await showLogin(ERR_TEXT.FORBIDDEN); continue; }
      if (res.status === 401) { setRT(null); auth.access = null; continue; }
      await new Promise(function (r) { setTimeout(r, 3000); }); // 5xx 等，稍后重试
    }
  }

  /* ---------- IndexedDB ams-files 对账制同步（不 hook IDB） ---------- */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('ams-files', 1);
      req.onupgradeneeded = function () { // 与 bundle 完全一致的 schema
        req.result.createObjectStore('files', { keyPath: 'id' }).createIndex('byAsset', 'assetId');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  async function idbGetAll() {
    try {
      var db = await idbOpen();
      return await new Promise(function (resolve) {
        var r = db.transaction('files').objectStore('files').getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      });
    } catch (e) { return []; }
  }
  async function idbPut(rec) {
    try {
      var db = await idbOpen();
      return await new Promise(function (resolve) {
        var r = db.transaction('files', 'readwrite').objectStore('files').put(rec);
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { resolve(false); };
      });
    } catch (e) { return false; }
  }
  async function idbDel(id) {
    try {
      var db = await idbOpen();
      return await new Promise(function (resolve) {
        var r = db.transaction('files', 'readwrite').objectStore('files').delete(id);
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { resolve(false); };
      });
    } catch (e) { return false; }
  }

  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(dataUrl || '');
    if (!m) return new Blob([dataUrl || ''], { type: 'application/octet-stream' });
    var mime = m[1] || 'application/octet-stream';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: mime });
    var bin = atob(m[3]);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  function bufToDataUrl(buf, mime) {
    var u8 = new Uint8Array(buf), s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return 'data:' + (mime || 'application/octet-stream') + ';base64,' + btoa(s);
  }
  async function sha256Hex(blob) {
    try {
      var buf = await blob.arrayBuffer();
      var d = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return null; } // 非安全上下文等，退化为只按存在性对账
  }
  // Header 只能 ASCII：中文文件名等转成 \uXXXX 转义的 JSON
  function asciiJSON(obj) {
    return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, function (c) {
      return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    });
  }

  var fileSyncing = false, fileSyncTimer = null;
  function scheduleFileSync(delay) {
    clearTimeout(fileSyncTimer);
    fileSyncTimer = setTimeout(fileSync, delay || 0);
  }
  async function fileSync() {
    if (fileSyncing || !engineOn) return;
    fileSyncing = true;
    try {
      var res = await apiFetch('GET', '/ams/files/manifest');
      if (!res.ok) throw new Error('manifest ' + res.status);
      var j = await res.json();
      var list = Array.isArray(j) ? j : ((j && j.files) || []);
      var server = {};
      list.forEach(function (f) { if (f && f.id != null) server[String(f.id)] = f; });
      var locals = await idbGetAll();
      var localMap = {};
      locals.forEach(function (r) { if (r && r.id != null) localMap[String(r.id)] = r; });
      var known = readJSON('amssync.files', {}); // id -> {sha256} 已同步指纹（区分“本地删了”和“从没有过”）
      var id, rec, sv;

      for (id in localMap) {
        rec = localMap[id]; sv = server[id];
        if (sv && sv.deleted) { await idbDel(id); delete known[id]; continue; } // 服务端墓碑 → 删本地
        var sha = (known[id] && known[id].sha256) || null;
        var blob = null;
        if (!sha) { blob = dataUrlToBlob(rec.dataUrl); sha = await sha256Hex(blob); }
        if (!sv) { // 服务端没有 → 上传
          blob = blob || dataUrlToBlob(rec.dataUrl);
          var meta = {};
          for (var mk in rec) if (mk !== 'dataUrl') meta[mk] = rec[mk];
          var pr = await apiFetch('PUT', '/ams/files/' + encodeURIComponent(id), undefined, {
            raw: blob,
            headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Ams-Meta': asciiJSON(meta) }
          });
          if (pr.ok) known[id] = { sha256: sha };
        } else if (sha && sv.sha256 && sv.sha256 !== sha) { // 内容不一致 → 服务端为准
          var got = await pullFile(id);
          if (got) known[id] = { sha256: sv.sha256 };
        } else {
          known[id] = { sha256: sv.sha256 || sha };
        }
      }
      for (id in server) {
        sv = server[id];
        if (localMap[id]) continue;
        if (sv.deleted) { delete known[id]; continue; }
        if (known[id]) { // 本地曾同步过又没了 → 本地删除，同步到服务端
          var dr = await apiFetch('DELETE', '/ams/files/' + encodeURIComponent(id));
          if (dr.ok || dr.status === 404) delete known[id];
        } else { // 服务端新文件 → 拉取
          if (await pullFile(id)) known[id] = { sha256: sv.sha256 };
        }
      }
      writeJSON('amssync.files', known);
    } catch (e) { }
    fileSyncing = false;
  }
  async function pullFile(id) {
    try {
      var res = await apiFetch('GET', '/ams/files/' + encodeURIComponent(id));
      if (!res.ok) return false;
      var metaH = res.headers.get('X-Ams-Meta');
      var meta = {};
      try { meta = metaH ? JSON.parse(metaH) : {}; } catch (e) { }
      var buf = await res.arrayBuffer();
      var mime = meta.type || res.headers.get('Content-Type') || 'application/octet-stream';
      var rec = Object.assign({}, meta, { id: meta.id || id, dataUrl: bufToDataUrl(buf, mime) });
      return idbPut(rec);
    } catch (e) { return false; }
  }

  /* ---------- presence 心跳 + 多设备黄条 ---------- */
  async function heartbeat() {
    try {
      var res = await apiFetch('PUT', '/ams/presence', { deviceId: devid });
      if (!res.ok) return;
      var j = await res.json();
      var now = Date.now();
      var others = ((j && j.others) || []).filter(function (o) {
        if (!o || o.deviceId === devid) return false;
        var t = typeof o.lastSeen === 'number' ? o.lastSeen : Date.parse(o.lastSeen);
        return isNaN(t) ? true : (now - t < 5 * 60 * 1000); // 解析失败时信服务端（表本身 5min 过期）
      });
      showBanner(others.length > 0);
    } catch (e) { }
  }

  /* ---------- 卸载兜底 flush ---------- */
  function flushOnExit() {
    if (!dirty.size || !engineOn) return;
    var payload = JSON.stringify({ deviceId: devid, changes: buildChanges() });
    var sent = false;
    try { // fetch keepalive 可带 Bearer，优先
      fetch(API + '/ams/push', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.access, 'X-Device-Id': devid },
        body: payload
      });
      sent = true;
    } catch (e) { }
    if (!sent && navigator.sendBeacon) {
      try { navigator.sendBeacon(API + '/ams/push', new Blob([payload], { type: 'application/json' })); } catch (e) { }
    }
  }

  /* ---------- 放行 bundle ---------- */
  function releaseBundle() {
    var s = document.createElement('script');
    s.src = BUNDLE_SRC;
    document.body.appendChild(s);
  }

  /* ---------- 启动 ---------- */
  whenBody(async function () {
    try {
      var snap = await ensureAuthAndSnapshot();
      if (snap && typeof snap.seq === 'number') seq = snap.seq;
      await reconcile(snap);
    } catch (e) {
      console.error('[amssync] 对账失败，转本地模式：', e);
    }
    try { normalizeAllStored(); } catch (e) { }
    engineOn = true;
    releaseBundle();
    if (dirty.size) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 2000); }

    setInterval(pollChanges, 30 * 1000);
    window.addEventListener('focus', pollChanges);
    setInterval(fileSync, 60 * 1000);
    scheduleFileSync(3000); // 等 bundle 起来后先对一次账
    setInterval(heartbeat, 60 * 1000);
    heartbeat();
    window.addEventListener('beforeunload', flushOnExit);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { clearTimeout(flushTimer); flush(); }
    });
  });
})();
