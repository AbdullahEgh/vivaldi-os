/* ==========================================================================
   Tab bar dock — Vivaldi JS mod (part of Bento OS)
   Top / bottom tab bar:  [ left area ] — gap — [ dock ] — gap — [ right area ]

   The dock (back, address field, tabs, +) always sits exactly in the middle
   of the window, however many tabs are open and whatever is in the side areas.

   The areas come from Vivaldi's toolbar editor: a "Flexible Space" marks the
   edge of the dock.
     - toolbar before the tabs: items before its last Flexible Space are the
       left area; the rest belongs to the dock
     - toolbar after the tabs: items before its first Flexible Space belong to
       the dock; the rest is the right area
   Without a Flexible Space a toolbar belongs to the dock entirely.
   The CSS (Mac/08-taskbar-and-address.css, section 4) packs the left area at
   the far left and the right area at the far right; this script gives the
   first dock item a left margin so the dock is centered. (A margin, not a
   transform: macOS hit-tests the window's drag area by layout, so a shifted
   button would not be clickable.)
   ========================================================================== */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const SPACER = "toolbar-spacer-flexible";

  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  function dockItems(tc) {
    const before = $(":scope > .toolbar-tabbar-before", tc);
    const strip = $(":scope > .resize", tc);
    const after = $(":scope > .toolbar-tabbar-after", tc);
    const kids = el => (el ? [...el.children] : []);
    const bk = kids(before), ak = kids(after);
    let bi = -1;
    bk.forEach((c, i) => { if (c.classList.contains(SPACER)) bi = i; });
    const ai = ak.findIndex(c => c.classList.contains(SPACER));
    const items = [
      ...(bi >= 0 ? bk.slice(bi + 1) : bk),
      ...(strip ? [strip] : []),
      ...(ai >= 0 ? ak.slice(0, ai) : ak),
    ];
    return items.filter(el => !el.classList.contains(SPACER));
  }

  let pushed = null;                       // the dock item that carries the margin
  const marginOf = el => parseFloat(el.style.getPropertyValue("margin-left")) || 0;
  function clear(el) {
    el.style.removeProperty("margin-left");
    el.removeAttribute("data-ft-dock");
  }

  // Windows, tabs at the top: the window buttons sit in the tab bar's top-right
  // corner (CSS, section 9). Tell the CSS their real width and the bar's height
  // so the bar keeps exactly that much room free for them.
  // (wherever Vivaldi puts them: the tab bar at the top, or the address bar)
  function windowButtons(b) {
    const g = [...document.querySelectorAll(".window-buttongroup")].find(shown);
    const tbc = g && g.closest("#tabs-tabbar-container");
    const set = (k, v) => { if (b.style.getPropertyValue(k) !== v) b.style.setProperty(k, v); };
    if (g) {
      const w = [...g.querySelectorAll("button")].filter(shown).reduce((s, x) => s + x.getBoundingClientRect().width, 0);
      set("--vos-wbg-w", Math.round(w) + "px");
    } else b.style.removeProperty("--vos-wbg-w");
    if (tbc) set("--vos-bar-h", Math.round(tbc.getBoundingClientRect().height) + "px");
    else b.style.removeProperty("--vos-bar-h");
  }

  // the least room kept between the dock and the right area
  const GAP = 8;
  const overflowing = tc => tc.scrollWidth > tc.clientWidth + 1;
  /* 1.0.350: where the right area begins when it sits packed at the far right - worked out from the toolbar's end and the
     right items' own span, never from the space left over (that space already holds the dock's last margin: measuring
     it made each pass answer the last one, and near the edge the dock kept jumping between two places) */
  function rightLimit(tc) {
    const after = $(":scope > .toolbar-tabbar-after", tc);
    const cs = el => getComputedStyle(el), px = v => parseFloat(v) || 0;
    const tcr = tc.getBoundingClientRect(), tcs = cs(tc);
    let end = tcr.right - px(tcs.paddingRight) - px(tcs.borderRightWidth);
    if (!after) return end;
    const ar = after.getBoundingClientRect(), as = cs(after);
    end = Math.min(end, ar.right) - px(as.paddingRight) - px(as.borderRightWidth);
    const kids = [...after.children], si = kids.findIndex(c => c.classList.contains(SPACER));
    if (si < 0) return end;                                       // (no right area: the whole toolbar is the dock's)
    const rest = kids.slice(si + 1).filter(shown);
    if (!rest.length) return end;
    const rr = rest.map(el => el.getBoundingClientRect());
    const span = Math.max(...rr.map(r => r.right)) - Math.min(...rr.map(r => r.left));
    return end - px(cs(rest[rest.length - 1]).marginRight) - span - px(cs(rest[0]).marginLeft);
  }

  /* a tight tab bar, step by step (CSS section 10): the date shortens first (floating-tile.js), then a short
     address field, then no timer ring, and only at the very end no clock */
  const TIGHT = ["data-vos-tight", "data-vos-tight2", "data-vos-tight3"], tightNeed = [];
  function layout() {
    const b = $("#browser"), tc = $("#tabs-container");
    if (!b) return;
    windowButtons(b);
    const horizontal = b.classList.contains("tabs-top") || b.classList.contains("tabs-bottom");
    const items = (horizontal && tc ? dockItems(tc) : []).filter(shown);
    const first = items[0] || null;
    if (pushed && pushed !== first) clear(pushed);
    pushed = first;
    if (!first) { TIGHT.forEach(a => b.removeAttribute(a)); return; }
    const rects = items.map(el => el.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
    const bar = (tc.closest("#tabs-tabbar-container") || tc).getBoundingClientRect();
    // the same answer on every pass: the dock's place with no margin, its width and the right area's start
    const rz = $(":scope > .resize", tc), cut = rz ? Math.max(0, rz.scrollWidth - rz.clientWidth) : 0;   // (the apps' strip at its full width, even when cut short)
    const cur = marginOf(first), L0 = left - cur, dockW = right - left + cut, lim = rightLimit(tc);
    let m = Math.max(0, Math.round((bar.left + bar.right) / 2 - dockW / 2 - L0));   // centered in the window...
    m = Math.min(m, Math.max(0, Math.floor(lim - GAP - dockW - L0)));              // ...or as far right as the room allows
    const deficit = L0 + dockW + GAP - lim;                                          // > 0: no room even at the far left
    if (!first.hasAttribute("data-ft-dock")) first.setAttribute("data-ft-dock", "");
    if (Math.abs(m - cur) >= 2) first.style.setProperty("margin-left", m + "px", "important");   // (a pixel off is no reason to move: rounding never walks it)

    // still no room with the dock at its leftmost: a tight bar (CSS section 10)
    const lv = TIGHT.filter(a => b.hasAttribute(a)).length;
    const over = deficit > 0.5 || (m === 0 && overflowing(tc));
    if (!over && lv === 0) return;                                  // (room to spare and not tight: nothing more to measure)
    const width = tc.clientWidth;
    if (over && lv < TIGHT.length) {
      if (lv === 0 && window.vosFitDate?.()) { queue(); return; }  // the date got shorter: measured again
      tightNeed[lv] = width + Math.max(deficit, tc.scrollWidth - tc.clientWidth, 1); b.setAttribute(TIGHT[lv], ""); queue();
    } else if (!over && lv > 0 && width > (tightNeed[lv - 1] || 0) + 16) {
      b.removeAttribute(TIGHT[lv - 1]);
      queue();
    }
  }

  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; layout(); });
  }

  let watched = null;
  const ro = new ResizeObserver(queue);
  // tabs added / removed, toolbar items changed (not our own style changes)
  const insideTab = n => !!n && n.nodeType === 1 && !n.classList.contains("tab-position") && !!n.closest(".tab-position, .vos-tm-mini, .vos-upd-tag");   // also the timer's ticking text
  const mo = new MutationObserver(recs => {
    for (const r of recs) if (!insideTab(r.target)) return queue();
  });
  function watch() {
    const tc = $("#tabs-container");
    if (tc && tc !== watched) {
      ro.disconnect(); mo.disconnect();
      ro.observe(tc);
      for (const c of tc.children) ro.observe(c);
      const strip = $(".tab-strip", tc);
      if (strip) ro.observe(strip);
      mo.observe(tc, { childList: true, subtree: true });
      watched = tc;
    }
    queue();
  }

  function start() {
    const b = $("#browser");
    if (!b) return setTimeout(start, 50);
    // the tab bar moves (top/bottom/side) or is re-drawn
    new MutationObserver(watch).observe(b, { attributes: true, attributeFilter: ["class"], childList: true, subtree: false });
    const footer = $("#footer"), header = $("#header");
    for (const el of [footer, header, $("#main")]) if (el) new MutationObserver(watch).observe(el, { childList: true });
    addEventListener("resize", queue);
    watch();
    (window.vosBeat || (f => setInterval(() => { if (!document.hidden) f(); }, 2500)))(() => { if ($("#tabs-container") !== watched) watch(); });   // 1.0.340: only a re-drawn tab bar   // a re-drawn tab bar is picked up within 2.5s
    document.addEventListener("visibilitychange", () => { if (!document.hidden) watch(); });
  }
  // clicking anywhere outside the address field ends typing there: the field
  // lets go of the keyboard and shows the app's name (or "Search") again
  function addressInput() {
    const a = document.activeElement;
    return a && a.closest?.("#browser .UrlBar-AddressField") ? a : null;
  }
  document.addEventListener("pointerdown", e => {
    const a = addressInput();
    if (!a || e.target.closest?.(".UrlBar-AddressField, .OmniDropdown")) return;
    a.blur();
  }, true);
  // a click inside a page (the page takes the focus away from the UI): the
  // same, in case the field still shows itself as being edited
  addEventListener("blur", () => { const a = addressInput(); if (a) a.blur(); });

  start();
})();

