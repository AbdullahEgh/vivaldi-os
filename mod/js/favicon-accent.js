/* ==========================================================================
   Favicon Accent — Vivaldi JS mod
   Tints Vivaldi's accent (tab bar, toolbars) with the dominant color of the
   active website's ICON, adjusted for light/dark themes.

   Icon search order (stops at the first colorful icon):
     1. The tab's favicon
     2. Icons declared by the site (apple-touch-icon, <link rel=icon>, manifest)
     3. /apple-touch-icon.png and /favicon.ico on the site
     4. DuckDuckGo icon service (sends only the domain name)
   If no colorful icon exists, a neutral icon color is used; if nothing at
   all is found, Vivaldi's own accent is left untouched.

   Needs: Settings > Themes > Editor > "Apply Accent Color to Window" ON.
   Installed by ../install-js-mods.sh (re-run after each Vivaldi update).
   ========================================================================== */
(() => {
  "use strict";

  const LOG = (...a) => console.log("%c[favicon-accent]", "color:#e67e22", ...a);
  const CACHE_KEY = "faviconAccent.v1";
  const CACHE_DAYS = 7;
  const FETCH_TIMEOUT = 4000;
  const STYLE_ID = "favicon-accent-style";

  /* ---------------- cache (per host) ---------------- */
  /* Vivaldi's window has no localStorage (it is null there): settings that
     must survive a restart live in chrome.storage.local */
  const vstore = {
    get: k => new Promise(r => { try { chrome.storage.local.get(k, o => { void chrome.runtime.lastError; r(o ? o[k] : undefined); }); } catch (e) { r(undefined); } }),
    set: (k, v) => { try { chrome.storage.local.set({ [k]: v }, () => void chrome.runtime.lastError); } catch (e) {} },
    del: k => { try { chrome.storage.local.remove(k, () => void chrome.runtime.lastError); } catch (e) {} },
  };
  let cache = {};
  vstore.get(CACHE_KEY).then(v => { if (v && typeof v === "object") cache = { ...v, ...cache }; });
  let saveTimer = 0;
  const now = () => Date.now();
  function cacheGet(host) {
    const e = cache[host];
    return e && now() - e.t < CACHE_DAYS * 864e5 ? e : null;
  }
  function cacheSet(host, val) {
    cache[host] = { ...val, t: now() };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => vstore.set(CACHE_KEY, cache), 1000);
  }

  /* ---------------- color helpers ---------------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255].map(Math.round);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
  }
  const hex = ([r, g, b]) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;
  function luminance([r, g, b]) {
    const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /* ---------------- dominant icon color ---------------- */
  function analyze(img) {
    const N = 48, cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    const buckets = Array.from({ length: 24 }, () => ({ r: 0, g: 0, b: 0, n: 0, s: 0 }));
    const neutral = { r: 0, g: 0, b: 0, n: 0 };
    let opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 160) continue;
      opaque++;
      const r = d[i], g = d[i + 1], b = d[i + 2], [h, s, l] = rgb2hsl(r, g, b);
      if (s < 0.22 || l < 0.1 || l > 0.93) {
        neutral.r += r; neutral.g += g; neutral.b += b; neutral.n++;
      } else {
        const k = Math.round(h * 24) % 24, bk = buckets[k];
        bk.r += r; bk.g += g; bk.b += b; bk.n++; bk.s += s;
      }
    }
    if (!opaque) return null;
    // score each hue with its neighbours so gradients count as one color
    let best = -1, bestScore = 0;
    buckets.forEach((bk, k) => {
      if (!bk.n) return;
      const nb = buckets[(k + 23) % 24].n + buckets[(k + 1) % 24].n;
      const score = (bk.n + nb * 0.5) * (0.4 + bk.s / bk.n);
      if (score > bestScore) { bestScore = score; best = k; }
    });
    if (best >= 0 && buckets[best].n >= opaque * 0.03) {
      const bk = buckets[best];
      return { rgb: [bk.r, bk.g, bk.b].map(v => Math.round(v / bk.n)), chromatic: true };
    }
    if (neutral.n) {
      return { rgb: [neutral.r, neutral.g, neutral.b].map(v => Math.round(v / neutral.n)), chromatic: false };
    }
    return null;
  }

  /* ---------------- loading icons (CORS-safe via blob URLs) ---------------- */
  async function timedFetch(url, asText = false) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { credentials: "omit", signal: ac.signal, cache: "force-cache" });
      if (!res.ok) return null;
      return asText ? await res.text() : await res.blob();
    } catch { return null; } finally { clearTimeout(to); }
  }
  async function colorFromUrl(url) {
    if (!url || url.startsWith("chrome://") || url.startsWith("vivaldi://")) return null;
    let src = url, revoke = null;
    if (!url.startsWith("data:")) {
      const blob = await timedFetch(url);
      if (!blob || !blob.size || /text\/html/.test(blob.type)) return null;
      src = revoke = URL.createObjectURL(blob);
    }
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      return analyze(img);
    } catch { return null; } finally { if (revoke) URL.revokeObjectURL(revoke); }
  }

  /* ---------------- searching for icons ---------------- */
  async function declaredIcons(origin) {
    const html = await timedFetch(origin + "/", true);
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html.slice(0, 200000), "text/html");
    const abs = h => { try { return new URL(h, origin + "/").href; } catch { return null; } };
    const size = l => parseInt((l.getAttribute("sizes") || "0").split("x")[0], 10) || 0;
    const links = [...doc.querySelectorAll("link[rel]")];
    const touch = links.filter(l => /apple-touch-icon/i.test(l.rel)).sort((a, b) => size(b) - size(a));
    const icons = links.filter(l => /(^|\s)icon(\s|$)/i.test(l.rel)).sort((a, b) => size(b) - size(a));
    const out = [...touch, ...icons].map(l => abs(l.getAttribute("href")));
    const man = links.find(l => /manifest/i.test(l.rel));
    if (man) {
      const mUrl = abs(man.getAttribute("href"));
      const txt = mUrl && await timedFetch(mUrl, true);
      try {
        const icons2 = (JSON.parse(txt).icons || []).sort((a, b) => size2(b) - size2(a));
        icons2.forEach(i => out.push(new URL(i.src, mUrl).href));
      } catch {}
    }
    return out.filter(Boolean);
    function size2(i) { return parseInt(String(i.sizes || "0").split("x")[0], 10) || 0; }
  }

  async function findColor(tab) {
    const u = new URL(tab.url), host = u.hostname, origin = u.origin;
    const hit = cacheGet(host);
    if (hit) return hit;

    let fallback = null;
    const tryUrl = async (url, source) => {
      const c = await colorFromUrl(url);
      if (!c) return null;
      if (c.chromatic) return { ...c, source };
      fallback = fallback || { ...c, source };
      return null;
    };

    let found = await tryUrl(tab.favIconUrl, "favicon");
    if (!found) {
      for (const url of await declaredIcons(origin)) {
        if ((found = await tryUrl(url, "site-declared"))) break;
      }
    }
    if (!found) found = await tryUrl(origin + "/apple-touch-icon.png", "apple-touch-icon");
    if (!found) found = await tryUrl(origin + "/favicon.ico", "favicon.ico");
    if (!found) found = await tryUrl(`https://icons.duckduckgo.com/ip3/${host}.ico`, "duckduckgo");

    const result = found || fallback || { rgb: null, source: "none" };
    cacheSet(host, result);
    return result;
  }

  /* ---------------- applying to the UI ---------------- */
  function styleEl() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    return el;
  }

  function buildVars(rgb, dark) {
    let [h, s, l] = rgb2hsl(...rgb);
    s = Math.min(s, 0.85);
    l = dark ? clamp(l, 0.2, 0.48) : clamp(l, 0.32, 0.72);
    const c = hsl2rgb(h, s, l);
    const shade = dl => hex(hsl2rgb(h, s, clamp(l + dl, 0, 1)));
    const fg = luminance(c) > 0.42 ? [26, 26, 26] : [255, 255, 255];
    const bg = dark ? [30, 30, 30] : [245, 245, 245];
    const mix = t => hex(c.map((v, i) => Math.round(v * (1 - t) + bg[i] * t)));
    return {
      "--colorAccentBg": hex(c),
      "--colorAccentBgDark": shade(-0.07),
      "--colorAccentBgDarker": shade(-0.14),
      "--colorAccentBgAlpha": rgba(c, 0.5),
      "--colorAccentBgAlphaBlur": rgba(c, 0.8),
      "--colorAccentBgFaded": mix(0.35),
      "--colorAccentBgFadedMore": mix(0.6),
      "--colorAccentBgFadedMost": mix(0.8),
      "--colorAccentBorder": shade(-0.1),
      "--colorAccentBorderDark": shade(-0.18),
      "--colorAccentFg": hex(fg),
      "--colorAccentFgFaded": rgba(fg, 0.65),
    };
  }

  /* One color change, one animation: the accent variables themselves are
     registered as colors and animated on #browser, so the tab bar, the address
     field, the tabs and the buttons all change together. (Fading each element's
     background on its own made the address field switch first and the bar
     follow later.) While a change runs, the elements' own background fades are
     turned off, so none of them lags behind the variables. */
  const VAR_NAMES = Object.keys(buildVars([128, 128, 128], true));
  const FADE_MS = 300;
  const AREAS = "#browser :is(#header, #footer, .mainbar, .tabbar-wrapper, #tabs-tabbar-container, .toolbar-statusbar)";
  function registerVars() {
    if (document.getElementById(STYLE_ID + "-props")) return;
    const el = document.createElement("style");
    el.id = STYLE_ID + "-props";
    el.textContent =
      VAR_NAMES.map(n => `@property ${n}{syntax:'<color>';inherits:true;initial-value:transparent}`).join("") +
      `#browser{transition:${VAR_NAMES.map(n => `${n} ${FADE_MS}ms ease`).join(",")}}` +
      `#browser.fa-recolor ${AREAS},#browser.fa-recolor ${AREAS} *{transition-property:none !important}`;
    document.head.appendChild(el);
  }
  let recolorTimer = 0;
  function recolorWindow(browser) {
    browser.classList.add("fa-recolor");
    clearTimeout(recolorTimer);
    recolorTimer = setTimeout(() => browser.classList.remove("fa-recolor"), FADE_MS + 50);
  }

  let current = null; // { rgb, source, host }
  function render() {
    const browser = document.getElementById("browser");
    if (!browser) return;
    registerVars();
    const el = styleEl();
    let css = "";
    if (current && current.rgb) {
      const dark = browser.classList.contains("theme-dark");
      const vars = buildVars(current.rgb, dark);
      css = `#browser{${Object.entries(vars).map(([k, v]) => `${k}:${v} !important`).join(";")}}`;
      window.__faviconAccent = { ...current, applied: vars["--colorAccentBg"], dark };
    }
    if (el.textContent === css) return;      // nothing changed (e.g. a class change on #browser)
    recolorWindow(browser);
    el.textContent = css;
  }

  /* ---------------- tracking the active tab ---------------- */
  let windowId = null, seq = 0;
  async function update() {
    const my = ++seq;
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, windowId: windowId ?? chrome.windows.WINDOW_ID_CURRENT });
    } catch (e) { LOG("tabs.query failed", e); return; }
    if (!tab || !/^https?:/.test(tab.url || "")) { current = null; render(); return; }
    const host = new URL(tab.url).hostname;
    if (current && current.host === host && current.rgb) return; // same site, keep color
    const res = await findColor(tab);
    if (my !== seq) return; // a newer tab switch won
    current = { ...res, host };
    LOG(host, "→", res.rgb ? hex(res.rgb) : "none", `(${res.source})`);
    render();
  }

  function start() {
    const browser = document.getElementById("browser");
    if (!browser || !window.chrome?.tabs) return setTimeout(start, 300);
    // which Vivaldi window is this? Ask about a tab whose page lives in this
    // document (chrome.windows.getCurrent() can name another window)
    const learnWindow = (tries = 0) => {
      const t = Number(document.querySelector("#webpage-stack .webpageview[data-id]")?.dataset.id);
      if (!(t > 0)) {
        if (tries < 40) return setTimeout(() => learnWindow(tries + 1), 250);
        return chrome.windows.getCurrent(w => { windowId = w?.id ?? null; update(); });
      }
      chrome.tabs.get(t, tab => { windowId = chrome.runtime.lastError || !tab ? null : tab.windowId; update(); });
    };
    learnWindow();
    // a window made active only by hovering it (floating-tile.js) keeps the
    // current color; clicking it ("ft-tint") recolors the tab bar
    const quiet = id => window.__ftQuietTint != null && window.__ftQuietTint === String(id);
    chrome.tabs.onActivated.addListener(i => {
      if ((windowId == null || i.windowId === windowId) && !quiet(i.tabId)) update();
    });
    window.addEventListener("ft-tint", () => update());
    chrome.tabs.onUpdated.addListener((id, info, tab) => {
      if (!tab.active || (windowId != null && tab.windowId !== windowId) || quiet(id)) return;
      if (info.url) current = null;               // navigated: re-evaluate
      if (info.url || info.favIconUrl || info.status === "complete") update();
    });
    // re-tune when switching light/dark theme
    new MutationObserver(render).observe(browser, { attributes: true, attributeFilter: ["class"] });
    LOG("loaded");
  }
  start();

  // handy for testing from DevTools: __faviconAccentClearCache()
  window.__faviconAccentClearCache = () => { cache = {}; vstore.del(CACHE_KEY); current = null; update(); };
})();
