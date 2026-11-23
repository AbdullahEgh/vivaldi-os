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

  // free room in the bar: the after-toolbar's Flexible Space takes whatever is
  // left between the dock and the right area
  const GAP = 8;
  function spare(tc) {
    const sp = $(":scope > .toolbar-tabbar-after > ." + SPACER, tc);
    return sp ? sp.getBoundingClientRect().width : null;
  }
  const overflowing = tc => tc.scrollWidth > tc.clientWidth + 1;

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
    // centered in the window when it fits; otherwise only as far right as the
    // free room allows, so the dock never runs into the right area / the buttons
    const dx = (bar.left + bar.right) / 2 - (left + right) / 2;
    let m = Math.max(0, Math.round(marginOf(first) + dx));
    const free = spare(tc);
    if (free != null) m = Math.min(m, Math.max(0, Math.round(marginOf(first) + free - GAP)));
    if (!first.hasAttribute("data-ft-dock")) first.setAttribute("data-ft-dock", "");
    if (Math.abs(m - marginOf(first)) >= 1) first.style.setProperty("margin-left", m + "px", "important");
    if (m > 0 && !(free != null && free > GAP) && overflowing(tc)) {   // the spacer was already 0: pull back by the overflow (with room in the spacer nothing can overflow: not measured again)
      m = Math.max(0, m - (tc.scrollWidth - tc.clientWidth) - GAP);
      first.style.setProperty("margin-left", m + "px", "important");
    }

    // still no room with the dock at its leftmost: a tight bar (CSS section 10)
    const lv = TIGHT.filter(a => b.hasAttribute(a)).length;
    if (m > 0 && lv === 0) return;                                  // (room to spare and not tight: nothing more to measure)
    const width = tc.clientWidth;
    if (m === 0 && overflowing(tc) && lv < TIGHT.length) {
      if (lv === 0 && window.vosFitDate?.()) { queue(); return; }  // the date got shorter: measured again
      tightNeed[lv] = tc.scrollWidth; b.setAttribute(TIGHT[lv], ""); queue();
    } else if (lv > 0 && width > tightNeed[lv - 1] + 16) {
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
    (window.vosBeat || (f => setInterval(() => { if (!document.hidden) f(); }, 2500)))(watch);   // a re-drawn tab bar is picked up within 2.5s
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
  const busy = new Set();
  async function brightness(src) {
    if (seen.has(src)) return seen.get(src);
    if (busy.has(src)) return undefined;
    busy.add(src);
    let v = null;
    try {                                            // (fetched: an <img> from chrome:// would lock the canvas)
      const blob = await (await fetch(src)).blob();
      if (/^text\//.test(blob.type)) { busy.delete(src); seen.set(src, "broken"); return "broken"; }   // a page, not a picture: no icon really
      const bmp = await createImageBitmap(blob);
      const N = 16, c = document.createElement("canvas"); c.width = c.height = N;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data; let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 120) { s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; }
      v = n > 12 ? s / n : null;                     // (almost nothing drawn: leave it)
    } catch (e) {}
    busy.delete(src); seen.set(src, v);
    return v;
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
      if (id && !favAsked.has(id)) { favAsked.add(id); try { chrome.tabs.get(id, x => { void chrome.runtime.lastError; favAsked.delete(id); const f = x?.favIconUrl || ""; if (/^(https?:|data:image)/.test(f) && favOf.get(id) !== f) { favOf.set(id, f); soon(); } }); } catch (e) { favAsked.delete(id); } }
      if (!src) { tab.removeAttribute("data-vos-plate"); continue; }
      const v = seen.get(src);
      if (v === undefined) { brightness(src).then(x => { if (x !== undefined) soon(); }); continue; }
      const want = typeof v !== "number" ? null : dark && v < 0.22 ? "light" : !dark && v > 0.86 ? "dark" : null;
      if (want) { if (tab.getAttribute("data-vos-plate") !== want) tab.setAttribute("data-vos-plate", want); }
      else if (tab.hasAttribute("data-vos-plate")) tab.removeAttribute("data-vos-plate");
    }
  }
  const soon = () => { if (!t) t = setTimeout(check, 250); };
  (function watch() {
    const tc = document.getElementById("tabs-container"), b = document.getElementById("browser");
    if (!tc || !b) return setTimeout(watch, 800);
    new MutationObserver(soon).observe(tc, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    new MutationObserver(soon).observe(b, { attributes: true, attributeFilter: ["class"] });
    soon();
  })();
})();