/* 1.0.219: an icon as dark as its circle (a dark icon in dark mode - or a white one in light mode) vanished into it: such a
   tab's circle gets a soft plate that contrasts with the icon. Each icon is measured once (a tiny sample, kept) */
(() => {
  "use strict";
  const seen = new Map();                            // icon address -> its brightness (0..1, null: no answer)
  const favOf = new Map(), favAsked = new Set();     // tab -> its site icon's address
  try {                                              // 1.0.340: asked once per tab; a new icon, or a closed tab, from Vivaldi's own events
    chrome.tabs.onUpdated.addListener((id, ch) => { if (ch.favIconUrl && /^(https?:|data:image)/.test(ch.favIconUrl) && favOf.get(id) !== ch.favIconUrl) { favOf.set(id, ch.favIconUrl); soon(); } });
    chrome.tabs.onRemoved.addListener(id => { favOf.delete(id); favAsked.delete(id); siteIcons.delete(id); });
  } catch (e) {}
  const busy = new Set();
  const hasMedia = new Set(), variant = new Map();   // 1.0.305: an SVG icon with a light and a dark version of its own
  /* 1.0.356: a site's own light and dark icons (<link rel="icon" media="(prefers-color-scheme: dark)">): each look its own picture -
     its tab, its window's buttons, its pinned circle */
  const siteIcons = new Map();                       // tab -> { key, light, dark }
  function siteIcon(id, look) {
    const key = favOf.get(id) || "", e = siteIcons.get(id);
    if (!e || e.key !== key) {
      siteIcons.set(id, { key });
      const wv = document.querySelector(`.webpageview[data-id="${id}"] webview`) || document.querySelector(`webview[tab_id="${id}"]`);
      if (wv && typeof wv.executeScript === "function") try {
        wv.executeScript({ code: `JSON.stringify([...document.querySelectorAll('link[rel~="icon" i]')].map(l => [l.href, (l.media || "").toLowerCase()]))` }, r => {
          void chrome.runtime.lastError;
          let L = []; try { L = JSON.parse(r?.[0] || "[]"); } catch (x) {}
          L = L.filter(x => /^https?:/.test(x[0] || ""));
          const dk = L.find(x => /prefers-color-scheme\s*:\s*dark/.test(x[1])), lt = L.find(x => /prefers-color-scheme\s*:\s*light/.test(x[1])) || (dk && L.find(x => !x[1]));
          const cur = siteIcons.get(id); if (!cur || cur.key !== key) return;
          if (dk || lt) { cur.dark = dk?.[0] || ""; cur.light = lt?.[0] || ""; soon(); }
        });
      } catch (x) {}
      else siteIcons.delete(id);                     // (not loaded yet: asked again next time)
      return "";
    }
    return e[look] || "";
  }
  const flipSvg = (t, look) => t.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, (m, x) => x.toLowerCase() === look ? "(min-width: 0px)" : "(max-width: 0px)");
  async function brightness(src0, look) {          // (measured as it is drawn in that look)
    const src = src0 + "|" + look, url = src0;
    if (seen.has(src)) return seen.get(src);
    if (busy.has(src)) return undefined;
    busy.add(src);
    let v = null;
    try {                                            // (fetched: an <img> from chrome:// would lock the canvas)
      let blob = await (await fetch(url)).blob();
      if (/svg/i.test(blob.type) || /^data:image\/svg/i.test(url)) {
        let txt = await blob.text();
        if (/prefers-color-scheme/i.test(txt)) { hasMedia.add(url); txt = flipSvg(txt, look); variant.set(src, "data:image/svg+xml," + encodeURIComponent(txt)); }
        blob = new Blob([txt], { type: "image/svg+xml" });
      }
      if (/^text\//.test(blob.type)) { busy.delete(src); seen.set(src, "broken"); return "broken"; }   // a page, not a picture: no icon really
      let bmp;
      if (/svg/i.test(blob.type)) {                    // 1.0.303: an SVG icon (claude.ai's): drawn through a picture first
        const u = URL.createObjectURL(blob), im = new Image(); im.src = u;
        try { await im.decode(); } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
        bmp = im;
      } else bmp = await createImageBitmap(blob);
      const N = 16, c = document.createElement("canvas"); c.width = c.height = N;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data; let n = 0, hi = 0, lo = 0;
      // 1.0.301: its own tile (the ring round its edge: solid, one colour) - the circle takes it, so the icon is whole;
      // and its own colour (its coloured parts) - for a gentle tint of the circle
      const ring = [], acc = [0, 0, 0, 0], all = [0, 0, 0, 0];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4, r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2);
        if (r >= 6 && r <= 7.6) ring.push(d[i + 3] > 200 ? [d[i], d[i + 1], d[i + 2]] : null);
        if (d[i + 3] > 160) { all[0] += d[i]; all[1] += d[i + 1]; all[2] += d[i + 2]; all[3]++; }
        if (d[i + 3] > 160) { const C = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); if (C > 60) { acc[0] += d[i]; acc[1] += d[i + 1]; acc[2] += d[i + 2]; acc[3]++; } }
      }
      const solid = ring.filter(Boolean);
      let tile = null;
      if (ring.length && solid.length / ring.length > 0.6) {         // (1.0.303: a tile with rounded corners too)
        const m = [0, 1, 2].map(k => solid.reduce((a, c) => a + c[k], 0) / solid.length);
        const dev = solid.reduce((a, c) => a + Math.abs(c[0] - m[0]) + Math.abs(c[1] - m[1]) + Math.abs(c[2] - m[2]), 0) / solid.length / 3;
        if (dev < 34) tile = m.map(Math.round).join(",");
      }
      const tint = acc[3] >= 4 ? [acc[0], acc[1], acc[2]].map(x => Math.round(x / acc[3])).join(",")
        : all[3] >= 4 ? [all[0], all[1], all[2]].map(x => Math.round(x / all[3])).join(",") : null;   // (1.0.303: a grey or black icon: its own grey)
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 120) {
        const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++;
        const C = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255;   // 1.0.282: a strong colour shows on black and on white
        if (L > 0.35 || C > 0.4) hi++; if (L < 0.65 || C > 0.4) lo++;
      }
      // 1.0.244: not its average - how much of it shows against the circle: a dark tile with bright marks (its own
      // background) shows on black and needs no plate; only an icon with hardly any bright (or, in light mode, dark) part does
      v = n > 12 ? { hi: hi / n, lo: lo / n, tile, tint } : null;   // (almost nothing drawn: leave it)
    } catch (e) {}
    busy.delete(src); seen.set(src, v);
    return v;
  }
  let tileCol = false;
  const hslL = col => { const [r, g, b] = col.split(",").map(Number); return (Math.max(r, g, b) + Math.min(r, g, b)) / 510; };
  function levels(col) {                           // 1.0.304: every circle at one level - its icon's colour, as deep (dark) or as pale (light) as the others
    let [r, g, b] = col.split(",").map(Number); r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    const S = Math.min(s, 0.6) * 100, exact = `rgb(${col})`, grey = s < 0.12;
    // 1.0.314: dimmer - a coloured circle 12% deep (dark) / 93% pale (light), a grey one 9% / 95%; a dark tile is its own
    // colour in both looks (the icon whole - a dark square on a pale circle never), a pale tile its own in light
    const dk = `hsl(${h.toFixed(0)} ${(S * 0.8).toFixed(0)}% ${grey ? 9 : 12}%)`, lt = `hsl(${h.toFixed(0)} ${S.toFixed(0)}% ${grey ? 95 : 93}%)`;
    const deeper = `hsl(${h.toFixed(0)} ${(Math.min(s, 0.8) * 90).toFixed(0)}% ${Math.max(4, Math.round(l * 100 * 0.4))}%)`;   // 1.0.316: a dark tile in dark: its circle far deeper than it, so the icon stands out
    return [tileCol && l < 0.3 ? deeper : dk, tileCol && l > 0.82 ? exact : lt];   // (1.0.317: a dark tile in light: a pale circle - the tile clear on it)
  }
  let t = 0;
  function check() {
    t = 0;
    const b = document.getElementById("browser"); if (!b) return;
    const dark = b.classList.contains("theme-dark");
    for (const tab of document.querySelectorAll("#tabs-container .tab")) {
      // the site's own icon address (Vivaldi's chrome://favicon2 picture cannot be read by a script)
      const id = Number((tab.closest(".tab-wrapper")?.id || tab.querySelector(".tab-wrapper")?.id || tab.closest(".tab-position")?.querySelector(".tab-wrapper")?.id || "").slice(4));
      const src = favOf.get(id) || "";
      if (id && !favAsked.has(id)) { favAsked.add(id); try { chrome.tabs.get(id, x => { void chrome.runtime.lastError; const f = x?.favIconUrl || ""; if (/^(https?:|data:image)/.test(f) && favOf.get(id) !== f) { favOf.set(id, f); soon(); } }); } catch (e) { favAsked.delete(id); } }
      if (tab.hasAttribute("data-vos-plate")) tab.removeAttribute("data-vos-plate");   // (1.0.365: no plate - the circle is always its page's look)
      if (!src) { tab.removeAttribute("data-vos-ink"); continue; }
      const tp = tab.closest(".tab-position"), look = tp?.getAttribute("data-vos-look") || (dark ? "dark" : "light");
      const own = siteIcon(id, look), shown = own || src;   // 1.0.356: the site's own icon for this look, if it has one
      const v = seen.get(shown + "|" + look);
      { const other = look === "dark" ? "light" : "dark", os = siteIcon(id, other) || src; if (seen.get(os + "|" + other) === undefined) brightness(os, other); }   // 1.0.355: the other look read ahead - a switch shows its icons at once
      if (v === undefined) { brightness(shown, look).then(x => { if (x !== undefined) soon(); }); continue; }
      if (tp) {                                      // 1.0.305: its window in the other look: the icon's own version for it
        const alt = own || (hasMedia.has(src) ? variant.get(src + "|" + look) || "" : "");   // (1.0.306: whichever look - the tab and its window's circles the same picture)
        if ((tp.dataset.vosFavUrl || "") !== alt) { if (alt) { tp.dataset.vosFavUrl = alt; tp.style.setProperty("--vos-fav", `url("${alt}")`); } else { delete tp.dataset.vosFavUrl; tp.style.removeProperty("--vos-fav"); } }
      }
      const dk = look === "dark", want = !v || typeof v !== "object" ? null : dk && v.hi < 0.08 ? "light" : !dk && v.lo < 0.08 ? "dark" : null;   // 1.0.357: by its own look, not Vivaldi's
      /* 1.0.365: an icon all in one colour that would vanish on its circle (a black logo on black): the icon flipped (white),
         never the circle changed - a tile (Claude's cream square) is whole on any circle: left as it is */
      const ink = !!want && !(v && typeof v === "object" && v.tile);
      if (tab.hasAttribute("data-vos-ink") !== ink) tab.toggleAttribute("data-vos-ink", ink);
      const kind = "", col = "";   // 1.0.355: no tint at all - every app on a plain white (light) / black (dark) circle
      if (tab.hasAttribute("data-vos-tile")) tab.removeAttribute("data-vos-tile");   // (1.0.360: no own-disc colour - the look decides)
      { const dim = !!(v && typeof v === "object" && dk && ((v.tile && hslL(v.tile) < 0.3) || want === "light"));   // 1.0.316: an icon too dim for the dark bar
        if (tab.hasAttribute("data-vos-dim") !== dim) tab.toggleAttribute("data-vos-dim", dim); }
      if ((tab.getAttribute("data-vos-tint") || "") !== kind) { if (kind) tab.setAttribute("data-vos-tint", kind); else tab.removeAttribute("data-vos-tint"); }
      if (col) { if (tab.style.getPropertyValue("--vos-tint") !== `rgb(${col})`) { tab.style.setProperty("--vos-tint", `rgb(${col})`); tileCol = kind === "tile"; const lv = levels(col); tab.style.setProperty("--vos-tint-d", lv[0]); tab.style.setProperty("--vos-tint-l", lv[1]); } }
      else if (tab.style.getPropertyValue("--vos-tint")) { tab.style.removeProperty("--vos-tint"); tab.style.removeProperty("--vos-tint-d"); tab.style.removeProperty("--vos-tint-l"); }
    }
  }
  const soon = () => { if (!t) t = setTimeout(check, 250); };
  const now = () => { clearTimeout(t); t = 0; check(); dispatchEvent(new Event("vos-tabicons")); };   // 1.0.355: a look switched - its icons at once, the window's circles with them
  (function watch() {
    const tc = document.getElementById("tabs-container"), b = document.getElementById("browser");
    if (!tc || !b) return setTimeout(watch, 800);
    new MutationObserver(ms => ms.some(m => m.attributeName === "data-vos-look") ? requestAnimationFrame(now) : soon()).observe(tc, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "data-vos-look"] });   // (1.0.305: a window's own look too - 1.0.355: at once)
    new MutationObserver(soon).observe(b, { attributes: true, attributeFilter: ["class"] });
    soon();
  })();
})();
