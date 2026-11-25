/* REDUCE MOTION (the system's accessibility setting): every animation Bento OS starts is made instant (it still ends,
   so what waits for it goes on) - only while the setting is on */
(() => {
  if (window.__vosReduceMotion) return; window.__vosReduceMotion = true;
  let rm = null; try { rm = matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) {}
  const orig = Element.prototype.animate;
  if (!rm || !orig) return;
  Element.prototype.animate = function (kf, opts) {
    if (!rm.matches) return orig.call(this, kf, opts);
    const o = typeof opts === "number" ? { duration: opts } : { ...(opts || {}) };
    o.duration = Math.min(Number(o.duration) || 0, 1); o.delay = 0; if (!(o.iterations > 0 && o.iterations < Infinity)) o.iterations = 1; o.endDelay = 0;
    return orig.call(this, kf, o);
  };
})();
/* ONE HEARTBEAT for every mod: the checks that catch what no event tells (a rebuilt tab bar,
   a missed change) run together, every 2.5s, in the browser's idle time, never while hidden */
window.vosBeat = window.vosBeat || (() => {
  const jobs = new Set();
  const tick = () => {
    if (document.hidden || !jobs.size) return;
    const run = () => { for (const f of jobs) { try { f(); } catch (e) {} } };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 1200 }); else run();
  };
  setInterval(tick, 2500);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });   // back: catch up at once
  return f => { jobs.add(f); return () => jobs.delete(f); };
})();
/* ==========================================================================
   Vivaldi as an OS — Vivaldi JS mod
   Pages behave like macOS windows INSIDE Vivaldi.

   SPACES (like macOS)
     • Desktop    the Start Page wallpaper + ALL floating windows, from any tab
     • New Tab    the Start Page alone; the windows fade away and fade back
                  when you return to the desktop (plain CSS transitions)
     • Own space  a maximized page or a split view, as before
     Every new site (new tab or link) opens directly as a floating window.

   TRAFFIC LIGHTS (hover a page's top-left corner; in a floating window's
   title bar; icons appear on hover)
     red     Close     close the tab (you stay on the desktop)
     yellow  Minimize  the window flies into its tab icon; click the tab to
                       bring it back
     green   maximized page / split tile → float it on the desktop
             floating window             → back to its place
     grey ⤢  (right of the title bar) resolution: each click gives the site
             more room (100 → 85 → 70 → 55%, then back to 100%); the
             window keeps its size, only the page's scale changes

   FLOATING WINDOWS
     move: title bar (or the top edge) · double-click: FOCUS MODE (below)
     resize: any edge or corner · click a window: bring it to the front
     drag its tab into a split: it becomes a split tile
     untile a split: its pages go back to being floating windows
     drop a site onto a floating window: the window becomes a floating split;
       green makes the split full size and back to floating.
       Two grab levels: the title bar (top) moves the window, the strip on
       top of each tile (below it) moves the tile; drop a tile outside the
       window and it becomes its own floating window
     Places are relative to the Vivaldi window and survive a restart.

   SNAP (like Windows Aero Snap / macOS tiling): drag a window and bring the
     POINTER to the top edge of the desktop (or onto the tab bar) -> full screen;
     to the left or right edge -> Bento with the window on that half. Windows can be dragged partly
     off the desktop (100px stays on it, the top never goes above it). A frosted preview shows where it goes; leave the
     edge before letting go and nothing snaps. A full-screen page has a handle
     in the middle of its top edge: drag it down and the page floats again.

   BENTO (button in the tab bar, after Home): organizes the floating windows
     into a split tree - see "BENTO" below.

   FOCUS MODE
     Double-click a floating window's title bar (or, with the title bar
     hidden, the strip just above it): the window stays as it is, and the
     tab bar, the side panel and every other window go away. Double-click it
     again, click outside it, or switch to another tab - and everything
     comes back. Behind it, everything is blurred and slightly dimmed.
     (Back to its place: the green button.)

   TOUCH (Windows touch screens)
     Move, resize and the split dividers work with a finger (pointer events).
     Hidden buttons (a page's corner, a hidden title bar): the first tap shows
     them, the second tap presses one. Double tap a title bar = double-click (focus mode).
     While you use touch, buttons, edges and the title bar get bigger.

   Styling: Mac/07-split-view.css (sections 4 and 5).
   Installed by ../install-js-mods.sh (re-run after each Vivaldi update).
   ========================================================================== */
(() => {
  "use strict";

  const LOG = (...a) => console.log("%c[vivaldi-os]", "color:#8e8e93", ...a);
  const MIN_W = 260, MIN_H = 180, MARGIN = 12;
  const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  const DUR = 320;
  const EXT_KEY = "vivaldiOsFloat";                 // our key inside the tab's vivExtData
  const LOOK_KEY = "vivaldiOsLook";                 // 1.0.347: its app's own look (light / dark) - any app, in a split too

  /* ---------------- state, keyed by tab id (= the page's data-id) ---------------- */
  const floating = new Set();       // windows on the desktop
  const minimized = new Set();      // hidden windows / split tiles (tab stays in the tab bar)
  const minKind = new Map();        // id -> "float" | "tile" | "max" (what was minimized)
  const origin = new Map();         // id -> { tiled, group } where it was when floated
  const frac = {};                  // id -> {x,y,w,h} as fractions of the desktop
  const noTitle = new Set();        // floating windows with the title bar hidden
  let cover = null;                 // the window held to full view (over the tab bar and Vivaldi's buttons)
  const pip = [];                   // windows held small in the bottom-left corner, oldest first
  const PIP_PAGE = 0.75;           // a pinned app's page scale unless you change it (Ctrl + / -: kept for that pin)
  const PIP_K = 0.55, PIP_START_W = 300, PIP_GAP = 8;   // their size and the page's scale in them: 55% of the window (1:1), and the space between them
  const pipZoomWas = new Map();     // page id -> its scale before it was held small (given back after)
  const pipAspect = new Map();      // id -> its height / width (its own shape, kept at any width)
  let pipDrag = null;                               // { id, r, mid, side }: a pinned window held and moved
  let pipPrio = null;                               // the pinned window whose height you set last: it keeps it, the others give room
  /* a pinned window is a miniature of the window it was: its page at (pinned width / normal width) - the same layout,
     only smaller - so pinning and unpinning only zoom the same picture (nothing reflows half way); the scale you
     choose with its scale button while pinned wins */
  const pinZoomFor = id => {
    if (pipUserZoom.has(id)) return pipUserZoom.get(id);
    return PIP_PAGE;                                                  // 1.0.255: a set 75% (100% and five Ctrl - steps) - was its size's ratio (often ~50% or less: too small)
  };
  const pipOrder = new Map();                       // (a restart: each pinned window's place in its stack)
  const pinMem = new Map();                         // id -> where it was pinned last { c, w, h, o }: pinned again, it goes back there
  const cornerW = (c, except) => { const o = pip.find(p => p !== except && (pipCorner.get(p) || "bl")[1] === c[1] && pipW.has(p)); return o ? pipW.get(o) : null; };   // one width per side (both corners of it)
  function pipFit(id, c, w) {                       // this one at that corner's width, its own shape
    const W = Math.max(160, Math.round(w)), a = pipAspect.get(id) || (pipH.get(id) && pipW.get(id) ? pipH.get(id) / pipW.get(id) : 0.75);
    pipW.set(id, W); pipH.set(id, Math.max(100, Math.round(W * a)));
  }
  const pipUserZoom = new Map();    // id -> the scale you chose with its scale button while held small
  const pipCorner = new Map();      // id -> "bl" | "br" | "tl" | "tr"
  const pipW = new Map();           // id -> its width (55% of the window it was: its own shape)
  const pipH = new Map();           // id -> its own height
  let btnHeldAt = 0;                // a button was held: the click that follows is not a click
  let coverWas = null, coverTill = 0;
  const focusSet = new Set();       // windows in focus mode (sharp, above the blur); empty = no focus
  let focusLift = new Set();        // windows that were in focus: kept above the blur while it fades out
  let focusIgnore = null;
  const focusLeave = new Set();     // windows leaving the focus: they blur on top before going under
  const FOCUS_BLUR = "blur(22px) brightness(0.88)";           // { id, until }: a window just taken out of focus (its tab was clicked)
  const zoomOf = {};                // id -> page scale of a window scaled by hold-and-drag (1 = normal)
  const floatOnLoad = new Set();    // tabs opened from the desktop: float when a site shows
  const titles = new Map();         // id -> tab title
  let zOrder = [];                  // floating ids, back → front
  let onDesktop = false;            // was the desktop the last space shown?
  let myWindowId = null;            // only this window's tabs matter
  const siteReady = new Set();      // new tabs whose site URL is known (not the Start Page)
  const floatOnLoadAt = new Map();  // when a new tab was opened (entries expire)
  const sawStart = new Set();       // new tabs that showed the Start Page first
  const inSplit = new Set();        // pages seen as split tiles: they float again when untiled
  const groupFloat = new Set();     // floating windows that hold a whole split (id = one page of it)
  const groupMemory = new Map();    // a floating split made full size: anchor id -> its page ids
  const splitFocus = new Map();     // floating split -> its selected tile (for the title)
  let lastGroup = new Map();        // split page id -> its split, as of the last render
  const tabsQuery = q => new Promise(r => chrome.tabs.query(q, t => r(t || [])));

  /* ---------------- DOM helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const stack = () => $("#webpage-stack");
  /* MISSION CONTROL: while the desktops panel is open, the windows shrink into the space
     below it (none under it), so one is easy to drag onto another desktop */
  /* FAILSAFE: nothing the mod lays over Vivaldi can ever be left behind. A drag puts a
     cover over everything until you let go; if that release never arrives (touch, pen,
     switching apps mid-drag, an error), the next press, losing focus or the heartbeat
     ends the drag and takes the cover away (not focus changes: a page taking focus is normal) - Vivaldi can never look frozen. The desktops
     panel's backdrop goes too if the panel itself is gone. */
  function unstick(why) {
    for (const sh of document.querySelectorAll(".ft-shield")) { try { sh.__end?.(); } catch (e) {} sh.remove(); }
    for (const bk of document.querySelectorAll(".vos-ws-back")) if (!wsStrip || wsStrip.__back !== bk) bk.remove();
  }
  addEventListener("pointerdown", ev => { if (document.querySelector(".ft-shield")) unstick("press"); }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) unstick("hidden"); });
  setInterval(() => {                                   // a cover with no button held for 3s is stale
    if (document.hidden) return;
    for (const sh of document.querySelectorAll(".ft-shield")) {
      sh.__seen = (sh.__seen || 0) + 1;
      if (sh.__seen > 3 && !unstick.down) unstick("idle");
    }
    for (const bk of document.querySelectorAll(".vos-ws-back")) if (!wsStrip || wsStrip.__back !== bk) bk.remove();
  }, 1000);
  addEventListener("pointerdown", () => { unstick.down = true; }, true);
  addEventListener("pointerup", () => { unstick.down = false; }, true);
  addEventListener("pointercancel", () => { unstick.down = false; }, true);
  /* Vivaldi opens a blank Start Page on a desktop it thinks is empty (a window moved there a
     moment ago is not counted yet): with that page in front the window stays hidden. When a
     desktop with windows shows up with such a fresh blank page in front, its windows come
     forward and the blank page closes. */
  let lastWsShown;
  const startBorn = new Map();                         // tab -> when a Start Page tab was made
  function noBlankFront(again) {
    const a = activePage();
    if (!a) return;
    if (!isStart(a)) { if (!again) setTimeout(() => noBlankFront(true), 300); return; }
    const w = topWindow(null);
    if (!w) return;                                    // no window here: that page is the desktop
    const sid = a.dataset.id;
    if (Date.now() - (startBorn.get(sid) || 0) > 6000) return;      // only a page Vivaldi just made (your Home stays)
    if (handStart.has(sid)) return;                                  // made so the window could leave: it stays in front
    raise(w); activate(groupFloat.has(w) ? (splitFocus.get(w) || w) : w); render();
    setTimeout(() => chrome.tabs.remove(Number(sid), () => void chrome.runtime.lastError), 120);
  }
  const wsPending = new Map();                        // tab -> { ws, until }: sent to a desktop, not confirmed yet
  const handStart = new Set();                        // Start Pages opened on purpose: the desktop a window just left
  const pend = (ids, ws) => { const until = Date.now() + 2500; for (const i of ids) { wsPending.set(String(i), { ws, until }); wsOfTab.set(String(i), ws); } wsNowAt = 0; };
  const deskShown = new Map();                       // desktop -> the tab it showed last
  let underId = null;                                 // the full-screen page under the floating windows
  let liveMove = null;                                // { id, base } a window being moved (by a translate)
  function endLiveMove() {                            // the move is over: its real place, the translate gone
    if (!liveMove) return;
    const id = liveMove.id; liveMove = null;
    const el = targetOf(pageOf(id)), f = frames.get(id);
    el?.style.removeProperty("translate"); f?.style.removeProperty("translate");
    if (el && floating.has(id)) { const ss = stackRect(); place(el, pxRect(id, ss), ss); placeFrame(id, el, pxRect(id, ss), ss); }
  }
  let mission = null, missionDrag = null, missionSkip = null;   // { k, ox, oy } / { id, r } picked up there / held from the top edge (full size)
  const mr = r => mission ? { x: mission.ox + r.x * mission.k, y: mission.oy + r.y * mission.k, w: r.w * mission.k, h: r.h * mission.k } : r;
  /* Mission Control lays the windows out side by side (none over another), in the space
     below the panel, roughly where they are (top-left first); each keeps its own shape */
  function missionSlots(list, s) {
    const slots = new Map();
    if (!mission || !list.length) return slots;
    const PAD = 24, GAP = 28, top = mission.oy, aw = s.width - 2 * PAD, ah = s.height - top - PAD;
    const all = list.map(({ id, r }) => ({ id, r: r || pxRect(id, s) }));
    // grouped by where they are: the pinned windows of the left side at the left, of the right side at the right
    // (each side one column, close together), every other window in the middle - none over another
    const sideOf = it => pip.includes(it.id) ? (pipCorner.get(it.id) || "bl")[1] : "m";
    const L = all.filter(it => sideOf(it) === "l").sort((a, b) => a.r.y - b.r.y), R = all.filter(it => sideOf(it) === "r").sort((a, b) => a.r.y - b.r.y);
    const M = all.filter(it => sideOf(it) === "m");
    const SW = Math.round(aw * 0.2);                                 // a side's column
    const column = (items, x) => {                                   // one above the other, as a block in the middle of the height
      if (!items.length) return;
      const ch = (ah - GAP * (items.length - 1)) / items.length;
      const ks = items.map(it => Math.min(0.85, SW / it.r.w, ch / it.r.h));
      const total = items.reduce((t, it, i) => t + it.r.h * ks[i], 0) + GAP * (items.length - 1);
      let y = top + Math.max(0, (ah - total) / 2);
      items.forEach((it, i) => { const k = ks[i], w = it.r.w * k, h = it.r.h * k; slots.set(it.id, { k, r: it.r, x: x + (SW - w) / 2, y }); y += h + GAP; });
    };
    column(L, PAD);
    column(R, PAD + aw - SW);
    if (!M.length) return slots;
    const mx = PAD + (L.length ? SW + GAP : 0), mw = aw - (L.length ? SW + GAP : 0) - (R.length ? SW + GAP : 0);
    const items = M.sort((a, b) => (a.r.y + a.r.h / 2) - (b.r.y + b.r.h / 2) || a.r.x - b.r.x);
    const n = items.length;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {                         // the grid that shows them largest
      const rows = Math.ceil(n / cols), cw = (mw - GAP * (cols - 1)) / cols, ch = (ah - GAP * (rows - 1)) / rows;
      if (cw <= 0 || ch <= 0) continue;
      const k = Math.min(...items.map(it => Math.min(cw / it.r.w, ch / it.r.h)));
      if (!best || k > best.k) best = { cols, rows, cw, ch, k };
    }
    if (!best) return slots;
    const { cols, rows, cw, ch } = best;
    // rows top to bottom, and in each row left to right
    for (let row = 0; row < rows; row++) {
      const part = items.slice(row * cols, row * cols + cols).sort((a, b) => a.r.x - b.r.x);
      const off = (cols - part.length) * (cw + GAP) / 2;            // a shorter last row is centred
      part.forEach((it, c) => {
        const k = Math.min(0.85, cw / it.r.w, ch / it.r.h), w = it.r.w * k, h = it.r.h * k;
        slots.set(it.id, { k, r: it.r, x: mx + off + c * (cw + GAP) + (cw - w) / 2, y: top + row * (ch + GAP) + (ch - h) / 2 });
      });
    }
    return slots;
  }
  const browserEl = () => $("#browser");
  const pageOf = id => (id == null ? null : $(`#webpage-stack .webpageview[data-id="${CSS.escape(String(id))}"]`));
  const isTiled = page => !!page?.classList.contains("tiled");
  const isStart = page => !!page?.querySelector(".startpage");
  const tileOf = page => page?.closest(".tile");
  function rootOf(page) {                           // the outermost split container of a page
    let root = null;
    for (let p = page?.parentElement; p && p.id !== "webpage-stack"; p = p.parentElement) {
      if (p.classList.contains("tiled") && !p.classList.contains("webpageview")) root = p;
    }
    return root;
  }
  const targetOf = page => {                        // the element that moves
    if (!page) return null;
    if (!isTiled(page)) return page;
    if (groupFloat.has(page.dataset.id)) return rootOf(page) || tileOf(page);   // a floating split
    return tileOf(page);
  };
  const membersOf = page => { const r = rootOf(page); return r ? $$(".webpageview[data-id]", r).map(e => e.dataset.id) : []; };
  /* A SPLIT NOT DRAWN: Vivaldi draws a split only on the desktop shown - on the others (and for a moment when you
     come back, and while you swipe) its pages are separate pages. The window stays one: its panes are laid out
     here, in Vivaldi's own order and layout (its tab data), until Vivaldi draws the split again. */
  function vSplit(id) {
    if (!groupFloat.has(id)) return null;
    const page = pageOf(id), g = splitOfTab.get(String(id));
    if (!page || isTiled(page) || !g) return null;
    const ids = [...splitOfTab].filter(([k, v]) => v === g).map(([k]) => k).sort((x, y) => (tileMeta.get(x)?.index || 0) - (tileMeta.get(y)?.index || 0));
    const pages = ids.map(k => pageOf(k)).filter(p => p && !isTiled(p) && (p.dataset.id === String(id) || !floating.has(p.dataset.id)));
    if (pages.length < 2) return null;
    return { pages, layout: tileMeta.get(String(id))?.layout || "row" };
  }
  const vsSince = new Map(), vsFixAt = new Map(), vsShells = new Map();
  async function vsRetile(id) {
    const v = vSplit(id), api = vivTile();
    if (!v || !api) return;
    await syncTiling();
    const g = splitOfTab.get(String(id)), all = [...splitOfTab].filter(([k, x]) => x === g).map(([k]) => k);
    if (!g || v.pages.length !== all.length) { vsFixAt.delete(id); return; }   // every pane there first (one left out would leave the split)
    // the same split, told to Vivaldi again (its own message, its own id): it draws it - nothing made anew, nothing moved
    if (api.dispatch && api.store.getTiles) {
      try {
        const wid = await winId(), pages = api.store.getTiles(wid, g), tree = await treeOf(g, all);
        if (pages && pages.size === all.length && tree && api.setLayout) {
          const uncover = coverPanes(wsOfTab.get(String(id)));       // (its panes held by their photos while Vivaldi draws it)
          setTimeout(() => uncover(), 0);
          api.dispatch({ actionType: "PAGE_TILE_PAGES", windowId: wid, pages, id: g });
          api.setLayout(wid, tree, g);                                // (that message clears the split's layout first: its own tree, put straight back)
          queueRender(); return;
        }
      } catch (e) { LOG("split shown again", e); }
    }
    try {
      const nums = v.pages.map(p => Number(p.dataset.id)), wid = await winId();
      const list = api.store.getPages(wid)?.filter?.(pg => nums.includes(pg.id))?.sortBy?.(pg => nums.indexOf(pg.id));
      if (!list || list.size !== nums.length) return;
      dropInfo = { target: String(id), dragged: null, src: String(id), kind: "window", t: Date.now() };   // the window keeps its place
      const tree = tileTrees[splitOfTab.get(String(id))];
      const sorted = list.sortBy(pg => tileMeta.get(String(pg.id))?.index ?? 0);   // (in its own order: the tree's numbers stay right)
      const nid = await api.tile(sorted, v.layout);
      if (tree && nid && api.setLayout) { api.setLayout(await winId(), tree, nid); setTimeout(readTiling, 300); }   // as it was: nested, its sizes
      queueRender();
    } catch (e) { LOG("split again", e); }
  }
  function splitParts(id, ss) {                    // the panes of the split a tab is in, where they are on the screen (a desktop's preview)
    const pg = pageOf(id);
    if (pg && isTiled(pg)) {
      const r0 = stackRect(), out = membersOf(pg).map(m => { const r = pageOf(m)?.getBoundingClientRect(); return r && r.width > 4 ? { id: m, r: { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height } } : null; }).filter(Boolean);
      if (out.length > 1) return out;
    }
    const g = splitOfTab.get(String(id));                          // not drawn (another desktop): Vivaldi's own order and layout
    if (!g) return null;
    const ids = [...splitOfTab].filter(([k, v]) => v === g).map(([k]) => k).sort((x, y) => (tileMeta.get(x)?.index || 0) - (tileMeta.get(y)?.index || 0));
    if (ids.length < 2) return null;
    const tb = splitBoxes(g, { x: 6, y: 6, w: ss.width - 12, h: ss.height - 12 }, 6);
    if (tb) return tb;
    const row = (tileMeta.get(String(id))?.layout || "row") !== "column", n = ids.length, G = 6;
    const each = ((row ? ss.width : ss.height) - G * (n + 1)) / n;
    return ids.map((m, i) => ({ id: m, r: row ? { x: G + i * (each + G), y: G, w: each, h: ss.height - 2 * G } : { x: G, y: G + i * (each + G), w: ss.width - 2 * G, h: each } }));
  }
  const winEls = id => { const v = vSplit(id); return v ? [vsShells.get(id), ...v.pages].filter(Boolean) : [targetOf(pageOf(id))]; };   // what shows a window: its element - or a split's pages not drawn
  /* the window a tab belongs to: itself, or the floating split it is part of */
  function winOf(id) {
    if (id == null) return null;
    id = String(id);
    if (floating.has(id) || minimized.has(id)) return id;
    const page = pageOf(id);
    if (!isTiled(page)) {                            // a split not drawn (another desktop, a swipe, just back): still its window
      const g = page && splitOfTab.get(id);
      if (g) for (const a of groupFloat) if (floating.has(a) && splitOfTab.get(a) === g && !isTiled(pageOf(a))) return a;
      return null;
    }
    const r = rootOf(page);
    for (const a of groupFloat) if (floating.has(a) && r && rootOf(pageOf(a)) === r) return a;
    return null;
  }
  const siblingOf = tile => tile && [...tile.parentElement.children].find(c => c !== tile && c.classList.contains("tile"));
  const activePage = () => $("#webpage-stack .webpageview.active.visible") || $("#webpage-stack .webpageview.active");
  const tabIdOf = id => { const n = Number(id); return Number.isFinite(n) && n > 0 ? n : null; };
  const raisedAt = new Map();                      // window -> when it last came to the front
  let focusInAt = 0;                                // when the keyboard focus last went into a window (a click there)
  const raise = id => { zOrder = zOrder.filter(z => z !== id); zOrder.push(id); raisedAt.set(id, Date.now()); };
  const vivaldiClose = page => { const b = $$(".mosaic-tile .controls > button", page); return b[b.length - 1]; };
  const topWindow = except => [...zOrder].reverse().find(z => z !== except && floating.has(z) && !minimized.has(z) && pageOf(z) && !awayWs(z));

  function groupOf(page) {                          // ids of all pages in its top-level split
    const root = rootOf(page);
    return root ? $$(".webpageview[data-id]", root).map(e => e.dataset.id).sort().join(",") : "";
  }

  /* tabs of one split share a pill in the tab bar: data-ft-pill = first / mid /
     last on their .tab-position (CSS draws one long background behind them).
     A split's tabs that are not side by side are moved next to each other. */
  const movedFor = new Set();
  // the split each tab belongs to, from Vivaldi's own tab data (steady, unlike
  // the page layout, which changes for a moment while windows switch)
  const splitOfTab = new Map();                                          // tab id -> split id ("" = solo)
  let tilingRead = false, tilingTimer = 0, tilingAt = 0;   // tilingAt: when a split last changed (Vivaldi's tab data)
  const extCache = new Map();                       // tab id -> { raw, x }: vivExtData parsed once per change
  const extOf = tab => {
    const raw = tab.vivExtData;
    if (typeof raw !== "string") return raw;
    const k = String(tab.id), c = extCache.get(k);
    if (c && c.raw === raw) return c.x;
    let x = null;
    try { x = JSON.parse(raw || "{}"); } catch (e) {}
    extCache.set(k, { raw, x });
    return x;
  };
  const tilingOfTab = tab => {
    const x = extOf(tab);
    return x?.tiling?.id ? String(x.tiling.id) : "";
  };
  const perf = { render: [0, 0], markPills: [0, 0] };              // (how often the drawing runs, and how long: Q.perf)
  const tileMeta = new Map();                       // tab id -> { index, layout } in its split (Vivaldi's tab data)
  let tileTrees = {};                               // split id -> its tree (the window's own data)
  const readTrees = () => new Promise(r => chrome.windows.getCurrent(w => { void chrome.runtime.lastError; try { tileTrees = JSON.parse(w?.vivExtData || "{}").tiles || {}; } catch (e) {} r(tileTrees); }));
  /* Vivaldi's split data, read now (not the last copy): each tab's split and place in it, and the window's trees */
  function syncTiling() {
    return new Promise(res => chrome.tabs.query({ currentWindow: true }, tabs => {
      void chrome.runtime.lastError;
      for (const t of tabs || []) {
        const k = String(t.id), g = tilingOfTab(t), ti = extOf(t)?.tiling;
        if (splitOfTab.get(k) !== g) { splitOfTab.set(k, g); tilingAt = Date.now(); }
        if (ti?.id) tileMeta.set(k, { index: Number(ti.index) || 0, layout: ti.layout === "column" ? "column" : "row" }); else tileMeta.delete(k);
      }
      readTrees().then(() => res());
    }));
  }
  const leavesOf = (n, out = []) => { if (typeof n === "number") out.push(n); else if (n) { leavesOf(n.first, out); leavesOf(n.second, out); } return out; };
  async function treeOf(g, ids) {                   // a split's tree: Vivaldi's own (read now) - only one that holds exactly its panes -, or the flat one it makes
    const idx = ids.map(k => tileMeta.get(String(k))?.index).filter(i => i != null).sort((x, y) => x - y);
    const fits = t => { const l = leavesOf(t).sort((x, y) => x - y); return !!t && l.length === idx.length && l.every((v, i) => v === idx[i]); };
    if (!fits(tileTrees[g])) await readTrees();
    if (fits(tileTrees[g])) return tileTrees[g];
    if (idx.length < 2) return null;
    const dir = (tileMeta.get(String(ids[0]))?.layout || "row") === "column" ? "column" : "row";
    const build = i => i === idx.length - 1 ? idx[i] : { direction: dir, first: idx[i], second: build(i + 1), splitPercentage: 100 / (idx.length - i) };
    return build(0);
  }
  /* a split's tree laid out in a box: pane index -> its rect (gap g between panes; sizes as Vivaldi keeps them) */
  function treeRects(node, box, g, out = new Map()) {
    if (node == null) return out;
    if (typeof node === "number") { out.set(node, box); return out; }
    const row = node.direction !== "column", pct = Math.max(5, Math.min(95, node.splitPercentage ?? 50)) / 100;
    const size = (row ? box.w : box.h) - g, a = size * pct;
    const A = row ? { x: box.x, y: box.y, w: a, h: box.h } : { x: box.x, y: box.y, w: box.w, h: a };
    const B = row ? { x: box.x + a + g, y: box.y, w: size - a, h: box.h } : { x: box.x, y: box.y + a + g, w: box.w, h: size - a };
    treeRects(node.first, A, g, out); treeRects(node.second, B, g, out);
    return out;
  }
  /* the panes of split g, by its tree (null: no tree known) - [{ id, r }] in a box */
  function splitBoxes(g, box, gap) {
    const tree = tileTrees[g];
    if (!tree) return null;
    const byIndex = new Map([...splitOfTab].filter(([k, v]) => v === g).map(([k]) => [tileMeta.get(k)?.index, k]));
    const out = [];
    for (const [i, r] of treeRects(tree, box, gap)) if (byIndex.has(i)) out.push({ id: byIndex.get(i), r });
    return out.length === byIndex.size && out.length > 1 ? out : null;
  }
  /* workspaces: the desktop shows only the windows of the current workspace */
  const wsOfTab = new Map();                        // tab id -> its workspace (null: none)
  const panelTabs = new Set();                        // tabs that are a side panel's page (never windows)
  /* the workspace shown: the one of the tabs in the tab bar (Vivaldi only lists
     the current workspace's tabs there) - not the active tab's, which is wrong
     for a moment after a tab is moved to another workspace */
  let wsNow, wsNowAt = 0;
  function curWs() {
    const t = performance.now();
    if (t - wsNowAt < 40) return wsNow;
    wsNowAt = t;
    { const v = vivActiveWs(); if (v !== undefined) return (wsNow = v); }   // Vivaldi's own (also for a desktop with no tab)
    const counts = new Map();
    for (const w of document.querySelectorAll("#tabs-container .tab-strip .tab-wrapper[id^='tab-']")) {
      const k = w.id.slice(4);
      if (!wsOfTab.has(k)) continue;
      const pd = wsPending.get(k);
      if (pd && pd.until > Date.now()) continue;                     // on its way to another desktop, still in this tab bar
      const v = wsOfTab.get(k); counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size) wsNow = [...counts].sort((x, y) => y[1] - x[1])[0][0];
    else { const a = activePage()?.dataset.id; wsNow = a != null && wsOfTab.has(String(a)) ? wsOfTab.get(String(a)) : undefined; }
    return wsNow;
  }
  function awayWs(id) {                             // a window of another workspace?
    const c = curWs();
    if (c === undefined || !wsOfTab.has(String(id))) return false;
    return wsOfTab.get(String(id)) !== c;
  }
  function readTiling() {
    clearTimeout(tilingTimer);
    tilingTimer = setTimeout(() => {
      chrome.tabs.query({ currentWindow: true }, tabs => {
        if (chrome.runtime.lastError || !tabs) return;
        let changed = !tilingRead;
        const live = new Set();
        let wsChanged = false;
        for (const t of tabs) {
          const k = String(t.id), g = tilingOfTab(t);
          live.add(k);
          if (splitOfTab.get(k) !== g) { splitOfTab.set(k, g); changed = true; tilingAt = Date.now(); }
          { const ti = extOf(t)?.tiling; if (ti?.id) tileMeta.set(k, { index: Number(ti.index) || 0, layout: ti.layout === "column" ? "column" : "row" }); else tileMeta.delete(k); }
          if (extOf(t)?.panelId != null) {                              // a side panel's page (web panel, extension panel): not a window
            panelTabs.add(k);
            if (floating.has(k)) { forget(k); wsChanged = true; }
            if (wsOfTab.delete(k)) wsChanged = true;
            continue;
          }
          let w = extOf(t)?.workspaceId ?? null;
          const pd = wsPending.get(k);                                 // just moved: Vivaldi may not say so yet
          if (pd) { if (sameWs(w, pd.ws) || Date.now() > pd.until) wsPending.delete(k); else w = pd.ws; }
          if (wsOfTab.get(k) !== w) { wsOfTab.set(k, w); wsChanged = true; wsNowAt = 0; }
          // a Start Page is the desktop, never a window (one that became a window by mistake)
          if (floating.has(k) && !groupFloat.has(k) && /^chrome:\/\/vivaldi-webui\/startpage/.test(t.url || t.pendingUrl || "")) { forget(k); wsChanged = true; }
        }
        for (const k of [...wsOfTab.keys()]) if (!live.has(k)) wsOfTab.delete(k);
        for (const k of [...panelTabs]) if (!live.has(k)) panelTabs.delete(k);
        for (const k of [...extCache.keys()]) if (!live.has(k)) extCache.delete(k);
        if (wsChanged) queueRender();
        for (const k of [...splitOfTab.keys()]) if (!live.has(k)) { splitOfTab.delete(k); changed = true; }
        for (const m of [tileMeta, lookWins, raisedAt, startBorn, roomPrev, pinMem]) for (const k of [...m.keys()]) if (!live.has(String(k))) m.delete(k);   // 1.0.340: closed tabs
        for (const k of [...roomOn]) if (!live.has(String(k))) roomOn.delete(k);
        for (const k of Object.keys(pageZoom)) if (!live.has(k)) delete pageZoom[k];
        tilingRead = true;
        readTrees();
        if (changed) markPills();
      });
    }, 30);
  }
  // Vivaldi re-draws the tabs (or the whole tab bar, e.g. going full screen):
  // mark them again on the next frame
  let pillQueued = false;
  function queuePills() {
    if (pillQueued) return;
    pillQueued = true;
    requestAnimationFrame(() => { pillQueued = false; markPills(); });
  }
  let pillWatch = false;
  function watchPills() {
    if (pillWatch) return;
    const b = $("#browser");
    if (!b) return;
    pillWatch = true;
    new MutationObserver(muts => {
      for (const m of muts)                                          // Vivaldi's address-bar popups (a site's permission, passwords)
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const pop = n.matches?.(".addressfield-popup-container") ? n : n.querySelector?.(".addressfield-popup-container");
          if (pop) placePopup(pop);
        }
      for (const m of muts) {
        if (!m.addedNodes.length) continue;
        const t = m.target;
        if (t.nodeType === 1 && (t.closest(".tab-position, #webpage-stack, .UrlBar-AddressField"))) continue;
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches?.(".tab-position, .tab-strip, #tabs-container, #tabs-tabbar-container, .tabbar-wrapper, #footer, #header") ||
                                   n.querySelector?.(".tab-position"))) return queuePills();
        }
      }
    }).observe(b, { childList: true, subtree: true });
    addEventListener("resize", queuePills);
    vosBeat(markPills);                                              // a backstop (the watcher catches changes)
  }
  /* an address-bar popup (a site asks for the clipboard, a password to save...) opens
     under the address field, where its button is - not in the top-left corner */
  /* Vivaldi's address-bar popups (save the password, a site's permissions...): under the address field, and always
     whole on the screen - fitted again while the popup grows to its real size and finishes its own opening animation
     (measured then: a popup measured mid-animation, or before its content, landed partly off the screen) */
  function placePopup(p) {
    if (p.__vosPop) return; p.__vosPop = true;
    p.setAttribute("data-vos-pop", "");
    let cx = 0, cy = 0;
    const set = (x, y) => { cx = Math.round(x); cy = Math.round(y); p.style.setProperty("--vos-pop-x", cx + "px"); p.style.setProperty("--vos-pop-y", cy + "px"); };
    const target = r => {                                            // where it should be, for its size now
      const af = document.querySelector("#browser .UrlBar-AddressField"), ar = af?.getBoundingClientRect();
      const w = r.width || p.offsetWidth || 320, h = r.height || p.offsetHeight || 160, M = 8;
      let tx, ty;
      if (ar && ar.width) {
        tx = ar.left;
        ty = ar.top > innerHeight / 2 ? ar.top - h - 6 : ar.bottom + 6;   // the tab bar at the bottom: above it
      } else { tx = (innerWidth - w) / 2; ty = 48; }
      tx = Math.max(M, Math.min(tx, innerWidth - w - M));             // whole on the screen
      ty = Math.max(M, Math.min(ty, innerHeight - h - M));
      return { tx, ty };
    };
    const box = () => {                                              // what is seen: the popup, or its card when the popup is only a holder
      let r = p.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) for (const c of p.children) { const q = c.getBoundingClientRect(); if (q.width * q.height > r.width * r.height) r = q; }
      return r;
    };
    const fit = () => {
      if (!p.isConnected) return;
      const r = box(), { tx, ty } = target(r);
      if (Math.abs(tx - r.left) > 1 || Math.abs(ty - r.top) > 1) set(cx + (tx - r.left), cy + (ty - r.top));   // (inside a box that moves it: the difference made up)
    };
    { const { tx, ty } = target({ width: 0, height: 0 }); set(tx, ty); }
    const t0 = performance.now();
    const loop = () => { fit(); if (p.isConnected && performance.now() - t0 < 900) requestAnimationFrame(loop); };   // through its opening animation
    requestAnimationFrame(loop);
    try { const ro = new ResizeObserver(() => fit()); ro.observe(p); setTimeout(() => ro.disconnect(), 4000); } catch (e) {}
    setTimeout(fit, 1200);
  }
  const tiledSeen = new Map();                                       // tab id -> { on, at }
  let pillRecheck = 0;
  let wsSeen;
  function markPills() { const t = performance.now(); try { return markPillsNow(); } finally { perf.markPills[0]++; perf.markPills[1] += performance.now() - t; } }
  function markPillsNow() {
    watchPills();
    wsNowAt = 0;                                     // the tab bar changed: is it another workspace now?
    if (curWs() !== wsSeen) { wsSeen = wsNow; queueRender(); }
    const tps = $$("#tabs-container .tab-strip .tab-position");
    const ids = new Map(tps.map(tp => [tp, (tp.querySelector(".tab-wrapper[id^='tab-']")?.id || "").slice(4)]));
    const idOf = tp => ids.get(tp);
    // a tab is in a pill only while its page is really tiled. Vivaldi can keep
    // an old split id on tabs that are no longer tiled (e.g. after a restart),
    // and a tiled page looks un-tiled for a moment while windows switch, so a
    // page counts as tiled until it has looked un-tiled for 1.5s
    const now = Date.now();
    let recheck = false;
    const grp = tps.map(tp => {
      const id = idOf(tp);
      const pg = pageOf(id);
      const st = tiledSeen.get(id) || { on: false, at: 0 };
      if (pg && pg.classList.contains("tiled")) { st.on = true; st.at = now; }
      else if (pg && st.on && now - st.at >= 1500) st.on = false;
      else if (pg && st.on) recheck = true;
      tiledSeen.set(id, st);                                        // no page drawn: keep the last answer
      if (!st.on) return "";
      // what you see decides: tiles in one floating split window share a pill;
      // a tile floating as its own window is a solo app
      const w = winOf(id);
      if (w && groupFloat.has(w)) return "w:" + w;
      if (w) return "";
      if (tilingRead && splitOfTab.get(id)) return splitOfTab.get(id);
      return pg && pg.classList.contains("tiled") ? groupOf(pg) : "";
    });
    if (recheck) { clearTimeout(pillRecheck); pillRecheck = setTimeout(markPills, 1600); }
    { const live = new Set(ids.values()); for (const k of [...tiledSeen.keys()]) if (!live.has(k)) tiledSeen.delete(k); }
    const seen = new Map();                                          // group -> positions in the bar
    grp.forEach((g, i) => { if (g) (seen.get(g) || seen.set(g, []).get(g)).push(i); });
    for (const [g, at] of seen) {                                    // not side by side: gather them
      if (at.length < 2 || at[at.length - 1] - at[0] === at.length - 1 || movedFor.has(g)) continue;
      movedFor.add(g);
      setTimeout(() => movedFor.delete(g), 3000);
      const ids = at.map(i => tabIdOf(idOf(tps[i]))).filter(Boolean);
      if (ids.length < 2) continue;
      chrome.tabs.get(ids[0], first => {
        if (chrome.runtime.lastError || !first || first.pinned) return;
        chrome.tabs.move(ids.slice(1), { index: first.index + 1 }, () => void chrome.runtime.lastError);
      });
    }
    tps.forEach((tp, i) => {
      const g = grp[i];
      const prev = g && grp[i - 1] === g, next = g && grp[i + 1] === g;
      const role = prev && next ? "mid" : next ? "first" : prev ? "last" : null;
      if (role) { if (tp.getAttribute("data-ft-pill") !== role) tp.setAttribute("data-ft-pill", role); }
      else if (tp.hasAttribute("data-ft-pill")) tp.removeAttribute("data-ft-pill");
    });
  }

  /* the tab we just asked Vivaldi to activate, until the switch lands */
  let pendingActive = null, pendingTimer = 0;
  let holdDesktop = null;           // a minimized window's tab made active only to keep the desktop up
  /* the tab the user chose (click, tab bar, keyboard). Hovering a window makes
     its tab active so it scrolls, but the tab bar and the address keep showing
     the chosen one. */
  let selected = null;
  /* window.__ftQuietTint (read by favicon-accent.js): a tab made active only by
     hovering its window, which must not recolor the tab bar until it is clicked */
  function confirmTint(id) {
    const was = window.__ftQuietTint;
    if (was == null) return;
    window.__ftQuietTint = null;
    if (was === String(id)) window.dispatchEvent(new Event("ft-tint"));   // recolor now
  }
  let wantActive = null, closingPip = null, restoreGuard = null;
  function activate(id, opts) {
    const t = tabIdOf(id);
    if (opts?.quiet) window.__ftQuietTint = String(id);
    else { confirmTint(id); selected = String(id); queueRender(); }   // the name and tab marks follow the choice
    if (!t || activePage()?.dataset.id === String(id)) return;     // already active: no event comes back
    wantActive = { id: String(id), at: Date.now() };                 // the latest switch asked for (older reports are stale)
    pendingActive = String(id);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingActive = null; queueRender(); }, 1500);
    chrome.tabs.update(t, { active: true }, () => void chrome.runtime.lastError);
  }

  /* focus mode: double-click a title bar. The windows in focus stay sharp and
     where they are; everything else (wallpaper, other windows, the panel) is
     blurred and slightly dimmed. The tab bar
     stays sharp: a click on a window's tab icon adds it to the focus, another
     click takes it out. Double-click a title bar or click the blur: it ends. */
  function toggleFocus(pageId) {
    if (focusSet.size) return endFocus();
    const id = winOf(pageId);
    if (!id || !floating.has(id) || minimized.has(id)) return;
    focusSet.add(id); raise(id); activate(String(pageId));
    focusSeenWin = id;
    focusQuietUntil = Date.now() + 400;                              // its own activation is landing: not another choice
    render();
  }
  function endFocus() {
    if (!focusSet.size) return;
    focusSet.clear();
    render();
  }
  function focusTab(tabId) {                       // in focus mode, a click on a tab icon
    const w = winOf(tabId);
    if (!w || !floating.has(w)) return false;      // not a window (Start Page, a full-size page): focus ends
    if (minimized.has(w)) { restore(w); setTimeout(() => focusJoin(w), 80); return true; }
    if (!focusSet.has(w)) { focusJoin(w); return true; }
    if (focusSet.size === 1) { endFocus(); return true; }
    focusSet.delete(w);
    render();
    return true;
  }
  function focusJoin(w) { focusSet.add(w); raise(w); render(); }
  let focusSeenWin = null;                          // the active window when focus last looked
  let swallowTab = 0;                               // a tab click used by focus mode: Vivaldi never sees it
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "dragstart"])
    document.addEventListener(type, ev => {
      if (Date.now() - swallowTab < 700 && tabIdAt(ev.target)) { ev.preventDefault(); ev.stopPropagation(); }
    }, true);

  /* the veil: over the desktop, just under the windows in focus. It blurs and
     dims what is behind it. A click on it ends focus. */
  let veil = null;
  function veilFor(on, s) {
    if (!on) {
      if (veil && !veil.__leaving) {
        const v = veil; veil = null; v.__leaving = true;
        if (!lpOverlay()) thawUnder();                               // the pages draw again while the veil fades
        v.style.setProperty("pointer-events", "none", "important");
        v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" })
          .finished.catch(() => {}).then(() => { v.remove(); focusLift = new Set(); queueRender(); });
      }
      return;
    }
    const host = stack();
    if (!host) return;
    const fresh = !veil;
    if (fresh) { veil = document.createElement("div"); veil.className = "ft-veil"; }
    if (veil.parentElement !== host) host.appendChild(veil);
    place(veil, { x: 0, y: 0, w: s.width, h: s.height }, s, fixedOrigin(host));
    setStyle(veil, "z-index", "999");
    if (fresh) { veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" }); if (!lpOverlay()) freezeUnder(); }
  }

  /* leave the desktop instantly (no fade of the other windows) for a moment */
  let quietTimer = 0;
  function quiet() {
    browserEl()?.setAttribute("data-ft-quiet", "");
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => browserEl()?.removeAttribute("data-ft-quiet"), 500);
  }

  /* ---------------- persistence: stored on the tab (survives restarts) ---------------- */
  const persistTimers = new Map();
  function persist(id) {
    const t = tabIdOf(id);
    if (!t) return;
    clearTimeout(persistTimers.get(id));
    persistTimers.set(id, setTimeout(() => {
      persistTimers.delete(id);
      chrome.tabs.get(t, tab => {
        if (chrome.runtime.lastError || !tab) return;
        let ext;
        try { ext = JSON.parse(tab.vivExtData || "{}") || {}; } catch { return; } // never clobber unreadable data
        const pc = pip.includes(id) ? (pipCorner.get(id) || "bl") : null;
        const want = floating.has(id) ? { r: frac[id] || bento.pre[id], nt: noTitle.has(id), g: groupFloat.has(id) || undefined,
                                          z: zoomOf[id] ? +zoomOf[id].toFixed(3) : undefined,
                                          h: pc ? { c: pc, h: Math.round(pipH.get(id) || 240), w: Math.round(pipW.get(id) || 360), o: pip.indexOf(id),
                                                    z: pipUserZoom.has(id) ? +pipUserZoom.get(id).toFixed(3) : undefined, b: pipZoomWas.has(id) ? +Number(pipZoomWas.get(id)).toFixed(3) : undefined } : undefined,   // pinned: its corner, size, place in the stack, page scale
                                          m: minimized.has(id) && minKind.get(id) === "float" ? 1 : undefined,   // minimized: so again after a restart
                                          dk: lookWins.get(id) || undefined,   // 1.0.273: its own look ("light" / "dark")
                                          lp: !pc && pinMem.has(id) ? pinMem.get(id) : undefined,   // where it was pinned last (pinned again: there)
 } : undefined;
        const lk = lookWins.get(id) || undefined;                       // 1.0.347: its app's own look, on its own tab (a split's apps: each its own)
        if (JSON.stringify(ext[EXT_KEY]) === JSON.stringify(want) && ext[LOOK_KEY] === lk) return;
        if (want) ext[EXT_KEY] = want; else delete ext[EXT_KEY];
        if (lk) ext[LOOK_KEY] = lk; else delete ext[LOOK_KEY];
        chrome.tabs.update(t, { vivExtData: JSON.stringify(ext) }, () => void chrome.runtime.lastError);
      });
    }, 400));
  }
  function clearStored(id, done) {                  // remove our key from the tab right away
    const t = tabIdOf(id);
    if (!t) return done();
    clearTimeout(persistTimers.get(id));
    chrome.tabs.get(t, tab => {
      if (chrome.runtime.lastError || !tab) return done();
      let ext;
      try { ext = JSON.parse(tab.vivExtData || "{}") || {}; } catch { return done(); }
      if (!(EXT_KEY in ext)) return done();
      delete ext[EXT_KEY];
      chrome.tabs.update(t, { vivExtData: JSON.stringify(ext) }, () => done());
    });
  }
  function restoreSession() {
    chrome.tabs.query({ currentWindow: true }, tabs => {
      let any = false;
      // Vivaldi brings splits back by itself: a tile of a split whose window
      // is saved on another tile of it stays in that split (an old saved
      // window of its own is stale and is cleared)
      const ext = tab => { try { return JSON.parse(tab.vivExtData || "{}") || {}; } catch { return {}; } };
      const splitHome = new Map();                                  // split id -> its window tab
      for (const tab of tabs || []) {
        const x = ext(tab);
        if (x.tiling?.id && x[EXT_KEY]?.g) splitHome.set(String(x.tiling.id), String(tab.id));
      }
      for (const tab of tabs || []) {
        { const lk = ext(tab)[LOOK_KEY]; if (lk === "light" || lk === "dark") lookWins.set(String(tab.id), lk); }   // 1.0.347: each app's own look
        let f;
        try { f = JSON.parse(tab.vivExtData || "{}")?.[EXT_KEY]; } catch { continue; }
        if (!f) continue;
        if (ext(tab).panelId != null) { persist(String(tab.id)); continue; }   // a side panel's page: not a window (its old window mark goes)
        const id = String(tab.id);
        const home = splitHome.get(String(ext(tab).tiling?.id || ""));
        if (home && home !== id) { persist(id); continue; }       // floating.has(id) is false: clears it
        if (f.r) frac[id] = f.r;
        if (f.h && !pip.includes(id)) {                               // held small before the restart: so again
          const c = /^[tb][lr]$/.test(f.h.c) ? f.h.c : "bl";
          pipCorner.set(id, c); if (f.h.h) pipH.set(id, f.h.h); if (f.h.w) pipW.set(id, f.h.w);
          if (f.h.b > 0) pipZoomWas.set(id, f.h.b);                  // its page's own scale, and the scale it had while pinned
          if (f.h.z > 0) pipUserZoom.set(id, f.h.z);
          pipOrder.set(id, Number.isFinite(f.h.o) ? f.h.o : 999);
          pip.push(id);
        }
        if (f.m && !f.h) { minimized.add(id); minKind.set(id, "float"); }
        if (f.dk === "light" || f.dk === "dark") lookWins.set(id, f.dk);
        if (f.lp && /^[tb][lr]$/.test(f.lp.c || "")) pinMem.set(id, f.lp);   // minimized before the restart: so again (its tab brings it back)
        noTitle.add(id);                                          // floating windows never show a title bar
        if (f.g) groupFloat.add(id);
        if (f.z && Math.abs(f.z - 1) > 0.01) zoomOf[id] = f.z;
        floating.add(id); raise(id);
        any = true;
      }
      pip.sort((a, b) => (pipOrder.get(a) ?? 999) - (pipOrder.get(b) ?? 999));   // each in its place in its stack, as before
      // every site tab is a window after a restart: a tab whose saved window was
      // lost (or that was never floated) becomes one too; a split, one window
      const isSite = t => /^https?:/i.test(t.url || t.pendingUrl || "");
      const splitsDone = new Set(splitHome.keys());
      for (const tab of tabs || []) {
        const id = String(tab.id);
        if (floating.has(id) || !isSite(tab) || ext(tab).panelId != null) continue;
        const sp = ext(tab).tiling?.id;
        if (sp != null) {
          if (splitsDone.has(String(sp))) continue;                 // its split is already a window
          splitsDone.add(String(sp));
          groupFloat.add(id);
        }
        floating.add(id); noTitle.add(id); raise(id);
        persist(id);
        any = true;
      }
      // Vivaldi leaves background tabs unloaded after a restart: a window needs
      // its page, so every window's tab is loaded (in the background)
      for (const tab of tabs || []) {
        const id = String(tab.id);
        if (!floating.has(id) && ![...groupFloat].some(g => g === id)) continue;
        if (tab.discarded || tab.status === "unloaded" || !pageOf(id)) {
          setTimeout(() => chrome.tabs.reload(tab.id, () => void chrome.runtime.lastError), 400);
        }
      }
      if (any) { LOG("restored floating windows"); queueRender(); }
    });
  }

  /* ---------------- geometry (fractions of the desktop ⇄ pixels) ---------------- */
  var stackBox = null;                              // (performance) the desktop area's box, kept until it can have changed
  function stackRect() {
    if (stackBox && stackBox.el?.isConnected) return stackBox.r;
    const s = stack();
    const r = s ? s.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
    if (s) stackBox = { el: s, r };
    return r;
  }
  const stackMoved = () => { stackBox = null; };     // its size changed, the window resized, Vivaldi's layout changed, a gesture starts
  addEventListener("resize", stackMoved, true);
  addEventListener("pointerdown", stackMoved, true);
  (window.vosBeat || (f => setInterval(f, 2500)))(stackMoved);
  (function watchLayout() {
    const b = document.getElementById("browser"); if (!b) return setTimeout(watchLayout, 300);
    new MutationObserver(stackMoved).observe(b, { attributes: true, attributeFilter: ["class", "style"] });
    for (const id of ["header", "footer", "main"]) { const e = document.getElementById(id); if (e) new MutationObserver(stackMoved).observe(e, { childList: true }); }
  })();
  function clampRect(r, s = stackRect()) {
    const w = Math.min(Math.max(r.w, MIN_W), s.width - MARGIN * 2);
    const h = Math.min(Math.max(r.h, MIN_H), s.height - MARGIN * 2);
    // partly off the desktop is fine (like Windows / macOS): 100px stays on it sideways,
    // and the top never goes above it, so the window can always be grabbed back
    const KEEP = 100;
    const x = Math.min(Math.max(r.x, KEEP - w), s.width - KEEP);
    const y = Math.min(Math.max(r.y, 0), s.height - 48);
    return { x, y, w, h };
  }
  // 1.0.256: pinned apps on this desktop (other than the full-screen one): full screen then fills only the room beside them
  const pinsLive = except => pip.some(p => p !== except && floating.has(p) && !minimized.has(p) && !awayWs(p));
  const roomPrev = new Map();                        // 1.0.258: id -> where it was before it filled the room beside the pinned apps
  const roomOn = new Set();                          // 1.0.259: windows filling that room now - a one-app Bento: they follow the pins,
  const roomActive = () => !bento.on && [...roomOn].some(id => floating.has(id) && !minimized.has(id) && !awayWs(id) && pinsLive(id));   // share an edge with them
  const coverBeside = () => pip.some(p => p !== cover && floating.has(p) && !minimized.has(p) && !awayWs(p));
  function pxRect(id, s = stackRect()) {
    if (bentoDrag?.id === id) return bentoDrag.rect;              // Bento: being dragged
    if (cover === id) return coverBeside() ? bArea(s, true) : { x: -s.left, y: -s.top, w: innerWidth, h: innerHeight };   // the whole Vivaldi window (1.0.256: pinned apps here - the room beside them, as one app in Bento)
    if (pipDrag?.id === id) return pipDrag.r;                       // a pinned window being dragged: where (and how big) it shows
    if (pip.includes(id)) return pipRect(id, s);                    // the corner stack
    if (roomOn.has(id) && !bento.on && pinsLive(id)) return bArea(s, true);   // 1.0.259: filling the room beside the pinned apps
    if (bento.rects.has(id)) return bento.rects.get(id);           // Bento: its slot
    if (!frac[id]) {                                                    // cascade new windows
      const n = floating.size % 6;
      frac[id] = { x: 0.2 + n * 0.025, y: 0.14 + n * 0.03, w: 0.5, h: 0.6 };
    }
    const f = frac[id];
    return clampRect({ x: f.x * s.width, y: f.y * s.height, w: f.w * s.width, h: f.h * s.height }, s);
  }
  /* the corner stacks: in each corner the newest sits at the corner, the earlier ones pushed
     away from it (no overlap); one width per corner, a height per window */
  /* the corner stacks of one side (left or right): the newest at its corner, the earlier ones pushed away from it.
     Never on top of each other: when they no longer fit the height - or the top stack and the bottom stack meet -
     the side is ONE column: one width, the heights shrunk alike to fit, one gap between each */
  let pipSideCache = null;                          // (during a redraw: each side's column worked out once)
  function pipSide(side, s, ws) {                   // (ws: another desktop's - for its preview)
    if (pipSideCache) { const k = side + s.width + "x" + s.height + "@" + ws, c = pipSideCache.get(k); if (c) return c; const m = pipSideNow(side, s, ws); pipSideCache.set(k, m); return m; }
    return pipSideNow(side, s, ws);
  }
  function pipSideNow(side, s, ws) {
    const out = new Map(), avail = s.height - 2 * MARGIN;
    const live = ws !== undefined ? p => !minimized.has(p) && sameWs(wsOfTab.get(String(p)), ws)
      : p => !awayWs(p) && !minimized.has(p) && p !== pipDrag?.id;   // (one being dragged: the others close up)
    const on = c => [...pip].reverse().filter(p => live(p) && (pipCorner.get(p) || "bl") === c);   // newest first (at the corner)
    const tops = on("t" + side), bots = on("b" + side), all = [...tops, ...bots];
    if (!all.length) return out;
    const wOf = p => Math.max(160, Math.min(s.width - 2 * MARGIN, pipW.get(p) || 360));
    const hOf = p => Math.max(100, Math.min(avail, pipH.get(p) || s.height * PIP_K));
    const xOf = w => side === "r" ? s.width - MARGIN - w : MARGIN;
    const need = all.reduce((a, p) => a + hOf(p), 0) + PIP_GAP * (all.length - 1);
    if (need <= avail) {                                            // they fit: each at its corner, its own size
      let y = MARGIN;
      for (const p of tops) { const w = wOf(p), h = hOf(p); out.set(p, { x: xOf(w), y, w, h, k: 1 }); y += h + PIP_GAP; }
      let yb = s.height - MARGIN;
      for (const p of bots) { const w = wOf(p), h = hOf(p); yb -= h; out.set(p, { x: xOf(w), y: yb, w, h, k: 1 }); yb -= PIP_GAP; }
      return out;
    }
    const W = Math.max(...all.map(wOf)), order = [...tops, ...bots.slice().reverse()];   // one column, top to bottom
    const room = avail - PIP_GAP * (order.length - 1), prio = order.includes(pipPrio) ? pipPrio : null;
    // the one you resized last keeps its height (as far as the others' smallest allows); the others share what is left
    const hp = prio ? Math.min(hOf(prio), room - 60 * (order.length - 1)) : 0;
    const k = (room - hp) / Math.max(1, order.reduce((a, p) => a + (p === prio ? 0 : hOf(p)), 0));
    let y = MARGIN;
    order.forEach((p, i) => {
      const h = i === order.length - 1 ? s.height - MARGIN - y : p === prio ? Math.round(hp) : Math.max(40, Math.round(hOf(p) * k));
      out.set(p, { x: xOf(W), y, w: W, h: Math.max(40, h), k }); y += h + PIP_GAP;
    });
    return out;
  }
  /* the line between two held windows one above the other: ONE edge - dragged, one grows and the other gives the
     same room (as Bento's lines) */
  function pipDividers(s) {
    const host = stack(), want = new Set();
    if (host && !mission && !cover) {
      const o = fixedOrigin(host);
      for (const side of ["l", "r"]) {
        const col = [...pipSide(side, s)].sort((a, b) => a[1].y - b[1].y);
        for (let i = 0; i + 1 < col.length; i++) {
          const [a, ra] = col[i], [b, rb] = col[i + 1], gap = rb.y - (ra.y + ra.h);
          if (gap < 0 || gap > PIP_GAP + 2) continue;               // not neighbours (the top and the bottom stack apart)
          const key = a + ":" + b; want.add(key);
          let el = host.querySelector(`:scope > .vos-pip-hdiv[data-key="${key}"]`);
          if (!el) { el = document.createElement("div"); el.className = "vos-pip-hdiv"; el.dataset.key = key; host.appendChild(el); }
          el.dataset.a = a; el.dataset.b = b; el.dataset.k = String(ra.k || 1);
          const x = Math.min(ra.x, rb.x), w = Math.max(ra.x + ra.w, rb.x + rb.w) - x;
          place(el, { x, y: ra.y + ra.h - 7, w, h: gap + 14 }, s, o);   // (1.0.239: an easier strip to grab)
          setStyle(el, "z-index", "1999");
        }
      }
    }
    for (const el of document.querySelectorAll(".vos-pip-hdiv")) if (!want.has(el.dataset.key)) el.remove();
  }
  function pipRowResize(e, a, b, k) {
    const pid = e.pointerId, y0 = e.clientY, s0 = stackRect(), avail = s0.height - 2 * MARGIN;
    const ha = Math.max(100, Math.min(avail, pipH.get(a) || s0.height * PIP_K)), hb = Math.max(100, Math.min(avail, pipH.get(b) || s0.height * PIP_K));
    const shield = document.createElement("div"); shield.className = "ft-shield"; shield.style.cursor = "ns-resize"; document.body.appendChild(shield);
    const line = () => document.querySelector(`#webpage-stack > .vos-pip-hdiv[data-key="${a}:${b}"]`);
    line()?.setAttribute("data-held", "");                          // 1.0.270: its pill stays while it is dragged
    // 1.0.270: held still first, then dragged - they come apart: only the one you drag toward changes, the other keeps its size
    const side = (pipCorner.get(a) || "bl")[1], col = pipSide(side, s0), da = col.get(a)?.h || ha * (k || 1), db = col.get(b)?.h || hb * (k || 1);
    let apart = false;
    const holdT = 0;                                                 // (1.0.272: held-then-dragged pull-apart - off for now)
    let frame = 0, last = null;
    const apply = () => {
      if (!last) return;
      const MIN = 100, dy = last.clientY - y0;
      if (apart) {                                                   // up: the upper one gives way; down: the lower one
        if (dy < 0) { pipH.set(a, Math.round(Math.max(MIN, da + dy))); pipH.set(b, Math.round(db)); }
        else { pipH.set(b, Math.round(Math.max(MIN, db - dy))); pipH.set(a, Math.round(da)); }
        pipAspect.set(a, pipH.get(a) / Math.max(1, pipW.get(a) || 1)); pipAspect.set(b, pipH.get(b) / Math.max(1, pipW.get(b) || 1));
        return render();
      }
      const d = Math.max(MIN - ha, Math.min(hb - MIN, dy / (k || 1)));   // in their own heights; neither below 100px
      pipH.set(a, Math.round(ha + d)); pipH.set(b, Math.round(hb - d));
      render();
    };
    const move = ev => {
      if (ev.pointerId !== pid) return; last = ev;
      if (!apart && Math.abs(ev.clientY - y0) > 4) clearTimeout(holdT);   // (moved at once: joined, as before)
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; apply(); });
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
      shield.remove(); cancelAnimationFrame(frame); frame = 0; clearTimeout(holdT);
      if (ev.type === "pointerup") { last = ev; apply(); }
      const l = line(); l?.removeAttribute("data-held"); l?.removeAttribute("data-apart");
      persist(a); persist(b);
    };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }
  /* a window dragged to a corner of the desktop, or onto the pinned windows of a side: let go there - pinned */
  function pinSlot(side, y, except) {               // the place between that side's pinned windows nearest the pointer
    const ss = stackRect(), ly = y - ss.top;
    const col = [...pipSide(side, ss)].filter(([p]) => p !== except).sort((a, b) => a[1].y - b[1].y);
    if (!col.length) return null;
    let i = col.findIndex(([, r]) => ly < r.y + r.h / 2); if (i < 0) i = col.length;
    const V = col.map(([p]) => p), nTop = V.filter(p => (pipCorner.get(p) || "bl")[0] === "t").length;
    let v = i < nTop ? "t" : i > nTop ? "b" : null;                  // between the top ones: top; between the bottom ones: bottom
    if (!v) {                                                        // between the two groups: the nearer one (the middle of the free gap)
      const gTop = nTop ? col[nTop - 1][1].y + col[nTop - 1][1].h : 0, gBot = nTop < col.length ? col[nTop][1].y : ss.height;
      v = ly < (gTop + gBot) / 2 ? "t" : "b";
    }
    // the far ends always reach the other group - even when the pinned ones fill the column: its top quarter is the top,
    // its bottom quarter the bottom (two pinned at the bottom: a new one still goes to the top easily)
    if (nTop === 0 && ly < ss.height * 0.25) { i = 0; v = "t"; }
    if (nTop === col.length && ly > ss.height * 0.75) { i = col.length; v = "b"; }
    const corner = v + side;
    const last = col[col.length - 1][1];
    const yAt = i === 0 ? col[0][1].y - PIP_GAP / 2 : i === col.length ? last.y + last.h + PIP_GAP / 2 : (col[i - 1][1].y + col[i - 1][1].h + col[i][1].y) / 2;
    const x = Math.min(...col.map(([, r]) => r.x)), w = Math.max(...col.map(([, r]) => r.x + r.w)) - x;
    return { side, i, V, corner, y: yAt, x, w };
  }
  function emptySlot(c, w) {                         // an empty side: its corner (the line where the window will sit)
    const ss = stackRect(), side = c[1];
    return { side, i: 0, V: [], corner: c, x: side === "r" ? ss.width - MARGIN - w : MARGIN, w, y: c[0] === "t" ? MARGIN / 2 : ss.height - MARGIN / 2 };
  }
  function fillGap(id, slot) {                       // dropped into the gap between the top and the bottom ones: the box shown
    const f = slot?.fill; if (!f) return;
    const h = Math.max(100, Math.round(f.h));
    pipH.set(id, h); pipAspect.set(id, h / Math.max(1, pipW.get(id) || f.w));
  }
  function pinOrder(id, slot) {                     // that place: its corner, and its turn in the column
    const V = slot.V.filter(p => p !== id); V.splice(Math.min(slot.i, V.length), 0, id);
    pipCorner.set(id, slot.corner);
    const Tv = V.filter(p => (pipCorner.get(p) || "bl")[0] === "t"), Bv = V.filter(p => (pipCorner.get(p) || "bl")[0] === "b");
    for (const p of V) { const k = pip.indexOf(p); if (k >= 0) pip.splice(k, 1); }
    pip.push(...Tv.reverse(), ...Bv);                               // (the top stack: newest at the corner; the bottom one: the same)
  }
  let slotEl = null, plotEl = null;
  /* where it will really be: the column laid out with it in that place (worked out, then everything put back) */
  function slotRect(id, slot, W, H) {
    const save = { pip: pip.slice(), c: pipCorner.get(id), w: pipW.get(id), h: pipH.get(id), drag: pipDrag };
    try {
      pipDrag = null;
      if (!pip.includes(id)) pip.push(id);
      pipCorner.set(id, slot.corner); pipW.set(id, W); pipH.set(id, H);
      pinOrder(id, slot);
      const all = pipSideNow(slot.side, stackRect()), r = all.get(id);
      return r ? { ...r, all } : null;
    } catch (e) { return null; }
    finally {
      pip.length = 0; pip.push(...save.pip); pipDrag = save.drag;
      for (const [m, v] of [[pipCorner, save.c], [pipW, save.w], [pipH, save.h]]) { if (v === undefined) m.delete(id); else m.set(id, v); }
    }
  }
  function slotShow(slot, id, W, H) {                // the line where it goes - at the place it will really take; joining the
    if (!slot) { slotEl?.remove(); slotEl = null; plotEl?.remove(); plotEl = null; return; }   // top and the bottom ones: the box it will fill
    const host = stack(); if (!host) return;
    const ss = stackRect(), R = id != null ? slotRect(id, slot, W, H) : null;
    const nTop = slot.V.filter(p => (pipCorner.get(p) || "bl")[0] === "t").length;
    let between = false;                             // the box only when it will fill the gap between the top and the bottom ones
    if (R && nTop > 0 && nTop < slot.V.length && slot.i === nTop) {
      const o = [...R.all].filter(([p]) => p !== id).map(([, r]) => r);
      const up = o.filter(r => r.y < R.y), dn = o.filter(r => r.y > R.y);
      const upEdge = up.length ? Math.max(...up.map(r => r.y + r.h)) : null, dnEdge = dn.length ? Math.min(...dn.map(r => r.y)) : null;
      // (1.0.247: also when it NEARLY fills it - a few px left over gave uneven gaps and one line: it takes the box exactly)
      between = upEdge != null && dnEdge != null && R.y - upEdge >= PIP_GAP - 2 && dnEdge - (R.y + R.h) >= PIP_GAP - 2 && (R.y - upEdge) + (dnEdge - (R.y + R.h)) <= 2 * PIP_GAP + 48;
    }
    let gap = null;                                  // the box: the free gap itself, as it is now - never over a pinned window
    if (between) {
      const now = pipSide(slot.side, ss), a = now.get(slot.V[nTop - 1]), z = now.get(slot.V[nTop]);
      if (a && z) { const y = a.y + a.h + PIP_GAP, h = z.y - PIP_GAP - y; if (h >= 40) gap = { x: R.x, y, w: R.w, h }; }
    }
    slot.fill = gap;                                 // (dropped there: it takes exactly that box)
    if (gap) {
      slotEl?.remove(); slotEl = null;
      if (!plotEl) { plotEl = document.createElement("div"); plotEl.className = "ft-snap-preview vos-pin-plot"; host.appendChild(plotEl); }
      place(plotEl, gap, ss); setStyle(plotEl, "z-index", "1995");
      return;
    }
    plotEl?.remove(); plotEl = null;
    if (!slotEl) { slotEl = document.createElement("div"); slotEl.className = "vos-pin-slot"; host.appendChild(slotEl); }
    const top = slot.corner[0] === "t";
    const y = R ? (top ? R.y - PIP_GAP / 2 : R.y + R.h + PIP_GAP / 2) : slot.y;   // its edge toward its neighbours (or the screen's edge)
    const x = R ? R.x : slot.x, ww = R ? R.w : slot.w;
    const w = Math.max(60, Math.round(ww * 0.6));                  // a grabber's pill, only longer
    place(slotEl, { x: x + (ww - w) / 2, y: Math.max(2, Math.min(ss.height - 6, y - 2)), w, h: 4 }, ss);
    setStyle(slotEl, "z-index", "1995");                         // over the pinned windows, under the window being dragged
  }
  /* A FLICK (let go while moving fast): where it is heading decides - its path is followed to the edge of the screen:
     a corner (or the bottom near one): pinned there ("pin:tl"); the side of the pinned apps, across them: with them
     ("col:l:<y>"); the left / right edge elsewhere: Bento's half ("left" / "right"); the top edge: full screen */
  function flickOf(at, ts, id, wr) {               // wr: where the window is now (its box on the screen)
    if (at.length < 3) return null;
    const [t0, x0, y0] = at[0], [t1, x1, y1] = at[at.length - 1], dt = t1 - t0;
    if (dt < 24 || ts - t1 > 70) return null;                        // (it had stopped before the release: no flick)
    const vx = (x1 - x0) / dt, vy = (y1 - y0) / dt;
    if (Math.hypot(vx, vy) < 1.1) return null;                       // px per ms: a plain move is far slower
    const ss = stackRect(), L = ss.left, R = ss.right, T = ss.top, B = ss.bottom, W = ss.width, H = ss.height;
    // the edge its path reaches first
    const tx = vx < 0 ? (L - x1) / vx : vx > 0 ? (R - x1) / vx : Infinity, ty = vy < 0 ? (T - y1) / vy : vy > 0 ? (B - y1) / vy : Infinity;
    const t = Math.max(0, Math.min(tx, ty)), hx = Math.max(L, Math.min(R, x1 + vx * t)), hy = Math.max(T, Math.min(B, y1 + vy * t));
    const cw = Math.max(140, W * 0.16), ch = Math.max(120, H * 0.2);  // a corner's reach along each edge
    const near = { l: hx - L < cw, r: R - hx < cw, t: hy - T < ch, b: B - hy < ch };
    // SMASHED into that edge, not thrown from afar: the window's own edge must reach it while still moving fast
    if (wr) {
      const REACH = 110, gap = tx <= ty ? (vx < 0 ? wr.left - L : R - wr.right) : (vy < 0 ? wr.top - T : B - wr.bottom);
      if (gap > REACH) return null;
    }
    const pinned = !pip.includes(id);
    if (tx <= ty) {                                                  // the left or right edge
      const side = vx < 0 ? "l" : "r";
      if (pinned && (near.t || near.b)) return "pin:" + (near.t ? "t" : "b") + side;
      const col = [...pipSide(side, ss)].filter(([p]) => p !== id).map(([, r]) => r);
      if (pinned && col.length) {                                    // across the pinned apps (with a little reach): with them
        const top = Math.min(...col.map(r => r.y)) + T - 40, bot = Math.max(...col.map(r => r.y + r.h)) + T + 40;
        if (hy >= top && hy <= bot) return "col:" + side + ":" + Math.round(hy);
      }
      return side === "l" ? "left" : "right";
    }
    if (vy < 0) {                                                    // the top edge
      if (pinned && (near.l || near.r)) return "pin:t" + (near.l ? "l" : "r");
      return "full";
    }
    if (pinned && (hx - L < W * 0.3 || R - hx < W * 0.3)) return "pin:b" + (hx - L < W / 2 ? "l" : "r");   // the bottom, toward a corner
    return null;                                                     // (the bottom's middle: nothing)
  }
  function flickSlot(kind, id, y, el) {             // where a flick pins it
    const ss = stackRect();
    if (kind.startsWith("col:")) { const side = kind[4], hy = Number(kind.split(":")[2]) || y; return pinSlot(side, hy, id) || emptySlot((hy - ss.top < ss.height / 2 ? "t" : "b") + side, Math.min(PIP_START_W, el.offsetWidth)); }   // (where its path crosses them)
    const c = kind.slice(4), w = cornerW(c, id) ?? Math.min(PIP_START_W, el.offsetWidth);
    return pinSlot(c[1], c[0] === "t" ? ss.top + 2 : ss.bottom - 2, id) || emptySlot(c, w);
  }
  const isPinFlick = k => typeof k === "string" && (k.startsWith("pin:") || k.startsWith("col:"));
  function cornerAt(x, y) {                         // a corner of the desktop (72px of both its edges - also pushed past them)
    const ss = stackRect(), C = 72;
    if (y < ss.top - 60 || y > ss.bottom + 60) return null;          // (not the tab bar)
    const lx = Math.max(0, Math.min(ss.width, x - ss.left)), ly = Math.max(0, Math.min(ss.height, y - ss.top));
    const h = lx <= C ? "l" : lx >= ss.width - C ? "r" : null, v = ly <= C ? "t" : ly >= ss.height - C ? "b" : null;
    return h && v ? v + h : null;
  }
  function pinZoneAt(x, y, id) {
    if (pip.includes(id) || mission) return null;
    const ss = stackRect(), ly = y - ss.top, raw = x - ss.left;
    if (x < 0 || x > innerWidth) return null;
    { const k = cornerAt(x, y); if (k) return k + "!"; }             // a corner of the desktop (even pushed into the screen's corner): pinned there
    if (ly < 0 || ly > ss.height) return null;                      // (the top edge: full screen)
    const lx = Math.max(0, Math.min(ss.width, raw));
    if (raw <= 1 || raw >= ss.width - 2) return null;               // the very left / right edge, all along it: the half-screen snap, as always
    for (const side of ["l", "r"]) {                                // onto that side's pinned windows
      const col = [...pipSide(side, ss)].filter(([p]) => p !== id).map(([, r]) => r);
      if (!col.length) continue;
      if (side === "l" ? lx <= Math.max(...col.map(r => r.x + r.w)) + 24 : lx >= Math.min(...col.map(r => r.x)) - 24) return (ly < ss.height / 2 ? "t" : "b") + side;
    }
    return null;
  }
  function roundAs(e, k, rad) {                     // scaled by k, its corners still as round as a window's (rad)
    if (!e) return;
    if (k == null) { e.style.removeProperty("border-radius"); e.style.removeProperty("clip-path"); return; }
    const r = (rad / k).toFixed(1) + "px";
    e.style.setProperty("border-radius", r, "important");
    e.style.setProperty("clip-path", `inset(0 round ${r})`, "important");
  }
  function pinLook(el, id, c, ox, oy, glide) {      // (glide: leaving the pin place while held - it grows back, animated)             // the window itself shrinks toward its pinned size (back when it leaves) - around
                                                     // the point where it is held (ox, oy: in its own box), so it stays under the pointer
    for (const e of [el, frames.get(id)]) {
      if (!e) continue;
      if (!c && glide && e.hasAttribute("data-vos-pinlook")) {      // back to its full size - the same smooth scale as on the way in
        e.style.setProperty("scale", "1", "important");
        if (e === el) roundAs(e, 1, el.__vosRad ?? 12);
        const tok = e.__vosGlide = {};
        setTimeout(() => { if (e.__vosGlide !== tok) return; e.__vosGlide = null; e.style.removeProperty("scale"); e.style.removeProperty("transform-origin"); e.removeAttribute("data-vos-pinlook"); if (e === el) roundAs(e, null); }, 260);
        continue;
      }
      e.__vosGlide = null;                                           // (a glide back still running: it is this look now)
      if (!c) { e.style.removeProperty("scale"); e.style.removeProperty("transform-origin"); e.removeAttribute("data-vos-pinlook"); if (e === el) roundAs(e, null); continue; }   // (all of it: its own glide setting too - else Mission Control could not move it smoothly)
      const m = pinMem.get(id), W = cornerW(c, id) ?? (m?.c?.[1] === c[1] && m.w ? m.w : Math.min(PIP_START_W, el.offsetWidth));
      const k = Math.max(0.15, Math.min(1, W / Math.max(1, el.offsetWidth))), o = e === el ? 0 : RING;
      e.setAttribute("data-vos-pinlook", "");
      if (ox != null) e.style.setProperty("transform-origin", `${Math.round(ox + o)}px ${Math.round(oy + o)}px`, "important");
      e.style.setProperty("scale", String(+k.toFixed(3)), "important");
      if (e === el) { if (el.__vosRad == null) el.__vosRad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12; roundAs(el, k, el.__vosRad); }
    }
  }
  function pinInto(id, c, slot) {
    const el = targetOf(pageOf(id));
    if (!el || pip.includes(id)) return;
    const r = { width: el.offsetWidth, height: el.offsetHeight }, others = pip.map(p => targetOf(pageOf(p))).filter(Boolean);
    flip([el, ...others], () => { pinNow(id, el, c, slot, r); render(); });   // from how it looks now (shrunk) into its place
  }
  function pinNow(id, el, c, slot, r) {             // (pinned - without drawing or animating: the caller does that once)
    pinLook(el, id, null); el.__vosRad = null;
    for (const e of [el, frames.get(id)]) e?.removeAttribute("data-vos-pinlook");
    if (cover === id) cover = null;
    if (backToBento.delete(id)) bento.skip.delete(id);
    pinBack(id, slot?.corner || c, r);
    if (slot) { pinOrder(id, slot); fillGap(id, slot); }             // between the ones it was dropped between
    persist(id);
  }
  function pinBack(id, c, r) {                     // pinned: back where it was the last time (else as given)
    const m = pinMem.get(id), corner = c || m?.c || "bl", same = m && m.c?.[1] === corner[1];
    pipAspect.set(id, same && m.w && m.h ? m.h / m.w : r.height / Math.max(1, r.width));
    pipFit(id, corner, cornerW(corner, id) ?? (same && m.w ? m.w : Math.min(PIP_START_W, r.width)));
    if (same && m.h && !cornerW(corner, id)) pipH.set(id, m.h);
    pipCorner.set(id, corner);
    const at = m && m.c === corner && Number.isFinite(m.o) ? m.o : null, mates = pip.filter(p => (pipCorner.get(p) || "bl") === corner);
    if (at != null && at < mates.length) pip.splice(pip.indexOf(mates[at]), 0, id); else pip.push(id);   // its place in that stack
    pipZoom(id, true);
  }
  function pipRect(id, s) {
    const c = pipCorner.get(id) || "bl", r = pipSide(c[1], s).get(id);
    if (r) return r;
    const W = Math.max(160, Math.min(s.width - 2 * MARGIN, pipW.get(id) || 360)), h = Math.max(100, Math.min(s.height - 2 * MARGIN, pipH.get(id) || 240));   // (one away: at its corner)
    return { x: c[1] === "r" ? s.width - MARGIN - W : MARGIN, y: c[0] === "b" ? s.height - MARGIN - h : MARGIN, w: W, h };
  }
  /* Bento on, a corner stack beside it: dragging the edge between them makes that side's held windows wider or
     narrower (only their width - each keeps its height) and Bento takes the rest - only that side changes */
  function pipColumnResize(e, side) {
    const pid = e.pointerId;
    const shield = document.createElement("div"); shield.className = "ft-shield"; shield.style.cursor = "ew-resize"; document.body.appendChild(shield);
    let frame = 0, last = null;
    const apply = () => {
      if (!last) return;
      const ss = stackRect(), x = last.clientX - ss.left;
      const W = Math.round(Math.max(160, Math.min(ss.width * 0.45, side === "l" ? x - MARGIN - BGAP / 2 : ss.width - x - MARGIN - BGAP / 2)));
      for (const p of pip) { const c = pipCorner.get(p) || "bl"; if (c[1] === side && !awayWs(p)) { pipW.set(p, W); if (pipH.has(p)) pipAspect.set(p, pipH.get(p) / W); } }   // only the width: each keeps its height
      render();
    };
    const move = ev => {
      if (ev.pointerId !== pid) return;
      last = ev;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; apply(); });
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
      shield.remove(); cancelAnimationFrame(frame); frame = 0;
      if (ev.type === "pointerup") { last = ev; apply(); }             // where it was let go (even if no frame was drawn meanwhile)
      for (const p of pip) if ((pipCorner.get(p) || "bl")[1] === side) persist(p);
      render();
    };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }
  function setPx(id, r, s = stackRect()) {
    frac[id] = { x: r.x / s.width, y: r.y / s.height, w: r.w / s.width, h: r.h / s.height };
  }
  /* exact position:fixed origin for children of `parent` (a probe that never animates) */
  let originCache = null;                           // (during a redraw: each origin measured once)
  function fixedOrigin(parent) {
    if (originCache?.has(parent)) return originCache.get(parent);
    const o = fixedOriginNow(parent);
    originCache?.set(parent, o);
    return o;
  }
  function fixedOriginNow(parent) {
    let probe = $(":scope > .ft-probe", parent);
    if (!probe) {
      probe = document.createElement("div");
      probe.className = "ft-probe";
      probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;";
      parent.appendChild(probe);
    }
    const r = probe.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }
  const setStyle = (el, k, v) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v, "important"); };
  function place(el, r, s = stackRect(), o = fixedOrigin(el.parentElement)) {
    setStyle(el, "position", "fixed");
    setStyle(el, "left", Math.round(s.left + r.x - o.x) + "px");
    setStyle(el, "top", Math.round(s.top + r.y - o.y) + "px");
    setStyle(el, "width", Math.round(r.w) + "px");
    setStyle(el, "height", Math.round(r.h) + "px");
  }
  const unplace = el => ["position", "width", "height", "left", "top", "z-index"].forEach(k => el.style.removeProperty(k));

  /* ---------------- animation ----------------
     Fades use filter: opacity(), because the CSS keeps floating windows at
     opacity:1 !important (to show background tabs) and !important would
     silently cancel an opacity animation. */
  const stopAnims = el => el?.getAnimations?.().forEach(a => a.cancel());
  const SHOWN = { transformOrigin: "50% 50%", transform: "none", filter: "opacity(1)" };

  /* iPadOS-style motion: real springs (response = seconds per swing, damping
     1 = no bounce), turned into a CSS linear() curve + its settle time. */
  function spring(response, damping) {
    const w = 2 * Math.PI / response, z = damping, wd = w * Math.sqrt(Math.max(1e-6, 1 - z * z));
    const x = t => z >= 1 ? 1 - Math.exp(-w * t) * (1 + w * t)
      : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
    const T = Math.min(1.2, Math.max(0.25, -Math.log(0.002) / (z * w)));
    const pts = [];
    for (let i = 0; i <= 48; i++) pts.push(+x(T * i / 48).toFixed(4));
    pts[48] = 1;
    return { easing: `linear(${pts.join(", ")})`, duration: Math.round(T * 1000) };
  }
  const SPR_OPEN = spring(0.27, 0.88);   // open, close and minimize all take ~0.3 s   // a window zooms out of its icon, a hint of bounce
  const SPR_MOVE = spring(0.34, 1.00);   // move / resize / place changes, Bento (1.0.321: a touch quicker than full screen's - still no bounce)
  const SPR_SHUT = spring(0.30, 1.00);   // close / minimize: quick, no bounce
  const SPR_GROW = spring(0.40, 1.00);   // 1.0.278: full screen in / out (a big size change): no bounce
  const fadeTo = (el, from, to, ms, delay = 0) =>
    el.animate([{ filter: `opacity(${from})` }, { filter: `opacity(${to})` }],
               { duration: ms, delay, easing: "linear", fill: "both" });
  function flip(elements, mutate) {
    const els = [...new Set(elements.filter(Boolean))];
    els.forEach(stopAnims);
    const first = els.map(e => e.getBoundingClientRect());
    mutate();
    els.forEach((e, i) => {
      if (!e.isConnected) return;
      const f = first[i], l = e.getBoundingClientRect();
      if (!l.width || !l.height || !f.width || !f.height) return;
      const dx = f.left - l.left, dy = f.top - l.top, sx = f.width / l.width, sy = f.height / l.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      let kx = sx, ky = sy, tx = dx, ty = dy, clip = null;
      if (Math.abs(sx - sy) > 0.03) {                                // another shape (full screen, a Bento slot): never stretched -
        // 1.0.325: one scale, just enough to fill the shape it starts from, and trimmed to it exactly - so it starts exactly
        // where it was and ends exactly where it lands, growing and shrinking alike (each the other's mirror)
        const k = Math.max(sx, sy), lw = l.width, lh = l.height;
        const ix = Math.max(0, (lw - f.width / k) / 2), iy = Math.max(0, (lh - f.height / k) / 2);
        kx = ky = k; tx = f.left - l.left - ix * k; ty = f.top - l.top - iy * k;
        const R = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0;
        clip = { ix, iy, r0: R / k, R };
      }
      e.style.setProperty("will-change", "transform");               // its own layer for the move (smooth), only while it moves
      const a = e.animate(
        [{ transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${kx}, ${ky})` },
         { transformOrigin: "0 0", transform: "none" }],
        Math.abs(kx - 1) > 0.12 || Math.abs(ky - 1) > 0.12 ? SPR_GROW : SPR_MOVE
      );
      if (clip) {                                                    // (the trim drawn by hand each frame, with the move's own easing - the
        const put = q => {                                           //  window rules say "no trim" firmly, so it is set on the window itself)
          const x = clip.ix * (1 - q), y = clip.iy * (1 - q), rr = clip.r0 + (clip.R - clip.r0) * q, sh = 60 * q * q;   // (its shadow let back in as it lands)
          e.style.setProperty("clip-path", `inset(${(y - sh).toFixed(1)}px ${(x - sh).toFixed(1)}px ${(y - sh).toFixed(1)}px ${(x - sh).toFixed(1)}px round ${(rr + sh).toFixed(1)}px)`, "important");
        };
        put(0);
        const tick = () => {
          const m = getComputedStyle(e).transform.match(/^matrix\(([^,]+)/), cur = m ? parseFloat(m[1]) : 1;   // (where the move is: its scale now)
          const q = Math.abs(1 - kx) < 1e-4 ? 1 : Math.min(1, Math.max(0, (cur - kx) / (1 - kx)));
          if (a.playState !== "finished" && a.playState !== "idle" && q < 1) { put(q); requestAnimationFrame(tick); } else e.style.removeProperty("clip-path");
        };
        requestAnimationFrame(tick);
      }
      a.finished.catch(() => {}).then(() => { e.style.removeProperty("clip-path"); if (!e.getAnimations().length) e.style.removeProperty("will-change"); });
    });
  }
  const barTop = () => !browserEl()?.classList.contains("tabs-bottom");   // 1.0.261: the tab bar at the top: the icon's bounce goes up
  function toTabFrame(el, id) {                     // the window shrunk into its tab icon
    const r = el.getBoundingClientRect();
    const t = document.getElementById("tab-" + id)?.getBoundingClientRect();
    if (!t || !t.width || !r.width) return { transformOrigin: "50% 100%", transform: "translateY(25%) scale(0.12)", filter: "opacity(0)" };
    const dx = t.left + t.width / 2 - (r.left + r.width / 2);
    const dy = t.top + t.height / 2 - (r.top + r.height / 2);
    const k = Math.max(0.02, Math.min(t.width / r.width, t.height / r.height));
    return { transformOrigin: "50% 50%", transform: `translate(${dx}px, ${dy}px) scale(${k})`, filter: "opacity(0)" };
  }
  /* close: the window shrinks a little and slips down as it fades (iPadOS);
     minimize: it shrinks into its tab icon, fading only at the very end */
  function animateOut(el, kind, id) {
    if (!el) return Promise.resolve();
    stopAnims(el);
    const end = kind === "minimize" ? toTabFrame(el, id)
      : { transformOrigin: "50% 60%", transform: "translateY(3%) scale(0.82)" };
    const move = el.animate([{ transformOrigin: end.transformOrigin, transform: "none" },
                             { transformOrigin: end.transformOrigin, transform: end.transform }],
                            { ...SPR_SHUT, fill: "forwards" });
    const fade = kind === "minimize" ? fadeTo(el, 1, 0, SPR_SHUT.duration * 0.35, SPR_SHUT.duration * 0.6)
                                     : fadeTo(el, 1, 0, 130);
    return Promise.all([move.finished, fade.finished]).catch(() => {}).then(() => move);
  }
  /* the tab icon bounces when a window lands in it, like the macOS Dock.
     (The tab itself is locked with transform !important in 04-tab-visuals,
     so the icon inside it is animated instead.) */
  function tabImpact(id) {
    const icon = document.getElementById("tab-" + id)?.querySelector(".favicon, .site-icon");
    if (!icon) return;
    // the window drops in: a gentle press toward the bar's edge (down at the bottom, up at the top), then a soft return
    const top = barTop(), o = top ? "50% 0%" : "50% 100%", d = top ? -1 : 1;
    icon.animate([
      { transform: "none", transformOrigin: o },
      { transform: `translateY(${1.5 * d}px) scale(1.04, 0.92)`, transformOrigin: o, offset: 0.3 },
      { transform: `translateY(${-1 * d}px) scale(0.99, 1.03)`, transformOrigin: o, offset: 0.65 },
      { transform: "none", transformOrigin: o },
    ], { duration: 420, easing: "ease-out" });
  }
  /* open / bring back: the window zooms out of its tab icon on a spring and
     is fully there after the first third (iPadOS) */
  function animateIn(el, id) {
    if (!el) return;
    stopAnims(el);
    const from = id != null && document.getElementById("tab-" + id) ? toTabFrame(el, id)
      : { transformOrigin: "50% 50%", transform: "scale(0.86)" };
    el.animate([{ transformOrigin: from.transformOrigin, transform: from.transform },
                { transformOrigin: from.transformOrigin, transform: "none" }], SPR_OPEN);
    fadeTo(el, 0, 1, 120).finished.then(a => a.cancel()).catch(() => {});
  }
  /* a new window: the close played backwards - it rises a little and grows
     into place as it fades in, on a spring (iPadOS) */
  function popIn(el) {
    if (!el) return;
    stopAnims(el);
    el.animate([{ transformOrigin: "50% 60%", transform: "translateY(3%) scale(0.82)" },
                { transformOrigin: "50% 60%", transform: "none" }], SPR_OPEN);
    fadeTo(el, 0, 1, 130).finished.then(a => a.cancel()).catch(() => {});
  }

  /* a workspace switch: the windows of the workspace you leave close (the
     close animation), then this workspace's windows open (the open animation).
     Only the windows themselves move; a quick switch back cancels cleanly. */
  let wsPrev, wsAwayPrev = new Set(), wsGen = 0, swiping = false;
  const wsTimers = new Set();
  function wsAnimate(windows) {
    const ws = curWs();
    const away = new Set(windows.filter(w => awayWs(w.id)).map(w => w.id));
    if (!swiping && ws !== undefined && wsPrev !== undefined && ws !== wsPrev && !document.hidden) {   // a swipe moves the whole desktop instead
      const gen = ++wsGen;
      wsTimers.forEach(clearTimeout); wsTimers.clear();
      // strictly by workspace: only the windows of the workspace left close, only the
      // windows of the new one open; any other workspace's windows are never shown
      const wsOf = id => wsOfTab.has(String(id)) ? wsOfTab.get(String(id)) : undefined;
      const leaving = windows.filter(w => wsOf(w.id) === wsPrev && away.has(w.id));
      const entering = windows.filter(w => wsOf(w.id) === ws && !away.has(w.id));
      for (const { el } of leaving) {
        el.setAttribute("data-ft-ws-leave", "");
        animateOut(el, "close").then(() => {
          if (gen !== wsGen) return;                                  // a newer switch took over
          el.removeAttribute("data-ft-ws-leave");
          stopAnims(el);
        });
      }
      // the new windows wait (unseen) until the old ones are mostly gone, then open
      const wait = leaving.length ? Math.round(SPR_SHUT.duration * 0.55) : 0;
      for (const { el } of entering) {
        el.removeAttribute("data-ft-ws-leave");
        stopAnims(el);
        if (!wait) { popIn(el); continue; }
        el.animate([{ filter: "opacity(0)" }, { filter: "opacity(0)" }], { duration: wait, fill: "both" });
        const t = setTimeout(() => { wsTimers.delete(t); if (gen === wsGen && !el.hasAttribute("data-ft-away")) popIn(el); else stopAnims(el); }, wait);
        wsTimers.add(t);
      }
    }
    if (ws !== undefined) { wsPrev = ws; wsAwayPrev = away; }   // an in-between state (no workspace known) changes nothing
  }

  /* ---------------- window chrome: title bar + resize handles ---------------- */
  const LIGHTS_HTML = `
    <button class="ft-light ft-red"    data-act="close"    title="Close"></button>
    <button class="ft-light ft-yellow" data-act="minimize" title="Minimize"></button>
    <button class="ft-light ft-green"  data-act="zoom"     title="Float / Back to its place"></button>`;
  const HANDLES = ["t", "b", "l", "r", "tl", "tr", "bl", "br"];
  /* 1.0.285: ONE component for a window's buttons: its app's circle and, beside it, its buttons on a small pill. Per type:
     the direction (a pinned app: upright under its circle - a normal window: side by side, above the window), its buttons
     (and their order), and when it shows (a pinned app: always, the buttons on the circle's hover - a normal window: its
     top left corner) */
  const CTL = {
    pin: { dir: "v", buttons: [["gray", "res", "Light / dark - hold: page size"], ["yellow", "unpin", "Back to the canvas"], ["red", "close", "Close"]] },   // (1.0.333: no green; yellow an arrow toward the canvas)   // (1.0.326: green back; yellow its minus - both as full screen's: out of it)
    win: { dir: "h", buttons: [["red", "close", "Close"], ["yellow", "minimize", "Minimize"], ["green", "zoom", "Full screen"], ["gray", "res", ""]] },
  };
  const ctlHtml = type => `<div class="vos-pin-ctl" data-dir="${CTL[type].dir}">` + CTL[type].buttons.map(([c, a, t]) => type === "pin"
    ? `<button class="vos-pc vos-pc-${c}" data-pc="${a}" title="${t}"></button>`
    : `<button class="vos-pc vos-pc-${c} ft-light" data-act="${a}" title="${t}"></button>`).join("") + `</div>`;
  function fetchTitle(id) {
    const t = tabIdOf(id);
    if (!t || titles.has(id)) return;
    titles.set(id, "");
    chrome.tabs.get(t, tab => { if (!chrome.runtime.lastError && tab) { titles.set(id, tab.title || ""); queueRender(); } });
  }
  function addChrome(el, id) {
    let bar = $(":scope > .ft-titlebar", el);
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "ft-titlebar";
      bar.innerHTML = `<div class="ft-lights">${LIGHTS_HTML}<button class="ft-light ft-gray ft-res" data-act="res"></button></div><div class="ft-title"></div>` +
        `<div class="ft-right"></div>`;                                // 1.0.267: the scale button joins the traffic lights
      el.appendChild(bar);
    }
    if (bar.dataset.ftPage !== id) bar.dataset.ftPage = id;
    { const g = $(":scope > .ft-right > .ft-res", bar), L = $(":scope > .ft-lights", bar); if (g && L) L.appendChild(g); }   // (a title bar made before 1.0.267)
    const pct = Math.round((zoomOf[id] || 1) * 100);
    const gray = $(".ft-res", bar), tip = `Light / dark - hold: page size (${pct}%)`;
    if (gray.title !== tip) gray.title = tip;
    const tid = groupFloat.has(id) ? (splitFocus.get(id) || id) : id;   // a split: its selected tile
    fetchTitle(tid);
    const tEl = $(".ft-title", bar), raw = titles.get(tid) || "";
    const title = /^(chrome|vivaldi|about):/i.test(raw) ? "" : raw;     // never an internal address
    if (tEl.textContent !== title) tEl.textContent = title;
  }
  /* 1.0.243: a pinned app: its tab-bar circle OUTSIDE it, beside its top corner toward the middle of the screen (right pins:
     top left, left pins: top right), under every window (z 99: windows start at 100). Always shown (1.0.246: outside the
     app, nothing to hide) */
  const pinBadges = new Map();                       // window id -> its circle (in the page area, beside the windows)
  function pinBadge(el, id, r, s, o) {
    let b = pinBadges.get(id);
    if (!pip.includes(id) || awayWs(id) || minimized.has(id) || !r) { if (b) badgeGone(b, id); return; }
    const bare = bento.on || roomActive();                           // 1.0.308: no circle on show: it waits, unseen, at its corner (the pointer there brings it)   // (1.0.250: none with Bento on)
    const host = stack(); if (!host) return;
    // 1.0.251: a split: every pane's icon, one above the other in one pill (the tab bar's split pill, upright)
    const ids = (groupFloat.has(id) && membersOf(pageOf(id)).length > 1) ? membersOf(pageOf(id)) : [groupFloat.has(id) ? (splitFocus.get(id) || id) : id];
    const iconOf = t => {
      let src = tabIcon(t);
      if (!src) {                                                     // (1.0.245: the tab bar's picture not there yet: the site's own icon)
        const u = pageOf(t)?.querySelector("webview")?.getAttribute("src") || "";
        if (/^https?:/.test(u)) try { src = favicon(u); } catch (e) {}
      }
      return src;
    };
    const srcs = ids.map(iconOf);
    if (!b || b.parentElement !== host) {
      b?.remove(); b = document.createElement("div"); b.className = "vos-pin-badge";
      { const bb = b; bb.addEventListener("pointerenter", () => { bb.__vosHover = true; setStyle(bb, "z-index", "2147483000"); if (!bb.hasAttribute("data-bare")) pinShow(bb.dataset.for, null); });   // (1.0.312: a circle on show: its own hover brings its buttons, as before)
        bb.addEventListener("pointerleave", () => { bb.__vosHover = false; }); }
      host.appendChild(b); pinBadges.set(id, b);
    }
    if (b.dataset.for !== id) b.dataset.for = id;
    let ctl = b.querySelector(":scope > .vos-pin-ctl");               // 1.0.265: its window buttons under it - close, back to its window, page
    if (!ctl) {                                                       // size - shown while the pointer is on the icon (or on them)
      b.insertAdjacentHTML("beforeend", ctlHtml("pin")); ctl = b.lastElementChild;   // (1.0.285: the shared component, upright)
    }
    const imgs = () => [...b.children].filter(n => n.tagName === "IMG");
    while (imgs().length < ids.length) { const im = document.createElement("img"); im.alt = ""; b.insertBefore(im, ctl); }
    while (imgs().length > ids.length) imgs().pop().remove();
    srcs.forEach((src, i) => { const im = imgs()[i]; if (src && im.getAttribute("src") !== src) im.src = src; im.style.visibility = src ? "" : "hidden"; });
    if (ids.length === 1) mirrorTab(b, imgs()[0], ids[0]);           // 1.0.307: its tab's circle
    const side = (pipCorner.get(id) || "bl")[1];
    if (b.dataset.side !== side) b.dataset.side = side;              // 1.0.333: its yellow's arrow points toward the canvas
    const plate = ids.length === 1 ? (document.getElementById("tab-" + ids[0])?.getAttribute("data-vos-plate") || "") : "";
    if ((b.dataset.plate || "") !== plate) { if (plate) b.dataset.plate = plate; else delete b.dataset.plate; }
    { const tb = ids.length === 1 ? document.getElementById("tab-" + ids[0]) : null, k = tb?.getAttribute("data-vos-tint") || "", c = tb?.style.getPropertyValue("--vos-tint") || "";   // 1.0.301: its tab's tint
      if ((b.dataset.tint || "") !== k) { if (k) b.dataset.tint = k; else delete b.dataset.tint; }
      if (b.style.getPropertyValue("--vos-tint") !== c) { if (c) b.style.setProperty("--vos-tint", c); else b.style.removeProperty("--vos-tint"); }
      for (const v of ["--vos-tint-d", "--vos-tint-l"]) { const x = tb?.style.getPropertyValue(v) || ""; if (b.style.getPropertyValue(v) !== x) { if (x) b.style.setProperty(v, x); else b.style.removeProperty(v); } } }
    b.toggleAttribute("data-multi", ids.length > 1); b.__vosIds = ids;   // (1.0.346: its apps, for their circles and its tone)
    b.toggleAttribute("data-empty", !srcs.some(Boolean));
    const moving = pipDrag?.id === id || badgeHeld === id, dragging = false;   // 1.0.319: moved any way - it never hides, it goes with its app          // (1.0.292: held by its own circle: it stays, and goes with its app)
    b.toggleAttribute("data-drag", dragging);                          // 1.0.247: held and moved: gone at once (back where it lands)
    b.toggleAttribute("data-bare", bare);
    const S = 24, G = 6, H = S + (ids.length - 1) * 20, x = side === "r" ? r.x - S - G : r.x + r.w + G;
    // 1.0.268: it comes out from behind its app once the app has settled (new, or back after a drag) - toward its own side
    if (!dragging && (b.__vosIn !== side || b.__vosWasDrag)) {
      b.style.setProperty("--vos-from", (side === "r" ? S + G : -(S + G)) + "px");
      b.removeAttribute("data-in"); void b.offsetWidth; b.setAttribute("data-in", "");
      b.__vosIn = side;
    }
    b.__vosWasDrag = dragging;
    if (moving) badgeFollow(b, id);
    if (!moving && !b.__vosFollow) place(b, { x: Math.max(2, Math.min(s.width - S - 2, x)), y: Math.max(2, r.y), w: S, h: H }, s, o);
    setStyle(b, "z-index", "2147483000");                            // 1.0.309: over everything, always (never under a window)
  }
  addEventListener("pointerdown", e => {                          // 1.0.249: the circle is a handle - pressed, its app moves as if held itself
    const b = e.button === 0 && e.target?.closest?.("#webpage-stack > .vos-pin-badge"), id = b?.dataset.for;
    if (!id || mission || lpOn() || !pip.includes(id) || e.target.closest(".vos-pin-ctl")) return;   // (its buttons: a click)
    const el = targetOf(pageOf(id)); if (!el) return;
    badgeHeld = id; b.removeAttribute("data-drag"); b.setAttribute("data-held", ""); b.removeAttribute("data-show");   // 1.0.292: held: it stays in sight and goes with its app (1.0.315: only the circle - its buttons away)
    badgeFollow(b, id);
    const up = ev => { if (ev.pointerId !== e.pointerId) return; badgeHeld = null; b.removeAttribute("data-held"); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true); setTimeout(render, 0); };
    addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    pipGesture(e, el, id, "move");
  }, true);
  var badgeHeld = null;
  /* 1.0.319: A PINNED APP MOVED - by its circle, its body or an edge: its circle stays in sight at its corner, going with it
     (where it is drawn this moment, its look while dragged included), its buttons rolled away (their own way out); let go,
     it is placed again - on the other side, it comes out from behind its app there; on the desktop, it goes in behind it */
  function badgeFollow(b, id) {
    if (b.__vosFollow) return; b.__vosFollow = true;
    const el = targetOf(pageOf(id)); if (!el) { b.__vosFollow = false; return; }
    b.setAttribute("data-held", ""); b.removeAttribute("data-show");
    b.style.translate = ""; const base = b.getBoundingClientRect();
    const S = 24, G = 6;
    const follow = () => {
      if (b.__gone) { b.__vosFollow = false; return; }               // (going into its window: from where it is)
      if (!b.isConnected || !(pipDrag?.id === id || badgeHeld === id)) {
        b.__vosFollow = false; b.removeAttribute("data-held"); b.style.translate = ""; setTimeout(render, 0); return; }
      const r = el.getBoundingClientRect(), side = pipDrag?.id === id && pipDrag.side ? pipDrag.side : (pipCorner.get(id) || "bl")[1];
      const x = side === "r" ? r.left - S - G : r.right + G;
      b.style.translate = `${Math.round(x - base.left)}px ${Math.round(r.top - base.top)}px`;
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }
  let pcHold = null;
  addEventListener("pointerdown", e => {                          // 1.0.270: its grey one held: light <-> dark
    const g = e.button === 0 && e.target?.closest?.("#webpage-stack > .vos-pin-badge .vos-pc-gray"); if (!g) return;
    const id = g.closest(".vos-pin-badge").dataset.for; clearTimeout(pcHold?.t);
    pcHold = { id, done: false, t: setTimeout(() => { pcHold.done = true; const pg = pageOf(id); if (pg) act("res", pg); }, BTN_HOLD) };   // (1.0.349: held - its page size)
  }, true);
  addEventListener("pointerup", () => { if (pcHold && !pcHold.done) { clearTimeout(pcHold.t); pcHold = null; } }, true);
  addEventListener("click", e => {                                // 1.0.265: the pinned app's own buttons
    const btn = e.target?.closest?.("#webpage-stack > .vos-pin-badge .vos-pc"); if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (pcHold?.done) { pcHold = null; return; }                    // (it was held)
    const id = btn.closest(".vos-pin-badge").dataset.for, pg = pageOf(id);
    if (!pg || !pip.includes(id)) return;
    if (btn.dataset.pc === "close") act("close", pg);
    else if (btn.dataset.pc === "unpin") holdAct("minimize", id);      // back to its window (as the yellow button did)
    else toggleDark(id);                                             // 1.0.349: the grey one clicked - light <-> dark (held: its page size)
  }, true);
  /* 1.0.273: one window's look on its own - its site's OWN light design (Vivaldi dark) or its own dark design (Vivaldi
     light), never a recolouring. In that window's page only: the site's style rules made for the other look are switched
     off and the ones for this look on, its <meta name="color-scheme"> and the page's own "which do you prefer?" question
     (matchMedia) answer this look. It runs as each of its pages starts, so the site is drawn that way from the first moment. */
  function vosLookPage(target, on, live) {
    var W = window, D = document, st = W.__vosLook || (W.__vosLook = { saved: [], added: [], disabled: [], attrs: [], done: new WeakSet(), obs: null, t: 0, target: null });
    function undo() {
      st.saved.forEach(function (x) { try { x[0].mediaText = x[1]; } catch (e) {} }); st.saved = [];
      st.added.forEach(function (n) { n.remove(); }); st.added = [];
      st.disabled.forEach(function (sh) { try { sh.disabled = false; } catch (e) {} }); st.disabled = [];
      st.attrs.forEach(function (x) { x[0].setAttribute(x[1], x[2]); }); st.attrs = [];
      st.done = new WeakSet(); if (st.obs) { st.obs.disconnect(); st.obs = null; }
      var s0 = D.getElementById("vos-look"); if (s0) s0.remove();
      var f0 = D.getElementById("vos-look-flip"); if (f0) f0.remove();
      if (st.imgObs) { st.imgObs.disconnect(); st.imgObs = null; } st.flip = false;
      st.target = null;
    }
    if (!on) { undo(); return "off"; }
    if (st.target && st.target !== target) undo();
    st.target = target;
    var other = target === "light" ? "dark" : "light";
    var reO = new RegExp("\\(\\s*prefers-color-scheme\\s*:\\s*" + other + "\\s*\\)", "gi"), reT = new RegExp("\\(\\s*prefers-color-scheme\\s*:\\s*" + target + "\\s*\\)", "gi");
    var fix = function (t) { return t.replace(reO, "(max-width: 0px)").replace(reT, "(min-width: 0px)"); };   // never / always
    var has = function (t) { return /prefers-color-scheme/i.test(t || ""); };
    if (!D.getElementById("vos-look")) { var cs = D.createElement("style"); cs.id = "vos-look"; cs.textContent = ":root{color-scheme:" + target + " !important}"; (D.head || D.documentElement).appendChild(cs); }
    if (!live && !W.__vosMM) {                                        // the page's own scripts ask too (their answer: this look; 1.0.276: only without the page-start file)
      W.__vosMM = 1;
      var sc = D.createElement("script");
      sc.textContent = "(function(){if(window.__vosMMp)return;window.__vosMMp=1;var o=window.matchMedia;window.matchMedia=function(q){q=String(q).replace(/\\(\\s*prefers-color-scheme\\s*:\\s*" + other + "\\s*\\)/gi,'(max-width: 0px)').replace(/\\(\\s*prefers-color-scheme\\s*:\\s*" + target + "\\s*\\)/gi,'(min-width: 0px)');return o.call(window,q);};})();";
      (D.head || D.documentElement).appendChild(sc); sc.remove();
    }
    function fixMedia(ml) { try { var t = ml.mediaText; if (has(t)) { st.saved.push([ml, t]); ml.mediaText = fix(t); } } catch (e) {} }
    function walk(rules) { for (var i = 0; i < rules.length; i++) { var r = rules[i]; if (r.media) fixMedia(r.media); if (r.styleSheet) sheet(r.styleSheet); if (r.cssRules) walk(r.cssRules); } }
    function far(sh) {                                                // another site's style sheet: read again, the same changes, in its place
      if (!sh.href || sh.disabled) return;
      fetch(sh.href, { credentials: "omit" }).then(function (r) { return r.ok ? r.text() : null; }).then(function (txt) {
        if (!txt || !has(txt) || st.target !== target) return;
        txt = txt.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (m, q, u) { if (/^(data:|https?:|\/\/|#|blob:)/i.test(u)) return m; try { return 'url("' + new URL(u, sh.href).href + '")'; } catch (e) { return m; } });
        var s = D.createElement("style"); s.textContent = fix(txt); var own = sh.ownerNode;
        if (own && own.parentNode) own.parentNode.insertBefore(s, own.nextSibling); else (D.head || D.documentElement).appendChild(s);
        st.added.push(s); if (s.sheet) st.done.add(s.sheet); sh.disabled = true; st.disabled.push(sh);
      }).catch(function () {});
    }
    function sheet(sh) { if (!sh || st.done.has(sh)) return; st.done.add(sh); try { if (sh.media) fixMedia(sh.media); walk(sh.cssRules); } catch (e) { far(sh); } }
    function pass() {
      for (var i = 0; i < D.styleSheets.length; i++) sheet(D.styleSheets[i]);
      var els = D.querySelectorAll("link[media],style[media],source[media],meta[name='color-scheme']");
      for (var j = 0; j < els.length; j++) {
        var e = els[j], at = e.tagName === "META" ? "content" : "media", v = e.getAttribute(at) || "";
        if (e.__vosLook) continue;
        if (at === "content") { e.__vosLook = 1; st.attrs.push([e, at, v]); e.setAttribute(at, target); }
        else if (has(v)) { e.__vosLook = 1; st.attrs.push([e, at, v]); e.setAttribute(at, fix(v)); }
      }
    }
    pass();
    // 1.0.274: a site that does not change with it (its look picked by its own script): its colours turned over instead,
    // every picture (and a site's background picture) turned back once - never twice
    function lum() {
      var e = D.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
      for (; e; e = e.parentElement) { var c = (getComputedStyle(e).backgroundColor.match(/[\d.]+/g) || []).map(Number);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
      var b = D.body && (getComputedStyle(D.body).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      return b && b.length >= 3 && (b.length < 4 || b[3] > 0.5) ? 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2] : 255;
    }
    function flipOn() {
      if (st.flip || st.target !== target) return; st.flip = true;
      var M = "img,video,canvas,iframe,embed,object,svg image,[data-vos-img]";
      var f = D.createElement("style"); f.id = "vos-look-flip";
      f.textContent = "html{filter:invert(1) hue-rotate(180deg) !important} :is(" + M + "):not(:is(" + M + ") *){filter:invert(1) hue-rotate(180deg) !important} :is(" + M + ") :is(" + M + "){filter:none !important}";
      (D.head || D.documentElement).appendChild(f);
      var tint = function (v) { return v && v !== "none" && v.indexOf("url(") < 0 && !/rgba?\([^)]*,\s*0\)$/.test(v) ? v : null; };
      var coloured = function (svg) {                               // 1.0.275: an icon with colours of its own (a logo): 2+ colours, not just the text's
        var cols = {}, n = 0, txt = getComputedStyle(svg).color, parts = svg.querySelectorAll("path,circle,rect,polygon,ellipse,g,use,line,polyline");
        for (var k = 0; k < parts.length && k < 60; k++) { var cs = getComputedStyle(parts[k]); [tint(cs.fill), tint(cs.stroke)].forEach(function (c) { if (c && c !== txt && c !== "rgb(0, 0, 0)" && c !== "rgb(255, 255, 255)" && !cols[c]) { cols[c] = 1; n++; } }); }
        return n >= 2;
      };
      var mark = function () { var all = D.querySelectorAll("*"); for (var i = 0; i < all.length && i < 6000; i++) { var el = all[i]; if (el.hasAttribute("data-vos-img") || el.__vosSeen) continue;
        if (el.tagName === "svg" || el.tagName === "SVG") { el.__vosSeen = 1; if (coloured(el)) el.setAttribute("data-vos-img", ""); continue; }
        var bg = getComputedStyle(el).backgroundImage; if (bg && bg.indexOf("url(") >= 0) el.setAttribute("data-vos-img", ""); } };
      mark();
      var tt = 0; st.imgObs = new MutationObserver(function () { if (tt) return; tt = setTimeout(function () { tt = 0; if (st.flip) mark(); }, 400); });
      st.imgObs.observe(D.documentElement, { childList: true, subtree: true });
    }
    function check() { if (!st.target || st.flip || !D.body) return; var L = lum(); if (target === "light" ? L < 110 : L > 150) flipOn(); }
    // 1.0.276: no colour flip any more - only the site's own design for that look (check() kept unused)
    if (!st.obs) {                                                   // what the page adds later (and the sheets still loading)
      st.obs = new MutationObserver(function () { if (st.t) return; st.t = setTimeout(function () { st.t = 0; if (st.target) pass(); }, 250); });
      st.obs.observe(D.documentElement, { childList: true, subtree: true });
      D.addEventListener("DOMContentLoaded", pass); W.addEventListener("load", pass);
    }
    return "on " + target;
  }
  const lookWins = new Map();                                         // window id -> "light" | "dark"
  const lookCode = (target, on) => "(" + vosLookPage.toString() + ")(" + JSON.stringify(target) + "," + !!on + "," + !!lookLive + ")";
  /* 1.0.276: the page-start file (installed beside the mod) runs first in every page, in the page's own world. A tab's look
     is told to it here: the site's own "the look changed" signal goes to the page, so script-themed apps (GitHub, Outlook,
     Teams, ChatGPT) redraw in their own design at once - no reload, nothing lost. Without the file: as before. */
  let lookLive = false;
  (async () => {
    const S = chrome.scripting; if (!S?.registerContentScripts) return;
    const file = "custom-vivaldi-os-page-look.js";
    try {
      const has = await S.getRegisteredContentScripts({ ids: ["vos-look"] }).catch(() => []);
      if (!has.length) await S.registerContentScripts([{ id: "vos-look", matches: ["<all_urls>"], js: [file], runAt: "document_start", world: "MAIN", allFrames: true, persistAcrossSessions: true }]);
      lookLive = true;
      // 1.0.303: pages Vivaldi restored before the page-start script was in place (right after a start) get it: one in a
      // window with a look of its own is opened again once (its app picks its look as it starts); any other gets it loaded in
      const fill = () => chrome.tabs.query({}, tabs => { for (const t of tabs || []) {
        if (!/^https?:/.test(t.url || "") || t.discarded) continue;
        chrome.scripting.executeScript({ target: { tabId: t.id }, world: "MAIN", func: () => !!window.__vosLookSet }).then(r => {
          if (!r || !r[0] || r[0].result !== false) return;
          const w = winOf(String(t.id)) || String(t.id);
          if (lookWins.has(w) && performance.now() < 120000) { chrome.tabs.reload(t.id, {}, () => void chrome.runtime.lastError); return; }
          chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, world: "MAIN", files: ["custom-vivaldi-os-page-look.js"] }).catch(() => {});
        }).catch(() => {});
      } });
      fill(); setTimeout(fill, 20000);
      for (const w of lookWins.keys()) for (const wv of webviewsOf(w)) wv.__vosLookAt = null;   // (told again, now live)
      for (const w of lookWins.keys()) if (floating.has(w)) lookSync(w);
    } catch (e) { lookLive = false; }
  })();
  const tabOfWv = wv => Number(wv.closest?.(".webpageview[data-id]")?.dataset.id) || null;
  function lookTell(wv, target, now) {                              // the page itself: its answer, and the signal
    const tabId = tabOfWv(wv); if (!lookLive || !tabId) return;
    const again = () => { if (!target || (wv.__vosLookTry = (wv.__vosLookTry || 0) + 1) > 20) return; if ((wv.__vosLookAt ?? "") === target) wv.__vosLookAt = null; };   // 1.0.298: not heard (a page still being restored after a start): told again on the next beat
    try { chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", injectImmediately: !!now, func: (t, q) => window.__vosLookSet ? window.__vosLookSet(t, q) : "none", args: [target || null, !!now] })
      .then(r => {
        if (r && r[0] && r[0].result === "none" && target && !wv.__vosLookReload) { wv.__vosLookReload = true; try { chrome.tabs.reload(tabId, {}, () => void chrome.runtime.lastError); } catch (e) {} return; }
        if (r && r[0] && r[0].result === "none" && target && !wv.__vosLookLoad) {   // 1.0.303: the page has no page-start script (it loaded before it, or without it): load it in, then tell it
          wv.__vosLookLoad = true;
          return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", files: ["custom-vivaldi-os-page-look.js"] })
            .then(() => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", func: (t) => window.__vosLookSet ? window.__vosLookSet(t) : "none", args: [target] }))
            .then(r2 => { wv.__vosLookLoad = false; if (!r2 || !r2[0] || r2[0].result === "none") setTimeout(again, 0); else wv.__vosLookTry = 0; })
            .catch(() => { wv.__vosLookLoad = false; setTimeout(again, 0); });
        }
        if (r && r[0] && /\|late$/.test(r[0].result || "") && target && !wv.__vosLookReload) {   // 1.0.303: its script came late (the app had already picked its look): opened again once, so it starts in this look
          wv.__vosLookReload = true; try { chrome.tabs.reload(tabId, {}, () => void chrome.runtime.lastError); } catch (e) {} return; }
        if (!r || !r[0] || r[0].result === "none" || r[0].result == null) setTimeout(again, 0); else wv.__vosLookTry = 0; }).catch(() => setTimeout(again, 0)); } catch (e) {}
  }
  function lookApply(wv, target) {
    if (!wv.__vosLookHook) {                                         // each new page in it: at its very start
      wv.__vosLookHook = true;
      wv.addEventListener("loadcommit", e => {
        if (!e.isTopLevel || !wv.__vosLookAt) return;
        lookTell(wv, wv.__vosLookAt, true);                          // (a new site in it: told as it starts)
        try { wv.executeScript({ code: lookCode(wv.__vosLookAt, true), runAt: "document_start" }, () => void chrome.runtime.lastError); } catch (err) {}
      });
    }
    lookTell(wv, target);
    try { wv.executeScript({ code: lookCode(target || "light", !!target) }, () => void chrome.runtime.lastError); } catch (e) {}   // the page open now: at once
    wv.__vosLookAt = target || "";
  }
  function lookSync(id) {                                              // 1.0.347: each pane its own app's look (a split: each app keeps its own)
    for (const wv of webviewsOf(id)) { const pid = wv.closest(".webpageview[data-id]")?.dataset.id || id, t = lookWins.get(pid) || ""; if ((wv.__vosLookAt ?? "") !== t) lookApply(wv, t); }
  }
  const lookPane = w => groupFloat.has(w) ? (splitFocus.get(w) || w) : w;   // (a split: the app in front)
  const lookOfWin = w => w == null ? "" : (lookWins.get(lookPane(w)) || "");
  function fullPage(id) { const pg = pageOf(id); return !!pg && !floating.has(id) && !isTiled(pg) && !isStart(pg); }   // (1.0.324: a page full screen)
  function toggleDark(win) {                                          // (the grey button held)
    if (!floating.has(win) && !fullPage(win)) return;
    const pane = lookPane(win);                                         // 1.0.347: a split - only the app in front changes
    const viv = browserEl()?.classList.contains("theme-dark") ? "dark" : "light", now = lookWins.get(pane) || viv, next = now === "dark" ? "light" : "dark";
    if (next === viv) lookWins.delete(pane); else lookWins.set(pane, next);   // 1.0.317: always the other look than the one it shows (a saved look equal to Vivaldi's no longer makes a hold do nothing)
    lookSync(win); persist(pane); if (pane !== win && floating.has(win)) persist(win); render();
  }
  (window.vosBeat || (f => setInterval(f, 2500)))(() => { if (!lookWins.size) return; for (const w of floating) lookSync(w); for (const k of lookWins.keys()) { const pg = pageOf(k); if (fullPage(k) || (pg && isTiled(pg) && !winOf(k))) lookSync(k); } });   // (1.0.347: a split full screen too)   // (a pane added to it, a restart)
  { let themeWas = null;                                              // 1.0.275: Vivaldi changed light <-> dark: every window follows it again
    let themeT = 0;
    const themeCheck = () => { clearTimeout(themeT); themeT = setTimeout(themeSettled, 1200); };   // 1.0.299: only a change that stays (not Vivaldi loading its theme)
    const themeSettled = () => {
      const b = browserEl(); if (!b) return;
      const now = b.classList.contains("theme-dark");
      if (performance.now() < 15000) { themeWas = now; return; }    // (starting: its look as it was saved, kept)
      if (themeWas !== null && now !== themeWas && lookWins.size) {
        const ws = [...lookWins.keys()]; lookWins.clear();
        for (const w of ws) { if (floating.has(w)) lookSync(w); persist(w); }
        render();
      }
      themeWas = now;
    };
    const watchTheme = () => { const b = browserEl(); if (!b) return setTimeout(watchTheme, 800); themeSettled(); new MutationObserver(themeCheck).observe(b, { attributes: true, attributeFilter: ["class"] }); };
    watchTheme(); }
  function pinBadgesSweep() { for (const [id, b] of pinBadges) if (!pip.includes(id) || !floating.has(id) || awayWs(id) || minimized.has(id)) badgeGone(b, id); }
  function badgeGone(b, id) {                                        // 1.0.301: a pinned app's circle, no longer needed: it goes into its window
    if (pinBadges.get(id) === b) pinBadges.delete(id);
    if (b.__gone) return; b.__gone = true; b.style.pointerEvents = "none";
    const el = targetOf(pageOf(id)), r = b.getBoundingClientRect();   // 1.0.312: it travels into its window - wherever the window is as it goes (still growing back)
    if (!el || !r.width || awayWs(id)) { b.remove(); return; }
    // 1.0.316: ITS OWN ENTRANCE, REVERSED - its buttons go first (their own way out: they pop away, the pill rolls up into it),
    // then the circle slides back behind its window and fades (the same 30px, scale and 0.32s it came out with, backwards)
    const zw = parseInt(getComputedStyle(el).zIndex, 10); b.style.setProperty("z-index", String(Number.isFinite(zw) ? Math.max(0, zw - 1) : 1), "important");
    const had = b.hasAttribute("data-show");                         // (its buttons still out: they go first)
    b.removeAttribute("data-show"); b.removeAttribute("data-bare"); b.removeAttribute("data-in"); b.removeAttribute("data-held");
    const w = el.getBoundingClientRect(), dir = (w.left + w.width / 2) >= (r.left + r.width / 2) ? 1 : -1;   // (toward its window, behind it)
    b.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${dir * 30}px) scale(0.85)` }],
      { duration: 320, delay: had ? 200 : 0, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "both" }   /* (1.0.332: every way out's curve) */).finished.catch(() => {}).then(() => b.remove());
    setTimeout(() => b.remove(), 900);
  }
  const removeChrome = el => $$(":scope > .ft-titlebar, :scope > .ft-resize, :scope > .vos-pin-badge", el).forEach(e => e.remove());

  /* resize only from outside: an invisible frame around the window, a few px
     wide, so the edges never fight with the title bar or the tile strips */
  const RING = 6;
  const frames = new Map();                          // window id -> its resize frame
  function frameFor(id, el) {
    let f = frames.get(id);
    if (!f) {
      f = document.createElement("div");
      f.className = "ft-frame";
      f.dataset.ftFor = id;
      HANDLES.forEach(c => {
        const h = document.createElement("div");
        h.className = `ft-resize ft-${c}`;
        h.dataset.edge = c;
        f.appendChild(h);
      });
      const g = document.createElement("div");      // the outside grab strip (a split with no title bar)
      g.className = "ft-grab";
      f.appendChild(g);
      frames.set(id, f);
    }
    if (f.parentElement !== el.parentElement) el.parentElement.appendChild(f);
    return f;
  }
  /* a floating split with its title bar hidden: the strip that moves it sits
     OUTSIDE, just above the window (GRAB px), and the top resize edge lies
     beyond that strip: from the outside in - resize, move, the window */
  const GRAB = 0;                                     // (the grab is inside now: a long pill at the top centre)
  function placeFrame(id, el, r, s, o) {
    const f = frameFor(id, el);
    const g = noTitle.has(id) && isSplitWindow(el);
    if (f.hasAttribute("data-ft-grab") !== g) f.toggleAttribute("data-ft-grab", g);
    place(f, { x: r.x - RING, y: r.y - RING, w: r.w + 2 * RING, h: r.h + 2 * RING }, s, o);
    setStyle(f, "z-index", el.style.getPropertyValue("z-index") || "100");
  }

  /* inside a floating split the scale is per page: each page has its own
     scale button on a small frosted corner (top right). The window's three
     buttons (top edge) stay as they were, for the whole split. */
  const INNER_HTML = `<button class="ft-light ft-gray ft-res" data-act="page-res" title="This page's scale"></button>`;
  function ensureInner(pages) {                     // 1.0.269: none any more - the scale button is with the traffic lights
    for (const page of pages) for (const box of $$(":scope > .ft-inner", page)) box.remove();
  }
  function ensureLights(pages) {                    // hover lights on every page
    ensureInner(pages);
    for (const page of pages) {
      if (page.lastElementChild?.classList.contains("ft-lights") || $(":scope > .ft-lights", page)) continue;
      const box = document.createElement("div");
      box.className = "ft-lights";
      box.innerHTML = LIGHTS_HTML;
      page.appendChild(box);
    }
  }

  /* ---------------- state → DOM (only what changed) ---------------- */
  function forget(id) {
    const was = floating.has(id);
    if (zoomOf[id]) { webviewsOf(id).forEach(wv => setWebZoom(wv, 1)); delete zoomOf[id]; }
    floating.delete(id); minimized.delete(id); minKind.delete(id); origin.delete(id); titles.delete(id);
    groupFloat.delete(id);
    persist(id);                                                    // also clears an old saved window
  }
  function floatNow(id, page) {
    if (panelTabs.has(String(id))) return;                          // a side panel's page stays in its panel
    origin.set(id, { tiled: isTiled(page), group: isTiled(page) ? groupOf(page) : "" });
    noTitle.add(id);                                              // floating windows never show a title bar
    floating.add(id); minimized.delete(id); raise(id);
    persist(id);
  }

  /* the floating split window moves from page `from` to page `to` (same split) */
  function passWindow(from, to) {
    floating.add(to); groupFloat.add(to); minimized.delete(to);
    frac[to] = { ...(frac[from] || pxFrac(from)) };
    if (noTitle.has(from)) noTitle.add(to);
    origin.set(to, { tiled: true, group: groupOf(pageOf(to)) });
    zOrder = zOrder.filter(z => z !== to);
    const i = zOrder.indexOf(from);
    i >= 0 ? zOrder.splice(i + 1, 0, to) : zOrder.push(to);
    persist(to);
  }
  const pxFrac = id => { pxRect(id); return frac[id]; };

  /* a page's own controls inside a floating split */
  const pageZoom = {};                              // page id -> its own scale (else the window's)
  function scaleLabel(host, z) {
    const old = host.querySelector(":scope > .ft-res-label");
    if (old) old.remove();
    const label = document.createElement("div");
    label.className = "ft-zoom-label ft-res-label";
    label.textContent = Math.round(z * 100) + "%";
    host.appendChild(label);
    label.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
                  { duration: 1100, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => label.remove()) && setTimeout(() => label.remove(), 2500);
  }
  function pageAct(what, page) {
    const id = page.dataset.id, w = winOf(id);
    if (what === "res") {                           // only this page's scale
      const steps = [1, 0.85, 0.7], now = pageZoom[id] ?? zoomOf[w] ?? 1;
      const i = steps.findIndex(z => Math.abs(z - now) < 0.02);
      const z = steps[(i + 1) % steps.length] ?? 1;
      pageZoom[id] = z;
      $$("webview", page).forEach(wv => setWebZoom(wv, z));
      if (w && pip.includes(w)) syncZooms();                         // in the corner: 70% of that
      scaleLabel(page, z);
      return;
    }
    if (!w || !groupFloat.has(w)) return act(what, page);         // not in a floating split: as usual
    if (what === "zoom") {                                          // out of the split: its own window
      const r = page.getBoundingClientRect();
      tileToDesktop({ id, src: w }, r.left + r.width / 2, r.top + 30);
      return;
    }
    if (w === id) {                                                 // the split's window passes to another page
      const heir = membersOf(page).find(m => m !== id && pageOf(m) && !minimized.has(m));
      if (heir) {
        passWindow(id, heir);
        groupFloat.delete(id); floating.delete(id); zOrder = zOrder.filter(z => z !== id);
        persist(id);
        render();
      }
    }
    return act(what, page);                                         // close / minimize only this page
  }

  /* a tab/tile dropped onto window `target`: once Vivaldi has merged them, the
     target window holds the split and keeps its place */
  function applyDrop(prevGroup) {
    const d = dropInfo;
    if (!d) return;
    if (Date.now() - d.t > 5000) { dropInfo = null; return; }
    const tp = pageOf(d.target), dp = d.dragged != null ? pageOf(d.dragged) : null;
    if (!tp || !isTiled(tp)) return;                                // not merged yet
    if (dp && (!isTiled(dp) || rootOf(tp) !== rootOf(dp))) {
      if (d.kind !== "unknown") return;                             // not merged yet
      d.dragged = null; d.src = null;                               // our guess of the dragged tab was wrong
    }
    dropInfo = null;
    if (d.src && d.dragged && d.src !== d.target && d.src === d.dragged && groupFloat.has(d.src)) {
      // the dragged tile held its old split window: the tiles left behind keep it
      const rest = (prevGroup.get(d.src) || "").split(",").filter(m => m && m !== d.src && pageOf(m));
      const heir = rest.find(m => isTiled(pageOf(m)) && rootOf(pageOf(m)) !== rootOf(tp));
      if (heir) passWindow(d.src, heir);
      else for (const m of rest) frac[m] = { ...frac[d.src] };   // one tile left: it floats right there
    }
    for (const m of membersOf(tp)) if (m !== d.target && floating.has(m)) { forget(m); inSplit.add(m); }
    floating.add(d.target); groupFloat.add(d.target); minimized.delete(d.target);
    origin.set(d.target, { tiled: true, group: groupOf(tp) });
    raise(d.target);
    persist(d.target);
  }

  function reconcile() {
    for (const id of [...floatOnLoad]) {            // every new site starts floating
      if (Date.now() - (floatOnLoadAt.get(id) || 0) > 20000) {     // never became a site
        floatOnLoad.delete(id); floatOnLoadAt.delete(id); siteReady.delete(id); sawStart.delete(id);
        continue;
      }
      const page = pageOf(id);
      if (!page) continue;
      if (isStart(page)) { sawStart.add(id); continue; }
      // ready: its site is known (it really went somewhere: a Start Page tab that only went
      // to the background - another desktop's first tab when an app opens - is not a window)
      if (!siteReady.has(id)) continue;
      floatOnLoad.delete(id); floatOnLoadAt.delete(id); siteReady.delete(id); sawStart.delete(id);
      if (isTiled(page) || floating.has(id)) continue;
      floatNow(id, page);
      requestAnimationFrame(() => popIn(targetOf(pageOf(id))));
    }
    const prevGroup = lastGroup;
    applyDrop(prevGroup);
    // split tiles: remember them; when the split is untiled they become floating windows again
    for (const p of $$("#webpage-stack .webpageview.tiled[data-id]")) {
      if (!floating.has(p.dataset.id)) inSplit.add(p.dataset.id);
    }
    for (const id of [...inSplit]) {
      const page = pageOf(id);
      if (!page || isTiled(page)) continue;                       // still in a split (or not loaded)
      if (tilingRead && splitOfTab.get(id) && [...splitOfTab].some(([k, v]) => k !== id && v === splitOfTab.get(id))) continue;   // Vivaldi's own tab data: still in its split (only not drawn - another desktop, a swipe): not a window of its own
      inSplit.delete(id);
      if (floating.has(id) || isStart(page)) continue;
      minKind.delete(id);
      floatNow(id, page);                                          // also clears a minimized tile
      requestAnimationFrame(() => popIn(targetOf(pageOf(id))));
    }
    for (const id of new Set([...floating, ...minimized])) {
      const page = pageOf(id);
      if (!page) { if (!floating.has(id)) minimized.delete(id); continue; } // not loaded yet / gone
      const tiledNow = isTiled(page), o = origin.get(id);
      if (!tiledNow && !groupFloat.has(id) && isStart(page)) {     // the desktop is never a window:
        forget(id); continue;                                      // a window that went to the Start Page
      }                                                            // becomes the full desktop
      if (floating.has(id)) {
        if (groupFloat.has(id)) {                                   // a floating split
          // after a restart Vivaldi tiles the pages again a little later: while
          // its own tab data still lists this tab in a split, keep the window
          if (!tiledNow && (!tilingRead || splitOfTab.get(id))) continue;
          if (!tiledNow) {
            groupFloat.delete(id); origin.set(id, { tiled: false, group: "" }); persist(id);
            // the rest of the split stays a floating window
            const prev = (prevGroup.get(id) || "").split(",").filter(m => m && m !== id);
            const prevSet = new Set(prev);
            // only a tile that stayed with the rest of this split (not one that moved elsewhere)
            const heir = prev.find(m => {
              const pg = pageOf(m);
              return pg && isTiled(pg) && !winOf(m) && membersOf(pg).every(x => prevSet.has(x));
            });
            if (heir) passWindow(id, heir);
          }
          continue;                                                 // its split may grow or shrink
        }
        if (!o) origin.set(id, { tiled: tiledNow, group: tiledNow ? groupOf(page) : "" });
        else if (!o.tiled && tiledNow) {                            // a floating window became a split
          const others = membersOf(page).filter(m => m !== id);
          const rivals = others.filter(m => floating.has(m) && !groupFloat.has(m) && origin.get(m) && !origin.get(m).tiled);
          if (rivals.length) {
            const all = [id, ...rivals];
            const lo = lastOver && Date.now() - lastOver.t < 8000 && all.includes(lastOver.id) ? lastOver.id : null;
            const keeper = lo || all.reduce((a, b) => zOrder.indexOf(b) > zOrder.indexOf(a) ? b : a);
            if (keeper !== id) { forget(id); inSplit.add(id); continue; }
            lastOver = null;
          }
          if (others.some(m => groupFloat.has(m) && floating.has(m))) { forget(id); inSplit.add(id); continue; } // into a floating split
          const counts = {};
          for (const m of others) { const g = prevGroup.get(m); if (g) counts[g] = (counts[g] || 0) + 1; }
          const joined = Object.values(counts).some(n => n >= 2);  // it joined a split that already existed
          if (joined || !onDesktop) { forget(id); inSplit.add(id); continue; } // a full-size split
          groupFloat.add(id);                                       // a site was dropped onto it:
          origin.set(id, { tiled: true, group: groupOf(page) });    // the window holds the split now
          persist(id);
          continue;
        }
        else if (o.tiled && tiledNow && groupOf(page) !== o.group) { forget(id); inSplit.add(id); continue; }
        else if (o.tiled && !tiledNow) origin.set(id, { tiled: false, group: "" });
      } else if (!tiledNow && minKind.get(id) === "tile") {
        minimized.delete(id); minKind.delete(id);   // a minimized split tile that left its split
      }
    }
    zOrder = zOrder.filter(id => floating.has(id));
    lastGroup = new Map();
    for (const p of $$("#webpage-stack .webpageview.tiled[data-id]")) lastGroup.set(p.dataset.id, groupOf(p));
  }

  let marked = new Map();                           // element -> { attr: value } from the last render
  let lastSiteTab = null;
  function render() { try { queued = false; } catch (e) {} const t = performance.now(); pipSideCache = new Map(); originCache = new Map(); try { return renderNow(); } finally { pipSideCache = null; originCache = null; perf.render[0]++; perf.render[1] += performance.now() - t; } }
  let focusTry = { id: null, at: 0 };                 // the last window brought up because the keyboard focus was in it
  function renderNow() {
    reconcile();
    bentoForDesk();
    focusForDesk();
    {                                                // the selected tile of a floating split
      const a0 = pendingActive ?? activePage()?.dataset.id, w0 = winOf(a0);
      if (w0 && groupFloat.has(w0) && pageOf(a0)) splitFocus.set(w0, String(a0));
    }
    if (focusSet.size) {                             // windows that left drop out; the chosen tab joins
      for (const f of [...focusSet]) if (!floating.has(f) || minimized.has(f) || awayWs(f)) focusSet.delete(f);   // (gone to another desktop: out of this one's focus)
      const aid = activePage()?.dataset.id, aw = winOf(aid);
      if (Date.now() < focusQuietUntil) focusSeenWin = aw;           // just arrived on this desktop: its front window is not a choice
      else if (focusSet.size && aid && !pendingActive && aw !== focusSeenWin) {   // another tab was chosen (keyboard)
        focusSeenWin = aw;
        if (aw && floating.has(aw) && !minimized.has(aw)) focusSet.add(aw);
        else focusSet.clear();                       // the Start Page or a full-size page: focus ends
      }
    }
    browserEl()?.toggleAttribute("data-ft-focus", focusSet.size > 0);
    const b = browserEl(), s = stackRect();
    if (!b) return;
    watchStack();

    const want = new Map();
    const mark = (el, attr, val = "") => {
      if (!el) return;
      if (!want.has(el)) want.set(el, {});
      want.get(el)[attr] = val;
    };

    const front = topWindow(null);
    if (cover && (!floating.has(cover) || minimized.has(cover) || front !== cover)) cover = null;   // another window came up: full view ends
    for (const p of [...pip]) if (!floating.has(p)) pipOff(p);   // (closed. One not drawn yet - a restart loads it a moment later - or on another desktop keeps its place)
    if (cover) coverWas = cover;
    else if (coverWas) { coverWas = null; coverTill = Date.now() + 450; setTimeout(queueRender, 470); }   // it glides back first
    b.toggleAttribute("data-ft-cover", (!!cover && !coverBeside()) || Date.now() < coverTill);   // (before anything is measured: the page area stops clipping)
    { // the keyboard focus never stays in a window behind the front one: a click in it is
      // then always heard (it focuses the page) and brings that window to the front
      const aw = document.activeElement?.closest?.("[data-ft-float]");
      // (not a window of another desktop - the one just left keeps the focus a moment -, not while sliding or in Mission
      // Control, and one try per window: it never turns into a loop of redraws)
      if (aw && front && aw.dataset.ftFloat !== front && !aw.hasAttribute("data-ft-away") && !awayWs(aw.dataset.ftFloat) && !swiping && !sw && !mission &&
          !(focusTry.id === aw.dataset.ftFloat && Date.now() - focusTry.at < 1000)) setTimeout(() => {
        const w = document.activeElement?.closest?.("[data-ft-float]");
        if (!w || w.dataset.ftFloat === topWindow(null) || w.hasAttribute("data-ft-pip") || awayWs(w.dataset.ftFloat)) return;
        const wid = w.dataset.ftFloat, inner = document.activeElement?.closest?.(".webpageview[data-id]")?.dataset.id;
        focusTry = { id: wid, at: Date.now() };
        const hovered = (hover && Date.now() - hover.t < 1500 && (hover.id === wid || winOf(hover.id) === wid)) ||
                        (window.__ftQuietTint != null && (window.__ftQuietTint === wid || winOf(window.__ftQuietTint) === wid));
        if (hovered) return unfocusPage();                           // only hovered: the focus goes back (the next click is heard)
        const fr = topWindow(null);                                  // the front one came AFTER the focus went there (a new tab - also one
        if (fr && (raisedAt.get(fr) || 0) > focusInAt) return unfocusPage();   // opened in the background): it stays in front; the focus goes
        raise(wid); activate(groupFloat.has(wid) && inner ? inner : wid); render();   // a click in it (its focus event comes a moment later): it comes up
      }, 0);
    }
    const windows = [];
    for (const id of new Set([...floating, ...minimized])) {
      const page = pageOf(id), el = targetOf(page);
      if (!el) continue;
      if (isTiled(page) && el.classList.contains("tile")) { mark(el.parentElement, "data-ft-parent"); mark(siblingOf(el), "data-ft-sibling"); }
      if (minimized.has(id)) { mark(el, "data-ft-min", id); continue; }
      mark(el, "data-ft-float", id);
      const vs = vSplit(id);
      if (vs) for (const mp of vs.pages) if (mp !== el) {                  // a split not drawn: its other panes are this window too
        mark(mp, "data-ft-float", id); mark(mp, "data-vos-vsplit", id);
        if (noTitle.has(id)) mark(mp, "data-ft-notitle");               // (no title bar room on any pane: no band at its top)
        if (awayWs(id)) mark(mp, "data-ft-away");
        for (let p = mp.parentElement; p && p.id !== "webpage-stack"; p = p.parentElement) mark(p, "data-ft-chain");
      }
      if (vs) mark(el, "data-vos-vsplit", id);
      if (id === front) mark(el, "data-ft-front");
      if (noTitle.has(id) || cover === id) mark(el, "data-ft-notitle");   // full view: its title bar moves the Vivaldi window
      if (cover === id && !coverBeside()) mark(el, "data-ft-cover");   // (beside pinned apps: a window, not over the whole Vivaldi window)
      if (pip.includes(id)) mark(el, "data-ft-pip");
      if (awayWs(id)) mark(el, "data-ft-away");                     // another workspace: not on this desktop
      if (focusSet.has(id)) mark(el, "data-ft-focused");
      for (let p = el.parentElement; p && p.id !== "webpage-stack"; p = p.parentElement) mark(p, "data-ft-chain");
      windows.push({ id, el });
    }
    // a full-screen page stays where it is, under the floating windows, when one of them
    // is chosen from the tab bar (the desktop / Home / its own desktop gone: not any more)
    {
      const a0 = pendingActive ?? activePage()?.dataset.id, ap = pageOf(a0);
      if (ap && !winOf(a0) && !isStart(ap) && !isTiled(ap)) underId = String(a0);
      else if (ap && isStart(ap)) underId = null;
      const up = underId && pageOf(underId);
      if (!up || winOf(underId) || isTiled(up)) underId = null;
      else if ((String(a0) !== underId || mission) && !awayWs(underId)) {
        mark(up, "data-ft-under");
        for (let p = up.parentElement; p && p.id !== "webpage-stack"; p = p.parentElement) mark(p, "data-ft-chain");
      }
    }
    // measure everything first (one layout), then write
    const origins = new Map();
    { const h = stack(); if (h) origins.set(h, fixedOrigin(h)); }   // (read now - later uses of it then cost nothing)
    for (const w of windows) {
      if (!origins.has(w.el.parentElement)) origins.set(w.el.parentElement, fixedOrigin(w.el.parentElement));
    }
    let FRAME = 3;                                   // (a split not drawn: the real split's frame, and its panes' origins - read now, with the rest)
    if (windows.some(w => vSplit(w.id))) {
      FRAME = parseFloat(getComputedStyle(b).getPropertyValue("--ft-frame")) || 3;
      for (const w of windows) { const vs = vSplit(w.id); if (vs) for (const mp of vs.pages) if (!origins.has(mp.parentElement)) origins.set(mp.parentElement, fixedOrigin(mp.parentElement)); }
    }
    bentoSync(s);
    { const w = curWs(); if (w !== undefined && w !== lastWsShown) { lastWsShown = w; setTimeout(noBlankFront, 150); } }
    // Mission Control over a full-screen page: the desktop shows (its windows too), the page is one of the windows
    const actM = pendingActive ?? activePage()?.dataset.id, apM = pageOf(actM);
    const mcOver = !!mission && !!apM && !winOf(actM) && !isStart(apM) && !isTiled(apM) && underId === String(actM);
    const upM = mission && underId && !awayWs(underId) && pageOf(underId) && !winOf(underId) && (!mission.frozen || mission.frozen.has(underId)) ? underId : null;
    const mItems = mission ? windows.filter(w => !awayWs(w.id) && w.id !== missionSkip && (!mission.frozen || mission.frozen.has(w.id))).map(w => ({ id: w.id })) : [];
    if (upM) mItems.push({ id: upM, r: { x: 0, y: 0, w: s.width, h: s.height } });
    const slots = mission && (b.hasAttribute("data-ft-desktop") || mcOver) ? missionSlots(mItems, s) : null;
    if (mission) mission.slots = slots;
    missionIcons(slots, s);
    missionMax(s, slots);
    pinBadgesSweep();
    const seenNow = new Map(); deskSeen = { key: deskKey(), w: s.width, h: s.height, map: seenNow };
    for (const { id, el } of windows) {
      addChrome(el, id);
      const held = missionDrag?.id === id;
      const r = held ? missionDrag.r : liveMove?.id === id ? liveMove.base
        : (awayWs(id) && !mission && otherTiles(wsOfTab.get(String(id)), s).get(id)) || pxRect(id, s), o = origins.get(el.parentElement);   // another desktop with Bento on: its place in that Bento (as it shows when you get there)
      if (!held && !awayWs(id)) seenNow.set(id, { r, pin: pip.includes(id) });   // (what this desktop looks like - for its preview from another one)
      const vs = vSplit(id);
      if (vs) {                                                      // a split not drawn: its panes side by side (or one above the other)
        const F = FRAME;                                             // the real split's frame and gap
        const n = vs.pages.length, I = F, G = F, row = vs.layout !== "column";
        let sh = vsShells.get(id);                                   // the window itself behind its panes: its colour, corners, outline, shadow
        if (!sh) { sh = document.createElement("div"); sh.className = "vos-vsplit-shell"; vsShells.set(id, sh); }
        if (sh.parentElement !== el.parentElement) el.parentElement.insertBefore(sh, el.parentElement.firstChild);
        sh.dataset.ftFor = id;
        sh.toggleAttribute("data-ft-away", awayWs(id));
        place(sh, r, s, o);
        const each = ((row ? r.w : r.h) - 2 * I - G * (n - 1)) / n;
        const boxes = splitBoxes(splitOfTab.get(String(id)), { x: r.x + I, y: r.y + I, w: r.w - 2 * I, h: r.h - 2 * I }, G);   // as Vivaldi keeps it (nested, its sizes)
        if (boxes) for (const { id: pid, r: pr } of boxes) { const mp = pageOf(pid); if (mp) place(mp, pr, s, origins.get(mp.parentElement) || fixedOrigin(mp.parentElement)); }
        else vs.pages.forEach((mp, i) => place(mp, row ? { x: r.x + I + i * (each + G), y: r.y + I, w: each, h: r.h - 2 * I }
                                                  : { x: r.x + I, y: r.y + I + i * (each + G), w: r.w - 2 * I, h: each }, s, origins.get(mp.parentElement) || fixedOrigin(mp.parentElement)));
      } else place(el, r, s, o);
      pinBadge(el, id, held || mission ? null : r, s, origins.get(stack()) || o);   // (Mission Control / held in it: none)
      const lifted = focusSet.has(id) || focusLeave.has(id) || (!focusSet.size && focusLift.has(id));   // above the blur
      setStyle(el, "z-index", bentoDrag?.id === id ? "2000"          // Bento: the dragged window rides above the drop preview
        : cover === id && !mission && !coverBeside() ? "90000"                         // full view: over the tab bar and Vivaldi's buttons (under the Launchpad and alerts); Mission Control: a window like the others
        : pip.includes(id) ? String((cover && !coverBeside() ? 90100 : 1900) + (id === front ? 50 : pip.indexOf(id)))   // the corner stack: always on top (over a window in full view too - 1.0.350: and sharp over the focus blur)
        : String((lifted ? 1000 : 100) + zOrder.indexOf(id)));
      if (vs) {
        for (const mp of vs.pages) if (mp !== el) setStyle(mp, "z-index", el.style.getPropertyValue("z-index"));
        const sh = vsShells.get(id); if (sh) setStyle(sh, "z-index", String((Number(el.style.getPropertyValue("z-index")) || 100) - 0));
      }
      placeFrame(id, el, r, s, o);
      missionLook(id, el, held ? { x: r.x, y: r.y, k: missionDrag.k } : slots?.get(id) || null, r);   // Mission Control: scaled, not resized
      frames.get(id)?.toggleAttribute("data-ft-focused", focusSet.has(id));
      frames.get(id)?.toggleAttribute("data-ft-away", awayWs(id));
      frames.get(id)?.toggleAttribute("data-ft-hide", cover === id);   // full view: not resized there
      frames.get(id)?.toggleAttribute("data-ft-pip", pip.includes(id));
    }
    if (focusSet.size) focusLift = new Set(focusSet);
    freezeKeep();
    // a split on this desktop that Vivaldi has not drawn again (back from another desktop): split it again, as it was
    for (const { id } of windows) {
      if (!vSplit(id) || awayWs(id) || swiping || sw || Date.now() - tilingAt < 1500) { vsSince.delete(id); continue; }   // (Mission Control and Bento too: the whole split; a split just made or changed: Vivaldi draws it itself)
      const now = !!mission || !!bento.on;                           // Mission Control / Bento: the whole split at once
      if (!vsSince.has(id)) { vsSince.set(id, Date.now()); if (!now) { setTimeout(queueRender, 900); continue; } }
      if (!now && Date.now() - vsSince.get(id) < 800) { setTimeout(queueRender, 300); continue; }
      if (Date.now() - (vsFixAt.get(id) || 0) < 4000) continue;
      vsFixAt.set(id, Date.now()); vsRetile(id);
    }
    wsAnimate(windows);
    b.toggleAttribute("data-ft-wins", mcOver || windows.some(w => !awayWs(w.id)));   // windows on this desktop (js/launchpad.js)
    veilFor(focusSet.size > 0, s);
    bentoAfterPlace(s);
    pipDividers(s);
    {
      const live = new Set(windows.map(w => w.id));
      for (const [id, f] of frames) if (!live.has(id)) { f.remove(); frames.delete(id); }
      for (const [id, sh] of vsShells) if (!live.has(id) || !vSplit(id)) { if (!sh.hasAttribute("data-vos-incoming") && !sh.hasAttribute("data-vos-out")) { sh.remove(); vsShells.delete(id); } }   // (drawn by Vivaldi again: the real window)
    }

    // apply the difference to the DOM
    for (const [el, attrs] of marked) {
      const w = want.get(el) || {};
      for (const a of Object.keys(attrs)) if (!(a in w)) el.removeAttribute(a);
      // no longer a window (even if still marked for another reason, e.g. as a sibling)
      if ((attrs["data-ft-float"] || attrs["data-ft-min"]) && !w["data-ft-float"] && !w["data-ft-min"]) {
        unplace(el); removeChrome(el);
      }
    }
    for (const [el, attrs] of want) {
      for (const [a, v] of Object.entries(attrs)) if (el.getAttribute(a) !== v) el.setAttribute(a, v);
    }
    marked = want;

    // which space is shown
    const actId = pendingActive ?? activePage()?.dataset.id;
    const act = pageOf(actId);
    const desktop = !!act && (!!winOf(actId) || mcOver);
    if (act && !isStart(act)) onDesktop = !!winOf(actId);
    b.toggleAttribute("data-ft-desktop", desktop);
    b.toggleAttribute("data-vos-desk-bare", !!act && isStart(act) && ![...floating].some(id => !minimized.has(id) && !awayWs(id)));   // 1.0.331: the desktop alone (its apps, no window on it)
    b.toggleAttribute("data-ft-has-floats", floating.size > 0);
    const cwNow = curWs();
    if (act && actId != null && cwNow != null && !pendingActive && sameWs(wsOfTab.get(String(actId)), cwNow)) deskShown.set(String(cwNow), String(actId));   // what this desktop shows (Vivaldi brings it back)
    const emptyHere = tilingRead && cwNow != null && ![...wsOfTab.values()].some(v => sameWs(v, cwNow));
    b.toggleAttribute("data-vos-empty", emptyHere);                    // a desktop with no tab at all
    b.toggleAttribute("data-ft-home", emptyHere || (!!act && isStart(act)));   // the Launchpad page (or a desktop still without one): the Launchpad   // an empty desktop: only its wallpaper (+ opens the Launchpad)   // the Start Page or an empty desktop: the Launchpad
    b.toggleAttribute("data-ft-maxpage", !!act && !desktop && !isStart(act) && !isTiled(act));   // a full-screen page
    b.toggleAttribute("data-vos-fullsplit", !!act && !desktop && !isStart(act) && isTiled(act) && !winOf(actId));   // a split full screen (its window grabber too)
    ensureMaxGrab();
    if (selected && !pageOf(selected)) selected = null;              // closed
    const selId = selected ?? actId;
    b.toggleAttribute("data-ft-hovering", !!selected && !!actId && selected !== String(actId));
    {
      const tp = document.getElementById("tab-" + selId)?.closest(".tab-position");
      for (const o of $$(".tab-position[data-ft-sel]")) if (o !== tp) o.removeAttribute("data-ft-sel");
      if (tp && !tp.hasAttribute("data-ft-sel")) tp.setAttribute("data-ft-sel", "");
    }
    markPills();
    {                                                                // 1.0.252: a minimized app: a thin line under its icon in the tab bar
      const want = new Set();
      for (const m of minimized) {
        if (pip.includes(m)) continue;
        const ids = groupFloat.has(m) ? membersOf(pageOf(m)) : [];
        for (const t of ids.length ? ids : [m]) { const tp = document.getElementById("tab-" + t)?.closest(".tab-position"); if (tp) want.add(tp); }
      }
      for (const o of $$(".tab-position[data-vos-min]")) if (!want.has(o)) o.removeAttribute("data-vos-min");
      for (const tp of want) if (!tp.hasAttribute("data-vos-min")) tp.setAttribute("data-vos-min", "");
    }
    {                                                                // 1.0.279: a window in its own look: its circle in the tab bar too
      const want = new Map();
      if (lookWins.size) {                                             // 1.0.347: each app its own (a split's apps each theirs)
        const tpOf = t => document.getElementById("tab-" + t)?.closest(".tab-position");
        for (const w of floating) for (const t of (groupFloat.has(w) ? membersOf(pageOf(w)) : [w])) { const look = lookWins.get(t), tp = look && tpOf(t); if (tp) want.set(tp, look); }
        for (const [k, look] of lookWins) { const pg = pageOf(k); if (fullPage(k) || (pg && isTiled(pg) && !winOf(k))) { const tp = tpOf(k); if (tp) want.set(tp, look); } }
      }
      for (const o of $$(".tab-position[data-vos-look]")) if (!want.has(o)) o.toggleAttribute("data-vos-look", false);
      for (const [tp, look] of want) if (tp.getAttribute("data-vos-look") !== look) tp.setAttribute("data-vos-look", look);
      const parts = new Map();                                       // 1.0.293: the window itself, its pinned circle and buttons - all that look
      if (lookWins.size) for (const w of floating) { const look = lookOfWin(w); if (!look) continue; const el = targetOf(pageOf(w)); if (el) parts.set(el, look); const pb = pinBadges.get(w); if (pb) parts.set(pb, look); }
      for (const o of $$("#main [data-ft-float][data-vos-look], #webpage-stack > .vos-pin-badge[data-vos-look]")) if (!parts.has(o)) o.removeAttribute("data-vos-look");
      for (const [o, look] of parts) if (o.getAttribute("data-vos-look") !== look) o.setAttribute("data-vos-look", look);
      if (wctl && wctlFor) { const lk = lookOfWin(wctlFor); if ((wctl.getAttribute("data-vos-look") || "") !== lk) { if (lk) wctl.setAttribute("data-vos-look", lk); else wctl.removeAttribute("data-vos-look"); } }
    }
    if (selId !== lastSiteTab) { lastSiteTab = selId; updateSiteName(); }
    else if (siteFor != null) for (const f of $$(".UrlBar-AddressField .UrlField")) {   // a re-drawn field
      if (f.getAttribute("data-ft-site") !== siteFor) f.setAttribute("data-ft-site", siteFor);
    }
    ensureClock();

    ensureLights($$("#webpage-stack .webpageview[data-id]"));
    for (const { id, el } of windows) if (!awayWs(id)) for (const pg of (el.classList.contains("webpageview") ? [el] : $$(".webpageview[data-id]", el))) readTone(pg);   // (each page: every 4s at most)
    if (b.hasAttribute("data-ft-maxpage")) readTone(activePage());
    { const ap = activePage(); if (ap && isTiled(ap) && !winOf(ap.dataset.id)) for (const m of membersOf(ap)) readTone(pageOf(m)); }   // a split shown full screen: its grabbers too
    toneSoon();
  }
  function toneSoon() { if (!toneSoon.q) toneSoon.q = requestAnimationFrame(() => { toneSoon.q = 0; toneFrames(); }); }   // (hoisted: safe from the first redraw)

  /* ---------------- desktop clock: "Mon 16 Nov 3:41" at the top center ---------------- */
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function clockText(d = new Date()) {
    const h = d.getHours() % 12 || 12, m = String(d.getMinutes()).padStart(2, "0");
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${h}:${m}`;
  }
  function ensureClock() {
    const s = stack();
    if (!s) return;
    let c = $(":scope > .ft-clock", s);
    if (!c) {
      c = document.createElement("div");
      c.className = "ft-clock";
      s.appendChild(c);
    }
    const t = clockText();
    if (c.textContent !== t) c.textContent = t;
    clearTimeout(toneTimer);
    toneTimer = setTimeout(clockTone, 300);          // after a burst of changes (theme switch…)
  }

  /* black or white text, from how bright the wallpaper is behind the clock */
  let toneFor = null, toneBusy = false, toneTimer = 0, toneLook = "";
  function clockTone() {
    const b = browserEl();
    if (!b || toneBusy) return;
    // (performance) the wallpaper can only have changed with #browser's classes / style or the page's own style: else
    // nothing to read - reading the style would make the browser work all its styles out again, right then
    const look = b.className + "|" + (b.getAttribute("style") || "") + "|" + (document.documentElement.getAttribute("style") || "");
    if (look === toneLook && toneFor !== null) return;
    toneLook = look;
    const cs = getComputedStyle(b);
    const img = cs.getPropertyValue("--browserBackgroundImage").trim();
    const color = cs.getPropertyValue("--browserBackgroundColor").trim();
    const key = img + "|" + color;
    if (key === toneFor) return;
    toneFor = key;
    const url = /url\((['"]?)(.*?)\1\)/.exec(img)?.[2];
    const setTone = lum => {
      if (lum == null) b.removeAttribute("data-ft-clock-tone");
      else b.setAttribute("data-ft-clock-tone", lum > 0.6 ? "dark" : "light");
    };
    const fromColor = () => {                        // no image: use the background colour
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
      setTone(m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : null);
    };
    if (!url) return fromColor();
    toneBusy = true;
    const measure = async () => {
      // fetch keeps the canvas readable (an <img> from chrome:// would taint it)
      let bmp;
      try { bmp = await createImageBitmap(await (await fetch(url)).blob()); }
      catch {
        bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      }
      const W = 48, H = 27, cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, W, H);                // the wallpaper is stretched over the window
      const d = ctx.getImageData(Math.round(W * 0.3), 0, Math.round(W * 0.4), Math.max(2, Math.round(H * 0.1))).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; }
      return n ? sum / n : null;
    };
    measure().then(setTone, () => setTone(null)).finally(() => { toneBusy = false; });
  }
  (function tick() {                               // update on each new minute
    ensureClock();
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  })();

  /* ---------------- site name in the address field ---------------- */
  function siteName(title = "", url = "") {
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    if (!/^https?:/.test(url)) return title || host;
    const parts = title.replace(/^\(\d+\+?\)\s*/, "").split(/\s+[-|\u2013\u2014\u00b7:]\s+/).map(t => t.trim()).filter(Boolean);
    const label = host.split(".").slice(-2)[0] || host;              // claude.ai -> claude
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const squash = t => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    // the part of the title that names the site ("Example AI — AI-native
    // creative suite" -> "Example AI"; "Inbox - Gmail" -> "Gmail")
    const named = key && parts.filter(t => {
      const q = squash(t);
      return t.length <= 24 && q.length >= 3 && (q.includes(key) || key.startsWith(q));  // "Runway" on runwayml.com
    }).sort((x, y) => x.length - y.length)[0];
    if (named) return named;
    const last = parts[parts.length - 1] || "";
    if (parts.length > 1 && last.length <= 24) return last;          // "Inbox - Gmail" -> "Gmail"
    if (parts.length === 1 && last.length <= 20) return last;        // "Claude"
    return label.charAt(0).toUpperCase() + label.slice(1);          // the site's domain name
  }
  let siteFor = null;
  function updateSiteName() {
    const id = tabIdOf(selected ?? pendingActive ?? activePage()?.dataset.id);
    if (!id) return;
    chrome.tabs.get(id, tab => {
      if (chrome.runtime.lastError || !tab) return;
      const url = tab.url || tab.pendingUrl || "";
      // the desktop (Start Page) shows no address: the field says "Search" (CSS)
      const name = /^(chrome:\/\/(vivaldi-webui\/startpage|newtab)|about:blank|chrome-search:)/.test(url) || !url ? "" : siteName(tab.title || "", url);   // a new tab too: "Search", nothing over it
      siteFor = name;
      for (const f of $$(".UrlBar-AddressField .UrlField")) {
        if (f.getAttribute("data-ft-site") !== name) f.setAttribute("data-ft-site", name);
      }
    });
  }

  /* ---------------- actions ---------------- */
  /* Home: the desktop — the wallpaper with the floating windows on it. The
     front window's tab becomes active (that keeps the desktop up). Only with
     no windows at all is it the empty desktop (a Start Page tab). */
  window.vosShowDesktop = () => showDesktop();
  (function touchScreen() {                           // a touch screen: finger-sized window edges
    const b = browserEl();
    if (!b) return setTimeout(touchScreen, 300);
    if (navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches) b.setAttribute("data-ft-touch-capable", "");
  })();
  // the Launchpad opens an app in the Start Page tab it was opened from: that tab floats once it has a site
  window.vosFloatNext = tabId => { const id = String(tabId); floatOnLoad.add(id); floatOnLoadAt.set(id, Date.now()); siteReady.delete(id); };
  async function showDesktop() {
    underId = null;                                   // Home: the desktop itself
    const w = topWindow(null);
    if (w) {
      const id = groupFloat.has(w) ? (splitFocus.get(w) || w) : w;
      raise(w); activate(id); render();
      return;
    }
    const tabs = await tabsQuery({ currentWindow: true });
    const start = tabs.find(t => /^chrome:\/\/vivaldi-webui\/startpage/.test(t.url || t.pendingUrl || "") &&
                                 !winOf(String(t.id)) && !isTiled(pageOf(t.id)));
    if (start) { activate(String(start.id)); return; }
    // a new tab with no address opens as a blank white page: ask for the Start Page
    chrome.tabs.create({ url: "chrome://vivaldi-webui/startpage", active: true });
  }

  /* ---------------- actions ---------------- */
  async function previousTab(exceptId) {
    const tabs = await tabsQuery({ currentWindow: true }), cw = curWs();
    const others = tabs.filter(t => t.id !== tabIdOf(exceptId) && !t.pinned && !minimized.has(String(t.id)) &&
                                    (cw === undefined || sameWs(wsOfTab.get(String(t.id)) ?? extOf(t)?.workspaceId ?? null, cw)));   // this desktop's only
    if (!others.length) return null;
    return others.filter(t => t.lastAccessed).sort((a, b) => b.lastAccessed - a.lastAccessed)[0] || others[others.length - 1];
  }

  function restore(id) {
    if (!minimized.delete(id)) return;
    minKind.delete(id); persist(id);
    if (floating.has(id)) raise(id);
    activate(id);
    render();
    animateIn(targetOf(pageOf(id)), id);
  }

  const busy = new Set();                           // ignore double clicks during an animation
  async function act(action, page) {
    if (action.startsWith("page-")) return pageAct(action.slice(5), page);
    const id = page.dataset.id;
    if (busy.has(id)) return;
    const tiled = isTiled(page);
    const el = targetOf(page);
    if (action === "minimize" && !tiled && !winOf(id) && !floating.has(id) && !isStart(page)) action = "zoom";
    { const w = winOf(id);                                            // 1.0.293: full screen of any kind - yellow brings the window back
      if (action === "minimize" && w && floating.has(w) && roomOn.has(w)) action = "zoom";                 // (beside pinned apps: back to its size)
      if (action === "minimize" && w && cover === w) { cover = null; raise(w); render(); return; } }      // (the full view over the tab bar: a window again)   // 1.0.278: full screen - yellow brings the window back

    if (action === "zoom") {
      const win = winOf(id);
      if (win && pip.includes(win)) return holdAct("minimize", win);   // held small: back as it was
      if (win && floating.has(win) && !bento.on && pinsLive(win)) {   // 1.0.258: pinned apps here - not a real full screen: the window
        const ss = stackRect(), a = bArea(ss, true), inRoom = roomOn.has(win);   // just grows to fill the room beside them (the wallpaper stays);
        // again: back
        const wEl = targetOf(pageOf(win));
        raise(win); activate(id);
        flip([wEl], () => {
          if (inRoom) { roomOn.delete(win); if (roomPrev.has(win)) { frac[win] = roomPrev.get(win); roomPrev.delete(win); } }
          else { if (frac[win]) roomPrev.set(win, { ...frac[win] }); setPx(win, a, ss); roomOn.add(win); }
          persist(win); render();
        });
        return;
      }
      if (win && floating.has(win)) {                               // back to its place
        if (bento.on && bento.root && bWins(bento.root).some(l => l.win === win)) bento.memo.set(win, bento.root);   // Bento: its layout, kept for its return
        quiet();                                                    // only this window animates
        const wEl = targetOf(pageOf(win));
        if (groupFloat.has(win)) groupMemory.set(win, new Set(membersOf(pageOf(win))));
        activate(id);
        flip([wEl, wEl?.classList.contains("tile") ? siblingOf(wEl) : null], () => { forget(win); render(); });
      } else {
        // a split that was a floating window before: the whole split floats again
        const mem = tiled && [...groupMemory].find(([a, ids]) => ids.has(id) && pageOf(a) && rootOf(pageOf(a)) === rootOf(page));
        if (mem) {
          const a = mem[0];
          groupMemory.delete(a);
          const root = rootOf(page);
          activate(id);
          flip([root], () => { groupFloat.add(a); floatNow(a, pageOf(a)); origin.set(a, { tiled: true, group: groupOf(page) }); render(); });
        } else {                                                    // float onto the desktop
          activate(id);
          flip([el], () => { floatNow(id, page); render(); });
        }
      }
      return;
    }

    if (action === "res") {                        // more room for the site: the page renders smaller
      if (!floating.has(id) && (tiled || isStart(page))) return;      // (1.0.324: a page full screen too)
      if (pip.includes(id)) {                        // held small: its own scale steps (kept while it is small)
        const steps = [0.4, 0.75, 1], now = pinZoomFor(id);
        const i = steps.findIndex(z => Math.abs(z - now) < 0.02), z = steps[(i + 1) % steps.length];
        pipUserZoom.set(id, z);
        webviewsOf(id).forEach(wv => { zoomSet.delete(wv); setWebZoom(wv, z); });
        persist(id);                                                 // (kept after a restart too)
        return;
      }
      const steps = [1, 0.85, 0.7], now = zoomOf[id] || 1;
      const i = steps.findIndex(z => Math.abs(z - now) < 0.02);
      const z = steps[(i + 1) % steps.length] ?? 1;                // any other scale: back to 100%
      if (z === 1) delete zoomOf[id]; else zoomOf[id] = z;
      for (const m of membersOf(pageOf(id))) delete pageZoom[m];   // a split: every page follows the window
      delete pageZoom[id];
      webviewsOf(id).forEach(wv => setWebZoom(wv, z));
      if (pip.includes(id)) syncZooms();                             // in the corner: 70% of that
      const w = targetOf(pageOf(id));
      if (w) {                                                       // the new scale, briefly in the middle
        w.querySelector(":scope > .ft-res-label")?.remove();
        const label = document.createElement("div");
        label.className = "ft-zoom-label ft-res-label";
        label.textContent = Math.round(z * 100) + "%";
        w.appendChild(label);
        label.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
                      { duration: 1100, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => label.remove()) && setTimeout(() => label.remove(), 2500);
      }
      persist(id);
      raise(id); activate(groupFloat.has(id) ? (splitFocus.get(id) || id) : id);   // 1.0.236: it comes forward with the keys - Ctrl + / - then zoom THIS window
      setTimeout(() => webviewsOf(id)[0]?.focus(), 0);
      render();
      return;
    }

    { const w = winOf(id);                                           // minimized or closed: no longer full view / in the corner
      if (w && action === "minimize" && pip.includes(w)) return holdAct("minimize", w);   // in the corner: back to normal
      if (w && action === "close" && pip.includes(w)) closingPip = w;   // closed in the corner: it closes there, at its small size
      else if (w && (action === "minimize" || action === "close")) { if (cover === w) cover = null; const ps = pip.filter(p => p !== w).map(p => targetOf(pageOf(p))); if (pipOff(w)) flip(ps, () => render()); } }
    busy.add(id);
    let fade = null;
    try {
      if (action === "close") {
        const wasFloating = floating.has(id);
        fade = await animateOut(el, "close");                       // stays invisible (fill) until removed
        if (closingPip) { const w = closingPip; closingPip = null; const ps = pip.filter(p => p !== w).map(p => targetOf(pageOf(p))); if (pipOff(w)) flip(ps, () => render()); }   // gone: the others close up
        if (wasFloating) {
          // stay on the desktop: focus the next window before the tab goes away.
          // It stays a hidden floating window until removed, so it never flashes.
          const next = topWindow(id);
          if (next) { raise(next); activate(next); }
          else {
            // only minimized windows left: stay on the desktop (wallpaper, no windows)
            // by making one of their tabs active without bringing it back
            const held = [...zOrder].reverse().find(z => z !== id && minimized.has(z) && pageOf(z) && !awayWs(z));
            if (held) { if (activePage()?.dataset.id !== held) holdDesktop = held; activate(held); }
            else {
              // the last window: back to the desktop (the Start Page), never a blank page
              quiet();
              const tabs = await tabsQuery({ currentWindow: true });
              const start = tabs.find(t => String(t.id) !== id && /^chrome:\/\/vivaldi-webui\/startpage/.test(t.url || t.pendingUrl || "") &&
                                           !winOf(String(t.id)) && !isTiled(pageOf(t.id)));
              if (start) activate(String(start.id));
              else await new Promise(r => chrome.tabs.create({ url: "chrome://vivaldi-webui/startpage", active: true }, () => { void chrome.runtime.lastError; r(); }));
            }
          }
          await new Promise(r => clearStored(id, r));               // a reopened tab must not float again
        } else {
          forget(id);
        }
        const group = groupFloat.has(id) ? membersOf(page).map(tabIdOf).filter(Boolean) : null;
        if (group && group.length) removeTabs(group);               // a floating split: all its tabs
        else if (tiled) vivaldiClose(page)?.click();
        else if (tabIdOf(id)) removeTabs([tabIdOf(id)]);
        const f = fade;
        setTimeout(() => { if (pageOf(id)) f?.cancel(); }, 1500);   // not closed after all: show again
        fade = null;
      } else if (action === "minimize") {
        const sibPage = tiled ? siblingOf(el)?.querySelector(".webpageview[data-id]") : null;
        fade = await animateOut(el, "minimize", id);
        tabImpact(id);                                              // the icon "catches" the window
        if (floating.has(id)) {
          // floating window: focus the next one; if none, stay on the desktop
          // (wallpaper) with this tab active, like an empty macOS desktop
          minimized.add(id); minKind.set(id, "float"); persist(id);
          const next = topWindow(id);
          if (next) { raise(next); activate(next); }
        } else if (tiled) {
          minimized.add(id); minKind.set(id, "tile");
          if (sibPage) activate(sibPage.dataset.id);
        } else {
          // maximized page: go back to the previous tab; if it is the only tab,
          // keep it minimized on the desktop (wallpaper). Its tab brings it back.
          const t = await previousTab(id);
          if (t) activate(String(t.id));
          else {                                                    // the only one here: minimized, and this desktop's Launchpad shows
            minimized.add(id); minKind.set(id, "max");
            await new Promise(r => chrome.tabs.create({ url: "chrome://vivaldi-webui/startpage", active: true }, () => { void chrome.runtime.lastError; r(); }));
          }
        }
        render();
        const f = fade;
        setTimeout(() => f?.cancel(), 450);                         // hidden by now; drop only this fade
        fade = null;
      }
    } finally {
      busy.delete(id);
      fade?.cancel();                                               // something failed: never leave it invisible
    }
  }

  /* ---------------- holding the green or yellow button ----------------
     Green held: the window covers the whole Vivaldi window - over the tab bar and
     Vivaldi's own window buttons - a full view. Yellow held: it shrinks to 70% (the
     page scaled with it) into a stack at the bottom-left corner, above every other
     window: the newest at the bottom, the earlier ones moving up behind it.
     Held again, its green button, or a double-click on its title bar: back as it was. */
  const BTN_HOLD = 450;
  function pipGesture(e, el, id, how) {
    e.preventDefault(); e.stopPropagation();
    raise(id); activate(splitFocus.get(id) || id); render();
    const c = pipCorner.get(id) || "bl", s0 = stackRect(), r0 = pxRect(id, s0);
    const w0 = r0.w, h0 = r0.h, sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const gx = Math.max(0, Math.min(1, (sx - s0.left - r0.x) / Math.max(1, w0))), gy = Math.max(0, Math.min(1, (sy - s0.top - r0.y) / Math.max(1, h0)));   // where it was held, in it
    const shield = document.createElement("div");
    shield.className = "ft-shield"; shield.style.cursor = CURSOR[how] || "grabbing";
    document.body.appendChild(shield);
    let frame = 0, last = null, moved = false, zone = c[1], look = { k: 1, W: w0, H: h0 }, hN = h0;   // hN: its height in its normal window's shape
    const pinAspect = h0 / Math.max(1, w0);
    /* how it looks there - done by the graphics card only: the pinned miniature scaled (it IS its window, smaller: the
       same page, the same layout) and trimmed to that shape. Its real size is set once, at the release, where it shows */
    const morph = (z, side) => {
      zone = z;
      const ss = stackRect();
      let W, H;
      if (z === "m") { const n = frac[id] || { w: 0.5, h: 0.6 }; W = n.w * ss.width; H = n.h * ss.height; }
      else { W = cornerW(side + side, id) ?? w0; H = W * hN / Math.max(1, w0); }
      const k = W / Math.max(1, w0);                                 // one scale: it already has the normal window's shape
      look = { k, W, H: z === "m" ? H : hN * k };
      const rad = el.__vosRad ?? (el.__vosRad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12);
      for (const [e2, o] of [[el, 0], [frames.get(id), RING]]) {
        if (!e2) continue;
        e2.setAttribute("data-vos-pinlook", "");
        e2.style.setProperty("transform-origin", `${Math.round(gx * w0 + o)}px ${Math.round(gy * hN + o)}px`, "important");
        e2.style.setProperty("scale", String(+k.toFixed(4)), "important");
        if (e2 !== el) continue;
        const rr = (rad / k).toFixed(1) + "px";                       // corners as round as a window's, at any scale
        e2.style.setProperty("border-radius", rr, "important");
        e2.style.setProperty("clip-path", `inset(0 round ${rr})`, "important");
      }
    };
    const unlook = () => { el.__vosRad = null; for (const e2 of [el, frames.get(id)]) { if (!e2) continue; for (const k of ["translate", "scale", "transform-origin", "clip-path", "opacity", "border-radius"]) e2.style.removeProperty(k); e2.removeAttribute("data-vos-pinlook"); } };
    const apply = () => {
      frame = 0;
      if (!last) return;
      const dx = last.clientX - sx, dy = last.clientY - sy;
      if (how === "move") {                                          // it follows the pointer; in the middle it IS its normal window (its own
        moved = moved || Math.hypot(dx, dy) > 4;                     // size, shape and 100%), at a side its pinned size - changed once when it
        if (!moved) return;                                          // crosses over (blurred while it changes), else only moved
        if (!pipDrag) {                                              // (once: the others close up; it takes its normal window's shape)
          const n = frac[id] || { w: 0.5, h: 0.6 }, na = (n.h * s0.height) / Math.max(1, n.w * s0.width);
          if (Math.abs(h0 / Math.max(1, w0) - na) > 0.03) hN = Math.round(w0 * na);
          pipDrag = { id, r: { ...r0, h: hN }, mid: false, side: c[1] }; render();
        }
        const f = (last.clientX - s0.left) / s0.width, side = f <= 0.2 ? "l" : f >= 0.8 ? "r" : null, z = side || "m";   // (the middle - a normal window again - is the wide part: 60%)
        if (z !== zone) morph(z, side);
        pipDrag.mid = !side; if (side) pipDrag.side = side;
        const cn = cornerAt(last.clientX, last.clientY);
        pipDrag.corner = null;
        const ec = cn || (side && ((last.clientY - s0.top < s0.height / 2 ? "t" : "b") + side));   // (alone on its side: top or bottom, shown too)
        pipDrag.slot = side ? (pinSlot(side, last.clientY, id) || emptySlot(ec, cornerW(ec, id) ?? w0)) : null;
        { const sw = pipDrag.slot ? (cornerW(pipDrag.slot.corner, id) ?? pipW.get(id) ?? w0) : 0; slotShow(pipDrag.slot, id, sw, pipH.get(id) ?? h0); }   // where it will sit
        setStyle(el, "z-index", "2050"); { const fr = frames.get(id); if (fr) setStyle(fr, "z-index", "2050"); }   // over the line and the other pinned windows
        const t = `${Math.round(dx)}px ${Math.round(dy)}px`;
        el.style.setProperty("translate", t, "important"); frames.get(id)?.style.setProperty("translate", t, "important");
        return;
      }
      if (/[lr]/.test(how)) {                       // the width: every window in this corner follows, each in its own shape
        const W = Math.max(160, Math.min(s0.width * 0.85, w0 + (how.includes("r") ? dx : -dx)));
        for (const p of pip) if ((pipCorner.get(p) || "bl")[1] === c[1]) pipW.set(p, W);   // a free resize: that side's windows (both corners) take the width, each keeps its height
      }
      if (/[tb]/.test(how)) {                       // the height: only this one (its shape changes) - the others keep theirs while there is room
        pipPrio = id;
        pipH.set(id, Math.max(100, Math.min(s0.height - 2 * MARGIN, h0 + (how.includes("b") ? dy : -dy))));
        pipAspect.set(id, pipH.get(id) / Math.max(1, pipW.get(id)));
      }
      render();
    };
    const onMove = ev => { if (ev.pointerId !== pid) return; last = ev; if (!frame) frame = requestAnimationFrame(apply); };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      cancelAnimationFrame(frame); frame = 0;
      if (ev.type === "pointerup") { last = ev; apply(); }           // where it was let go (even when no frame was drawn meanwhile)
      shield.remove();
      removeEventListener("pointermove", onMove, true); removeEventListener("pointerup", onUp, true); removeEventListener("pointercancel", onUp, true);
      if (how !== "move") { persist(id); return render(); }
      const d = pipDrag?.id === id ? pipDrag : null;
      slotShow(null);
      if (!moved || ev.type !== "pointerup" || !d) { unlook(); pipDrag = null; return render(); }
      const sr = stackRect(), els = pip.map(p => targetOf(pageOf(p))).filter(Boolean);
      if (d.mid) {                                                   // let go in the middle: it already is its window - it stays where it is
        // where it shows now (scaled around where it is held, trimmed): its real place - set at once, nothing moves
        const dx = ev.clientX - sx, dy = ev.clientY - sy, k = look.k;
        const r = clampRect({ x: d.r.x + dx + gx * w0 * (1 - k), y: d.r.y + dy + gy * hN * (1 - k), w: look.W, h: look.H }, sr);
        flip(els.filter(e2 => e2 !== el), () => { unlook(); pipDrag = null; pipOff(id); setPx(id, r, sr); persist(id); raise(id); render(); });
        return;
      }
      const to = (ev.clientY < sr.top + sr.height / 2 ? "t" : "b") + d.side;
      flip(els, () => {                                              // it glides into that corner (newest there: at the corner)
        unlook(); pipDrag = null;
        const to2 = d.corner || d.slot?.corner || to;
        { const w = cornerW(to2, id); if (w) pipFit(id, to2, w); }   // that side's width, its own shape
        pipCorner.set(id, to2);
        if (d.slot) { pinOrder(id, d.slot); fillGap(id, d.slot); } else { pip.splice(pip.indexOf(id), 1); pip.push(id); }   // between the ones it was dropped between
        pipZoom(id, true);
        persist(id);
        render();
      });
    };
    shield.__end = () => { try { onUp({ pointerId: pid, type: "pointercancel", clientX: 0, clientY: 0 }); } catch (err) {} };
    addEventListener("pointermove", onMove, true); addEventListener("pointerup", onUp, true); addEventListener("pointercancel", onUp, true);
  }
  let btnHold = null;
  /* held small: the page gets smaller with its window (55%, 1:1); back to normal, it gets its own scale back
     (100%, or whatever it was). In between you can change it - it is not forced. */
  function pipZoom(id, on) {
    // pinned: 75% (or the scale you gave it while pinned); out of the pin: 100% - nothing else to remember
    if (!on) { pipUserZoom.delete(id); delete zoomOf[id]; }
    webviewsOf(id).forEach(wv => {
      const pid = wv.closest(".webpageview")?.dataset.id || id;
      pipZoomWas.delete(pid); delete pageZoom[pid];
      zoomSet.delete(wv);
      setWebZoom(wv, on ? pinZoomFor(id) : 1);
    });
  }
  setTimeout(() => { for (const id of pip) pipZoom(id, true); }, 4000);   // held small before a restart: its page small again
  function pipOff(id) {
    const i = pip.indexOf(id);
    if (i < 0) return false;
    { const c = pipCorner.get(id) || "bl"; pinMem.set(id, { c, w: Math.round(pipW.get(id) || 0) || undefined, h: Math.round(pipH.get(id) || 0) || undefined,
        o: pip.filter(p => (pipCorner.get(p) || "bl") === c).indexOf(id) }); }   // its place, for the next time
    pip.splice(i, 1); pipZoom(id, false); pipH.delete(id); pipW.delete(id); pipAspect.delete(id); pipCorner.delete(id);
    raise(id);                                                       // out of the pin: in front of the others
    persist(id);
    return true;
  }
  /* hold the yellow button of a full-screen page: it becomes a window again, then held small (55%) */
  async function holdSmallFromFull(id) {
    const page = pageOf(id);
    if (!page || floating.has(id)) return;
    await act("zoom", page);                                         // a window on this desktop (the green button's way back)
    await new Promise(r => setTimeout(r, 380));
    if (floating.has(id) && !pip.includes(id)) holdAct("minimize", id);
  }
  /* hold the green button: a new desktop, the window moves there and fills it (a full-screen app, as in macOS) */
  async function fullOnNewDesk(win) {
    if (fullOnNewDesk.busy) return;
    fullOnNewDesk.busy = true;
    try {
      const page = pageOf(splitFocus.get(win) || win);
      if (!page) return;
      // 1. it grows to fill the screen, here (the green button's own animation: a full-screen page now)
      const ids = [...new Set([String(page.dataset.id), ...(isTiled(page) && groupFloat.has(win) ? membersOf(page) : [])])];
      await act("zoom", page);
      await new Promise(r => setTimeout(r, 420));                     // (it has grown)
      // 3. a new desktop, the page moves into it, and you go with it (it stays on the screen all the way)
      const list = (await prefGet("vivaldi.workspaces.list")) || [];
      const ws = await newDesk(list, true);
      if (ws == null) return;
      deskInfo = null;
      let fresh = list;
      for (let i = 0; i < 30; i++) { fresh = (await prefGet("vivaldi.workspaces.list")) || list; if (fresh.some(w => sameWs(w.id, ws))) break; await new Promise(r => setTimeout(r, 50)); }
      const cur = curWs();
      pend(ids, ws);
      await tpMove(ids, ws);
      if (!(await arrivedAt(ids, ws, 1500))) { await tpMove(ids, ws); await arrivedAt(ids, ws, 1200); }
      await switchWs({ id: ws, name: fresh.find(w => sameWs(w.id, ws))?.name || "Desktop" }, fresh);
      chrome.tabs.update(Number(ids[0]), { active: true }, () => void chrome.runtime.lastError);
      for (const i of ids) { floating.delete(i); persist(i); }       // a full-screen app there: never a window again by itself
      deskInfo = null; deskIndicatorNow();
      if (wsStrip) openWsStripNow({ refresh: true });                 // the desktops panel shows the new one
      queueRender();
    } catch (e) { wsErr("full screen on a new desktop", e); }
    finally { fullOnNewDesk.busy = false; }
  }
  function holdAct(what, win) {
    if (what === "res") { const pg = pageOf(win); if (pg) act("res", pg); return; }   // 1.0.349: the grey one held: its page size (a click: light <-> dark)
    const el = targetOf(pageOf(win));
    if (!el || !floating.has(win)) return;
    raise(win); activate(splitFocus.get(win) || win);
    const others = [...floating].filter(p => p !== win && !minimized.has(p) && !awayWs(p)).map(p => targetOf(pageOf(p)));   // the stack, and Bento closing / opening the gap, glide too
    if (what === "zoom") { pipOff(win); cover = null; fullOnNewDesk(win); return; }   // held: a desktop of its own, the app full screen there
    else {
      const r = el.getBoundingClientRect();                          // (55% of the Vivaldi window: pipRect)
      flip([el, ...others], () => {
        if (!pipOff(win)) {
          if (cover === win) cover = null;
          pinBack(win, null, r);                                     // where it was pinned last (else the bottom left, 300 wide)
          persist(win);
        }
        render();
      });
    }
  }
  /* 1.0.242: the window buttons (title bar hidden, normal and pinned): the pointer just OUTSIDE a top corner - or on the top
     edge near it - shows that corner's buttons (left: the coloured ones, right: the scale one). A press there still resizes;
     they go again once the pointer is neither there nor on them */
  /* 1.0.281: a normal window's buttons (title bar hidden) live on their own floating pill - the app's icon, then the
     traffic lights and the scale button - drawn above everything, the tab bar too. Only the pointer at the window's top
     left corner (just outside it, or on the top edge near it) brings it: no blink from the page's top strip. It sits just
     above the window (inside its corner when there is no room), follows it, and goes once the pointer leaves both. */
  let wctl = null, wctlFor = null, cornerH = null, wctlTick = 0;
  const wctlEl = () => {
    const host = browserEl(); if (!host) return null;
    if (wctl && wctl.parentElement === host) return wctl;
    wctl?.remove();
    wctl = document.createElement("div"); wctl.className = "vos-wctl ft-titlebar";
    wctl.innerHTML = `<span class="vos-wctl-ic"><img alt=""></span>` + ctlHtml("win");   // (1.0.285: the shared component, side by side)
    host.appendChild(wctl);
    return wctl;
  };
  let wctlOutT = 0;
  addEventListener("click", e => {                                // 1.0.293: a button clicked: gone quickly (its window's own animation is next)
    if (!wctl || !wctl.contains(e.target) || !e.target.closest?.(".vos-pc")) return;
    if ((btnHeldAt && Date.now() - btnHeldAt < 1500) || e.target.closest('[data-act="res"]')) return;   // 1.0.298: a hold (its look changed) or the scale: they stay
    const b = wctl; b.removeAttribute("data-out"); b.setAttribute("data-gone", ""); b.removeAttribute("data-on");
    wctlFor = null; cornerH = null; clearInterval(wctlTick); clearTimeout(wctlOutT);
    wctlOutT = setTimeout(() => b.removeAttribute("data-gone"), 120);
    wctlMute = Date.now() + 900;                                     // 1.0.294: not back while its window animates (the pointer is still there)
  }, true);
  let wctlMute = 0;
  const wctlOff = () => {                                           // 1.0.289: they go as they came, backwards (the pill back into the circle, the circle down)
    if (wctl?.hasAttribute("data-on")) { wctl.setAttribute("data-out", ""); clearTimeout(wctlOutT); const b = wctl; wctlOutT = setTimeout(() => b.removeAttribute("data-out"), 380); }
    wctl?.removeAttribute("data-on"); wctlFor = null; cornerH = null; clearInterval(wctlTick);
  };
  const wctlPlace = () => {
    if (!wctl || !wctlFor) return false;
    const el = targetOf(pageOf(wctlFor));
    if (!el || !floating.has(wctlFor) || minimized.has(wctlFor) || (el.hasAttribute("data-ft-pip") && !pinBare()) || el.hasAttribute("data-ft-cover")) return false;
    const w = el.getBoundingClientRect(), H = 24, up = w.top >= H + 8;   // 1.0.282: the app's circle (24px), as a pinned app's
    const R = Math.max(up ? 0 : 6, wctlRadius(el));                   // 1.0.350: past its rounded corner - the corner itself stays free to resize from
    let lx = w.left + R; const ty0 = up ? w.top - H - 6 : w.top + 6;
    if (wctlSide === "r") {                                           // 1.0.349: from its top-right corner - mirrored, ending at its right edge
      lx = w.right - R - wctlW;
      if (winLights() && ty0 < 44 && lx + wctlW > innerWidth - 150) lx = innerWidth - 150 - wctlW;   // (not under Vivaldi's own buttons on Windows)
    }
    else if (macLights() && ty0 < 44 && lx < 84) lx = 84;             // 1.0.320: not under Vivaldi's own buttons - just past them
    wctl.style.left = Math.round(lx) + "px";
    wctl.style.top = Math.round(up ? w.top - H - 6 : w.top + 6) + "px";
    wctl.toggleAttribute("data-in", !up);
    return true;
  };
  let wctlSide = "l", wctlW = 0;
  const wctlRadius = el => { const v = parseFloat(getComputedStyle(el).borderTopLeftRadius); return v >= 0 && v < 60 ? v : 17; };
  const WCTL_REACH = 200;                                           // 1.0.350: how far along its top strip, from a corner, the pointer brings them (was 120)
  function wctlShow(id, side = "l") {
    if (Date.now() < wctlMute) return;
    const b = wctlEl(); if (!b) return;
    if (wctlFor === id && b.hasAttribute("data-on") && wctlSide === side) return;
    wctlFor = id; b.dataset.ftPage = id; wctlSide = side; b.toggleAttribute("data-side-r", side === "r");
    const t = groupFloat.has(id) ? (splitFocus.get(id) || id) : id;
    const iconOf = x => { let v = tabIcon(x); if (!v) { const u = pageOf(x)?.querySelector("webview")?.getAttribute("src") || ""; if (/^https?:/.test(u)) try { v = favicon(u); } catch (e) {} } return v; };
    let src = iconOf(t);
    /* 1.0.338: a window holding a split: every app's icon side by side in one pill (as a pinned split's, upright there) */
    { const ic = b.querySelector(".vos-wctl-ic"), mem = groupFloat.has(id) ? membersOf(pageOf(id)) : [], multi = mem.length > 1, want = multi ? mem.length : 1;
      const imgs = () => [...ic.querySelectorAll(":scope > img")];
      while (imgs().length < want) { const x = document.createElement("img"); x.alt = ""; ic.appendChild(x); }
      while (imgs().length > want) imgs().pop().remove();
      ic.toggleAttribute("data-multi", multi); ic.__vosIds = multi ? mem : null;
      if (multi) mem.forEach((m, i) => { const v = iconOf(m), x = imgs()[i]; if (v && x.getAttribute("src") !== v) x.src = v; x.style.visibility = v ? "" : "hidden"; });
      else imgs()[0].style.visibility = ""; }
    const im = b.querySelector(".vos-wctl-ic img");
    if (src && im.getAttribute("src") !== src) im.src = src;
    b.querySelector(".vos-wctl-ic").toggleAttribute("data-empty", !src);
    { const lk = lookOfWin(id); if (lk) b.setAttribute("data-vos-look", lk); else b.removeAttribute("data-vos-look"); }   // (1.0.293: its window's own look - 1.0.347: a split's, the app in front)
    if (b.querySelector(".vos-wctl-ic").hasAttribute("data-multi")) { const ic = b.querySelector(".vos-wctl-ic");
      for (const a of ["data-plate", "data-tint", "data-vos-dim"]) ic.removeAttribute(a);
      for (const v of ["--vos-tint", "--vos-tint-d", "--vos-tint-l"]) ic.style.removeProperty(v);
      ic.removeAttribute("data-empty"); skinMulti(ic, ic.__vosIds || [], splitFocus.get(id)); }
    else { mirrorTab(b.querySelector(".vos-wctl-ic"), b.querySelector(".vos-wctl-ic img"), t);   // 1.0.307: its tab's circle
    { const plate = document.getElementById("tab-" + t)?.getAttribute("data-vos-plate") || "", ic = b.querySelector(".vos-wctl-ic");   // (its tab's plate, as a pinned app's)
      if ((ic.dataset.plate || "") !== plate) { if (plate) ic.dataset.plate = plate; else delete ic.dataset.plate; }
      const tb = document.getElementById("tab-" + t), k = tb?.getAttribute("data-vos-tint") || "", c = tb?.style.getPropertyValue("--vos-tint") || "";   // 1.0.301: its tab's tint
      if ((ic.dataset.tint || "") !== k) { if (k) ic.dataset.tint = k; else delete ic.dataset.tint; }
      if (ic.style.getPropertyValue("--vos-tint") !== c) { if (c) ic.style.setProperty("--vos-tint", c); else ic.style.removeProperty("--vos-tint"); }
      for (const v of ["--vos-tint-d", "--vos-tint-l"]) { const x = tb?.style.getPropertyValue(v) || ""; if (ic.style.getPropertyValue(v) !== x) { if (x) ic.style.setProperty(v, x); else ic.style.removeProperty(v); } } } }
    const g = b.querySelector('[data-act="res"]'), pct = Math.round((zoomOf[id] || 1) * 100), tip = `Light / dark - hold: page size (${pct}%)`;
    if (g.title !== tip) g.title = tip;
    wctlW = b.offsetWidth || 120;                                      // (its width, once - for the right corner)
    if (!wctlPlace()) return wctlOff();
    clearTimeout(wctlOutT); b.removeAttribute("data-out"); b.removeAttribute("data-gone");
    b.removeAttribute("data-on"); void b.offsetWidth; b.setAttribute("data-on", "");
    const follow = () => { if (wctlFor !== id) return; if (!wctlPlace()) return wctlOff(); requestAnimationFrame(follow); };
    requestAnimationFrame(follow);
    clearInterval(wctlTick);
    wctlTick = setInterval(() => {                                   // (over the page the browser hears no moves: checked here)
      if (wctlFor !== id) return clearInterval(wctlTick);
      if (wctlHeld || wctl.matches(":hover")) return;
      if (cornerH?.matches(":hover") && inCorner(id)) return;           // 1.0.348: on its top strip - but only at its corner (further right along it: gone)
      if (document.querySelector(`.ft-frame[data-ft-for="${CSS.escape(id)}"] > .ft-resize:is(.ft-tl, .ft-l, .ft-t):hover`) && inCorner(id)) return;   // (1.0.311: on its edge, between the strip and them)
      wctlOff();
    }, 200);
  }
  function inCorner(id) {                                            // 1.0.348: the pointer at the window's top-left corner (where they came from) - not further along
    const el = targetOf(pageOf(id)), p = wctlXY; if (!el || !p) return false;
    const w = el.getBoundingClientRect(), reach = (macLights() && w.top < 44 && w.left < 84 ? 84 - w.left + WCTL_REACH : WCTL_REACH) + 40;
    if (p[1] <= w.top - 50 || p[1] >= w.top + 44) return false;
    if (wctlSide === "r") return p[0] < w.right + 30 && w.right - p[0] < Math.max(reach, wctlW + 40);   // 1.0.349: its top-right corner
    return p[0] > w.left - 30 && p[0] - w.left < reach;
  }
  addEventListener("pointermove", ev => {
    if (ev.buttons || ev.pointerType === "touch") return;
    const t = ev.target;
    if (wctl && wctl.contains(t)) return;
    wctlXY = [ev.clientX, ev.clientY, t];
    if (mission || lpOn()) return;
    /* 1.0.311: FROM INSIDE ONLY - the strip along the window's own top, at its corner (a window: its left end; a pinned app:
       the end its circle is at). Not from outside it */
    const bar = t?.closest?.("[data-ft-float][data-ft-notitle] > .ft-titlebar"), el = bar?.parentElement, id = bar?.dataset.ftPage && winOf(bar.dataset.ftPage);
    if (!bar || !el || !id) return;
    const w = el.getBoundingClientRect();
    if (el.hasAttribute("data-ft-pip")) {
      const side = (pipCorner.get(id) || "bl")[1], near = side === "r" ? ev.clientX - w.left < 56 : w.right - ev.clientX < 56;   // (its circle's end - 1.0.317: a smaller stretch of it)
      if (near) pinShow(id, bar);
      return;
    }
    const reach = Math.min(macLights() && w.top < 44 && w.left < 84 ? 84 - w.left + WCTL_REACH : WCTL_REACH, w.width / 2);   // 1.0.320: part of its corner under Vivaldi's own buttons: the strip reaches past them (1.0.350: at most half of it)
    if (wctlOk(id, el) && ev.clientX - w.left < reach) { cornerH = bar; wctlShow(id); }
    else if (wctlOk(id, el) && w.right - ev.clientX < Math.min(WCTL_REACH, w.width / 2) && w.width > 300) { cornerH = bar; wctlShow(id, "r"); }   // 1.0.349: its top-right corner - the same, mirrored
  }, { capture: true, passive: true });
  let pinShown = null, pinShowT = 0;
  function pinShow(id, bar) {                                        // a pinned app's circle and buttons, brought from inside its corner
    const b = pinBadges.get(id); if (!b || badgeHeld === id) return;   // (held by its circle: no buttons)
    if (pinShown && pinShown !== b) pinShown.removeAttribute("data-show");
    pinShown = b; if (!b.hasAttribute("data-show")) b.setAttribute("data-show", "");
    clearInterval(pinShowT);
    pinShowT = setInterval(() => {                                   // (kept while the pointer is on its corner, its circle or its buttons)
      if (b.matches(":hover") || bar?.matches(":hover") || b.__vosHover || badgeHeld === id) return;
      b.removeAttribute("data-show"); if (pinShown === b) pinShown = null; clearInterval(pinShowT);
    }, 200);
  }
  let wctlXY = null, wctlHeld = false;
  addEventListener("pointerdown", e => {                          // 1.0.297: its window resized (an edge or corner pressed): they stay, following it
    const h = e.button === 0 && wctlFor && e.target?.closest?.(".ft-frame > .ft-resize");
    if (!h || h.parentElement?.dataset.ftFor !== wctlFor) return;
    wctlHeld = true;
    const up = ev => { if (ev.pointerId !== e.pointerId) return; wctlHeld = false; removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true); };
    addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }, true);
  addEventListener("pointerdown", e => {                          // 1.0.284: the circle is a handle, as a pinned app's - pressed, its window moves
    if (e.button !== 0 || !wctl || !wctlFor || !e.target?.closest?.(".vos-wctl-ic") || !wctl.contains(e.target)) return;
    const id = wctlFor, el = targetOf(pageOf(id)); if (!el || mission || lpOn()) return;
    wctlHeld = true;                                                 // 1.0.287: held: the circle and its buttons stay, moving with the window
    const up = ev => { if (ev.pointerId !== e.pointerId) return; wctlHeld = false; removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true); };
    addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    startGesture(e, el, "move");
  }, true);
  const pinBare = () => false;
  const winLights = () => { const b = browserEl(); return !!b && b.classList.contains("win") && !b.classList.contains("fullscreen"); };   // (1.0.349: Vivaldi's own buttons, top right, on Windows)
  const macLights = () => { const b = browserEl(); return !!b && b.classList.contains("mac") && !b.classList.contains("fullscreen"); };   // (Vivaldi's own buttons on show, top left)                                     // (1.0.308: a pinned app's own circle comes at its corner instead)                  // 1.0.302: pinned apps without their circle (Bento, or a window full beside them):
  const wctlOk = (id, el) => floating.has(id) && el.hasAttribute("data-ft-notitle") && !el.hasAttribute("data-ft-cover") && (!el.hasAttribute("data-ft-pip") || pinBare()) && !minimized.has(id) && !awayWs(id);   // their corner brings it, as a window's
  function wctlZone(id) {                                            // the corner's area: 30px out from it, 100px along the top
    const el = targetOf(pageOf(id)); if (!el || !wctlXY) return false;
    if (wctlXY[2]?.closest?.("webview") || document.querySelector("webview:hover")) return false;   // (in a page: gone)
    const w = el.getBoundingClientRect(), [x, y] = wctlXY;
    return x >= w.left - 30 && x <= w.left + 100 && y >= w.top - 30 && y <= w.top + 4;
  }
  addEventListener("pointerdown", ev => {
    btnHeldAt = 0;                                                   // a new press: the last hold's click is long gone
    if (btnHold) { clearTimeout(btnHold.t); btnHold.btn.removeAttribute("data-ft-holding"); btnHold = null; }
    if (ev.button !== 0) return;
    const btn = ev.target?.closest?.('.ft-titlebar .ft-light[data-act="zoom"], .ft-titlebar .ft-light[data-act="minimize"], .ft-lights .ft-light[data-act="minimize"], .ft-titlebar .ft-light[data-act="res"]');
    let win = btn && winOf(btn.closest(".ft-titlebar")?.dataset.ftPage);
    const fsb = !win && btn?.closest(".vos-fsctl");                // 1.0.324: the full-screen buttons in the toolbar
    const maxPg = fsb ? pageOf(fsb.dataset.ftPage) : !win && btn?.closest(".ft-lights") ? btn.closest(".webpageview[data-id]") : null;   // a full-screen page's own buttons
    if (maxPg) { if (winOf(maxPg.dataset.id) || isTiled(maxPg) || isStart(maxPg)) return; win = maxPg.dataset.id; }
    else if (!win || !floating.has(win) || minimized.has(win)) return;
    const hold = { btn, x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
    btn.setAttribute("data-ft-holding", "");
    hold.t = setTimeout(() => {
      btn.removeAttribute("data-ft-holding");
      if (btnHold === hold) btnHold = null;
      btnHeldAt = Date.now();                                        // the click on letting go is not a click
      if (maxPg && btn.dataset.act !== "res") return holdSmallFromFull(win);
      holdAct(btn.dataset.act, win);
    }, BTN_HOLD);
    btnHold = hold;
  }, true);
  const btnLetGo = ev => {
    if (!btnHold || ev.pointerId !== btnHold.pid) return;
    if (ev.type === "pointermove" && Math.hypot(ev.clientX - btnHold.x, ev.clientY - btnHold.y) < 10) return;
    clearTimeout(btnHold.t); btnHold.btn.removeAttribute("data-ft-holding"); btnHold = null;
  };
  for (const t of ["pointerup", "pointercancel", "pointermove"]) addEventListener(t, btnLetGo, { capture: true, passive: true });

  /* PUT THE BUTTONS AWAY: drag a window's buttons (the traffic lights, or the scale button) away - down into the
     window, or out of it - and let go: they are gone from it; they come back once the mouse has left the window and
     come in again. Only nudged (let go near their place): they glide back. Their corners never change. A press
     without moving is a click (or a hold). */
  const CTRL_AWAY = 44;                                              // px from its place: let go there, it is put away
  function ctrlDrag(e, box, kind) {
    const win = box.closest("[data-ft-float]") || box.closest(".webpageview"); if (!win || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    let moving = false, out = false;
    const outside = (x, y) => { const r = win.getBoundingClientRect(); return x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2; };
    const gone = (x, y) => Math.hypot(x - sx, y - sy) >= CTRL_AWAY || outside(x, y);   // far enough (down into the window, or out of it)
    const move = ev => {
      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moving && Math.hypot(dx, dy) < 8) return;
      if (!moving) { moving = true; box.setAttribute("data-vos-ctrl-drag", ""); }
      ev.preventDefault();
      out = gone(ev.clientX, ev.clientY);
      box.toggleAttribute("data-vos-ctrl-out", out);                // far enough: it fades (let go: gone)
      box.style.setProperty("transform", `translate(${dx}px, ${dy}px)`, "important");
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
      if (!moving) return;                                           // a press: the button's own click
      const swallow = c => { c.preventDefault(); c.stopPropagation(); c.stopImmediatePropagation(); };   // the click on letting go is not a click
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, true), 400);
      const away = ev.type === "pointerup" && gone(ev.clientX, ev.clientY);
      box.removeAttribute("data-vos-ctrl-drag"); box.removeAttribute("data-vos-ctrl-out");
      if (away) {
        const t = box.style.getPropertyValue("transform");
        box.style.removeProperty("transform");
        box.animate([{ transform: t, opacity: 0.5 }, { transform: t + " scale(0.4)", opacity: 0 }], { duration: 180, easing: "ease-in" });
        ctrlHide(box, win);
        return;
      }
      const before = box.getBoundingClientRect();
      box.style.removeProperty("transform");
      const after = box.getBoundingClientRect();                     // let go inside: it glides back
      box.animate([{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
    };
    e.preventDefault(); e.stopPropagation();
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }
  /* away until the mouse has been in the window, gone out of it, and come back */
  function ctrlHide(box, win) {
    box.setAttribute("data-vos-ctrl-hid", "");
    let wasIn = false, wasOut = false;
    const inWin = (x, y) => { const r = win.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    const watch = ev => {
      if (!box.isConnected || !win.isConnected) return stop();
      const inside = inWin(ev.clientX, ev.clientY);
      if (inside && !wasIn) wasIn = true;
      else if (!inside && wasIn) wasOut = true;
      else if (inside && wasOut) { stop(); box.removeAttribute("data-vos-ctrl-hid"); box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" }); }
    };
    const stop = () => { removeEventListener("pointermove", watch, true); box.__vosCtrlStop = null; };
    box.__vosCtrlStop?.();
    box.__vosCtrlStop = stop;
    addEventListener("pointermove", watch, { capture: true, passive: true });
  }

  /* ---------------- move / resize ---------------- */
  const CURSOR = { move: "grabbing", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize",
                   tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize" };
  /* ---------------- scaling (hold an edge, then drag) ----------------
     (Off: holding an edge no longer scales; the grey button sets the scale.)
     Press and hold a window's edge or corner without moving: a gentle flash,
     and the window breathes - scaling mode (hold again: back to resizing,
     no need to let go). Dragging now scales it like a picture: the
     same proportions, and the page inside zooms with it (only that window;
     other tabs of the site keep their zoom). The title bar gets the new width
     but keeps its own size. Close to 100% it snaps to normal. */
  const HOLD_MS = 1400, SLOP = 4, ZMIN = 0.4, ZMAX = 2;
  const zoomSet = new WeakMap();                     // webview -> the zoom we gave it
  const webviewsOf = id => { const el = targetOf(pageOf(id)); return el ? $$("webview", el) : []; };
  function zoomHear(wv) {                           // a zoom you set (Ctrl + / -, a pinch): it stays this page's zoom
    if (!wv || wv.__vosZoomHear || typeof wv.addEventListener !== "function") return;
    wv.__vosZoomHear = true;
    wv.addEventListener("zoomchange", ev => {
      const z = +Number(ev.newZoomFactor).toFixed(3);
      if (!(z > 0) || Math.abs(z - (zoomSet.get(wv) ?? -1)) < 0.002) return;   // (one Bento OS set)
      zoomSet.set(wv, z);
      const pid = wv.closest(".webpageview")?.dataset.id, id = pid && (winOf(pid) || pid);
      if (!pid) return;
      if (id && pip.includes(id)) pipUserZoom.set(id, z); else pageZoom[pid] = z;
      if (id) persist(id);
    });
  }
  (window.vosBeat || (f => setInterval(f, 2500)))(() => { for (const wv of document.querySelectorAll("#webpage-stack webview")) zoomHear(wv); });
  function setWebZoom(wv, z) {
    if (!wv || typeof wv.setZoom !== "function") return;
    zoomHear(wv);
    if (!wv.__ftZoomHook) {                          // a new page in it starts at its own zoom: re-apply
      wv.__ftZoomHook = true;
      wv.addEventListener("loadcommit", ev => { if (ev.isTopLevel) { zoomSet.delete(wv); setTimeout(syncZooms, 60); } });
    }
    if (zoomSet.get(wv) === z) return;
    zoomSet.set(wv, z);
    const go = () => { try { wv.setZoom(z); } catch (_) {} };
    if (!wv.__ftZoomMode) { wv.__ftZoomMode = true; try { wv.setZoomMode("per-view", go); } catch (_) { go(); } }
    else go();
  }
  function syncZooms() {
    if (document.hidden || (!Object.keys(zoomOf).length && !Object.keys(pageZoom).length && !pip.length)) return;
    for (const id of floating) webviewsOf(id).forEach(wv => {
      const own = pageZoom[wv.closest(".webpageview")?.dataset.id];
      let z = own ?? zoomOf[id];
      if (pip.includes(id)) z = pinZoomFor(id);                    // pinned: still its miniature after a new page loads (or the scale you chose)
      if (z) setWebZoom(wv, z);
    });
  }
  vosBeat(syncZooms);

  /* closing the last tab(s) never closes Vivaldi (like Vivaldi's own setting
     "never close the last tab", which chrome.tabs.remove skips): the desktop
     (Start Page) opens first, then the tabs go */
  function removeTabs(ids) {
    const gone = new Set(ids.map(Number));
    chrome.tabs.query({ currentWindow: true }, tabs => {
      const left = (tabs || []).filter(t => !gone.has(t.id));
      if (left.length) return chrome.tabs.remove([...gone]);
      chrome.tabs.create({ url: "chrome://vivaldi-webui/startpage", active: true }, () => chrome.tabs.remove([...gone]));
    });
  }

  /* ======================= BENTO: organize the windows =======================
     Ported from Bento (a macOS window manager): one split tree for the desktop.
     Turn it on with the Bento button in the tab bar (left, after Home): every
     floating window gets a slot, the most recent one a large pane, with a gap
     between them. New windows join in the largest slot; closed or minimized
     ones leave and the tree closes up. Turn it off: every window goes back to
     where it was.
       drag a window by its title bar onto another   quick drop = swap places
       hold it over another window's edge            split beside it (preview)
       drag a gap between windows / a window's edge  resize that split
       drop anywhere else                            it springs back
     Engine (BentoCore): LayoutEngine.calculate, AutoLayout.activating /
     arrange / insert, Workspace.placing; minimum sizes are always kept. */
  const BGAP = 10, BHOLD = 320, BENTO_KEY = "vivaldiOsBento";
  const bento = { on: false, root: null, pre: {}, skip: new Set(), layout: null, rects: new Map(), shape: "", pendingFlip: null,
                  memo: new Map(),                // window -> the layout it left for full screen (it comes back to it)
                  handles: [], handlesKey: "", gesture: null, undo: [], redo: [] };
  let bentoDrag = null;                             // { id, rect } a tiled window being dragged
  let bUid = 0;
  const bid = () => "b" + (++bUid);
  const bLeaf = win => ({ t: "w", id: bid(), win, min: { w: MIN_W, h: MIN_H } });
  const bSplit = (axis, ratio, a, b) => ({ t: "s", id: bid(), axis, ratio, a, b });
  const bWins = n => !n ? [] : n.t === "w" ? [n] : [...bWins(n.a), ...bWins(n.b)];
  const bShape = n => !n ? "" : n.t === "w" ? n.win : `(${n.axis}${bShape(n.a)},${bShape(n.b)})`;
  const bReplace = (n, target, r) => n.id === target ? r : n.t === "w" ? n : { ...n, a: bReplace(n.a, target, r), b: bReplace(n.b, target, r) };
  function bRemove(n, win) {
    if (!n) return null;
    if (n.t === "w") return n.win === win ? null : n;
    const a = bRemove(n.a, win), b = bRemove(n.b, win);
    return !a ? b : !b ? a : { ...n, a, b };
  }
  const bResizing = (n, target, ratio) => n.t === "w" ? n
    : { ...n, ratio: n.id === target ? ratio : n.ratio, a: bResizing(n.a, target, ratio), b: bResizing(n.b, target, ratio) };
  function bMin(n) {
    if (n.t === "w") return n.min;
    const x = bMin(n.a), y = bMin(n.b);
    return n.axis === "h" ? { w: x.w + BGAP + y.w, h: Math.max(x.h, y.h) } : { w: Math.max(x.w, y.w), h: x.h + BGAP + y.h };
  }
  class CannotFit extends Error {}
  function bCalc(root, area) {                     // LayoutEngine.calculate
    const res = { regions: [], dividers: [] };
    const visit = (n, r) => {
      const m = bMin(n);
      if (r.w < m.w || r.h < m.h) throw new CannotFit();
      if (n.t === "w") { res.regions.push({ leaf: n, r }); return; }
      const h = n.axis === "h", m1 = bMin(n.a), m2 = bMin(n.b);
      const len = (h ? r.w : r.h) - BGAP;
      const first = Math.max(h ? m1.w : m1.h, Math.min(len - (h ? m2.w : m2.h), Math.round(len * Math.max(0, Math.min(1, n.ratio)))));
      const A = h ? { x: r.x, y: r.y, w: first, h: r.h } : { x: r.x, y: r.y, w: r.w, h: first };
      const B = h ? { x: r.x + first + BGAP, y: r.y, w: len - first, h: r.h } : { x: r.x, y: r.y + first + BGAP, w: r.w, h: len - first };
      res.dividers.push({ id: n.id, axis: n.axis, parent: r,
        r: h ? { x: r.x + first, y: r.y, w: BGAP, h: r.h } : { x: r.x, y: r.y + first, w: r.w, h: BGAP } });
      visit(n.a, A); visit(n.b, B);
    };
    if (root) visit(root, area);
    return res;
  }
  const bFits = (root, area) => { try { bCalc(root, area); return true; } catch (e) { if (e instanceof CannotFit) return false; throw e; } };
  function bArrange(leaves, area) {                // AutoLayout.arrange: balanced, deterministic
    if (!leaves.length) return null;
    const failed = new Set();
    let budget = 20000;
    const build = (start, count, w, h) => {
      if (--budget < 0 || w <= 0 || h <= 0) return null;
      if (count === 1) { const l = leaves[start]; return w >= l.min.w && h >= l.min.h ? l : null; }
      const key = `${start}:${count}:${w}:${h}`;
      if (failed.has(key)) return null;
      const wide = w >= h * 1.35, mid = count / 2, counts = [];
      for (let i = 1; i < count; i++) counts.push(i);
      counts.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
      for (const horiz of [wide, !wide]) for (const fc of counts) {
        const len = (horiz ? w : h) - BGAP;
        const minA = Math.max(...leaves.slice(start, start + fc).map(l => horiz ? l.min.w : l.min.h));
        const minB = Math.max(...leaves.slice(start + fc, start + count).map(l => horiz ? l.min.w : l.min.h));
        if (len < minA + minB) continue;
        const tried = new Set();
        for (const raw of [Math.floor(len / 2), Math.round(len * fc / count), minA, len - minB]) {
          const cut = Math.max(minA, Math.min(len - minB, raw));
          if (tried.has(cut)) continue;
          tried.add(cut);
          const a = build(start, fc, horiz ? cut : w, horiz ? h : cut);
          const b = a && build(start + fc, count - fc, horiz ? len - cut : w, horiz ? h : len - cut);
          if (a && b) return bSplit(horiz ? "h" : "v", cut / len, a, b);
        }
      }
      failed.add(key);
      return null;
    };
    const root = build(0, leaves.length, area.w, area.h);
    if (!root) throw new CannotFit();
    return root;
  }
  /* the most recent window gets the biggest slot, the next one the biggest of
     what is left, and so on (leaves come most recent first) */
  function bRecency(leaves, area) {
    if (!leaves.length) return null;
    const build = (ls, r) => {
      if (ls.length === 1) return ls[0];
      const [p, ...rest] = ls, horiz = r.w >= r.h;
      const len = (horiz ? r.w : r.h) - BGAP, share = Math.min(0.6, 1.4 / ls.length);
      const cut = Math.round(len * share);
      const sub = horiz ? { x: r.x + cut + BGAP, y: r.y, w: len - cut, h: r.h } : { x: r.x, y: r.y + cut + BGAP, w: r.w, h: len - cut };
      return bSplit(horiz ? "h" : "v", cut / len, p, build(rest, sub));
    };
    const root = build(leaves, area);
    return bFits(root, area) ? root : null;
  }
  function bActivate(leaves, area) {
    { const r = bRecency(leaves, area); if (r) return r; }               // AutoLayout.activating: the most recent gets a large pane
    let cand = leaves.filter(l => l.min.w <= area.w && l.min.h <= area.h);
    const largest = (root, win) => {
      const rs = bCalc(root, area).regions, size = r => r.r.w * r.r.h;
      const p = rs.find(r => r.leaf.win === win);
      return !!p && rs.every(r => size(r) <= size(p));
    };
    while (cand.length) {
      const [p, ...rest] = cand;
      if (!rest.length) return p;
      const wide = area.w >= area.h;
      for (const horiz of [wide, !wide]) {
        const len = (horiz ? area.w : area.h) - BGAP, mn = horiz ? p.min.w : p.min.h;
        if (len <= mn) continue;
        for (const cut of [...[0.6, 0.55, 0.5].map(k => Math.max(mn, Math.ceil(len * k))), mn]) {
          if (cut >= len) continue;
          const sec = horiz ? { x: area.x + cut + BGAP, y: area.y, w: len - cut, h: area.h }
                            : { x: area.x, y: area.y + cut + BGAP, w: area.w, h: len - cut };
          let g;
          try { g = bArrange(rest, sec); } catch (e) { continue; }
          const root = bSplit(horiz ? "h" : "v", cut / len, p, g);
          if (largest(root, p.win)) return root;
        }
      }
      try { return bArrange(cand, area); } catch (e) { /* too many: the oldest stays floating */ }
      cand = cand.slice(0, -1);
    }
    return null;
  }
  function bInsert(leaf, root, area) {             // AutoLayout.insert: beside the largest slot that fits
    if (!root) return leaf.min.w <= area.w && leaf.min.h <= area.h ? leaf : null;
    const regions = bCalc(root, area).regions.sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h);
    for (const { leaf: l, r } of regions) {
      const wide = r.w >= r.h * 1.35;
      for (const horiz of [wide, !wide]) {
        const cand = bReplace(root, l.id, bSplit(horiz ? "h" : "v", 0.5, l, leaf));
        if (bFits(cand, area)) return cand;
      }
    }
    try { return bArrange([...bWins(root), leaf], area); } catch (e) { return null; }
  }
  function bPlacement(r, p) {                      // LayoutEngine.placement
    const x = (p.x - r.x) / r.w, y = (p.y - r.y) / r.h;
    if (x >= 0.35 && x <= 0.65 && y >= 0.35 && y <= 0.65) return "center";   // the sides: 35% each, easy to reach
    const near = Math.min(x, 1 - x, y, 1 - y);
    return near === x ? "left" : near === 1 - x ? "right" : near === y ? "top" : "bottom";
  }
  function bPlacing(root, src, target, placement) { // Workspace.placing: swap, or split beside the target
    const s = bWins(root).find(l => l.win === src), t = bWins(root).find(l => l.id === target);
    if (!s || !t || s === t) return null;
    if (placement === "center") {
      const swap = n => n.t === "w" ? (n === s ? { ...n, win: t.win } : n === t ? { ...n, win: s.win } : n)
                                    : { ...n, a: swap(n.a), b: swap(n.b) };
      return swap(root);
    }
    const without = bRemove(root, src);
    const h = placement === "left" || placement === "right", srcFirst = placement === "left" || placement === "top";
    const t2 = bWins(without).find(l => l.win === t.win);
    return bReplace(without, t2.id, bSplit(h ? "h" : "v", 0.5, srcFirst ? s : t2, srcFirst ? t2 : s));
  }

  /* ResizeHandles (Bento): equivalent split trees expose every seam without
     moving a window. Dividers that line up into one continuous seam get one
     long shared grabber; the short local grabbers stay for single sections
     and win near their centre (80px); the rest of the seam is the shared one. */
  const bSame = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const bNode = (n, id) => !n || n.t === "w" ? null : n.id === id ? n : bNode(n.a, id) || bNode(n.b, id);
  function bHandles(root, area) {
    const orig = bCalc(root, area);
    const res = orig.dividers.map(d => ({ d, root }));
    const end = (r, h) => h ? r.r.x + r.r.w : r.r.y + r.r.h, beg = (r, h) => h ? r.r.x : r.r.y;
    const cuts = (regions, axis) => {
      const h = axis === "h";
      return [...new Set(regions.map(r => end(r, h)))].sort((a, b) => a - b).filter(cut => {
        const first = regions.filter(r => end(r, h) <= cut), second = regions.filter(r => beg(r, h) >= cut + BGAP);
        return first.length && second.length && first.length + second.length === regions.length
          && first.some(r => end(r, h) === cut) && second.some(r => beg(r, h) === cut + BGAP);
      });
    };
    const build = (regions, rect, forced, preferred) => {
      if (regions.length === 1) return bSame(regions[0].r, rect) ? regions[0].leaf : null;
      const choices = forced ? [forced]
        : [preferred, preferred === "h" ? "v" : "h"].flatMap(ax => cuts(regions, ax).map(cut => [ax, cut]));
      for (const [ax, cut] of choices) {
        const h = ax === "h";
        const first = regions.filter(r => end(r, h) <= cut), second = regions.filter(r => beg(r, h) >= cut + BGAP);
        if (!first.length || !second.length || first.length + second.length !== regions.length) continue;
        const len = (h ? rect.w : rect.h) - BGAP, start = h ? rect.x : rect.y;
        const A = h ? { x: rect.x, y: rect.y, w: cut - start, h: rect.h } : { x: rect.x, y: rect.y, w: rect.w, h: cut - start };
        const B = h ? { x: cut + BGAP, y: rect.y, w: rect.x + rect.w - cut - BGAP, h: rect.h }
                    : { x: rect.x, y: cut + BGAP, w: rect.w, h: rect.y + rect.h - cut - BGAP };
        const a = build(first, A, null, preferred), b = a && build(second, B, null, preferred);
        if (!a || !b) continue;
        const bounds = h ? { x: cut, y: rect.y, w: BGAP, h: rect.h } : { x: rect.x, y: cut, w: rect.w, h: BGAP };
        const same = orig.dividers.find(d => d.axis === ax && bSame(d.r, bounds) && bSame(d.parent, rect));
        return { t: "s", id: same ? same.id : bid(), axis: ax, ratio: (cut - start) / len, a, b };
      }
      return null;
    };
    const visited = new Set();
    const visit = (node, rect, base) => {
      const lay = bCalc(node, rect), key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (!visited.has(key)) {
        visited.add(key);
        for (const ax of ["h", "v"]) for (const cut of cuts(lay.regions, ax)) {
          const alt = build(lay.regions, rect, [ax, cut], ax);
          if (!alt) continue;
          const cand = bReplace(base, node.id, alt);
          let geo;
          try { geo = bCalc(cand, area); } catch (e) { continue; }
          if (!geo.regions.every(r => orig.regions.some(o => o.leaf.win === r.leaf.win && bSame(o.r, r.r)))) continue;
          for (const d of geo.dividers)
            if (!res.some(x => x.d.axis === d.axis && bSame(x.d.r, d.r) && bSame(x.d.parent, d.parent))) res.push({ d, root: cand });
          visit(alt, rect, cand);
        }
      }
      if (node.t === "s") {
        const d = lay.dividers[0].r, h = node.axis === "h";
        visit(node.a, h ? { x: rect.x, y: rect.y, w: d.x - rect.x, h: rect.h } : { x: rect.x, y: rect.y, w: rect.w, h: d.y - rect.y }, base);
        visit(node.b, h ? { x: d.x + d.w, y: rect.y, w: rect.x + rect.w - d.x - d.w, h: rect.h }
                        : { x: rect.x, y: d.y + d.h, w: rect.w, h: rect.y + rect.h - d.y - d.h }, base);
      }
    };
    visit(root, area, root);
    const inside = (a, b) => a.d.axis === b.d.axis && (a.d.axis === "h"     // a is a longer seam holding b
      ? a.d.r.x === b.d.r.x && a.d.r.y <= b.d.r.y && a.d.r.y + a.d.r.h >= b.d.r.y + b.d.r.h && a.d.r.h > b.d.r.h
      : a.d.r.y === b.d.r.y && a.d.r.x <= b.d.r.x && a.d.r.x + a.d.r.w >= b.d.r.x + b.d.r.w && a.d.r.w > b.d.r.w);
    for (const x of res) {
      x.universal = !res.some(o => inside(o, x));
      x.shared = res.some(o => inside(x, o));
      x.key = `${x.d.axis}:${x.d.r.x},${x.d.r.y},${x.d.r.w},${x.d.r.h}`;
    }
    for (const x of res) x.parts = res.filter(o => inside(x, o)).map(o => o.key);   // the singles along a joined seam
    return res;
  }
  /* InteractionGeometry.snappingSeam: a dragged divider that comes near an
     adjoining parallel one (within 24px) sticks to it, so the slots line up
     and the seam joins; pulling further away breaks it again. */
  const SNAP = 24;
  function bSnap(root, id, area) {
    const lay = bCalc(root, area), mv = lay.dividers.find(d => d.id === id);
    if (!mv) return root;
    const h = mv.axis === "h", pos = h ? mv.r.x : mv.r.y;
    const near = lay.dividers.filter(o => o.id !== id && o.axis === mv.axis && (h
        ? Math.abs(o.r.y + o.r.h - mv.r.y) <= BGAP || Math.abs(mv.r.y + mv.r.h - o.r.y) <= BGAP
        : Math.abs(o.r.x + o.r.w - mv.r.x) <= BGAP || Math.abs(mv.r.x + mv.r.w - o.r.x) <= BGAP)
      && Math.abs((h ? o.r.x : o.r.y) - pos) <= SNAP)
      .sort((a, b) => Math.abs((h ? a.r.x : a.r.y) - pos) - Math.abs((h ? b.r.x : b.r.y) - pos));
    for (const n of near) {
      const target = h ? n.r.x : n.r.y, start = h ? mv.parent.x : mv.parent.y, len = (h ? mv.parent.w : mv.parent.h) - BGAP;
      if (len <= 0) continue;
      const cand = bResizing(root, id, (target - start) / len);
      let got;
      try { got = bCalc(cand, area).dividers.find(d => d.id === id); } catch (e) { continue; }
      if (got && (h ? got.r.x : got.r.y) === target) return cand;     // a minimum-size clamp is not a join
    }
    return root;
  }
  function bHit(handles, p) {
    const hits = handles.filter(x => p.x >= x.d.r.x && p.x < x.d.r.x + x.d.r.w && p.y >= x.d.r.y && p.y < x.d.r.y + x.d.r.h);
    const cd = x => Math.abs(x.d.axis === "h" ? p.y - (x.d.r.y + x.d.r.h / 2) : p.x - (x.d.r.x + x.d.r.w / 2));
    const nearer = (a, b) => cd(a) - cd(b) || (a.d.r.w + a.d.r.h) - (b.d.r.w + b.d.r.h);
    return hits.filter(x => !x.universal && cd(x) <= 80).sort(nearer)[0]
        || hits.filter(x => x.universal).sort(nearer)[0] || null;
  }

  /* the layout is remembered (every change, and when Bento turns off or
     Vivaldi quits): turning Bento on again rebuilds it - windows matched by
     tab, else by site - and new windows join in the largest slot. */
  /* Vivaldi's window has no localStorage (it is null there): settings that
     must survive a restart live in chrome.storage.local */
  const vstore = {
    get: k => new Promise(r => { try { chrome.storage.local.get(k, o => { void chrome.runtime.lastError; r(o ? o[k] : undefined); }); } catch (e) { r(undefined); } }),
    set: (k, v) => { try { chrome.storage.local.set({ [k]: v }, () => void chrome.runtime.lastError); } catch (e) {} },
    del: k => { try { chrome.storage.local.remove(k, () => void chrome.runtime.lastError); } catch (e) {} },
  };
  const BENTO_LAYOUT = "vivaldiOsBentoLayout";
  let bLayoutSaved = null;                          // the remembered layout (loaded at start)
  const hostOf = id => {
    try { return new URL(pageOf(id)?.querySelector("webview")?.getAttribute("src") || "").hostname; } catch (e) { return ""; }
  };
  const bSerialize = n => n.t === "w" ? { w: n.win, h: hostOf(n.win) }
    : { s: n.axis, r: +n.ratio.toFixed(4), a: bSerialize(n.a), b: bSerialize(n.b) };
  let bSaved = "";
  /* BENTO PER DESKTOP (workspace): each desktop has its own Bento - on or off (off by
     default), its layout, its undo - kept when you go to another desktop and back */
  const bentoOn = {}, bentoLayouts = {};              // desktop -> true / its saved layout
  const bentoWs = new Map();                          // desktop -> its Bento state while away
  const deskKey = () => {
    const w = curWs();
    if (w === undefined && bento.ws != null) return bento.ws;      // in the middle of a switch: not known yet, keep it
    return w == null ? "default" : String(w);
  };
  function bentoSave() {
    if (!bento.on || !bento.root || bento.gesture) return;
    const j = JSON.stringify(bSerialize(bento.root));
    if (j === bSaved) return;
    bSaved = j;
    bLayoutSaved = j;
    bentoLayouts[bento.ws || deskKey()] = j;
    vstore.set(BENTO_LAYOUT, JSON.stringify(bentoLayouts));
  }
  /* FOCUS PER DESKTOP: like Bento - each desktop keeps its own focus (the windows in it), and gets it
     back when you return; a desktop without one shows no blur */
  const focusWs = new Map();                          // desktop -> the windows in its focus
  let focusDesk = null, focusQuietUntil = 0;
  function focusForDesk() {
    const k = deskKey();
    if (focusDesk === k) return;
    if (focusDesk != null) { if (focusSet.size) focusWs.set(focusDesk, new Set(focusSet)); else focusWs.delete(focusDesk); }
    focusDesk = k;
    focusSet.clear(); focusLeave.clear();
    for (const id of focusWs.get(k) || []) if (floating.has(id) && !minimized.has(id) && !awayWs(id)) focusSet.add(id);
    focusSeenWin = winOf(activePage()?.dataset.id);
    focusQuietUntil = Date.now() + 800;                              // the arrival's own tab changes are not choices
  }
  /* A DESKTOP'S PREVIEW from another desktop shows it as you last saw it: when you leave a desktop, where its windows
     were is kept (the last redraw's boxes - nothing measured again) */
  var deskSeen = null, deskLook = null;              // (var: safe before this line has run)
  function bentoForDesk() {                            // another desktop: its own Bento comes out
    const k = deskKey();
    if (bento.ws === k) return;
    if (deskSeen && deskSeen.key === bento.ws) (deskLook ||= new Map()).set(deskSeen.key, deskSeen);   // (the desktop being left)
    if (bento.ws != null) bentoWs.set(bento.ws, { on: bento.on, root: bento.root, pre: bento.pre, skip: bento.skip,
      memo: bento.memo, undo: bento.undo, redo: bento.redo });
    bento.ws = k; bento.shape = ""; bentoDrag = null; bSaved = "";
    const st = bentoWs.get(k);
    if (st) Object.assign(bento, st);
    else {
      Object.assign(bento, { on: !!bentoOn[k], root: null, pre: {}, skip: new Set(), memo: new Map(), undo: [], redo: [] });
      bLayoutSaved = bentoLayouts[k] || null;
      if (bento.on) {                                  // on for this desktop: its saved layout, else a fresh one
        for (const id of floating) if (frac[id]) bento.pre[id] = { ...frac[id] };
        bento.restoreUntil = Date.now() + 10000;
      }
    }
    bLayoutSaved = bentoLayouts[k] || null;
    bentoButton();
  }
  function bRestore(members, area) {
    let saved = null;
    try { saved = JSON.parse(bLayoutSaved || "null"); } catch (e) {}
    if (!saved) return null;
    const free = new Set(members), leaves = [], got = new Map();
    const walk = n => { if (n.w != null) leaves.push(n); else { walk(n.a); walk(n.b); } };
    walk(saved);
    for (const l of leaves) if (free.has(l.w)) { got.set(l, l.w); free.delete(l.w); }          // the same tab
    for (const l of leaves) if (!got.has(l) && l.h) {                                         // else the same site
      const id = [...free].find(x => hostOf(x) === l.h);
      if (id) { got.set(l, id); free.delete(id); }
    }
    if (!got.size) return null;
    const build = n => {
      if (n.w != null) return got.has(n) ? bLeaf(got.get(n)) : null;
      const a = build(n.a), b = build(n.b);
      return !a ? b : !b ? a : bSplit(n.s, n.r, a, b);
    };
    let root = build(saved);
    for (const id of members) if (free.has(id)) { const next = bInsert(bLeaf(id), root, area); if (next) root = next; }
    return root && bFits(root, area) ? root : null;
  }

  /* undo / redo: one step per finished drag (Cmd/Ctrl+Z, Shift for redo) */
  function bPush(prev) {
    bento.undo.push(prev);
    if (bento.undo.length > 50) bento.undo.shift();
    bento.redo = [];
  }
  function bentoHistory(redo) {
    const from = redo ? bento.redo : bento.undo, to = redo ? bento.undo : bento.redo;
    if (!bento.on || !from.length) return false;
    bTransition(() => { to.push(bento.root); bento.root = from.pop(); bento.shape = ""; render(); bento.shape = bShape(bento.root); });
    return true;
  }

  /* minimum-jerk motion (Bento's WindowMotion): no overshoot, all windows together */
  const MJ = (() => {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(+(t * t * t * (t * (6 * t - 15) + 10)).toFixed(4)); }
    return { easing: `linear(${pts.join(", ")})`, duration: 220 };
  })();
  function slideFrom(el, f) {                       // FLIP one element from its old rect
    if (!el?.isConnected || !f) return;
    const l = el.getBoundingClientRect();
    if (!l.width || !l.height || !f.width || !f.height) return;
    const dx = f.left - l.left, dy = f.top - l.top, sx = f.width / l.width, sy = f.height / l.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
    stopAnims(el);
    el.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
                { transformOrigin: "0 0", transform: "none" }], SPR_MOVE);   // (1.0.321: Bento at the windows' speed)
  }
  // a window and its frame (ring + shadow) move together - before, the frame jumped
  const bEls = () => [...floating].flatMap(id => [targetOf(pageOf(id)), frames.get(id)]).filter(Boolean);
  function bentoSettle() {                          // the gaps stay out of sight while windows move
    const b = browserEl();
    b?.setAttribute("data-bento-moving", "");
    clearTimeout(bentoSettle.t); bentoSettle.t = setTimeout(() => b?.removeAttribute("data-bento-moving"), 380);
  }
  function bTransition(mutate) {                    // every window slides to its new slot
    const els = bEls(), first = els.map(e => e.getBoundingClientRect());
    mutate();
    bentoSettle();
    els.forEach((e, i) => slideFrom(e, first[i]));
  }
  const bArea = (s = stackRect(), keep = false) => {       // the corner stack's side stays free (Bento never under it)
    let l = MARGIN, r = MARGIN;
    for (const p of pip) {
      if (!floating.has(p) || minimized.has(p) || awayWs(p)) continue;
      const w = MARGIN + pipRect(p, s).w + BGAP;
      if ((pipCorner.get(p) || "bl")[1] === "r") r = Math.max(r, w); else l = Math.max(l, w);
    }
    if (!keep && s.width - l - r < 2 * MIN_W) l = r = MARGIN;        // no room left beside it: as before
    // 1.0.350 (keep: full screen, or one app filling the room): beside the pinned apps however narrow - never under them
    return { x: l, y: MARGIN, w: Math.max(Math.round(s.width - l - r), Math.min(120, Math.round(s.width - 2 * MARGIN))), h: Math.round(s.height - 2 * MARGIN) };
  };
  // front first; only windows that are really there: a tab Vivaldi has not loaded yet (after a
  // restart or an update) has no page to show, and would leave an empty slot until it loads
  const bMembers = () => [...zOrder].reverse().filter(id => floating.has(id) && !minimized.has(id) && !pip.includes(id) && !awayWs(id) && !!targetOf(pageOf(id)));   // the corner stack is not Bento's

  /* keep the tree in step with the windows (render calls this first) */
  function bentoSync(s) {
    bento.rects = new Map(); bento.layout = null;
    if (!bento.on) return;
    const area = bArea(s), members = bMembers(), live = new Set(members);
    for (const l of bWins(bento.root)) if (!live.has(l.win)) { bento.root = bRemove(bento.root, l.win); bento.skip.clear(); }
    for (const id of [...bento.skip]) if (!live.has(id)) bento.skip.delete(id);
    for (const id of members) if (!bento.pre[id] && frac[id]) bento.pre[id] = { ...frac[id] };   // its own place, once known
    if (Date.now() < (bento.restoreUntil || 0) && members.some(id => !bWins(bento.root).some(l => l.win === id))) {
      const r = bRestore(members, area);
      if (r) bento.root = r;
    }
    for (const [w, saved] of [...bento.memo]) {                     // back from full screen: exactly where it was
      if (!live.has(w) || bento.skip.has(w)) continue;             // still full screen, or still being dragged
      bento.memo.delete(w);
      const ids = new Set(bWins(saved).map(l => l.win)), cur = members.filter(id => !bento.skip.has(id));
      if (ids.size === cur.length && cur.every(id => ids.has(id)) && bFits(saved, area)) bento.root = saved;
    }
    for (const w of [...bento.memo.keys()]) if (!floating.has(w) && !pageOf(w)) bento.memo.delete(w);   // closed meanwhile
    const have = new Set(bWins(bento.root).map(l => l.win));
    let joined = false;
    for (const id of members) {
      if (have.has(id) || bento.skip.has(id)) continue;
      joined = true;
      if (frac[id] && !bento.pre[id]) bento.pre[id] = { ...frac[id] };
      const next = bInsert(bLeaf(id), bento.root, area);
      if (next) bento.root = next; else bento.skip.add(id);       // no room: it keeps floating
    }
    if (joined && Date.now() >= (bento.restoreUntil || 0)) {        // a new window: sizes follow recent use again
      const order = members.filter(id => bWins(bento.root).some(l => l.win === id));
      const r = bRecency(order.map(bLeaf), area);
      if (r) bento.root = r;
    }
    if (bento.root && !bFits(bento.root, area)) {                  // the screen got smaller
      try { bento.root = bArrange(bWins(bento.root), area); } catch (e) { bento.root = bActivate(bWins(bento.root), area); }
    }
    try { bento.layout = bento.root ? bCalc(bento.root, area) : null; } catch (e) { bento.layout = null; }
    for (const { leaf, r } of bento.layout?.regions || []) bento.rects.set(leaf.win, r);
    const shape = bShape(bento.root);
    if (bento.shape && shape !== bento.shape && !bento.pendingFlip) {   // windows came or went: the rest slide
      bento.pendingFlip = new Map(members.flatMap(id => [[targetOf(pageOf(id)), targetOf(pageOf(id))?.getBoundingClientRect()],
                                                         [frames.get(id), frames.get(id)?.getBoundingClientRect()]]).filter(([e]) => e));
    }
    bento.shape = shape;
  }
  const bDivEls = new Map(), bGripEls = new Map();   // (performance) Bento's dividers and grabbers, by id - never searched for
  let bBtnOn = null, bBtnAt = 0;
  function bentoAfterPlace(s) {
    if (bento.pendingFlip) {
      bentoSettle();
      for (const [el, f] of bento.pendingFlip) slideFrom(el, f);
      bento.pendingFlip = null;
    }
    // the gaps between windows: grab one to resize that split
    const host = stack();
    const want = new Set();
    if (host && bento.layout) {
      const o = fixedOrigin(host);
      for (const d of bento.layout.dividers) {
        want.add(d.id);
        let el = bDivEls.get(d.id);
        if (!el || el.parentElement !== host) { el?.remove(); el = document.createElement("div"); el.className = "bento-divider"; el.dataset.id = d.id; host.appendChild(el); bDivEls.set(d.id, el); }
        el.dataset.axis = d.axis;
        place(el, d.r, s, o);
        setStyle(el, "z-index", "950");
      }
    }
    if (host && ((bento.on && bento.layout) || roomActive())) {     // the edge to the corner stack: it resizes both (1.0.259: a room window too)
      const o = fixedOrigin(host), area = bArea(s);
      for (const side of ["l", "r"]) {
        const ids = [...pipSide(side, s).keys()];
        if (!ids.length || (side === "l" ? area.x <= MARGIN : s.width - area.x - area.w <= MARGIN)) continue;
        const id = "pip-" + side; want.add(id);
        let el = bDivEls.get(id);
        if (!el || el.parentElement !== host) { el?.remove(); el = document.createElement("div"); el.className = "bento-divider vos-pip-divider"; el.dataset.id = id; host.appendChild(el); bDivEls.set(id, el); }
        el.dataset.axis = "h"; el.dataset.side = side;
        const x = side === "l" ? area.x - BGAP : area.x + area.w;
        place(el, { x, y: MARGIN, w: BGAP, h: s.height - 2 * MARGIN }, s, o);
        setStyle(el, "z-index", "950");
      }
    }
    for (const [k, el] of bDivEls) if (!want.has(k)) { el.remove(); bDivEls.delete(k); }
    bentoGrips(s);
    bentoDim(s);
    bentoSave();
    // the toolbar's Bento button: at once when Bento changes, else at most once a second (the heartbeat catches a rebuilt toolbar)
    if (bento.on !== bBtnOn || performance.now() - bBtnAt > 1000) { bBtnOn = bento.on; bBtnAt = performance.now(); bentoButton(); }
  }
  (window.vosBeat || (f => setInterval(f, 2500)))(() => { try { bentoButton(); } catch (e) {} });

  function bentoGrips(s) {
    const host = stack();
    if (!host || !bento.layout || !bento.root) {
      bento.handles = []; bento.handlesKey = "";
      for (const g of bGripEls.values()) g.remove(); bGripEls.clear();
      return;
    }
    const area = bArea(s);
    const key = JSON.stringify(bento.layout.regions.map(r => [r.leaf.win, r.r]));
    if (key !== bento.handlesKey) {
      try { bento.handles = bHandles(bento.root, area); } catch (e) { bento.handles = []; }
      bento.handlesKey = key;
    }
    const o = fixedOrigin(host), want = new Set();
    for (const x of bento.handles) {
      const long = x.universal && x.shared, h = x.d.axis === "h", r = x.d.r;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const g = long ? (h ? { x: cx - 2, y: r.y + 14, w: 4, h: r.h - 28 } : { x: r.x + 14, y: cy - 2, w: r.w - 28, h: 4 })
                     : (h ? { x: cx - 2, y: cy - 60, w: 4, h: 120 } : { x: cx - 60, y: cy - 2, w: 120, h: 4 });
      want.add(x.key);
      let el = bGripEls.get(x.key);
      if (!el || el.parentElement !== host) { el?.remove(); el = document.createElement("div"); el.className = "bento-grip"; el.dataset.key = x.key; host.appendChild(el); bGripEls.set(x.key, el); }
      el.toggleAttribute("data-long", long);
      place(el, g, s, o);
      setStyle(el, "z-index", long ? "951" : "952");            // the singles sit on the joined line
    }
    for (const [k, el] of bGripEls) if (!want.has(k)) { el.remove(); bGripEls.delete(k); }
    bentoHot();
  }
  /* while Bento is on, the desktop behind the windows dims (fades in and out) */
  let bDim = null;
  function bentoDim(s) {
    const host = stack();
    if (!bento.on || !host) {
      if (bDim && !bDim.__leaving) {
        const d = bDim; bDim = null; d.__leaving = true;
        d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-out", fill: "forwards" })
          .finished.catch(() => {}).then(() => d.remove()) && setTimeout(() => d.remove(), 2500);
      }
      return;
    }
    const fresh = !bDim;
    if (fresh) { bDim = document.createElement("div"); bDim.className = "bento-dim"; }
    if (bDim.parentElement !== host) host.appendChild(bDim);
    place(bDim, { x: 0, y: 0, w: s.width, h: s.height }, s, fixedOrigin(host));
    setStyle(bDim, "z-index", "99");                          // above the wallpaper, under every window
    if (fresh) bDim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  }
  function bentoHot() {                             // the grabber in use, and the singles on a joined seam
    const hot = new Set();
    const add = x => { hot.add(x.key); if (x.universal && x.shared) x.parts.forEach(k => hot.add(k)); };
    for (const x of bento.handles)
      if (bento.gesture ? bento.gesture.ids.has(x.d.id) : x.key === bento.hoverKey) add(x);
    for (const [k, g] of bGripEls)
      if (g.hasAttribute("data-hot") !== hot.has(k)) g.toggleAttribute("data-hot", hot.has(k));
  }
  function bentoHover(e) {                          // light the grabber the pointer would take
    if (lpOn()) return;
    if (!bento.on || bento.gesture) return;
    const bd = e.target?.closest?.(".bento-divider"), ss = stackRect();
    const hit = bd ? bHit(bento.handles, { x: e.clientX - ss.left, y: e.clientY - ss.top }) : null;
    if ((hit?.key ?? null) === (bento.hoverKey ?? null)) return;
    bento.hoverKey = hit?.key ?? null;
    bentoHot();
  }

  function bentoToggle(force, keep) {
    const on = force ?? !bento.on;
    if (on === bento.on) return;
    const kept = !on && keep ? new Map([...bento.rects].filter(([id]) => floating.has(id) && !awayWs(id)).map(([id, r]) => [id, { ...r }])) : null;   // (as Bento has them now)
    bTransition(() => {
      if (on) {
        bento.on = true; bento.pre = {}; bento.skip = new Set(); bento.shape = ""; bento.undo = []; bento.redo = [];
        for (const id of floating) if (frac[id]) bento.pre[id] = { ...frac[id] };
        const members = bMembers();
        bento.root = members.length ? (bRestore(members, bArea()) || bActivate(members.map(bLeaf), bArea())) : null;
      } else {
        bento.on = false; bento.root = null; bento.shape = ""; bento.undo = []; bento.redo = []; bentoDrag = null; bento.memo.clear();
        const ss = stackRect();
        for (const id of floating) {                // every window back to where it was before Bento (held: where Bento put it)
          if (kept?.has(id)) setPx(id, kept.get(id), ss);
          else if (bento.pre[id]) frac[id] = bento.pre[id];
          persist(id);
        }
        bento.pre = {};
      }
      render();
    });
    const dk = bento.ws || deskKey();
    if (on) bentoOn[dk] = true; else delete bentoOn[dk];
    vstore.set(BENTO_KEY, JSON.stringify(bentoOn));
    bentoButton();
  }

  /* drag a tiled window: quick drop = swap, hold over an edge = split there */
  function bentoMove(e, el, id) {
    const ss = stackRect(), area = bArea(ss), host = stack(), r0 = { ...bento.rects.get(id) };
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const shield = document.createElement("div");
    shield.className = "ft-shield"; shield.style.cursor = "grabbing";
    document.body.appendChild(shield);
    shield.__end = () => { try { onUp({ pointerId: pid, type: "pointercancel", clientX: 0, clientY: 0, screenX: 0, screenY: 0 }); } catch (e) {} };   // a stale drag can always be ended
    const preview = document.createElement("div");
    preview.className = "bento-preview";
    host?.appendChild(preview);
    let key = "", split = false, holdTimer = 0, proposal = null, frame = 0, last = null;
    let top = false, topTimer = 0, topShown = false;                 // held at the top edge: full screen
    let deskT = 0, desk = false, deskOn = null, bEnded = false;      // held longer: the desktops come down - drop it on one
    let leavingB = false;                                            // past the edge of this Vivaldi window
    let bPin = null, bSlot = null, bColSide = null, bColAt = 0, bColT = 0;   // over a corner or the pinned windows: let go - pinned (out of Bento)
    const bFling = [];                                               // (its last moments: flicked toward a corner - pinned there)
    const shake = shaker();
    const show = (r, conflict) => {
      if (!r) { preview.removeAttribute("data-show"); return; }
      place(preview, r, ss, fixedOrigin(host));
      preview.setAttribute("data-show", "");
      preview.toggleAttribute("data-conflict", !!conflict);
      preview.toggleAttribute("data-split", split);
    };
    const propose = target => {
      proposal = null;
      if (!target) return show(null);
      const placement = split ? bPlacement(target.r, last) : "center";
      const next = bPlacing(bento.root, id, target.leaf.id, placement);
      if (next && bFits(next, area)) {
        proposal = next;
        show(bCalc(next, area).regions.find(r => r.leaf.win === id)?.r);
      } else show(target.r, true);
    };
    const update = () => {
      frame = 0;
      const dx = last.cx - sx, dy = last.cy - sy;
      bentoDrag = { id, rect: { x: r0.x + dx, y: r0.y + dy, w: r0.w, h: r0.h } };
      setStyle(el, "z-index", "2000");
      place(el, bentoDrag.rect, ss); placeFrame(id, el, bentoDrag.rect, ss);
      { let pz = desk ? null : pinZoneAt(last.cx, last.cy, id);
        if (pz && !pz.endsWith("!")) {                               // over the pinned column: after a pause only
          if (bColSide !== pz[1]) { bColSide = pz[1]; bColAt = performance.now(); clearTimeout(bColT); bColT = setTimeout(() => { if (!bEnded && !frame) frame = requestAnimationFrame(update); }, 380); }
          if (performance.now() - bColAt < 350) pz = null;
        } else bColSide = null;
        const pz2 = pz && pz.endsWith("!") ? pz.slice(0, 2) : pz;
        const bw = pz2 ? (cornerW(pz2, id) ?? Math.min(PIP_START_W, el.offsetWidth)) : 0;
        bSlot = pz2 ? (pinSlot(pz2[1], last.cy, id) || emptySlot(pz2, bw)) : null; slotShow(bSlot, id, bw, bw * el.offsetHeight / Math.max(1, el.offsetWidth));
        const pc = bSlot ? bSlot.corner : pz2;
        if (pc !== bPin) { bPin = pc; pinLook(el, id, pc, sx - ss.left - r0.x, sy - ss.top - r0.y, true); }
        if (pc) { show(null); proposal = null; key = ""; clearTimeout(holdTimer); return; } }
      if (desk) {                                                    // the desktops are down: which one is under the pointer
        const card = document.elementsFromPoint(last.cx, last.cy).find(n => n.classList?.contains("vos-ws-card") && !n.classList.contains("vos-ws-more") && !n.hasAttribute("data-current")) || null;
        if (card !== deskOn) { deskOn?.removeAttribute("data-drop"); deskOn = card; deskOn?.setAttribute("data-drop", ""); }
        return;
      }
      const atTop = snapZone(last.cx, last.cy) === "full";           // the pointer near the top: full screen
      if (atTop !== top) {
        top = atTop; clearTimeout(topTimer); clearTimeout(deskT);
        if (topShown) { snapPreview(null); topShown = false; }
        if (atTop) {
          topTimer = setTimeout(() => { topShown = true; show(null); snapPreview("full", el); }, SNAP_HOLD);
          deskT = setTimeout(() => {                                 // still holding: the desktops (like without Bento)
            desk = true; show(null); missionSkip = id;                 // (1.0.262: held: out of Mission Control's layout - under the pointer, no icon)
            if (topShown) { snapPreview(null); topShown = false; }
            if (!wsStrip) openWsStrip().then(() => { if (bEnded && wsStrip) closeWsStrip(); });
          }, SNAP_HOLD + 700);
        }
      }
      if (top) return;
      const target = bento.layout?.regions.find(r => r.leaf.win !== id &&
        last.x >= r.r.x && last.x < r.r.x + r.r.w && last.y >= r.r.y && last.y < r.r.y + r.r.h);
      const where = target ? bPlacement(target.r, last) : "";
      const k = target ? target.leaf.id + ":" + where : "";
      if (k !== key) {                                             // a new spot: the hold starts again
        key = k; split = false; clearTimeout(holdTimer);
        if (target && where !== "center") holdTimer = setTimeout(() => { split = true; propose(target); }, BHOLD);
        propose(target);
      }
    };
    const onMove = ev => {
      if (ev.pointerId !== pid) return;
      last = { cx: ev.clientX, cy: ev.clientY, x: ev.clientX - ss.left, y: ev.clientY - ss.top };
      bFling.push([ev.timeStamp, ev.clientX, ev.clientY]); while (bFling.length > 2 && ev.timeStamp - bFling[0][0] > 110) bFling.shift();
      const out = isOutside(ev);                                     // past the edge of this Vivaldi window
      if (out !== leavingB) { leavingB = out; if (out) { show(null); dragOutStart(id, el, ev); } else dragOutCancel(); }
      if (out) { dragOutMove(ev.screenX, ev.screenY); return; }
      if (shake(ev.clientX, ev.timeStamp)) return shakeOff(ev);
      if (!frame) frame = requestAnimationFrame(update);
    };
    /* shaken: Bento ends, every window goes back to its own place, and this one
       keeps following the pointer as a floating window */
    const shakeOff = ev => {
      proposal = null;
      onUp({ pointerId: pid, type: "pointercancel" });
      bentoToggle(false);
      const s2 = stackRect(), r = pxRect(id, s2);
      setPx(id, clampRect({ x: ev.clientX - s2.left - r.w / 2, y: Math.max(MARGIN, ev.clientY - s2.top - 14), w: r.w, h: r.h }, s2), s2);
      render();
      const w = targetOf(pageOf(id));
      if (w?.hasAttribute("data-ft-float")) startGesture(ev, w, "move", ev.timeStamp);   // (the hold goes on; its next shake counts 2 s from now)
    };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      cancelAnimationFrame(frame);
      if (ev.type === "pointerup" && last && !leavingB && !desk) { frame = 0; update(); }   // where it was let go (even when no frame was drawn meanwhile)
      clearTimeout(holdTimer); clearTimeout(topTimer); clearTimeout(deskT); bEnded = true;
      if (missionSkip === id) missionSkip = null;
      let toCard = null, deskList = [];
      if (desk) {                                                    // let go over the desktops
        toCard = ev.type === "pointerup" ? deskOn : null; deskOn?.removeAttribute("data-drop");
        deskList = wsStrip?.__list || [];
        ntrace("bento drop", { card: toCard ? (toCard.classList.contains("vos-ws-more") ? "new" : toCard.dataset.ws) : null });
        closeWsStrip(); proposal = null;
      }
      let flickC = null;                                             // flicked to a corner / to the pinned apps (worked out first: past the edge too)
      if (!bPin && ev.type === "pointerup") {
        const dx = ev.clientX - sx, dy = ev.clientY - sy, L0 = ss.left + r0.x + dx, T0 = ss.top + r0.y + dy;
        const k = flickOf(bFling, ev.timeStamp, id, { left: L0, top: T0, right: L0 + r0.w, bottom: T0 + r0.h }); if (isPinFlick(k)) flickC = k;
      }
      if (flickC && leavingB) { leavingB = false; dragOutCancel(); }   // (a flick that went past the edge: still a pin)
      const away = leavingB && ev.type === "pointerup";             // let go outside: to another Vivaldi window
      const awayTo = leavingB ? dragOutEnd(ev.screenX, ev.screenY, away) : null;
      if (away) proposal = null;
      const full = topShown && ev.type === "pointerup" && !away;
      if (topShown) snapPreview(null, null, full);
      if (full) proposal = null;
      shield.remove(); preview.remove();
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
      removeEventListener("pointercancel", onUp, true);
      removeEventListener("keydown", onKey, true);
      if (flickC && !away && !full && !toCard) { bSlot = flickSlot(flickC, id, ev.clientY, el); bPin = bSlot.corner; }   // flicked: pinned there
      { const c = bPin && ev.type === "pointerup" && !away && !full && !toCard ? bPin : null;
        if (bPin && !c) pinLook(el, id, null);
        slotShow(null);
        if (c) { proposal = null; bentoDrag = null; pinInto(id, c, bSlot); return; } }   // pinned: out of Bento, between the others
      bTransition(() => {
        bentoDrag = null;
        if (proposal && ev.type === "pointerup") { bPush(bento.root); bento.root = proposal; }   // else: back to its slot
        bento.shape = bShape(bento.root);
        render();
      });
      // full screen; leaving it (green button, or dragging its top edge down) brings it back into Bento
      if (full) act("zoom", pageOf(id));
      if (away) toOtherWindow(id, ev.screenX, ev.screenY, awayTo);
      if (toCard) {                                                  // to that desktop (Bento closes the gap here)
        persist(id);
        toDeskAndGo(id, toCard.dataset.ws ? (deskList.find(w => String(w.id) === toCard.dataset.ws)?.id ?? null) : null);
      }
    };
    const onKey = ev => { if (ev.key === "Escape") { ev.preventDefault(); proposal = null; onUp({ pointerId: pid, type: "pointercancel" }); } };
    addEventListener("pointermove", onMove, true);
    addEventListener("pointerup", onUp, true);
    addEventListener("pointercancel", onUp, true);
    addEventListener("keydown", onKey, true);
  }

  /* drag a gap, or a tiled window's edge: the split beside it follows */
  function bentoResize(e, dividers, cursor, base = bento.root) {
    if (!dividers.length || !base) return;
    const ss = stackRect(), area = bArea(ss), start = bento.root;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const shield = document.createElement("div");
    shield.className = "ft-shield"; shield.style.cursor = cursor;
    document.body.appendChild(shield);
    shield.__end = () => { try { onUp({ pointerId: pid, type: "pointercancel", clientX: 0, clientY: 0, screenX: 0, screenY: 0 }); } catch (e) {} };   // a stale drag can always be ended
    bento.gesture = { ids: new Set(dividers.map(d => d.id)) };
    bento.root = base;                                             // the equivalent tree, held for the whole drag
    let frame = 0, last = null, moved = false;
    const update = () => {
      frame = 0;
      let next = base;
      for (const d of dividers) {
        const n = bNode(base, d.id);
        if (!n) continue;
        const h = d.axis === "h", len = (h ? d.parent.w : d.parent.h) - BGAP;
        const m1 = bMin(n.a), m2 = bMin(n.b);                    // minimum sizes on both sides
        const lo = (h ? m1.w : m1.h) / len, hi = (len - (h ? m2.w : m2.h)) / len;
        const offset = (h ? d.r.x - d.parent.x : d.r.y - d.parent.y) + (h ? last.clientX - sx : last.clientY - sy);
        let cand = bResizing(next, d.id, Math.max(lo, Math.min(hi, offset / len)));
        if (!bFits(cand, area)) continue;
        try { cand = bSnap(cand, d.id, area); } catch (e) { /* keep it unsnapped */ }
        next = cand;
      }
      moved = true;
      bento.root = next;
      render();
    };
    const finish = commit => {
      cancelAnimationFrame(frame);
      shield.remove();
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
      removeEventListener("pointercancel", onUp, true);
      removeEventListener("keydown", onKey, true);
      bento.gesture = null;
      if (commit && moved) bPush(start);                           // one undo step
      else bento.root = start;                                     // cancelled: the starting layout
      render();
    };
    const onMove = ev => { if (ev.pointerId !== pid) return; last = ev; if (!frame) frame = requestAnimationFrame(update); };
    const onUp = ev => { if (ev.pointerId === pid) finish(ev.type === "pointerup"); };
    const onKey = ev => { if (ev.key === "Escape") { ev.preventDefault(); finish(false); } };
    addEventListener("pointermove", onMove, true);
    addEventListener("pointerup", onUp, true);
    addEventListener("pointercancel", onUp, true);
    addEventListener("keydown", onKey, true);
    render();
  }
  function bentoEdge(e, id, how) {                 // the splits along a tiled window's edges
    const r = bento.rects.get(id), ds = bento.layout?.dividers || [];
    const pick = test => ds.filter(test).sort((a, b) => a.parent.w * a.parent.h - b.parent.w * b.parent.h)[0];
    const coversV = d => d.parent.y <= r.y && d.parent.y + d.parent.h >= r.y + r.h;
    const coversH = d => d.parent.x <= r.x && d.parent.x + d.parent.w >= r.x + r.w;
    const list = [];
    if (how.includes("r")) list.push(pick(d => d.axis === "h" && d.r.x === r.x + r.w && coversV(d)));
    if (how.includes("l")) list.push(pick(d => d.axis === "h" && d.r.x + d.r.w === r.x && coversV(d)));
    if (how.includes("b")) list.push(pick(d => d.axis === "v" && d.r.y === r.y + r.h && coversH(d)));
    if (how.includes("t")) list.push(pick(d => d.axis === "v" && d.r.y + d.r.h === r.y && coversH(d)));
    e.preventDefault(); e.stopPropagation();
    bentoResize(e, list.filter(Boolean), CURSOR[how] || "default");
  }
  function bentoGesture(e, el, how) {
    const id = el.dataset.ftFloat;
    e.preventDefault(); e.stopPropagation();
    raise(id); activate(id); render();
    if (how === "move") bentoMove(e, el, id); else bentoEdge(e, id, how);
  }

  /* the Bento button: in the tab bar, after Home */
  /* three slots (Bento's mark). Off: outlines (rings drawn as shapes, so no
     toolbar style can fill them); on: filled tiles. */
  const BENTO_SLOTS = [[1.5, 1.5, 6.6, 15], [9.6, 1.5, 6.9, 6.75], [9.6, 9.75, 6.9, 6.75]];   // Bento's mark: one tall, two stacked
  const rrect = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  const bentoIcon = on => on                                         // on: solid tiles (and the button lit); off (disabled): thin outlines, dimmed
    ? `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="` + BENTO_SLOTS.map(([x, y, w, h]) => rrect(x, y, w, h, 1.9)).join("") + `"/></svg>`
    : `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6"><path d="` + BENTO_SLOTS.map(([x, y, w, h]) => rrect(x + 0.6, y + 0.6, w - 1.2, h - 1.2, 1.5)).join("") + `"/></svg>`;
  /* THE BENTO BUTTON IN THE TOOLBAR EDITOR: a Command Chain named "Bento" (made once, put
     after the Workspaces button) is Vivaldi's own toolbar button - so View > Customize
     Toolbar moves it, removes it, adds it back. The mod gives it the Bento drawing and click. */
  const BENTO_CHAIN = "COMMAND_vosbento";
  /* Vivaldi's own settings module (it keeps its copy of every setting in step - a plain
     prefs.set is overwritten by that copy) */
  let prefsApi = null;
  function vivPrefs() {
    if (prefsApi) return prefsApi;
    try {
      let host = null;
      try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      if (!ch?.push) return null;
      let req = null;
      ch.push([["vos-pref-" + Date.now()], {}, r => { req = r; }]);
      const isP = v => v && typeof v.set === "function" && typeof v.get === "function" && typeof v.toggle === "function";
      for (const id of Object.keys(req?.m || {})) {
        let src = "";
        try { src = Function.prototype.toString.call(req.m[id]); } catch (e) { continue; }
        if (!src.includes("_presetCache(") || !src.includes("prefs.set(")) continue;
        let ex; try { ex = req(id); } catch (e) { continue; }
        if (isP(ex)) return (prefsApi = ex);
        for (const k of Object.keys(ex || {})) { let v; try { v = ex[k]; } catch (e) { continue; } if (isP(v)) return (prefsApi = v); }
      }
    } catch (e) { LOG("prefs: Vivaldi's settings not found", e); }
    return null;
  }
  const prefSet = (path, value) => new Promise(res => {
    const api = vivPrefs();
    if (api) { try { res(api.set(path, value) !== false); return; } catch (e) { LOG("prefs set", e); } }
    res(false);                                     // never a plain set: Vivaldi would undo it
  });
  /* THE OS WIDGETS in Vivaldi's toolbar editor: Bento, Mission Control and Timer are Command
     Chains named "OS · ..." - they sit together in the editor's Command Chains list, and drag
     onto any toolbar like Vivaldi's own buttons. Bento starts on the tab bar. */
  const OS_CHAINS = [
    { key: "vosbento", label: "OS · Bento", old: ["Bento"] },
    { key: "vosmission", label: "OS · Desktops" },
    { key: "vostimer", label: "OS · Timer" },
    { key: "vosdate", label: "OS · Date" },
    { key: "vosdark", label: "OS · Dark Mode" },
  ];
  const chainName = c => "COMMAND_" + c.key;
  const editingToolbar = () => !!document.querySelector("#browser.toolbar-edit-mode");   // Vivaldi's toolbar editor is open
  let chainReady = false;
  setTimeout(async function bentoChainSetup() {      // after start (every helper ready)
    try {
      if (!vivPrefs()) {                              // not reachable yet: again soon (the mod's own button meanwhile)
        bentoChainSetup.n = (bentoChainSetup.n || 0) + 1;
        if (bentoChainSetup.n < 10) setTimeout(bentoChainSetup, 1500);
        return;
      }
      // every start: the chain exists (a toolbar naming a missing chain breaks Vivaldi's tab bar)
      let list = (await prefGet("vivaldi.chained_commands.command_list")) || [];
      if (!Array.isArray(list)) return;
      let changed = false;
      list = list.map(c => {                           // their names (an older "Bento" becomes "OS · Bento")
        const o = OS_CHAINS.find(x => chainName(x) === c?.name);
        if (o && c.label !== o.label) { changed = true; return { ...c, label: o.label }; }
        return c;
      });
      for (const o of OS_CHAINS) if (!list.some(c => c?.name === chainName(o))) {
        list = [...list, { category: "CATEGORY_COMMAND_CHAIN", chain: [], key: o.key, label: o.label, name: chainName(o) }];
        changed = true;
      }
      if (changed) await prefSet("vivaldi.chained_commands.command_list", list);
      // on no toolbar (an installer reset the tab bar, or it was taken off): back after Workspaces
      const bars = ["navigation", "panel", "status", "tabbar_after", "tabbar_before"];
      const vals = await Promise.all(bars.map(b => prefGet("vivaldi.toolbars." + b)));
      if (!vals.some(v => Array.isArray(v) && v.includes(BENTO_CHAIN)) && !(await vstore.get("vosBentoOff")) && !(await vstore.get("vosBentoChain2"))) {   // once only: taken off later, it stays off   // (not when you took it off in the Launchpad)
        const tb = Array.isArray(vals[4]) ? [...vals[4]] : [];
        const at = tb.indexOf("WorkspaceButton");
        tb.splice(at >= 0 ? at : 0, 0, BENTO_CHAIN);                  // Bento at the left, then the desktops
        await prefSet("vivaldi.toolbars.tabbar_before", tb);
      }
      if (!(await vstore.get("vosBentoFirst1"))) {                   // once: Bento before the desktops (the new default)
        const tb = await prefGet("vivaldi.toolbars.tabbar_before");
        if (Array.isArray(tb)) {
          const i = tb.indexOf(BENTO_CHAIN), j = tb.indexOf("WorkspaceButton");
          if (i >= 0 && j >= 0 && i > j) { const n = tb.filter(x => x !== BENTO_CHAIN); n.splice(n.indexOf("WorkspaceButton"), 0, BENTO_CHAIN); await prefSet("vivaldi.toolbars.tabbar_before", n); }
        }
        vstore.set("vosBentoFirst1", true);
      }
      if (!(await vstore.get("vosDesksChain2"))) {                  // once: the Desktops widget in the Workspaces button's place - that button goes (the default)
        const all = await Promise.all(bars.map(b => prefGet("vivaldi.toolbars." + b)));
        const has = all.some(v => Array.isArray(v) && v.includes("COMMAND_vosmission"));
        for (const [k, v] of bars.map((b, i) => [b, all[i]])) {
          if (!Array.isArray(v) || !v.includes("WorkspaceButton")) continue;
          const n = has ? v.filter(x => x !== "WorkspaceButton") : v.map(x => x === "WorkspaceButton" ? "COMMAND_vosmission" : x);
          await prefSet("vivaldi.toolbars." + k, n);
        }
        if (!has && !all.some(v => Array.isArray(v) && v.includes("WorkspaceButton"))) {   // neither: after Bento
          const tb = Array.isArray(all[4]) ? [...all[4]] : [];
          const i = tb.indexOf(BENTO_CHAIN);
          tb.splice(i >= 0 ? i + 1 : 0, 0, "COMMAND_vosmission");
          await prefSet("vivaldi.toolbars.tabbar_before", tb);
        }
        vstore.set("vosDesksChain2", true);
      }
      if (!(await vstore.get("vosOrder1"))) {                       // once: Bento first, then the Desktops, at the far left of the tab bar
        const tb = await prefGet("vivaldi.toolbars.tabbar_before");
        if (Array.isArray(tb)) {
          const lead = [BENTO_CHAIN, "COMMAND_vosmission"].filter(n => tb.includes(n));   // (only the ones on the tab bar: none is added here)
          const rest = tb.filter(x => !lead.includes(x));
          const next = [...lead, ...rest];
          if (JSON.stringify(next) !== JSON.stringify(tb)) await prefSet("vivaldi.toolbars.tabbar_before", next);
        }
        vstore.set("vosOrder1", true);
      }
      vstore.set("vosBentoChain2", true);
      chainReady = true;
    } catch (e) { LOG("bento chain", e); }
  }, 1200);
  function osChainButtons() {                       // Vivaldi's buttons for the OS chains, wherever they are
    const out = {};
    for (const b of document.querySelectorAll("#browser .toolbar button")) {
      if (b.closest(".bento-toggle:not(.vos-bento-chain)")) continue;
      const t = (b.getAttribute("title") || b.getAttribute("aria-label") || "").trim();
      for (const o of OS_CHAINS)
        if (!out[o.key] && [o.label, ...(o.old || [])].some(l => t === l || t.startsWith(l + " ") || t.startsWith(l + "\n"))) out[o.key] = b;
    }
    return out;
  }
  const chainButton = () => osChainButtons().vosbento || null;
  const MC_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="currentColor"><rect x="1.5" y="7" width="7" height="4" rx="2"/><circle cx="12" cy="9" r="2"/><circle cx="16" cy="9" r="1.6" opacity="0.55"/></svg>';   // Ubuntu: this desktop a line, the others dots
  const TIMER_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke-width="2.6" stroke-linecap="round"><circle cx="10" cy="10" r="7.5" stroke="currentColor" opacity="0.3"/><path d="M10 2.5a7.5 7.5 0 1 1-7.13 5.18" stroke="#ff9f0a"/></svg>';   // only the ring
  const DARK_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="currentColor"><path fill-rule="evenodd" d="M9 1.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 0 1 0-15zM9 3.8a5.2 5.2 0 0 1 0 10.4z"/></svg>';   // Ubuntu style: solid - a thick ring, its left half filled
  const DATE_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="currentColor"><path fill-rule="evenodd" d="M4.6 3h8.8A2.6 2.6 0 0 1 16 5.6v7.8a2.6 2.6 0 0 1-2.6 2.6H4.6A2.6 2.6 0 0 1 2 13.4V5.6A2.6 2.6 0 0 1 4.6 3zM4.9 7.4a1 1 0 0 0-1 1v4.7a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1V8.4a1 1 0 0 0-1-1z"/><rect x="4.9" y="1.2" width="2" height="3.4" rx="1"/><rect x="11.1" y="1.2" width="2" height="3.4" rx="1"/><rect x="10.2" y="10.2" width="2.6" height="2.6" rx="0.7"/></svg>';   // Ubuntu style: a solid calendar
  /* THE DATE by the tab bar clock: Fri / Fri 20 / Fri 20 Nov */
  let dateFmt = "dd";
  vstore.get("vosDateFmt").then(v => { if (v === "d" || v === "dd" || v === "ddm") { dateFmt = v; paintDate(); } }).catch(() => {});
  function dateText(f = dateFmt, d = new Date()) {
    const a = DAYS[d.getDay()];
    return f === "d" ? a : f === "ddm" ? `${a} ${d.getDate()} ${MONTHS[d.getMonth()]}` : `${a} ${d.getDate()}`;
  }
  function paintDate() {
    const btn = osChainButtons().vosdate, tx = btn?.querySelector(".vos-date-tx");
    if (!tx) return;
    fitDate();
    const ck = document.querySelector("#browser .ClockButton");
    if (ck) { const cs = getComputedStyle(ck); if (tx.style.fontSize !== cs.fontSize) { tx.style.fontSize = cs.fontSize; tx.style.fontWeight = cs.fontWeight; tx.style.fontFamily = cs.fontFamily; } }
  }
  setInterval(paintDate, 30000);
  /* short of room in the tab bar, the date gets shorter: the month goes first, then the day's number, then the day */
  function fitDate() {
    const btn = osChainButtons().vosdate, tx = btn?.querySelector(".vos-date-tx");
    if (!tx) return;
    const wrap = btn.closest(".button-toolbar") || btn, bar = wrap.parentElement;
    if (!bar) return;
    const spacers = [...bar.children].filter(c => c !== wrap && /spacer/i.test(c.className) && /flex/i.test(c.className));
    const tc = document.getElementById("tabs-container");
    const roomy = () => !(tc && tc.scrollWidth > tc.clientWidth + 1) && (spacers.length ? spacers.every(c => c.getBoundingClientRect().width >= 6) : bar.scrollWidth <= bar.clientWidth + 1);
    const order = dateFmt === "ddm" ? ["ddm", "dd", "d", ""] : dateFmt === "dd" ? ["dd", "d", ""] : ["d", ""];
    const was = (wrap.style.display === "none" ? "" : tx.textContent);
    for (const f of order) {
      if (f) { const t = dateText(f); if (tx.textContent !== t) tx.textContent = t; }
      if (f) wrap.style.removeProperty("display"); else wrap.style.setProperty("display", "none", "important");
      if (!f || roomy()) break;
    }
    return (wrap.style.display === "none" ? "" : tx.textContent) !== was;   // shorter now (the tab bar measures again)
  }
  window.vosFitDate = fitDate;
  addEventListener("resize", () => { clearTimeout(fitDate.t); fitDate.t = setTimeout(fitDate, 60); });
  (function watchBar() {
    const c = document.getElementById("tabs-tabbar-container");
    if (!c || typeof ResizeObserver !== "function") return setTimeout(watchBar, 1000);
    new ResizeObserver(() => { clearTimeout(fitDate.t); fitDate.t = setTimeout(fitDate, 60); }).observe(c);
  })();
  async function ensureChain(name) {                 // a toolbar never names a chain that is missing (it breaks the tab bar)
    const o = OS_CHAINS.find(x => chainName(x) === name);
    if (!o) return true;
    const list = (await prefGet("vivaldi.chained_commands.command_list")) || [];
    if (!Array.isArray(list)) return false;
    if (list.some(c => c?.name === name)) return true;
    return prefSet("vivaldi.chained_commands.command_list", [...list, { category: "CATEGORY_COMMAND_CHAIN", chain: [], key: o.key, label: o.label, name }]);
  }
  /* THE TAB BAR WIDGETS - Desktops, Bento, Timer - on or off from the Launchpad's widget gallery */
  const TB_WIDGETS = { desktops: "COMMAND_vosmission", bento: BENTO_CHAIN, timer: "COMMAND_vostimer", date: "COMMAND_vosdate", dark: "COMMAND_vosdark" };
  const TB_BARS = ["navigation", "panel", "status", "tabbar_after", "tabbar_before"];
  const tbBars = async () => Object.fromEntries(await Promise.all(TB_BARS.map(async b => [b, await prefGet("vivaldi.toolbars." + b)])));
  window.vosTabbarWidgets = {
    icons: { desktops: MC_ICON, bento: bentoIcon(true), timer: TIMER_ICON, date: DATE_ICON, dark: DARK_ICON },
    dateFmt: () => dateFmt,
    dateText: f => dateText(f),
    setDateFmt(f) { if (!["d", "dd", "ddm"].includes(f)) return; dateFmt = f; vstore.set("vosDateFmt", f); paintDate(); },
    async get() {
      const bars = await tbBars(), on = n => Object.values(bars).some(v => Array.isArray(v) && v.includes(n));
      return Object.fromEntries(Object.entries(TB_WIDGETS).map(([k, n]) => [k, on(n)]));
    },
    async set(key, on) {
      const name = TB_WIDGETS[key];
      if (!name) return false;
      const bars = await tbBars();
      if (key === "bento") vstore.set("vosBentoOff", !on);
      if (!on) {                                       // off every toolbar it is on
        for (const [b, v] of Object.entries(bars)) if (Array.isArray(v) && v.includes(name)) await prefSet("vivaldi.toolbars." + b, v.filter(x => x !== name));
        if (key === "timer") window.vosTimer?.hide?.();
        return true;
      }
      if (Object.values(bars).some(v => Array.isArray(v) && v.includes(name))) return true;
      if (!(await ensureChain(name))) return false;
      if (key === "timer" || key === "date" || key === "dark") {   // by the clock, at its left (the date right next to it; Dark Mode first)
        const ta = Array.isArray(bars.tabbar_after) ? [...bars.tabbar_after] : [];
        const first = n => ta.indexOf(n) >= 0 ? ta.indexOf(n) : null;
        const at = key === "dark" ? (first(TB_WIDGETS.timer) ?? first(TB_WIDGETS.date) ?? ta.indexOf("Clock"))
                 : key === "timer" && ta.includes(TB_WIDGETS.date) ? ta.indexOf(TB_WIDGETS.date) : ta.indexOf("Clock");
        ta.splice(at >= 0 ? at : ta.length, 0, name);
        const ok = await prefSet("vivaldi.toolbars.tabbar_after", ta);
        setTimeout(() => { osWidgets(); paintDate(); }, 400);
        return ok;
      }
      const tb = Array.isArray(bars.tabbar_before) ? [...bars.tabbar_before] : [];
      if (key === "desktops") { const at = tb.indexOf(BENTO_CHAIN); tb.splice(at >= 0 ? at + 1 : 0, 0, name); }   // after Bento
      else { const at = tb.indexOf("WorkspaceButton"); tb.splice(at >= 0 ? at : 0, 0, name); }   // Bento: at the left, before Desktops
      return prefSet("vivaldi.toolbars.tabbar_before", tb);
    },
  };
  function osWidgets() {                            // Mission Control and Timer: their drawing and click
    for (const b of document.querySelectorAll("#tabs-tabbar-container .button-toolbar:not([data-vos-back])")) {   // the Back button: always the bold arrow (its title changes)
      const t = (b.getAttribute("title") || b.querySelector("button")?.getAttribute("title") || b.querySelector("button")?.getAttribute("aria-label") || "").trim();
      if (/^(previous page|go to previous page|back)\b/i.test(t)) b.setAttribute("data-vos-back", "");
    }
    const found = osChainButtons();
    for (const [key, icon, act] of [["vosmission", MC_ICON, () => openWsStrip()], ["vostimer", TIMER_ICON, b => window.vosTimer?.toggle(b)],
                                    ["vosdate", '<span class="vos-date-tx"></span>', b => window.vosClockPop?.(b)],
                                    ["vosdark", DARK_ICON, () => window.vosAppearance?.toggle()]]) {
      const btn = found[key];
      if (!btn) continue;
      const wrap = btn.closest(".button-toolbar") || btn;
      if (!wrap.__vosChain) {
        wrap.__vosChain = true;
        wrap.classList.add("vos-chain", "vos-chain-" + key);
        wrap.addEventListener("pointerdown", ev => { if (!editingToolbar()) ev.stopPropagation(); }, true);
        wrap.addEventListener("click", ev => { if (editingToolbar()) return; ev.preventDefault(); ev.stopPropagation(); act(wrap); }, true);
      }
      if (key === "vosmission") { if (!btn.querySelector(":scope > .vos-desks-ic")) setTimeout(() => { try { deskIndicatorNow(); } catch (e) {} }); }   // the Desktops widget: the dots (this desktop a line)
      else if (!btn.querySelector(":scope > .vos-chain-ic")) { const ic = document.createElement("span"); ic.className = "vos-chain-ic"; ic.innerHTML = icon; btn.appendChild(ic); if (key === "vosdate") paintDate(); }
      if (key === "vostimer" && !wrap.previousElementSibling?.classList?.contains("vos-tm-mini")) window.vosTimer?.paint?.();   // the ring takes its place
    }
  }
  const BENTO_HOLD = 550;
  function bentoHoldable(el) {                      // held (Bento on): off, the layout kept - the click on letting go is not a click
    el.addEventListener("pointerdown", ev => {
      if (ev.button !== 0 || editingToolbar()) return;
      clearTimeout(el.__vosHold); el.__vosHeld = false;
      if (!bento.on) return;
      el.__vosHold = setTimeout(() => {
        el.__vosHeld = true;
        el.animate([{ scale: 1 }, { scale: 0.86 }, { scale: 1 }], { duration: 280, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });   // (it took)
        bentoToggle(false, true);
      }, BENTO_HOLD);
    }, true);
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(t, () => clearTimeout(el.__vosHold), true);
  }
  const bentoHeld = el => { if (!el.__vosHeld) return false; el.__vosHeld = false; return true; };
  function bentoButton() {
    osWidgets();
    const chain = chainButton();
    if (chain) {                                    // Vivaldi's own: the injected one goes
      $$("#browser .bento-toggle:not(.vos-bento-chain)").forEach(x => x.remove());
      const wrap = chain.closest(".button-toolbar") || chain;
      if (!wrap.__vosBento) {
        wrap.__vosBento = true;
        wrap.classList.add("bento-toggle", "vos-bento-chain");
        wrap.addEventListener("pointerdown", ev => { if (!editingToolbar()) ev.stopPropagation(); }, true);
        wrap.addEventListener("click", ev => { if (editingToolbar()) return; ev.preventDefault(); ev.stopPropagation(); if (bentoHeld(wrap)) return; bentoToggle(); }, true);
        bentoHoldable(wrap);
      }
      let ic = chain.querySelector(":scope > .vos-bento-ic");
      if (!ic) { ic = document.createElement("span"); ic.className = "vos-bento-ic"; chain.appendChild(ic); ic.__on = null; }
      if (ic.__on !== bento.on) { ic.__on = bento.on; ic.innerHTML = bentoIcon(bento.on); }
      chain.toggleAttribute("data-vos-on", !!bento.on);
      wrap.toggleAttribute("data-on", bento.on);
      return;
    }
    // no chain button (yet): the mod's own Bento button - there is always one
    const bar = $("#tabs-tabbar-container .toolbar-tabbar-before");
    if (!bar) return;
    let btn = $(":scope > .bento-toggle", bar);
    if (!btn) {
      btn = document.createElement("div");
      btn.className = "button-toolbar bento-toggle";
      btn.innerHTML = `<button class="ToolbarButton-Button" type="button" title="Bento: organize the windows" aria-label="Bento">${bentoIcon(false)}</button>`;
      btn.addEventListener("pointerdown", ev => ev.stopPropagation(), true);
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); if (bentoHeld(btn)) return; bentoToggle(); });
      bentoHoldable(btn);
      const homeLabel = v => /^(go to )?home ?page\b/i.test((v || "").trim());
      const home = [...bar.children].find(ch => [ch, ch.querySelector("button")].some(x => x && (homeLabel(x.getAttribute("title")) || homeLabel(x.getAttribute("aria-label")))));
      const first = home || [...bar.children].find(ch => ch !== btn && !/spacer/i.test(ch.className));
      if (first) first.after(btn); else bar.prepend(btn);
    }
    if (btn.hasAttribute("data-on") !== bento.on) {
      btn.toggleAttribute("data-on", bento.on);
      btn.querySelector("button").innerHTML = bentoIcon(bento.on);
    }
  }

  /* scaling mode's breath ends gently: from wherever it is in its swing, the
     window eases back to rest instead of jumping */
  function breathOut(el) {
    if (!el.hasAttribute("data-ft-scaling")) return;
    const cs = getComputedStyle(el), sc = cs.scale, fl = cs.filter;
    el.removeAttribute("data-ft-scaling");
    const from = {}, to = {};
    if (sc && sc !== "none" && sc !== "1") { from.scale = sc; to.scale = "1"; }
    if (fl && fl !== "none") { from.filter = fl; to.filter = "brightness(1)"; }
    if (Object.keys(from).length) el.animate([from, to], { duration: 420, easing: EASE });
  }

  function startGesture(e, el, how, shookAt) {
    { const g = el.dataset.ftFloat;                                  // full view / the corner stack: a press only picks it
      if (!mission && pip.includes(g)) return pipGesture(e, el, g, how);
      if (!mission && cover === g) { e.preventDefault(); e.stopPropagation(); raise(g); activate(splitFocus.get(g) || g); render(); return; } }
    if (!mission && bento.on && bento.rects.has(el.dataset.ftFloat)) return bentoGesture(e, el, how);   // a tiled window
    e.preventDefault();
    e.stopPropagation();
    const id = el.dataset.ftFloat;
    stopAnims(el);
    raise(id); activate(id); render();
    const ss = stackRect();
    let s0 = pxRect(id, ss), sx = e.clientX, sy = e.clientY;           // re-based at every mode switch
    const frac0 = frac[id] ? { ...frac[id] } : null;                 // its place before this drag (a flick to a pin: it comes back there)
    const gx0 = sx - ss.left - s0.x, gy0 = sy - ss.top - s0.y;      // where it is held, in its own box (the pivot when it shrinks to be pinned)
    const pid = e.pointerId;
    const shield = document.createElement("div");
    shield.className = "ft-shield";
    shield.style.cursor = CURSOR[how];
    document.body.appendChild(shield);
    shield.__end = () => { try { onUp({ pointerId: pid, type: "pointercancel", clientX: 0, clientY: 0, screenX: 0, screenY: 0 }); } catch (e) {} };   // a stale drag can always be ended
    let frame = 0, last = null, roomLook = null;   // (roomLook: dragged out of the room - its size from before, shown by the GPU)
    let scaling = false, holdTimer = 0, tb = 0, label = null;
    let z0 = zoomOf[id] || 1;
    /* holding still switches the mode, as often as you like, without letting
       go: resize -> (hold) -> scale -> (hold) -> resize ... A gentle flash marks
       each switch; the drag goes on from where the window is now. After a
       switch, move a little before the next hold can switch again. */
    let px = e.clientX, py = e.clientY, ax = px, ay = py;           // pointer now / where it rests
    const flash = () => el.animate(
      [{ filter: "brightness(1)" }, { filter: "brightness(1.28)", offset: 0.35 }, { filter: "brightness(1)" }],
      { duration: 420, easing: "ease-out" });
    const toggle = () => {
      holdTimer = 0;
      s0 = pxRect(id, ss); sx = px; sy = py; z0 = zoomOf[id] || 1;
      scaling = !scaling;
      if (scaling) {
        tb = noTitle.has(id) ? 0 : ($(":scope > .ft-titlebar", el)?.getBoundingClientRect().height || 0);
        el.setAttribute("data-ft-scaling", "");
        label = document.createElement("div");
        label.className = "ft-zoom-label";
        label.textContent = Math.round(z0 * 100) + "%";
        el.appendChild(label);
      } else {
        breathOut(el);
        label?.remove(); label = null;
      }
      flash();
    };
    const arm = () => { clearTimeout(holdTimer); ax = px; ay = py; holdTimer = setTimeout(toggle, HOLD_MS); };
    /* hold-to-scale is off: an edge only resizes (page scale: the grey button) */

    /* SNAP (like macOS / Windows): moving a window, hold the pointer at the top edge
       (full screen) or at the left / right edge (Bento, that half): a preview shows
       where it goes, and letting go puts it there. Leave the edge: no snap. */
    let zone = null, shown = null, zoneTimer = 0, leaving = false;
    /* TO ANOTHER DESKTOP: keep holding at the top edge - the desktops panel comes down;
       let go on a desktop and the window moves there */
    let deskTimer = 0, deskDrop = !!mission && how === "move", deskOver = null;
    const inMission = deskDrop;                                       // the panel was open already: Mission Control
    if (!inMission && how === "move") missionSkip = id;               // held from the top edge: it keeps its size
    const slot0 = inMission ? mission.slots?.get(id) : null, kHeld = slot0?.k ?? mission?.k ?? 1;
    let gOff = inMission ? (() => { const d = slot0 || mr(s0); return { x: sx - ss.left - d.x, y: sy - ss.top - d.y }; })() : null;
    let moved = false, ended = false;
    const openDeskDrop = () => {
      deskDrop = true;
      clearTimeout(zoneTimer);
      if (shown) { snapPreview(null); shown = null; }
      if (!wsStrip) openWsStrip().then(() => { if (ended && wsStrip) closeWsStrip(); });   // let go meanwhile: not after
    };
    const shake = shaker(); let shook = shookAt ?? -1e9;
    let pinAt = null;                                                // over a corner or a side's pinned windows: it shrinks; let go - pinned there
    let pinSl = null;
    const pinShow = (c, x, y) => {
      if (c && c.endsWith("!")) c = c.slice(0, 2);
      const pw = c ? (cornerW(c, id) ?? Math.min(PIP_START_W, el.offsetWidth)) : 0, ph = pw * el.offsetHeight / Math.max(1, el.offsetWidth);
      pinSl = c ? (pinSlot(c[1], y, id) || emptySlot(c, pw)) : null; slotShow(pinSl, id, pw, ph);   // where it will sit
      if (c) { setStyle(el, "z-index", "2050"); const fr = frames.get(id); if (fr) setStyle(fr, "z-index", "2050"); }   // above the pinned windows while over them
      if (pinSl) c = pinSl.corner;
      if (c !== pinAt) pinLook(el, id, c, gx0, gy0, true);
      pinAt = c;
    };
    const pinZone = (x, y) => how !== "move" || deskDrop || inMission ? null : pinZoneAt(x, y, id);
    let colAt = 0, colSide = null, colT = 0;                         // over the pinned column: it counts after a pause (passing over it to snap: nothing)
    const snapCheck = (x, y) => {
      if (how !== "move" || deskDrop) return;
      { let pz = pinZone(x, y);
        if (pz && !pz.endsWith("!")) {
          if (colSide !== pz[1]) { colSide = pz[1]; colAt = performance.now(); clearTimeout(colT); colT = setTimeout(() => { if (!ended) snapCheck(px, py); }, 380); }
          if (performance.now() - colAt < 350) pz = null;
        } else { colSide = null; clearTimeout(colT); }
        if (pz) { clearTimeout(zoneTimer); clearTimeout(deskTimer); if (shown) { snapPreview(null); shown = null; } zone = null; pinShow(pz, x, y); return; }
        if (pinAt) pinShow(null); }
      const z = snapZone(x, y);
      if (z === zone) return;
      zone = z;
      clearTimeout(zoneTimer); clearTimeout(deskTimer);
      if (shown) { snapPreview(null); shown = null; }
      if (z) zoneTimer = setTimeout(() => { shown = z; snapPreview(z, el); }, SNAP_HOLD);
      if (z === "full") deskTimer = setTimeout(openDeskDrop, SNAP_HOLD + 700);
    };
    /* SPLIT: hold the window over another window (a moment, still): a preview of the half it takes
       (the side nearest the pointer), and letting go makes the two one split view - as a tab
       dropped onto the window from the tab bar */
    let spT = null, spTimer = 0, spArmed = false, spSide = null, spAt = null;
    const splitOff = () => {
      clearTimeout(spTimer); spTimer = 0; spArmed = false; spSide = null;
      splitPreview(null); el.removeAttribute("data-vos-split-armed"); frames.get(id)?.removeAttribute("data-vos-split-armed");
    };
    const splitCheck = (x, y) => {
      const hit = how === "move" && !inMission && !deskDrop && !zone && !leaving && !scaling && !groupFloat.has(id) ? splitTargetAt(id, x, y) : null;
      if ((hit?.w ?? null) !== (spT?.w ?? null)) { splitOff(); spT = hit; spAt = null; }
      else if (hit && spT) spT.pane = hit.pane;                       // (another pane of the same split)
      if (!spT) return;
      if (spArmed) { spSide = splitPreview(spT.w, x, y, el, null, spT.pane ? pageOf(spT.pane)?.getBoundingClientRect() : null); return; }
      if (spAt && Math.hypot(x - spAt.x, y - spAt.y) < 14) return;    // held still: the timer runs on
      spAt = { x, y }; clearTimeout(spTimer);
      spTimer = setTimeout(() => {
        if (!spT || ended || leaving) return;
        spArmed = true; spSide = splitPreview(spT.w, px, py, el, null, spT.pane ? pageOf(spT.pane)?.getBoundingClientRect() : null);
        el.setAttribute("data-vos-split-armed", ""); frames.get(id)?.setAttribute("data-vos-split-armed", "");
      }, SPLIT_HOLD);
    };
    const deskCheck = (x, y) => {
      if (!deskDrop) return;
      const card = document.elementsFromPoint(x, y).find(n => n.classList?.contains("vos-ws-card") && !n.hasAttribute("data-current")) || null;   // New too: a new desktop for it
      if (card !== deskOver) { deskOver?.removeAttribute("data-drop"); deskOver = card; deskOver?.setAttribute("data-drop", ""); }
    };

    const flingAt = [];
    const fling = ev => {                                            // (let go while moving fast)
      if (how !== "move" || !moved) return null;
      const dx = ev.clientX - sx, dy = ev.clientY - sy, L0 = ss.left + s0.x + dx, T0 = ss.top + s0.y + dy;
      return flickOf(flingAt, ev.timeStamp, id, { left: L0, top: T0, right: L0 + s0.w, bottom: T0 + s0.h });
    };
    const onMove = ev => {
      if (ev.pointerId !== pid) return;                             // another finger
      last = ev; px = ev.clientX; py = ev.clientY;
      const out = how === "move" && isOutside(ev);                  // past the edge of this Vivaldi window
      if (out !== leaving) { leaving = out; if (out) { splitOff(); spT = null; spAt = null; } out ? dragOutStart(id, el, ev) : dragOutCancel(); }   // (no split here: it goes to the other window)
      if (out) { dragOutMove(ev.screenX, ev.screenY); return; }
      flingAt.push([ev.timeStamp, px, py]); while (flingAt.length > 2 && ev.timeStamp - flingAt[0][0] > 110) flingAt.shift();   // (its last moments: how fast)
      if (how === "move" && shake(px, ev.timeStamp) && ev.timeStamp - shook > 2000) {   // shaken (again and again in one hold - 2 s apart):
        shook = ev.timeStamp;                                        // Bento on: Bento off; else the others pinned to the corners / back
        if (bento.on) bentoToggle(false); else shakeWindows(id);
      }
      if (!moved && Math.hypot(px - sx, py - sy) > 4 && roomOn.has(id)) {   // moved or resized by hand: out of the room - a window again
        const ss = stackRect(), cur = pxRect(id, ss), prev = roomPrev.get(id);
        roomOn.delete(id); roomPrev.delete(id);
        setPx(id, cur, ss);                                           // (it moves on from the room's place and size)
        if (how === "move" && prev) {                                 // 1.0.264: dragged out: its size from before - as a pinned app changes
          const w = prev.w * ss.width, h = prev.h * ss.height, k = w / Math.max(1, cur.w);   // size while dragged: scaled by the GPU around
          const gx = sx - ss.left - cur.x, gy = sy - ss.top - cur.y;   // the point you hold and trimmed to its shape (eased); its real
          roomLook = { k, w, h, gx, gy, cw: cur.w };                    // size is set once, where it shows, when you let go
          const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12, rr = (rad / k).toFixed(1) + "px", cut = Math.max(0, Math.round(cur.h - h / k));
          for (const [e2, o] of [[el, 0], [frames.get(id), RING]]) {
            if (!e2) continue;
            e2.setAttribute("data-vos-pinlook", "");
            e2.style.setProperty("transform-origin", `${Math.round(gx + o)}px ${Math.round(gy + o)}px`, "important");
            e2.style.setProperty("scale", String(+k.toFixed(4)), "important");
            if (e2 === el) { e2.style.setProperty("border-radius", rr, "important"); e2.style.setProperty("clip-path", `inset(0 0 ${cut}px 0 round ${rr})`, "important"); }
          }
        }
      }
      if (Math.hypot(px - sx, py - sy) > 4) moved = true;
      if (frame) return;                                            // at most one update per frame
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!leaving) { snapCheck(px, py); deskCheck(px, py); splitCheck(px, py); }   // 1.0.341: once a frame (reads first, then the move's writes) - not on every raw move
        if (mission && inMission && how === "move") {                // Mission Control: the small window follows the pointer
          const cur = pxRect(id, ss);
          const d = { x: last.clientX - ss.left - gOff.x, y: last.clientY - ss.top - gOff.y, w: cur.w, h: cur.h };
          if (!missionDrag) { el.setAttribute("data-ft-mc-held", ""); frames.get(id)?.setAttribute("data-ft-mc-held", ""); }   // no easing while held: it sticks to the pointer
          missionDrag = { id, r: d, k: kHeld };
          mcIcons?.querySelector(`[data-id="${CSS.escape(String(id))}"]`)?.setAttribute("data-held", "");   // held: its app icon goes (back when let go)
          place(el, d, ss); placeFrame(id, el, d, ss); missionLook(id, el, { x: d.x, y: d.y, k: kHeld }, d);
          return;
        }
        const dx = last.clientX - sx, dy = last.clientY - sy;
        let L = s0.x, T = s0.y, R = s0.x + s0.w, B = s0.y + s0.h;
        if (how === "move") { L += dx; R += dx; T += dy; B += dy; }
        else {
          if (how.includes("l")) L = Math.max(MARGIN, Math.min(L + dx, R - MIN_W));
          if (how.includes("r")) R = Math.min(ss.width - MARGIN, Math.max(R + dx, L + MIN_W));
          if (how.includes("t")) T = Math.max(MARGIN, Math.min(T + dy, B - MIN_H));
          if (how.includes("b")) B = Math.min(ss.height - MARGIN, Math.max(B + dy, T + MIN_H));
        }
        let r = clampRect({ x: L, y: T, w: R - L, h: B - T }, ss);
        if (scaling) {                                              // like a picture: one factor for both sides
          const ch0 = Math.max(1, s0.h - tb);
          let kx = null, ky = null;
          if (how.includes("r")) kx = (s0.w + dx) / s0.w;
          if (how.includes("l")) kx = (s0.w - dx) / s0.w;
          if (how.includes("b")) ky = (ch0 + dy) / ch0;
          if (how.includes("t")) ky = (ch0 - dy) / ch0;
          let k = kx != null && ky != null ? (kx + ky) / 2 : (kx ?? ky);
          k = Math.min(Math.max(k, ZMIN / z0, MIN_W / s0.w, (MIN_H - tb) / ch0),
                       ZMAX / z0, (ss.width - 2 * MARGIN) / s0.w, (ss.height - 2 * MARGIN - tb) / ch0);
          let z = z0 * k;
          if (Math.abs(z - 1) < 0.03) { z = 1; k = 1 / z0; }           // snaps to normal
          const w = s0.w * k, h = tb + ch0 * k;
          const x = how.includes("l") ? s0.x + s0.w - w : how.includes("r") ? s0.x : s0.x + (s0.w - w) / 2;
          const y = how.includes("t") ? s0.y + s0.h - h : how.includes("b") ? s0.y : s0.y + (s0.h - h) / 2;
          r = clampRect({ x, y, w, h }, ss);
          if (z === 1) delete zoomOf[id]; else zoomOf[id] = z;
          webviewsOf(id).forEach(wv => setWebZoom(wv, z));
          if (label) label.textContent = Math.round(z * 100) + "%";
        }
        setPx(id, r, ss);
        if (how === "move" && !scaling) {                            // moving: one GPU translate from where it started -
          if (liveMove?.id !== id) { liveMove = { id, base: { ...s0 } }; place(el, s0, ss); placeFrame(id, el, s0, ss); }   // no layout, no repaint
          const t = `${Math.round(r.x - liveMove.base.x)}px ${Math.round(r.y - liveMove.base.y)}px`;
          el.style.setProperty("translate", t, "important");
          frames.get(id)?.style.setProperty("translate", t, "important");
        } else { endLiveMove(); place(el, r, ss); placeFrame(id, el, r, ss); }
      });
    };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      cancelAnimationFrame(frame);
      ended = true;
      endLiveMove();
      if (roomLook) {                                                // (dragged out of the room: its real size, where it shows)
        const L = roomLook, ss = stackRect(), r = pxRect(id, ss), px0 = r.x + L.gx, py0 = r.y + L.gy;   // the point held, now
        for (const e2 of [el, frames.get(id)]) { if (!e2) continue; for (const k of ["scale", "transform-origin", "clip-path", "border-radius"]) e2.style.removeProperty(k); e2.removeAttribute("data-vos-pinlook"); }
        const fin = clampRect({ x: px0 - L.gx * L.k, y: py0 - L.gy * L.k, w: L.w, h: L.h }, ss);
        setPx(id, fin, ss); place(el, fin, ss); placeFrame(id, el, fin, ss); roomLook = null;
      }
      clearTimeout(holdTimer);
      if (scaling) { breathOut(el); label?.remove(); }
      holdTimer = 0;
      shield.remove();
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
      removeEventListener("pointercancel", onUp, true);
      clearTimeout(zoneTimer); clearTimeout(deskTimer);
      const heldMD = missionDrag?.id === id ? missionDrag : null, wasHeld = !!heldMD; missionDrag = null;
      if (wasHeld) requestAnimationFrame(() => requestAnimationFrame(() => { el.removeAttribute("data-ft-mc-held"); frames.get(id)?.removeAttribute("data-ft-mc-held"); }));
      if (missionSkip === id) missionSkip = null;
      { const t = spArmed && spT && spSide && !leaving && ev.type === "pointerup" ? spT.w : null, side = spSide, pane = spT?.pane;
        splitOff(); spT = null;
        if (t) { persist(id); if (backToBento.delete(id)) bento.skip.delete(id); splitInto(id, t, side, pane); return; } }
      if (deskDrop) {                                               // the desktops panel is open
        const card = deskOver; deskOver?.removeAttribute("data-drop");
        ntrace("drop", { card: card ? (card.classList.contains("vos-ws-more") ? "new" : card.dataset.ws) : null, type: ev.type, inMission });
        const strip = wsStrip, list = strip?.__list || [];
        const keep = inMission && card && !card.classList.contains("vos-ws-more");   // Mission Control stays open
        if (!keep && (!inMission || card || !moved)) closeWsStrip();
        if (card?.classList.contains("vos-ws-more") && ev.type === "pointerup") {   // New: a desktop made for it, and you go there with it
          persist(id);
          if (backToBento.delete(id)) bento.skip.delete(id);
          return toNewDeskNow(id, list);
        }
        if (card && ev.type === "pointerup") {
          persist(id);
          if (backToBento.delete(id)) bento.skip.delete(id);
          const ws = card.dataset.ws ? (list.find(w => String(w.id) === card.dataset.ws)?.id ?? null) : null;
          if (keep) {                                                 // its mini window goes to that desktop
            const mini = strip.querySelector(`.vos-ws-win[data-tab="${CSS.escape(String(id))}"]`);
            card.querySelector(".vos-ws-empty")?.remove();
            if (mini) card.querySelector(".vos-ws-mini")?.appendChild(mini);
            return flyInto(id, el, card, heldMD, () => toDesk(id, ws));
          }
          return toDeskAndGo(id, ws);                                // dragged up to the desktops (not from the desktops button): you go with it
        }
        if (inMission) { if (wasHeld) { missionGlide(); queueRender(); } return; }   // let go elsewhere: it glides back
      }
      { const f0 = ev.type === "pointerup" && leaving && !deskDrop && !inMission ? fling(ev) : null;   // a corner flick past the edge: still a pin
        if (isPinFlick(f0)) { leaving = false; dragOutCancel(); } }
      if (leaving) {                                                // let go outside: to the Vivaldi window under it
        const target = dragOutEnd(ev.screenX, ev.screenY, ev.type === "pointerup");
        if (ev.type === "pointerup") { if (shown) snapPreview(null); persist(id); return toOtherWindow(id, ev.screenX, ev.screenY, target); }
      }
      { const c = pinAt;
        const sl = pinSl; slotShow(null);
        if (c && ev.type === "pointerup" && floating.has(id) && !pip.includes(id)) { pinAt = null; persist(id); pinInto(id, c, sl); return; }   // pinned there, between the others
        if (c) pinShow(null); }
      if (how !== "move" && moved && ev.type === "pointerup") { const m = pinMem.get(id); if (m) { delete m.w; delete m.h; } }   // resized: its remembered pinned size goes (its corner and place stay)
      let snap = ev.type === "pointerup" ? (shown || (!deskDrop && !leaving && !inMission ? fling(ev) : null)) : null;   // (thrown: the same snap)
      if (isPinFlick(snap)) {                                         // flicked to a corner / to the pinned apps: pinned there (it flies in)
        const sl = flickSlot(snap, id, ev.clientY, el);
        if (frac0) frac[id] = frac0;                                 // unpinned later: back where it was before the flick
        if (shown) snapPreview(null);
        persist(id); pinInto(id, sl.corner, sl);
        return;
      }
      if (shown) snapPreview(null, null, !!snap);
      persist(id);
      const toBento = backToBento.delete(id);
      if (toBento) bento.skip.delete(id);                           // Bento takes it back now
      if (snap === "full") act("zoom", pageOf(id));                // full screen (the green button's way)
      else if (snap) snapBento(id, snap);
      else if (toBento) bTransition(() => render());               // let go elsewhere: it glides into its Bento slot
    };
    // pointer events: mouse, touch and pen move/resize the same way
    addEventListener("pointermove", onMove, true);
    addEventListener("pointerup", onUp, true);
    addEventListener("pointercancel", onUp, true);
  }

  /* TO ANOTHER VIVALDI WINDOW: drag a floating window past the edge of this one and let
     go over another Vivaldi window - its tab(s) move there and it floats where you let go;
     let go over the empty desktop - a new Vivaldi window opens there with it */
  const DROP_KEY = "vosWindowDrop";
  const isOutside = ev => ev.clientX < 0 || ev.clientY < 0 || ev.clientX > innerWidth || ev.clientY > innerHeight;
  /* while a window is dragged out, the Vivaldi windows talk (they share this channel):
     this one tells where it is held, with a snapshot of the page; the window under the
     pointer draws it there, live, and answers "here" - so it is dropped where you see it */
  const dragCh = typeof BroadcastChannel === "function" ? new BroadcastChannel("vos-window-drag") : null;
  const myWin = () => window.vivaldiWindowId;
  let dragOut = null;                                   // { id, ox, oy, over, overAt }
  let dragHeld = null;                                  // where the last window dragged out was held
  function hint(text) {
    let h = document.getElementById("vos-leave-hint");
    if (!text) { h?.remove(); return; }
    if (!h) { h = document.createElement("div"); h.id = "vos-leave-hint"; (browserEl() || document.body).appendChild(h); }
    h.textContent = text;
  }
  async function dragOutStart(id, el, ev) {
    const r = el.getBoundingClientRect();
    dragOut = { id, ox: ev.clientX - r.left, oy: ev.clientY - r.top, over: null, overAt: 0 };
    const tab = await new Promise(res => chrome.tabs.get(tabIdOf(id), t => { void chrome.runtime.lastError; res(t); }));
    const img = "";                                     // (the other window shows its app icon)
    if (!dragOut || dragOut.id !== id) return;
    dragCh?.postMessage({ type: "start", from: myWin(), w: r.width, h: r.height, ox: dragOut.ox, oy: dragOut.oy,
                          title: tab?.title || "", url: tab?.url || "", img });
    hint("Release to open it in a new window");
  }
  function dragOutMove(sx, sy) {
    if (!dragOut) return;
    dragCh?.postMessage({ type: "move", from: myWin(), sx, sy });
    if (dragOut.over && Date.now() - dragOut.overAt > 400) dragOut.over = null;
    hint(dragOut.over ? "" : "Release to open it in a new window");
  }
  function dragOutCancel() { if (!dragOut) return; dragCh?.postMessage({ type: "end", from: myWin() }); dragOut = null; hint(""); }
  function dragOutEnd(sx, sy, drop) {                    // -> the window that said it is under the pointer
    if (!dragOut) return null;
    const to = dragOut.over && Date.now() - dragOut.overAt < 600 ? dragOut.over : null;
    dragHeld = { ox: dragOut.ox, oy: dragOut.oy };
    dragCh?.postMessage({ type: "end", from: myWin(), drop });
    dragOut = null; hint("");
    return to;
  }
  // the other side: draw the window being dragged in, where the pointer is
  let ghost = null, landGhost = null;
  function ghostGone(g = landGhost) {                // the icon of a window dropped here: gone as the window shows (a quick fade)
    if (!g || g.__gone) return;
    g.__gone = true; if (landGhost === g) landGhost = null;
    g.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.8)" }], { duration: 140, easing: "ease-in", fill: "forwards" }).finished.catch(() => {}).then(() => g.remove()) && setTimeout(() => g.remove(), 2500);
    setTimeout(() => g.remove(), 400);
  }
  if (dragCh) dragCh.onmessage = ({ data: m }) => {
    if (!m || m.from === myWin()) return;
    if (m.to != null) {                                   // an answer to my own drag
      if (m.to === myWin() && dragOut && m.type === "over") { dragOut.over = m.win; dragOut.overAt = Date.now(); }
      return;
    }
    if (m.type === "start") {
      ghost?.el.remove();
      const g = document.createElement("div");
      g.className = "vos-drag-ghost vos-drag-icon";                // its app icon, under the pointer
      g.style.display = "none";
      const im = document.createElement("img"); im.alt = ""; im.src = favicon(m.url || ""); g.appendChild(im);
      (browserEl() || document.body).appendChild(g);
      ghost = { el: g, ox: 32, oy: 32, from: m.from };
    } else if (m.type === "move" && ghost) {
      const top = window.screenY + (window.outerHeight - window.innerHeight);
      const lx = m.sx - window.screenX, ly = m.sy - top;
      const inside = lx >= 0 && ly >= 0 && lx <= innerWidth && ly <= innerHeight;
      ghost.el.style.display = inside ? "" : "none";
      if (inside) {
        ghost.el.style.left = (lx - ghost.ox) + "px"; ghost.el.style.top = (ly - ghost.oy) + "px";
        dragCh.postMessage({ type: "over", from: myWin(), to: ghost.from, win: myWin() });
      }
    } else if (m.type === "end" && ghost) {
      const g = ghost.el; ghost = null;
      if (m.drop && g.style.display !== "none") { landGhost = g; setTimeout(() => ghostGone(g), 700); }   // until the window itself arrives (no longer)
      else g.remove();
    }
  };
  async function toOtherWindow(id, sx, sy, toWin) {
    const page = pageOf(id);
    const ids = (groupFloat.has(id) && page ? membersOf(page) : [id]).map(tabIdOf).filter(Boolean);
    if (!ids.length) return;
    const tabs = (await Promise.all(ids.map(t => new Promise(r => chrome.tabs.get(t, x => { void chrome.runtime.lastError; r(x); })))))
      .filter(Boolean);
    if (!tabs.length) return;
    const urls = tabs.map(t => t.url || t.pendingUrl);
    const me = await new Promise(r => chrome.windows.getCurrent(w => r(w)));
    const all = await new Promise(r => chrome.windows.getAll({ windowTypes: ["normal"] }, w => r(w || [])));
    const target = (toWin != null && all.find(w => w.id === toWin && w.id !== me?.id)) ||
      all.find(w => w.id !== me?.id && w.state !== "minimized" && !w.incognito === !me?.incognito &&
        sx >= w.left && sx <= w.left + w.width && sy >= w.top && sy <= w.top + w.height);
    const r = pxRect(id), w0 = Math.round(r.w), h0 = Math.round(r.h);
    const held = dragHeld || { ox: w0 / 2, oy: 14 };
    // the other window opens it where it was seen (it reads this when the new tab appears)
    vstore.set(DROP_KEY, { urls, sx, sy, w: w0, h: h0, ox: held.ox, oy: held.oy, t: Date.now() });
    // Vivaldi itself opens it there, as a new tab of the desktop that window shows - the
    // reliable way (moving a live tab between windows confuses its workspaces); the page reloads
    const closeOld = () => chrome.tabs.remove(tabs.map(t => t.id), () => void chrome.runtime.lastError);
    if (target) {                                                   // moved, as it is, onto the desktop that window shows
      const tws = vivActiveWs(target.id);
      const split = ids.length > 1 ? (tileMeta.get(String(id))?.layout || (page && rootOf(page)?.querySelector(".mosaic-split.-column, [class*='column']") ? "column" : "row")) : null;   // a split: it stays one there
      let tree = null;                                                // its layout, by tab (the other window numbers its panes itself)
      if (split) try {
        await syncTiling();
        const g = splitOfTab.get(String(ids[0])), t = g ? await treeOf(g, ids.map(String)) : null;
        const tabAt = new Map(ids.map(x => [tileMeta.get(String(x))?.index, String(x)]));
        const conv = n => typeof n === "number" ? (tabAt.has(n) ? tabAt.get(n) : null) : (n ? { ...n, first: conv(n.first), second: conv(n.second) } : null);
        const tt = t ? conv(t) : null, ok = n => typeof n === "string" || (!!n && typeof n === "object" && ok(n.first) && ok(n.second));
        if (tt && ok(tt)) tree = tt;
      } catch (e) {}
      vstore.set(DROP_KEY, { urls, ids: ids.map(String), split, tree, sx, sy, w: w0, h: h0, ox: held.ox, oy: held.oy, t: Date.now() });
      const cur = curWs();
      const left = await handOver(ids.map(String), cur);              // this window stays on its desktop
      const moved = await new Promise(res => {
        try {
          vivaldi.tabsPrivate.move({ tabIds: ids.map(Number), target: "last", tweaks: ["do-not-reparent"], windowId: target.id, workspaceId: tws == null ? "window" : tws },
            () => res(!chrome.runtime.lastError));
        } catch (e) { res(false); }
      });
      if (moved) {
        if (left === "empty" && cur != null && !sameWs(vivActiveWs(), cur)) emptySwitch(cur);
        chrome.windows.update(target.id, { focused: true }, () => void chrome.runtime.lastError);
        chrome.tabs.update(Number(ids[0]), { active: true }, () => void chrome.runtime.lastError);
        return;
      }
    }
    if (target) {                                                   // (could not move: opened there instead)
      let n = 0;
      for (const [i, url] of urls.entries())
        chrome.tabs.create({ windowId: target.id, url, active: i === 0 }, () => { void chrome.runtime.lastError; if (++n === urls.length) closeOld(); });
      chrome.windows.update(target.id, { focused: true }, () => void chrome.runtime.lastError);
    } else {                                                        // the empty desktop: a new Vivaldi window there
      const W = Math.max(w0 + 80, 900), H = Math.max(h0 + 120, 640);
      chrome.windows.create({ url: urls, left: Math.round(sx - W / 2), top: Math.max(0, Math.round(sy - 40)), width: W, height: H, focused: true },
        () => { void chrome.runtime.lastError; closeOld(); });
    }
  }
  /* a new tab opened here for a window dropped from another Vivaldi window: it floats
     where it was let go */
  function droppedHere(tab) {
    const url = tab.pendingUrl || tab.url || "";
    if (!/^https?:/i.test(url)) return;
    vstore.get(DROP_KEY).then(d => {
      if (!d || Date.now() - d.t > 8000 || !d.urls?.includes(url)) return;
      chrome.windows.getCurrent(me => {
        if (!me || tab.windowId !== me.id) return;
        const ss = stackRect(), id = String(tab.id);
        const lx = d.sx - window.screenX - ss.left, ly = d.sy - window.screenY - (window.outerHeight - window.innerHeight) - ss.top;
        setPx(id, clampRect({ x: lx - (d.ox ?? d.w / 2), y: Math.max(0, ly - (d.oy ?? 14)), w: d.w, h: d.h }, ss), ss);
        if (floating.has(id)) persist(id);
        queueRender();
      });
    });
  }
  /* a tab arriving from another Vivaldi window: it floats where it was let go */
  function arrived(tabId, info) {
    chrome.windows.getCurrent(me => {
      if (!me || info.newWindowId !== me.id) return;
      const id = String(tabId);
      vstore.get(DROP_KEY).then(d => {
        const ours = d && Date.now() - d.t < 8000 && d.ids?.includes(id);
        if (ours && d.split && d.ids.length > 1) {                    // a split window: one window here, its first tab holds it
          if (id !== d.ids[0]) return;                                // the other panes are in it (never windows of their own)
          const ss = stackRect();
          const lx = d.sx - window.screenX - ss.left, ly = d.sy - window.screenY - (window.outerHeight - window.innerHeight) - ss.top;
          setPx(id, clampRect({ x: lx - (d.ox ?? d.w / 2), y: Math.max(0, ly - (d.oy ?? 14)), w: d.w, h: d.h }, ss), ss);
          groupFloat.add(id); floatNow(id, pageOf(id) || null); raise(id); queueRender();
          requestAnimationFrame(() => ghostGone());
          const t0 = Date.now(), order = d.tree ? tabLeaves(d.tree) : d.ids;
          const again = async () => {                                 // Vivaldi let go of the split on the way: split again, in the same order - then its own layout
            if (!d.ids.every(x => pageOf(x))) { if (Date.now() - t0 < 5000) setTimeout(again, 150); return; }
            if (isTiled(pageOf(id)) && rootOf(pageOf(id)) === rootOf(pageOf(d.ids[1]))) { if (d.tree) await layOutTabs(d.tree); queueRender(); return; }
            const api = vivTile(); if (!api) return;
            try {
              const nums = order.map(Number), list = api.store.getPages(await winId())?.filter?.(pg => nums.includes(pg.id))?.sortBy?.(pg => nums.indexOf(pg.id));
              if (list && list.size === nums.length) {
                dropInfo = { target: id, dragged: null, src: id, kind: "window", t: Date.now() };
                await api.tile(list, d.split);
                if (d.tree) setTimeout(() => layOutTabs(d.tree).then(queueRender), 500);
                queueRender();
              }
            } catch (e) { LOG("split moved", e); }
          };
          setTimeout(again, 400);
          return;
        }
        floatOnLoad.add(id); floatOnLoadAt.set(id, Date.now()); siteReady.add(id);
        if (ours) {
          const ss = stackRect();
          const lx = d.sx - window.screenX - ss.left, ly = d.sy - window.screenY - (window.outerHeight - window.innerHeight) - ss.top;
          setPx(id, clampRect({ x: lx - (d.ox ?? d.w / 2), y: Math.max(0, ly - (d.oy ?? 14)), w: d.w, h: d.h }, ss), ss);
        }
        floatNow(id, pageOf(id) || null); raise(id); queueRender();
        requestAnimationFrame(() => ghostGone());
      });
    });
  }

  /* SHAKE: a window shaken left-right while you drag it (4 quick turns) */
  /* SHAKE a window: every other window of this desktop is pinned, shared out over the four corners (front ones first) */
  function shakeWindows(id) {                       // shaken: the others pinned - shaken again (only pins left): every pin back to a window
    const normal = [...floating].some(w => w !== id && !pip.includes(w) && !minimized.has(w) && !awayWs(w) && w !== cover && !groupFloat.has(w));
    if (normal) return pinOthers(id);                               // (1.0.269: normal windows beside pinned ones: those are pinned too)
    const live = pip.filter(p => p !== id && !awayWs(p) && !minimized.has(p));
    if (!live.length) return;
    flip(live.map(p => targetOf(pageOf(p))), () => { for (const p of live) { pipOff(p); persist(p); } raise(id); render(); });   // (they glide back; the one held stays on top)
  }
  function pinOthers(id) {
    const C = ["tl", "tr", "bl", "br"];
    const others = [...floating].filter(w => w !== id && !pip.includes(w) && !minimized.has(w) && !awayWs(w) && w !== cover && !groupFloat.has(w))
      .sort((a, b) => zOrder.indexOf(b) - zOrder.indexOf(a));
    if (!others.length) return;
    const els = others.map(w => targetOf(pageOf(w))), sizes = els.map(e => e ? { width: e.offsetWidth, height: e.offsetHeight } : null);
    // each to the corner it had last time (then its place there too); one never pinned: the corner nearest to it, while
    // that corner has room (so they still share the four corners) - a shake never shuffles them
    const ss = stackRect(), cap = Math.ceil(others.length / 4), used = { tl: 0, tr: 0, bl: 0, br: 0 }, to = new Map();
    for (const w of others) { const c = pinMem.get(w)?.c; if (/^[tb][lr]$/.test(c || "")) { to.set(w, c); used[c]++; } }
    for (const w of others) {
      if (to.has(w)) continue;
      const r = pxRect(w, ss), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const near = C.slice().sort((a, b) => Math.hypot((a[1] === "l" ? 0 : ss.width) - cx, (a[0] === "t" ? 0 : ss.height) - cy) - Math.hypot((b[1] === "l" ? 0 : ss.width) - cx, (b[0] === "t" ? 0 : ss.height) - cy));
      const c = near.find(k => used[k] < cap) || near[0]; to.set(w, c); used[c]++;
    }
    flip([...els, ...pip.map(p => targetOf(pageOf(p)))].filter(Boolean), () => {   // all of them in ONE animation (one measure, one draw)
      others.forEach((w, i) => { if (els[i] && sizes[i]) { try { pinNow(w, els[i], to.get(w), null, sizes[i]); } catch (e) {} } });
      raise(id); render();
    });
  }
  function shaker() {
    let dir = 0, turnX = null, turns = [];
    return (x, t) => {
      if (turnX == null) { turnX = x; return false; }
      const d = Math.sign(x - turnX);
      if (!d || Math.abs(x - turnX) < 28) return false;          // too small to count as a swing
      if (d !== dir) { if (dir) turns.push(t); dir = d; }
      turnX = x;
      turns = turns.filter(u => t - u < 800);
      if (turns.length >= 4) { turns = []; return true; }
      return false;
    };
  }

  /* the snap preview: a frosted rounded area where the window will go */
  const SNAP_HOLD = 200;
  /* which snap zone the pointer is in: AT the top edge of the desktop, or on the tab bar
     above it (full screen); AT the left / right edge (that half) */
  function snapZone(x, y) {
    const r = stack() ? stackRect() : null;                           // (1.0.341: the kept size - no layout read per move)
    if (!r) return null;
    if (y <= r.top + 1) return "full";                               // at the top edge, or on the tab bar above it
    if (x <= r.left + 1 || x <= 1) return "left";                    // at the left edge
    if (x >= r.right - 2 || x >= innerWidth - 2) return "right";     // at the right edge
    return null;
  }
  let snapEl = null;
  const SPLIT_HOLD = 1200;                           // (held still this long over a window: the split shows - a little longer, never by chance)
  /* the window under the pointer that a held window can split with (one page, on this desktop) */
  function splitTargetAt(id, x, y) {
    if (focusSet.size) return null;                                  // focus mode: no splits (windows only move)
    for (const w of [...zOrder].reverse()) {
      if (w === id || !floating.has(w) || minimized.has(w) || awayWs(w) || pip.includes(w) || w === cover) continue;
      const pg = pageOf(w), t = targetOf(pg);
      if (!t) continue;
      const r = t.getBoundingClientRect();
      if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue;
      if (isTiled(pg)) {                                             // a split: beside the pane under the pointer
        const pane = membersOf(pg).map(m => pageOf(m)).find(p => p && inRect(x, y, p.getBoundingClientRect()));
        return pane ? { w, r: pane.getBoundingClientRect(), pane: pane.dataset.id } : null;
      }
      return { w, r };
    }
    return null;
  }
  let splitEl = null;
  function splitPreview(w, x, y, fromEl, overEl, rect) {                    // rect: one pane of it (a split re-arranged)                          // the half of window w the held one takes; null: gone
    if (w == null) {
      const old = splitEl; splitEl = null;
      old?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-in", fill: "forwards" }).finished.catch(() => {}).then(() => old.remove()) && setTimeout(() => old.remove(), 2500);
      return null;
    }
    const t = targetOf(pageOf(w)), host = stack();
    if ((!t && !rect) || !host) return null;
    const r = rect || t.getBoundingClientRect(), ss = stackRect();
    const fx = (x - r.left) / Math.max(1, r.width), fy = (y - r.top) / Math.max(1, r.height);
    const side = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]].sort((a, b) => a[1] - b[1])[0][0];
    const G = 6, hw = r.width / 2, hh = r.height / 2;
    const p = side === "left" ? { x: r.left, y: r.top, w: hw, h: r.height } : side === "right" ? { x: r.left + hw, y: r.top, w: hw, h: r.height }
            : side === "top" ? { x: r.left, y: r.top, w: r.width, h: hh } : { x: r.left, y: r.top + hh, w: r.width, h: hh };
    const born = !splitEl;
    if (born) { splitEl = document.createElement("div"); splitEl.className = "ft-snap-preview vos-split-preview"; host.appendChild(splitEl); }
    const z = overEl ? (Number(getComputedStyle(overEl).zIndex) || 100) + 1 : (Number(fromEl && getComputedStyle(fromEl).zIndex) || 100) - 1;
    splitEl.style.zIndex = String(z);                                 // over the window it splits, under the one you hold
    splitEl.dataset.side = side;
    Object.assign(splitEl.style, { left: (p.x - ss.left + G) + "px", top: (p.y - ss.top + G) + "px", width: Math.max(0, p.w - 2 * G) + "px", height: Math.max(0, p.h - 2 * G) + "px" });
    if (born) splitEl.animate([{ opacity: 0, transform: "scale(0.94)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
    return side;
  }
  /* Vivaldi's own split (its "tile these tabs"): window src goes beside window target, on that
     side; the target window holds the split and keeps its place (as a tab dropped on it) */
  let tileApi = null;
  function vivTile() {
    if (tileApi) return tileApi;
    try {
      let host = null;
      try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      if (!ch?.push) return null;
      let req = null, tile = null, store = null, setLayout = null, addTo = null, flux = null, moveIn = null;
      ch.push([["vos-tile-" + Date.now()], {}, r => { req = r; }]);
      for (const mid of Object.keys(req?.m || {})) {
        let src = "";
        try { src = Function.prototype.toString.call(req.m[mid]); } catch (e) { continue; }
        const wantTile = !tile && src.includes('"TILE_SET_LAYOUT"') && src.includes("randomUUID");
        const wantStore = !store && /getPageInWindow\([a-z],[a-z]\)\{/.test(src);
        const wantFlux = !flux && src.length < 3000 && src.includes("reorderRegistrations");   // Vivaldi's own dispatcher (its actions)
        if (!wantTile && !wantStore && !wantFlux) continue;
        let ex; try { ex = req(mid); } catch (e) { continue; }
        for (const k of Object.keys(ex || {})) {
          let v; try { v = ex[k]; } catch (e) { continue; }
          if (wantTile && typeof v === "function") { let fs = ""; try { fs = Function.prototype.toString.call(v); } catch (e) {} if (fs.includes("randomUUID") && fs.includes("tiling:")) tile = v; if (fs.includes('actionType:"TILE_SET_LAYOUT"')) setLayout = v; if (fs.includes('"PAGE_TILE_ADD_PAGES"')) addTo = v; if (fs.includes('"PAGE_TILE_RETILE"')) moveIn = v; }
          if (wantStore && v && typeof v.getPageInWindow === "function" && typeof v.getPages === "function") store = v;
          if (wantFlux && v && typeof v.dispatch === "function" && typeof v.register === "function") flux = v;
        }
        if (tile && store && setLayout && addTo && flux && moveIn) break;
      }
      if (tile && store) tileApi = { tile, store, setLayout, addTo, moveIn, dispatch: flux ? a => flux.dispatch(a) : null };
    } catch (e) { LOG("tile: Vivaldi's split not found", e); }
    return tileApi;
  }
  /* CLOSE THE APP FROM THE KEYBOARD: Vivaldi's own "Close Tab" (Cmd+W on a Mac, Ctrl+W on Windows - or whatever key it
     has) closes the app in front as its red button does: a floating window - a split window whole, all its panes -,
     with its closing animation. Anything else (a full-screen page, the Launchpad): Vivaldi's own close, as always. */
  let closeCmdPatched = false;
  function closeAppNow() {
    closeAppNow.n = (closeAppNow.n || 0) + 1;                       // (how often Vivaldi's close came here)
    const ap = activePage(), id = ap?.dataset.id;
    if (!ap || isStart(ap) || lpOn() || mission) return false;
    const w = winOf(id);
    if (!w || !floating.has(w) || minimized.has(w) || awayWs(w)) return false;
    const pg = pageOf(w); if (!pg) return false;
    act("close", pg);
    return true;
  }
  window.vosCloseApp = closeAppNow;
  setTimeout(() => {
    const mac = /Mac/i.test(navigator.platform || ""), M = mac ? "meta+" : "ctrl+";
    prefGet("vivaldi.actions").then(acts => {
      if (!acts) return;
      let j = JSON.stringify(acts);
      if (!mac && /"meta\+/.test(j)) j = j.replace(/"meta\+/g, '"ctrl+').replace(/\+meta\+/g, "+ctrl+");
      const all = JSON.parse(j), o = Array.isArray(all) ? all[0] : all;
      let changed = j !== JSON.stringify(acts);
      /* 1.0.239: zoom in with the "=" key too, and with Shift + "=" (the "+" on most keyboards) - Vivaldi names that key "="
         even with Shift held, so "Ctrl + +" alone never matched it */
      if (o && typeof o === "object") {
        const z = o.COMMAND_MAIN_ZOOM_IN || (o.COMMAND_MAIN_ZOOM_IN = { shortcuts: [M + "+", "0", "numpad0", "+"] });
        if (!Array.isArray(z.shortcuts)) z.shortcuts = [];
        for (const k of [M + "=", M + "shift+="]) if (!z.shortcuts.includes(k)) { z.shortcuts.push(k); changed = true; }
      }
      if (changed) prefSet("vivaldi.actions", all);
    }).catch(() => {});
  }, 5000);
  function patchCloseCmd(tries = 0) {
    if (closeCmdPatched && zoomInCmd) return;
    try {
      let host = null; try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      let req = null;
      if (ch?.push) ch.push([["vos-close-" + Date.now()], {}, r => { req = r; }]);
      for (const mid of Object.keys(req?.m || {})) {
        let src = ""; try { src = Function.prototype.toString.call(req.m[mid]); } catch (e) { continue; }
        if (!src.includes('name:"COMMAND_CLOSE_TAB"') && !src.includes('name:"COMMAND_MAIN_ZOOM_IN"')) continue;
        let ex; try { ex = req(mid); } catch (e) { continue; }
        for (const k of Object.keys(ex || {})) {
          let v; try { v = ex[k]; } catch (e) { continue; }
          if (Array.isArray(v) && !zoomInCmd) zoomInCmd = v.find(x => x?.name === "COMMAND_MAIN_ZOOM_IN" && typeof x.action === "function") || null;
          const c = Array.isArray(v) ? v.find(x => x?.name === "COMMAND_CLOSE_TAB") : null;
          if (!c || typeof c.action !== "function" || c.__vosOrig) continue;
          const orig = c.action;
          c.__vosOrig = orig;
          c.action = function (...a) { try { if (closeAppNow()) return; } catch (e) {} return orig.apply(this, a); };
          closeCmdPatched = true;
        }
        if (closeCmdPatched && zoomInCmd) return;
      }
    } catch (e) { LOG("close shortcut", e); }
    if (tries < 10) setTimeout(() => patchCloseCmd(tries + 1), 1500);
  }
  setTimeout(patchCloseCmd, 1500);
  /* 1.0.240: zoom in from the keyboard on every layout - Ctrl (Cmd) with "=", Shift + "=" ("+") or the keypad's "+". A key
     pressed in a page reaches Vivaldi as a name its engine makes; on some keyboards that name for "=" / "+" matches no
     shortcut, so nothing happens (Ctrl + "-" works). Heard here too: if the page's zoom has not changed a moment later,
     Vivaldi's own Zoom In runs (where the key already works, it is not done twice) */
  let zoomInCmd = null;
  try {
    vivaldi.tabsPrivate.onKeyboardShortcut.addListener((winId, combo, rep) => {
      const k = String(combo || "").toLowerCase().replace(/\s+/g, "");
      if (!/^(ctrl|meta)\+(shift\+)?(=|\+|plus|equal|add|numpadadd|numpad\+)$/.test(k) || !zoomInCmd) return;
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => {
        if (!t) return;
        chrome.tabs.getZoom(t.id, z0 => {
          if (chrome.runtime.lastError) return;
          setTimeout(() => chrome.tabs.getZoom(t.id, z1 => {
            if (chrome.runtime.lastError || Math.abs(z1 - z0) > 0.001) return;   // Vivaldi zoomed it: done
            try { zoomInCmd.action({ windowId: winId }); } catch (e) { LOG("zoom in", e); }
          }), 180);
        });
      });
    });
  } catch (e) { LOG("zoom keys", e); }
  /* a split re-arranged from inside: pane `id` goes to `side` of pane `to` - left / right: the panes side by side,
     top / bottom: one above the other (three or more: one row / one column, in the new order) */
  const tabLeaves = (n, out = []) => { if (typeof n === "string") out.push(n); else if (n) { tabLeaves(n.first, out); tabLeaves(n.second, out); } return out; };
  async function layOutTabs(tabTree, tries = 0) {
    const api = vivTile(); if (!api?.setLayout) return false;
    try {
      await syncTiling();
      const leaves = tabLeaves(tabTree), g = splitOfTab.get(leaves[0]);
      if (!g || !leaves.every(t => splitOfTab.get(t) === g) || [...splitOfTab].filter(([, v]) => v === g).length !== leaves.length) {
        if (tries < 12) setTimeout(() => layOutTabs(tabTree, tries + 1), 250);   // (not all in one split yet)
        return false;
      }
      await Promise.all(leaves.map((tid, i) => new Promise(res => {   // each pane's number follows its place
        if (tileMeta.get(tid)?.index === i) return res();
        chrome.tabs.get(Number(tid), t => {
          void chrome.runtime.lastError;
          let x = {}; try { x = JSON.parse(t?.vivExtData || "{}") || {}; } catch (e) {}
          if (!x.tiling) return res();
          x.tiling = { ...x.tiling, index: i };
          chrome.tabs.update(Number(tid), { vivExtData: JSON.stringify(x) }, () => { void chrome.runtime.lastError; tileMeta.set(tid, { ...(tileMeta.get(tid) || {}), index: i }); res(); });
        });
      })));
      const conv = n => typeof n === "string" ? leaves.indexOf(n) : { ...n, first: conv(n.first), second: conv(n.second) };
      const tree = conv(tabTree);
      api.setLayout(await winId(), tree, g);
      tileTrees = { ...tileTrees, [g]: tree }; setTimeout(readTiling, 600);
      return true;
    } catch (e) { LOG("layout moved", e); return false; }
  }
  async function rearrange(win, id, to, side, full) {
    const api = vivTile();
    if (!api) return false;
    try {
      await syncTiling();                                            // (each pane's place in the split as it is now)
      const g = splitOfTab.get(String(id)), ix = tileMeta.get(String(id))?.index, iy = tileMeta.get(String(to))?.index;
      const tree = g ? await treeOf(g, [...splitOfTab].filter(([k, v]) => v === g).map(([k]) => k)) : null;
      if (tree && api.setLayout && ix != null && iy != null && splitOfTab.get(String(to)) === g) {
        const cut = n => {                                           // the pane out of its place (its neighbour takes the room)
          if (typeof n === "number") return n === ix ? null : n;
          const a = cut(n.first), b = cut(n.second);
          return a == null ? b : b == null ? a : { ...n, first: a, second: b };
        };
        const into = n => typeof n === "number"                       // the other pane split in two: the dropped one on that side
          ? (n === iy ? { direction: side === "left" || side === "right" ? "row" : "column", first: side === "left" || side === "top" ? ix : iy, second: side === "left" || side === "top" ? iy : ix, splitPercentage: 50 } : n)
          : { ...n, first: into(n.first), second: into(n.second) };
        let next = into(cut(tree));
        if (!full) dropInfo = { target: String(win), dragged: String(id), src: String(win), kind: "window", t: Date.now() };
        // Vivaldi lays panes of one direction out in their tabs' order: each pane's number follows where it now is
        const order = leavesOf(next), byIdx = new Map([...splitOfTab].filter(([k, v]) => v === g).map(([k]) => [tileMeta.get(k)?.index, k]));
        const renum = n => typeof n === "number" ? order.indexOf(n) : { ...n, first: renum(n.first), second: renum(n.second) };
        await Promise.all(order.map((oldIdx, newIdx) => new Promise(res => {
          const tid = byIdx.get(oldIdx);
          if (tid == null || oldIdx === newIdx) return res();
          chrome.tabs.get(Number(tid), t => {
            void chrome.runtime.lastError;
            let x = {}; try { x = JSON.parse(t?.vivExtData || "{}") || {}; } catch (e) {}
            if (!x.tiling) return res();
            x.tiling = { ...x.tiling, index: newIdx };
            chrome.tabs.update(Number(tid), { vivExtData: JSON.stringify(x) }, () => { void chrome.runtime.lastError; tileMeta.set(String(tid), { ...(tileMeta.get(String(tid)) || {}), index: newIdx }); res(); });
          });
        })));
        next = renum(next);
        api.setLayout(await winId(), next, g);
        tileTrees = { ...tileTrees, [g]: next }; setTimeout(readTiling, 600);
        activate(id); queueRender();
        return true;
      }
      if (api.moveIn) {                                              // (no tree known: Vivaldi's own move)
        const wid = await winId(), all = api.store.getPages(wid);
        const P = x => all?.find?.(pg => pg.id === Number(x)), pg = P(id), ref = P(to), g = pg?.vivExtData?.tiling?.id;
        if (pg && ref && g && ref.vivExtData?.tiling?.id === g) {
          if (!full) dropInfo = { target: String(win), dragged: String(id), src: String(win), kind: "window", t: Date.now() };
          await api.moveIn(g, pg, ref, side);
          setTimeout(readTiling, 500);
          activate(id); queueRender();
          return true;
        }
      }
      return false;                                                  // (never a flat re-split: the layout stays as it is)
    } catch (e) { LOG("rearrange", e); dropInfo = null; render(); return false; }
  }
  async function splitInto(src, target, side, pane) {
    const api = vivTile();
    if (!api) { LOG("tile: Vivaldi's split not found"); render(); return false; }
    try {
      const wid = await winId(), all = api.store.getPages(wid);
      const tp = pageOf(target), refId = pane || (isTiled(tp) ? (splitFocus.get(String(target)) || target) : null);
      if (refId && isTiled(pageOf(refId)) && api.addTo) {
        await syncTiling();
        const ref = all?.find?.(pg => pg.id === Number(refId)), g = ref?.vivExtData?.tiling?.id;
        const adds = all?.filter?.(pg => pg.id === Number(src));
        if (!ref || !g || !adds?.size) { render(); return false; }
        dropInfo = { target: String(target), dragged: String(src), src: String(src), kind: "window", t: Date.now() };   // the split window keeps its place
        lastOver = { id: String(target), t: Date.now() };
        raise(target); render();
        await api.addTo(g, adds, ref, side);                          // Vivaldi's own add: beside that pane, nested as Vivaldi does it
        setTimeout(readTiling, 400);
        queueRender();
        return true;
      }
      const order = side === "left" || side === "top" ? [Number(src), Number(target)] : [Number(target), Number(src)];
      const list = all?.filter?.(pg => order.includes(pg.id))?.sortBy?.(pg => order.indexOf(pg.id));
      if (!list || list.size !== 2) { render(); return false; }
      dropInfo = { target: String(target), dragged: String(src), src: String(src), kind: "window", t: Date.now() };   // the target keeps its place
      lastOver = { id: String(target), t: Date.now() };
      raise(target); render();
      await api.tile(list, side === "left" || side === "right" ? "row" : "column");
      queueRender();
      return true;
    } catch (e) { LOG("tile", e); dropInfo = null; render(); return false; }
  }
  function snapPreview(zone, fromEl, taken) {
    const host = stack();
    if (!zone) {
      const old = snapEl; snapEl = null;
      if (!old) return;
      if (taken) { old.remove(); return; }                          // the window takes its place now
      old.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.96)" }], { duration: 160, easing: "ease-in", fill: "forwards" })
        .finished.catch(() => {}).then(() => old.remove()) && setTimeout(() => old.remove(), 2500);
      return;
    }
    if (!host) return;
    const ss = stackRect(), a = bArea(ss), half = Math.round((a.w - BGAP) / 2);
    const room = zone === "full" && !bento.on && pinsLive(fromEl?.dataset?.ftFloat);   // (pinned apps here: the room beside them - a window's corners)
    const r = zone === "full" ? (room ? bArea(ss, true) : { x: 0, y: 0, w: ss.width, h: ss.height })
            : zone === "left" ? { x: a.x, y: a.y, w: half, h: a.h } : { x: a.x + a.w - half, y: a.y, w: half, h: a.h };
    const el = document.createElement("div");
    el.className = "ft-snap-preview";
    el.dataset.zone = room ? "room" : zone;
    const z = Number(fromEl && getComputedStyle(fromEl).zIndex) || 100;
    el.style.zIndex = String(z - 1);                                   // just behind the window you hold
    Object.assign(el.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    host.appendChild(el);
    const f = fromEl?.getBoundingClientRect();
    if (f) {                                                         // grows out of the window, to its place
      const sx = f.width / r.w, sy = f.height / r.h;
      const tx = f.left - ss.left - r.x, ty = f.top - ss.top - r.y;
      el.animate([{ transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`, opacity: 0.4 }, { transform: "none", opacity: 1 }],
                 { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
    }
    snapEl = el;
  }
  /* a window snapped to a side: Bento, this window on that half, the others beside it */
  function snapBento(id, side) {
    bento.memo.delete(id);                                          // a new place was chosen: not back to the old one
    const area = bArea();
    const others = bMembers().filter(m => m !== id);
    let rest = bento.on && bento.root ? bRemove(bento.root, id) : null;
    if (others.length && !rest) rest = bActivate(others.map(bLeaf), area);
    const me = bLeaf(id);
    const next = rest ? (side === "left" ? bSplit("h", 0.5, me, rest) : bSplit("h", 0.5, rest, me)) : me;
    if (!bFits(next, area)) { bentoToggle(true); return; }            // no room for halves: plain Bento
    bTransition(() => {
      if (!bento.on) {
        bento.on = true; bento.pre = {}; bento.skip = new Set(); bento.shape = ""; bento.undo = []; bento.redo = [];
        for (const f of floating) if (frac[f]) bento.pre[f] = { ...frac[f] };
        bentoOn[bento.ws || deskKey()] = true; vstore.set(BENTO_KEY, JSON.stringify(bentoOn));
      } else if (bento.root) bPush(bento.root);
      bento.root = next;
      render();
    });
    bentoButton();
  }
  const backToBento = new Set();                     // windows dragged out of full screen with Bento on
  /* a full-screen page: drag its top edge down and it floats again, under the pointer */
  function ensureMaxGrab() {
    const host = stack();
    if (!host || host.querySelector(":scope > .ft-max-grab")) return;
    const g = document.createElement("div");
    g.className = "ft-max-grab";
    g.title = "Drag down to float";
    host.appendChild(g);
  }
  function startMaxDrag(e) {
    const page = activePage(), id = page?.dataset.id;
    const split = isTiled(page) && !winOf(id);                        // a split full screen: the whole split floats (its layout as it is)
    if (!id || floating.has(id) || (isTiled(page) && !split) || isStart(page)) return;
    e.preventDefault(); e.stopPropagation();
    const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    const move = ev => {
      if (ev.pointerId !== pid || Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;   // floats right away
      end();
      const ss = stackRect(), old = frac[id] ? pxRect(id, ss) : null;
      const w = Math.min(old?.w || Math.round(ss.width * 0.62), ss.width - 2 * MARGIN);
      const h = Math.min(old?.h || Math.round(ss.height * 0.72), ss.height - 2 * MARGIN);
      const px = ev.clientX - ss.left, py = ev.clientY - ss.top;
      setPx(id, clampRect({ x: px - w / 2, y: Math.max(MARGIN, py - 14), w, h }, ss), ss);
      if (bento.on) { bento.skip.add(id); backToBento.add(id); }    // under the pointer, not in a Bento slot, while held
      if (split) { for (const [a, ids] of groupMemory) if (ids.has(id)) groupMemory.delete(a); groupFloat.add(id); }
      floatNow(id, page);
      render();
      const el = targetOf(pageOf(id));
      if (el?.hasAttribute("data-ft-float")) startGesture(ev, el, "move");
    };
    const end = () => {
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", end, true);
      removeEventListener("pointercancel", end, true);
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", end, true);
    addEventListener("pointercancel", end, true);
  }

  /* ================= WORKSPACES: a slide strip of mini desktops =================
     The Workspaces button opens a strip under the tab bar (like macOS Mission
     Control's Spaces): each workspace is a card with a miniature of its desktop -
     the wallpaper and its windows where they are - and its name. Click one to go
     there (Vivaldi's own list does the switch, unseen). "Manage" opens Vivaldi's list. */
  let wsStrip = null, wsPass = false;
  const WS_BTN = "#tabs-tabbar-container .workspace-popup, #browser .tabbar-workspace-button";
  const prefGet = path => new Promise(res => {
    try {
      const r = vivaldi.prefs.get(path, v => res(v?.value ?? v));
      if (r && typeof r.then === "function") r.then(v => res(v?.value ?? v), () => res(null));
    } catch (e) { res(null); }
  });
  const favicon = url => `chrome://favicon2/?size=32&scaleFactor=2x&pageUrl=${encodeURIComponent(url)}&allowGoogleServerFallback=0`;
  const wsErr = (what, e) => { LOG("workspaces: " + what + " failed", e); vstore.set("vosWsErr", JSON.stringify({ what, e: String(e).slice(0, 200), t: Date.now() })); };
  function editableName(nm, sp) {
    nm.title = "Click to rename";
    const start = () => {
      if (nm.parentElement?.querySelector(".vos-ws-input")) return;
      const inp = document.createElement("input");
      inp.className = "vos-ws-input"; inp.type = "text"; inp.value = sp.name; inp.spellcheck = false;
      inp.style.width = Math.max(60, nm.offsetWidth + 24) + "px";
      nm.replaceWith(inp); inp.focus(); inp.select();
      let over = false;
      const done = save => {
        if (over) return; over = true;
        const v = inp.value.trim();
        if (save && v && v !== sp.name) {
          const api = vivWs();
          try { api?.setName(sp.id, v); if (api) sp.name = v; } catch (e) { wsErr("rename", e); }
        }
        nm.textContent = sp.name;
        inp.replaceWith(nm);
      };
      inp.addEventListener("keydown", ev => {
        ev.stopPropagation();
        if (ev.key === "Enter") { ev.preventDefault(); done(true); }
        else if (ev.key === "Escape") { ev.preventDefault(); done(false); }
      });
      for (const t of ["pointerdown", "click", "dblclick"]) inp.addEventListener(t, ev => ev.stopPropagation());
      inp.addEventListener("blur", () => done(true));
    };
    nm.addEventListener("click", ev => { ev.stopPropagation(); ev.preventDefault(); start(); });
    nm.addEventListener("pointerdown", ev => ev.stopPropagation());
    return start;
  }
  /* a window to another desktop (workspace): Vivaldi's own move; it leaves this one */
  const sameWs = (a, b) => (a == null && b == null) || String(a) === String(b);
  /* Vivaldi goes along with the active tab when it moves: another one of this desktop becomes
     active first (or its desktop page), so you stay here until you choose to go */
  async function handOver(ids, cur) {
    try {
      const stillActive = async () => (await tabsQuery({ currentWindow: true })).some(t => ids.includes(String(t.id)) && t.active);
      const settle = async () => { for (let k = 0; k < 10; k++) { if (!(await stillActive())) return true; await new Promise(r => setTimeout(r, 40)); } return false; };
      if (!(await stillActive())) return;
      const tabs = await tabsQuery({ currentWindow: true });
      const here = t => !ids.includes(String(t.id)) && sameWs(wsOfTab.get(String(t.id)), cur) && sameWs(extOf(t)?.workspaceId ?? null, cur);   // Vivaldi agrees it is here
      const zs = [...zOrder].reverse().filter(o => !ids.includes(o) && floating.has(o) && !minimized.has(o));
      const cands = [...new Set([...zs.map(o => tabs.find(t => String(t.id) === o)).filter(t => t && here(t)), ...tabs.filter(here)])].slice(0, 3);
      for (const t of cands) {                                       // the next window here comes to the front - checked, not assumed
        await new Promise(r => chrome.tabs.update(t.id, { active: true }, () => { void chrome.runtime.lastError; r(); }));
        const ok = await settle();
        ntrace("handOver", { to: t.id, ok });
        if (ok) return;
      }
      await new Promise(r => chrome.tabs.create({ url: "chrome://vivaldi-webui/startpage", active: true }, t => { void chrome.runtime.lastError; if (t) handStart.add(String(t.id)); r(); }));
      ntrace("handOver", { to: "start", ok: await settle() });       // nothing else here: its Launchpad page (no empty desktops)
    } catch (e) { wsErr("hand over", e); }
  }
  async function arrivedAt(ids, ws, ms) {             // Vivaldi says every one of these tabs is on that desktop
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      const tabs = await tabsQuery({ currentWindow: true });
      const mine = tabs.filter(t => ids.includes(String(t.id)));
      if (mine.length && mine.every(t => sameWs(extOf(t)?.workspaceId ?? null, ws))) return true;
      await new Promise(r => setTimeout(r, 70));
    }
    return false;
  }
  /* 1.0.240: a window dragged up to the desktops and let go on one: it goes there and you go with it, swiping (from the
     desktops button you stay where you are - toDesk alone) */
  async function toDeskAndGo(id, ws) {
    const key = String(id), pg = pageOf(key), list = (await prefGet("vivaldi.workspaces.list")) || [];
    const ids = [...new Set([key, ...(pg && isTiled(pg) && groupFloat.has(key) ? membersOf(pg) : [])])];
    const from = curWs();
    await toDesk(id, ws);
    if (sameWs(from, ws) || !(await arrivedAt(ids, ws, 1500))) return;
    const at = w => list.findIndex(x => sameWs(x.id, w)), name = list.find(w => sameWs(w.id, ws))?.name || "Desktop";
    swipeTo({ id: ws, name, keep: ids, go: async () => {
      if (!sameWs(vivActiveWs(), ws)) await switchWs({ id: ws, name }, list);
      chrome.tabs.update(Number(key), { active: true }, () => void chrome.runtime.lastError);
      raise(winOf(key) || key);
    } }, list, at(ws) >= at(from) ? 1 : -1);
  }
  async function toDesk(id, ws) {
    { const w = winOf(String(id)) || String(id); if (cover === w) cover = null; }   // to another desktop: held small stays held small, same corner and size
    const key = String(id), cur = curWs();
    const pg = pageOf(key);                                          // every page of the window (a split has several)
    const ids = [...new Set([key, ...(pg && isTiled(pg) && groupFloat.has(key) ? membersOf(pg) : [])])];
    const left = await handOver(ids, cur);
    ntrace("toDesk", { ids, ws, cur, left, act: (await tabsQuery({ currentWindow: true })).find(t => t.active)?.id });
    pend(ids, ws);
    queueRender();                                                   // gone from this desktop at once
    await tpMove(ids, ws);
    if (left === "empty" && cur != null && !sameWs(vivActiveWs(), cur)) await emptySwitch(cur);   // Vivaldi went along with it: back, to the empty desktop
    setTimeout(() => {                                               // did it arrive? (kept for a look if not)
      chrome.tabs.query({ currentWindow: true }, tabs => {
        void chrome.runtime.lastError;
        const got = (tabs || []).filter(t => ids.includes(String(t.id))).map(t => extOf(t)?.workspaceId ?? null);
        const ok = got.length && got.every(g => sameWs(g, ws));
        vstore.set("vosMoveDiag", JSON.stringify({ ws, ids, got, ok, t: Date.now() }));
        if (!ok) { LOG("move to desktop did not stick", ws, got); tpMove(ids, ws).then(readTiling); }   // once more
      });
    }, 900);
    if (mission) missionGlide();                                     // the windows left close up, gliding
    queueRender();
  }
  /* drag a mini window onto another desktop: its tab goes there (Vivaldi's own move) */
  function wsWindowDrag(row, list) {
    row.addEventListener("pointerdown", ev => {
      const win = ev.target.closest(".vos-ws-win[data-tab]");
      if (!win || ev.button !== 0) return;
      ev.stopImmediatePropagation();                                 // not a reorder of the desktop (the row's other listener)
      const from = win.closest(".vos-ws-card"), pid = ev.pointerId, sx = ev.clientX, sy = ev.clientY;
      let ghost = null, over = null;
      const move = e => {
        if (e.pointerId !== pid) return;
        if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
        if (!ghost) {
          const r = win.getBoundingClientRect();
          ghost = win.cloneNode(true); ghost.classList.add("vos-ws-winghost");
          Object.assign(ghost.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", margin: 0 });
          ghost.__ox = sx - r.left; ghost.__oy = sy - r.top;
          (browserEl() || document.body).appendChild(ghost);
          win.style.opacity = "0.3";
        }
        ghost.style.left = (e.clientX - ghost.__ox) + "px"; ghost.style.top = (e.clientY - ghost.__oy) + "px";
        const card = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains("vos-ws-card") && !n.classList.contains("vos-ws-more"));   // New takes no windows
        const target = card && card !== from ? card : null;
        if (target !== over) { over?.removeAttribute("data-drop"); over = target; over?.setAttribute("data-drop", ""); }
      };
      const up = e => {
        if (e.pointerId !== pid) return;
        removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
        if (!ghost) return;                                          // a click on the mini window: the desktop's own click
        from.__dragged = true;
        ghost.remove(); win.style.opacity = "";
        over?.removeAttribute("data-drop");
        if (!over || e.type !== "pointerup") return;
        const ws = over.dataset.ws ? (list.find(w => String(w.id) === over.dataset.ws)?.id ?? null) : null;   // Default: the window's own
        over.querySelector(".vos-ws-mini")?.appendChild(win);          // show it there right away
        toDesk(win.dataset.tab, ws);
      };
      addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    });
  }
  /* right-click a desktop: Rename, Delete (Vivaldi's own; it closes that desktop's tabs, so
     the first click asks, the second deletes) */
  /* the nearest desktop of this window: the one before it, else the one after (as the panel shows them) */
  function deskNear(sp, list) {
    const shown = list.filter(w => wsStrip?.querySelector(`.vos-ws-card[data-ws="${CSS.escape(String(w.id))}"]`));
    const at = shown.findIndex(w => String(w.id) === String(sp.id));
    return at > 0 ? shown[at - 1] : shown[at + 1];
  }
  /* delete a desktop: its windows go to the nearest desktop (keep) or close with it; its Launchpad page goes */
  async function deskDelete(sp, list, keep) {
    const api = vivWs(), near = deskNear(sp, list);
    if (!api?.removeWorkspace || !near) return;
    lastDelete = Date.now();
    try {
      const wid = await winId();
      const now = await tabsQuery({ currentWindow: true });            // its tabs as they are now
      const its = now.filter(t => !t.pinned && !isStartUrl(t) && sameWs(extOf(t)?.workspaceId ?? null, sp.id)).map(t => String(t.id));
      if (keep && its.length) {                                      // its windows go to the nearest desktop - checked
        await tpMove(its, near.id);
        if (!(await arrivedAt(its, near.id, 2000))) { wsErr("delete", "its windows did not move - not deleted"); return; }
      }
      if (sameWs(curWs(), sp.id)) {                                  // on it now: go to that desktop first
        await switchWs({ id: near.id, name: near.name }, list);
        await new Promise(r => setTimeout(r, 250));
      }
      const wasOpen = !!wsStrip;
      await api.removeWorkspace(wid, sp.id);
      lastDelete = Date.now(); deskInfo = null;
      if (!wasOpen || !wsStrip) return;                               // the panel stays open (even if it was redrawn meanwhile): the card goes
      const card = wsStrip.querySelector(`.vos-ws-card[data-ws="${CSS.escape(String(sp.id))}"]`);
      if (card) await card.animate([{ opacity: card.style.opacity || 1, transform: "none" }, { opacity: 0, transform: "scale(0.85)" }], { duration: 160, easing: "ease-in", fill: "forwards" }).finished.catch(() => {});
      for (let i = 0; i < 20 && ((await prefGet("vivaldi.workspaces.list")) || []).some(w => sameWs(w.id, sp.id)); i++) await new Promise(r => setTimeout(r, 50));
      for (let i = 0; i < 20 && wsOpening; i++) await new Promise(r => setTimeout(r, 50));   // a redraw under way: after it
      if (!wsStrip || wsOpening) return;
      wsOpening = true;
      try { await openWsStripNow({ refresh: true }); } finally { wsOpening = false; }
    } catch (e) { wsErr("delete", e); }
  }
  let wsMenuEl = null;
  const closeWsMenu = () => { wsMenuEl?.remove(); wsMenuEl = null; };
  function wsMenu(sp, card, x, y, tabs, list) {
    closeWsMenu();
    const m = document.createElement("div");
    m.className = "lp-menu vos-vars vos-ws-menu";
    const add = (label, svg, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item" + (cls ? " " + cls : "");
      b.innerHTML = `<svg class="lp-mi-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${svg}</svg><span class="lp-mi-text"></span>`;   // one thin line weight
      b.querySelector(".lp-mi-text").textContent = label;
      b.addEventListener("click", ev => { ev.stopPropagation(); fn(b); });
      m.appendChild(b); return b;
    };
    add("Rename", '<path d="M4 20l1.2-4.2L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M14 7l3 3"/>',
        () => { closeWsMenu(); card.querySelector(".vos-ws-name")?.__edit?.(); });
    const ids = (tabs || []).filter(t => !t.pinned && !isStartUrl(t) && wsOfTab.has(String(t.id)) && sameWs(extOf(t)?.workspaceId ?? null, sp.id)).map(t => t.id);   // its windows, as Vivaldi has them (its Launchpad page is not one)
    const n = ids.length;
    const BIN = '<path d="M4.5 7h15M10 4h4M6.5 7l.9 12a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12M10 11v6M14 11v6"/>';
    const near = deskNear(sp, list);
    const doDelete = keep => { closeWsMenu(); deskDelete(sp, list, keep); };
    if (near) {                                                      // the last desktop of a window stays
      add(n ? "Delete, keep windows" : "Delete", BIN, () => doDelete(true));
      if (n) add(`Delete and close ${n} window${n === 1 ? "" : "s"}`, BIN, () => doDelete(false), "lp-danger");
    }
    m.addEventListener("pointerdown", ev => ev.stopPropagation());
    m.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); });
    (browserEl() || document.body).appendChild(m);
    m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + "px";
    wsMenuEl = m;
    setTimeout(() => addEventListener("pointerdown", ev => { if (!m.contains(ev.target)) closeWsMenu(); }, { capture: true, once: true }));
  }
  /* drag a desktop sideways to put it elsewhere (any desktop; New stays last) */
  function wsReorder(row, list) {
    row.addEventListener("pointerdown", ev => {
      const card = ev.target.closest(".vos-ws-card[data-ws]");
      if (!card || ev.button !== 0 || ev.target.closest(".vos-ws-name, .vos-ws-input")) return;
      const cards = [...row.querySelectorAll(".vos-ws-card[data-ws]")];
      if (cards.length < 2) return;
      const rects = cards.map(c => c.getBoundingClientRect()), from = cards.indexOf(card);
      const step = rects[1].left - rects[0].left;
      const sx = ev.clientX, pid = ev.pointerId;
      let on = false, to = from;
      const move = e => {
        if (e.pointerId !== pid) return;
        const dx = e.clientX - sx;
        if (!on && Math.abs(dx) < 6) return;
        if (!on) { on = true; card.classList.add("vos-ws-dragging"); }
        card.style.transform = `translateX(${dx}px) scale(1.04)`;
        const c = rects[from].left + rects[from].width / 2 + dx;
        to = rects.reduce((best, r, i) => Math.abs(r.left + r.width / 2 - c) < Math.abs(rects[best].left + rects[best].width / 2 - c) ? i : best, from);
        cards.forEach((o, i) => {
          if (o === card) return;
          const shift = from < to && i > from && i <= to ? -step : from > to && i >= to && i < from ? step : 0;
          o.style.transform = shift ? `translateX(${shift}px)` : "";
        });
      };
      const up = e => {
        if (e.pointerId !== pid) return;
        removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
        cards.forEach(o => { o.style.transform = ""; });
        card.classList.remove("vos-ws-dragging");
        if (!on) return;
        card.__dragged = true;                                       // the click that follows is not a switch
        if (to === from || e.type !== "pointerup") return;
        const ids = cards.map(c => c.dataset.ws);
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        const byId = new Map(list.map(w => [String(w.id), w.id]));
        const shown = new Set(ids), next = ids[Symbol.iterator]();        // other windows' desktops keep their places
        const all = list.map(w => String(w.id)).map(i => shown.has(i) ? next.next().value : i);
        try { vivWs()?.setOrder(all.map(i => byId.get(i))); deskInfo = null; } catch (e2) { LOG("workspaces: reorder failed", e2); }
        const others = cards.filter(o => o !== card);                // show the new order right away
        row.insertBefore(card, others[to] || row.querySelector(".vos-ws-more"));
      };
      addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    });
  }

  /* a picture of a window's web page, through Vivaldi's own tab thumbnails (any loaded
     tab, not only the visible one); kept, so the strip opens with the last ones at once */
  const pagePics = new Map();                         // tab id -> data URL
  /* another desktop in Bento: where its tiles are (its windows at their real size there) */
  const tilesOf = new Map();
  function otherTiles(ws, ss) {
    const key = ws == null ? "default" : String(ws), st = bentoWs.get(key);
    if (!st?.on || !st.root) return new Map();
    const memo = tilesOf.get(key);
    if (memo && memo.root === st.root && memo.w === ss.width && memo.h === ss.height) return memo.map;
    const map = new Map();
    try { for (const { leaf, r } of bCalc(st.root, bArea(ss)).regions) map.set(leaf.win, r); } catch (e) {}
    tilesOf.set(key, { root: st.root, w: ss.width, h: ss.height, map });
    return map;
  }
  const picAt = new Map();                          // tab -> when its picture was taken
  function pagePicture(box, tabId, r) {
    const show = url => { if (!url) return; box.style.setProperty("background-image", `url("${url}")`, "important"); box.setAttribute("data-pic", ""); };
    show(pagePics.get(tabId));
    const cap = vivaldi?.thumbnails?.captureTab;
    if (!cap || !tabId) return;
    if (pagePics.has(tabId) && Date.now() - (picAt.get(tabId) || 0) < 20000) return;   // a fresh one: no new picture
    picAt.set(tabId, Date.now());
    pagePicture.n = (pagePicture.n || 0) + 1;                        // one after another, after the panel is down
    const wait = 320 + 60 * (pagePicture.n - 1);
    clearTimeout(pagePicture.reset); pagePicture.reset = setTimeout(() => { pagePicture.n = 0; }, wait + 100);
    setTimeout(() => capturePic(box, tabId, r, show, cap), wait);
  }
  function capturePic(box, tabId, r, show, cap) {
    if (!box.isConnected) return;
    const W = 420, H = Math.max(120, Math.round(W * (r.h / Math.max(1, r.w))));
    const done = d => { void chrome.runtime.lastError; const url = typeof d === "string" ? d : d?.image || d?.dataUrl || ""; if (url) { pagePics.set(tabId, url); show(url); } };
    try {
      const p = cap.call(vivaldi.thumbnails, tabId, { encodeFormat: "jpg", encodeQuality: 70, fullPage: false, width: W, height: H }, done);
      if (p && typeof p.then === "function") p.then(done, () => {});
    } catch (e) {}
  }
  /* DESKTOPS PER WINDOW: Vivaldi's workspaces are shared by all its windows; each window
     shows only its own - the ones with its pages, the one it is on, the ones made or used
     in it. A desktop of a window that is gone (after a restart) shows in every window. */
  const OWN_KEY = "vosWsOwner";
  async function myDesks(list, tabs, cur) {
    const me = String(myWin());
    let own = {};
    try { own = JSON.parse((await vstore.get(OWN_KEY)) || "{}") || {}; } catch (e) {}
    const live = await new Promise(res => { try { chrome.windows.getAll({}, ws => { void chrome.runtime.lastError; res(new Set((ws || []).map(w => String(w.id)))); }); } catch (e) { res(null); } });
    const used = new Set((tabs || []).map(t => wsOfTab.get(String(t.id))).filter(v => v != null).map(String));
    if (cur != null) used.add(String(cur));
    let changed = false;
    for (const id of used) if (own[id] !== me) { own[id] = me; changed = true; }
    const ids = new Set(list.map(w => String(w.id)));
    for (const k of Object.keys(own)) if (!ids.has(k)) { delete own[k]; changed = true; }
    if (changed) vstore.set(OWN_KEY, JSON.stringify(own));
    return new Set(list.map(w => String(w.id)).filter(id => used.has(id) || own[id] === me || !own[id] || (live && !live.has(own[id]))));
  }
  /* a new desktop (Vivaldi's own add), owned by this window; resolves to its id.
     switchTo false: you stay where you are (a window dropped on New goes there) */
  function newDesk(list, stay, name) {
    const api = vivWs();
    if (!api) return null;
    const names = new Set(list.map(w => w.name));
    let n = list.length + 1;
    while (!name || names.has(name)) name = "Desktop " + n++;
    const before = new Set(list.map(w => String(w.id)));
    const find = async tries => {
      for (let i = 0; i < tries; i++) {
        await new Promise(r => setTimeout(r, 150));
        const nl = (await prefGet("vivaldi.workspaces.list")) || [];
        const fresh = nl.filter(w => !before.has(String(w.id)));
        if (fresh.length) {
          let own = {};                                              // a new desktop belongs to this window
          try { own = JSON.parse((await vstore.get(OWN_KEY)) || "{}") || {}; } catch (e) {}
          for (const w of fresh) own[String(w.id)] = String(myWin());
          vstore.set(OWN_KEY, JSON.stringify(own));
          return fresh[fresh.length - 1].id;
        }
      }
      return undefined;
    };
    try {
      return Promise.resolve(api.addWorkspace(name, undefined, undefined, undefined, !!stay)).then(async id => {
        if (id == null) return find(20);                           // an older Vivaldi: look it up
        let own = {};                                                // a new desktop belongs to this window
        try { own = JSON.parse((await vstore.get(OWN_KEY)) || "{}") || {}; } catch (e) {}
        own[String(id)] = String(myWin());
        vstore.set(OWN_KEY, JSON.stringify(own));
        return id;
      }).catch(e => { wsErr("new", e); return undefined; });
    } catch (e) { wsErr("new", e); return null; }
  }
  /* Vivaldi's move of tabs to a desktop (null: none), as a promise */
  /* (Vivaldi 8.3 moves them only when told their window too: without it the call does nothing, with no error) */
  const tpMove = (ids, ws) => new Promise(async res => {
    try {
      tpMove.lastErr = null;
      const wid = await winId();
      const r = vivaldi.tabsPrivate.move({ tabIds: ids.map(Number), target: "last", tweaks: ["do-not-reparent"], workspaceId: ws ?? "window", ...(wid != null ? { windowId: wid } : {}) },
        () => { tpMove.lastErr = chrome.runtime.lastError?.message || null; res(); });
      if (r?.then) r.then(res, e => { tpMove.lastErr = String(e); wsErr("move", e); res(); });
    } catch (e) { wsErr("move", e); res(); }
  });
  /* NO DEFAULT DESKTOP: pages of no desktop (Vivaldi's "this window") go to a real one -
     "Desktop 1", first - so every desktop is alike: renamed, reordered, deleted */
  let unDefaulting = false, lastDelete = 0;
  async function noDefault(list, tabs) {
    const loose = (tabs || []).filter(t => !t.pinned && wsOfTab.has(String(t.id)) && wsOfTab.get(String(t.id)) == null);
    if (!loose.length || unDefaulting || !vivWs() || Date.now() - lastDelete < 3000) return false;
    unDefaulting = true;
    try {
      // desktops exist: the pages go to the one you are on, else this window's first one -
      // never a new desktop (that made "Desktop N" desktops appear, first in the row)
      if (list.length) {
        const own = await myDesks(list, tabs, curWs());
        const cur = curWs();
        const to = (cur != null && list.find(w => sameWs(w.id, cur))) || list.find(w => own.has(String(w.id))) || list[0];
        await tpMove(loose.map(t => t.id), to.id);
        loose.forEach(t => wsOfTab.set(String(t.id), to.id)); wsNowAt = 0;
        return true;
      }
      const id = await newDesk(list, true, "Desktop 1");            // no desktop at all yet: the first one
      if (id === undefined) return false;
      await tpMove(loose.map(t => t.id), id);                        // the active one too: you go along with it
      loose.forEach(t => wsOfTab.set(String(t.id), id)); wsNowAt = 0;
      const l2 = (await prefGet("vivaldi.workspaces.list")) || [];   // two desktops to start with
      if (l2.length < 2) await newDesk(l2, true, "Desktop 2");
      vstore.set("vosTwoDesks1", true);
      return true;
    } finally { unDefaulting = false; }
  }
  /* once: two desktops (the default) - a window with only one gets a second */
  setTimeout(async function twoDesks() {
    try {
      if (await vstore.get("vosTwoDesks1")) return;
      if (!vivWs() || curWs() == null) { twoDesks.n = (twoDesks.n || 0) + 1; if (twoDesks.n < 10) setTimeout(twoDesks, 2000); return; }
      const info = await desksNow(true);
      if (info.ds.length === 1) await newDesk(info.list, true, "Desktop 2");
      vstore.set("vosTwoDesks1", true); deskInfo = null;
    } catch (e) { LOG("two desktops", e); }
  }, 5000);
  /* once (1.0.68): the empty "Desktop N" desktops an earlier version kept making go away -
     only empty ones with that name; named or used desktops stay */
  setTimeout(async () => {
    try {
      if (await vstore.get("vosWsCleanup1")) return;
      const api = vivWs(), list = (await prefGet("vivaldi.workspaces.list")) || [];
      if (!api?.removeWorkspace || !list.length) return;
      const all = await tabsQuery({});
      const used = new Set(all.map(t => String(extOf(t)?.workspaceId ?? "")));
      const empty = list.filter(w => /^Desktop \d+$/.test(w.name || "") && !used.has(String(w.id)));
      const keepOne = empty.length === list.length ? 1 : 0;           // never all of them
      const wid = await winId();
      for (const w of empty.slice(keepOne)) { lastDelete = Date.now(); await api.removeWorkspace(wid, w.id); }
      vstore.set("vosWsCleanup1", true);
    } catch (e) { wsErr("cleanup", e); }
  }, 8000);
  /* a window dropped on New: a new desktop, and the window goes there */
  /* a trace of the last "window to New desktop" (vstore vosNewDiag), to see what Vivaldi did */
  let ntr = [];
  const ntrace = (step, v) => { ntr.push([step, v, Date.now() % 1000000]); ntr = ntr.slice(-40); vstore.set("vosNewDiag", JSON.stringify(ntr)); };
  /* Vivaldi's list of pages (tabs) per window - what its own "New Workspace with Selected Tabs" uses */
  let storeApi = null;
  function vivStore() {
    if (storeApi) return storeApi;
    try {
      let host = null;
      try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      if (!ch?.push) return null;
      let req = null;
      ch.push([["vos-store-" + Date.now()], {}, r => { req = r; }]);
      const isS = v => v && typeof v.getPages === "function" && typeof v.getPageInWindow === "function" && typeof v.getWorkspacePages === "function";
      for (const id of Object.keys(req?.m || {})) {
        let src = "";
        try { src = Function.prototype.toString.call(req.m[id]); } catch (e) { continue; }
        if (!src.includes("getWorkspaceWindowId(") || !src.includes("getPageInWindow(")) continue;
        let ex; try { ex = req(id); } catch (e) { continue; }
        if (isS(ex)) return (storeApi = ex);
        for (const k of Object.keys(ex || {})) { let v; try { v = ex[k]; } catch (e) { continue; } if (isS(v)) return (storeApi = v); }
      }
    } catch (e) { LOG("pages: Vivaldi's page list not found", e); }
    return null;
  }
  /* Vivaldi's workspace store (its own list of the desktop each window shows) */
  let wsStoreApi = null, wsStoreMiss = 0;
  function vivWsStore() {
    if (wsStoreApi) return wsStoreApi;
    if (wsStoreMiss && performance.now() - wsStoreMiss < 10000) return null;   // 1.0.340: not found - looked for again in 10s, not on every call
    wsStoreMiss = performance.now();
    try {
      let host = null;
      try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      if (!ch?.push) return null;
      let req = null;
      ch.push([["vos-wss-" + Date.now()], {}, r => { req = r; }]);
      const isW = v => v && typeof v.getActiveWorkspaceId === "function" && typeof v.getWorkspaces === "function";
      for (const id of Object.keys(req?.m || {})) {
        let src = "";
        try { src = Function.prototype.toString.call(req.m[id]); } catch (e) { continue; }
        if (!src.includes("getActiveWorkspaceId(") || !src.includes("activeWorkspaces")) continue;
        let ex; try { ex = req(id); } catch (e) { continue; }
        if (isW(ex)) return (wsStoreApi = ex);
        for (const k of Object.keys(ex || {})) { let v; try { v = ex[k]; } catch (e) { continue; } if (isW(v)) return (wsStoreApi = v); }
      }
    } catch (e) { LOG("workspaces: Vivaldi's store not found", e); }
    return null;
  }
  // the desktop this Vivaldi window shows, as Vivaldi has it (null: none; undefined: not known)
  const vivActiveWs = (win = myWin()) => {
    if (win == null) return undefined;
    const st = vivWsStore();
    if (!st) return undefined;
    try { const v = st.getActiveWorkspaceId(Number(win)); return v === undefined ? null : v; } catch (e) { return undefined; }
  };
  /* an EMPTY DESKTOP is just that: no tab at all (no blank Start Page) - Vivaldi's own switch
     without the page it would open; the Launchpad is its desktop */
  async function emptySwitch(ws) {
    const st = vivWsStore(), wid = await winId();
    const d = st?.getDispatcher?.() || st?.__dispatcher || st?._dispatcher;
    const act = { actionType: "SET_ACTIVE_WORKSPACE", windowId: wid, workspaceId: ws ?? undefined };
    if (wid == null || (!d?.dispatch && typeof st?.dispatchAction !== "function")) return false;
    try { if (d?.dispatch) d.dispatch(act); else st.dispatchAction(act); }      // (the store's own, if Vivaldi's dispatcher is out of reach)
    catch (e) { wsErr("empty switch", e); return false; }
    emptySwitch.err = null;
    try {                                                              // the browser engine too: new tabs open on this desktop
      const x = vivaldi.tabsPrivate.notifyActiveWorkspace(wid, ws || 0);
      if (x?.then) await Promise.race([x, new Promise(r => setTimeout(r, 300))]);
    } catch (e) {
      emptySwitch.err = String(e);
      try { await new Promise(r => { vivaldi.tabsPrivate.notifyActiveWorkspace(wid, ws || 0, () => { void chrome.runtime.lastError; r(); }); setTimeout(r, 300); }); } catch (e2) { emptySwitch.err += " | " + e2; }
    }
    wsNowAt = 0; queueRender();
    return true;
  }
  const deskTabs = (ws, tabs) => (tabs || []).filter(t => !t.pinned && sameWs(wsOfTab.has(String(t.id)) ? wsOfTab.get(String(t.id)) : (extOf(t)?.workspaceId ?? null), ws));
  const isStartUrl = t => /^chrome:\/\/vivaldi-webui\/startpage|^chrome:\/\/newtab/i.test(t.url || t.pendingUrl || "");
  /* a desktop left with only blank Start Pages: they close - it is an empty desktop */
  async function dropBlanks(ws) {
    if (ws == null) return;
    const tabs = await tabsQuery({ currentWindow: true });
    const its = deskTabs(ws, tabs);
    if (!its.length || !its.every(isStartUrl) || its.some(t => t.active)) return;
    chrome.tabs.remove(its.map(t => t.id), () => void chrome.runtime.lastError);
  }
  /* A WINDOW DROPPED ON NEW, in one go: a new desktop, the window moved into it, that
     desktop shown with the window in front (the desktop swipe around it) */
  async function toNewDeskNow(id, list) {
    const key = String(id), pg = pageOf(key);
    const ids = [...new Set([key, ...(pg && isTiled(pg) && groupFloat.has(key) ? membersOf(pg) : [])])];
    { const w = winOf(key) || key; if (cover === w) cover = null; }
    const from = curWs();
    const ws = await newDesk(list, true);
    ntrace("new+move", { ws, ids });
    if (ws == null) return;
    deskInfo = null;
    let fresh = list;
    for (let i = 0; i < 30; i++) {                                    // Vivaldi has saved it
      fresh = (await prefGet("vivaldi.workspaces.list")) || list;
      if (fresh.some(w => sameWs(w.id, ws))) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const name = fresh.find(w => sameWs(w.id, ws))?.name || "Desktop";
    let shown = false;
    await swipeTo({ id: ws, name, keep: ids, go: async () => {
      pend(ids, ws);
      await tpMove(ids, ws);                                          // the window goes ...
      let ok = await arrivedAt(ids, ws, 1500);
      if (!ok) { await tpMove(ids, ws); ok = await arrivedAt(ids, ws, 1200); }
      ntrace("new+move moved", ok);
      if (!sameWs(vivActiveWs(), ws)) await switchWs({ id: ws, name }, fresh);   // ... and you with it
      chrome.tabs.update(Number(key), { active: true }, () => void chrome.runtime.lastError);
      raise(winOf(key) || key); shown = ok;
    } }, fresh, 1);
    if (!shown) { ids.forEach(i => wsPending.delete(String(i))); readTiling(); }
  }
  /* A WINDOW DROPPED ON NEW: exactly what Vivaldi's "New Workspace with Selected Tabs" does -
     1. a new desktop, 2. the window's pages moved into it, 3. that desktop shown - in one
     call of Vivaldi's own, with the desktop swipe around it. The step-by-step way is kept
     for a Vivaldi without that call. */
  async function toNewDesk(id, list) {
    const key = String(id), pg = pageOf(key);
    const ids = [...new Set([key, ...(pg && isTiled(pg) && groupFloat.has(key) ? membersOf(pg) : [])])];
    const api = vivWs(), store = vivStore(), wid = await winId();
    let pages = null;
    try { pages = store?.getPages(wid)?.filter(p => ids.includes(String(p.id))); } catch (e) { pages = null; }
    ntrace("start", { id: key, api: !!api, store: !!store, pages: pages?.size ?? null });
    if (api && pages && pages.size && typeof api.addWorkspace === "function") {
      const names = new Set(list.map(w => w.name));
      let n = list.length + 1, name;
      do { name = "Desktop " + n++; } while (names.has(name));
      await handOver(ids, curWs());                                  // you stay here while it moves (no jump)
      let ws;
      try { ws = await api.addWorkspace(name, undefined, undefined, pages, true); }   // 1. the desktop + 2. the move (Vivaldi's own)
      catch (e) { ntrace("add failed", String(e)); wsErr("new + move", e); return; }
      ntrace("added", ws);
      const undo = () => { ids.forEach(i => wsPending.delete(String(i))); readTiling(); };   // it stays where it really is
      if (ws == null) return undo();
      deskInfo = null;
      pend(ids, ws); render();                                       // gone from this desktop at once
      try { const own = JSON.parse((await vstore.get(OWN_KEY)) || "{}") || {}; own[String(ws)] = String(myWin()); vstore.set(OWN_KEY, JSON.stringify(own)); } catch (e) {}
      let ok = await arrivedAt(ids, ws, 1500);                       // Vivaldi confirms the window is there
      for (let i = 0; !ok && i < 3; i++) {                           // not yet: move it again (the desktop is saved by now)
        await new Promise(r => setTimeout(r, 250));
        pend(ids, ws);                                               // still on its way: it stays off this desktop
        await tpMove(ids, ws);
        ok = await arrivedAt(ids, ws, 1200);
        ntrace("retry", { ok, err: tpMove.lastErr || null });
      }
      ntrace("moved", ok);
      if (!ok) { wsErr("new + move", "the window did not reach the new desktop"); undo(); return; }
      await new Promise(r => setTimeout(r, 120));                   // Vivaldi's page list catches up
      const pa = vivPages();
      swipeTo({ id: ws, name, keep: ids, go: async () => {           // 3. that desktop, shown with the window in front
        if (pa?.setActiveWorkspace) await pa.setActiveWorkspace(wid, ws);
        else await switchWs({ id: ws, name }, (await prefGet("vivaldi.workspaces.list")) || list);
        chrome.tabs.update(Number(id), { active: true }, () => void chrome.runtime.lastError);
      } }, list, 1);
      setTimeout(() => ntrace("shown", { now: curWs() ?? null, want: ws }), 1500);
      return;
    }
    return toNewDeskSteps(id, list);
  }
  function toNewDeskSteps(id, list) {
    ntrace("steps", { id: String(id), api: !!vivWs(), pages: !!vivPages() });
    const p = newDesk(list, true);
    if (!p) { ntrace("no api", null); return; }
    p.then(async ws => {
      ntrace("created", ws);
      if (ws === undefined) return wsErr("new + move", "no new desktop");
      const key = String(id), pg = pageOf(key);
      const ids = [...new Set([key, ...(pg && isTiled(pg) && groupFloat.has(key) ? membersOf(pg) : [])])];
      // Vivaldi's engine only moves a tab to a desktop it has saved: wait for that
      let t0 = Date.now(), listed = false;
      while (Date.now() - t0 < 3000) {
        const nl = (await prefGet("vivaldi.workspaces.list")) || [];
        if (nl.some(w => sameWs(w.id, ws))) { listed = true; break; }
        await new Promise(r => setTimeout(r, 60));
      }
      ntrace("listed", { listed, ms: Date.now() - t0 });
      const arrived = async ms => {
        const t1 = Date.now();
        while (Date.now() - t1 < ms) {
          const tabs = await tabsQuery({ currentWindow: true });
          const mine = tabs.filter(t => ids.includes(String(t.id)));
          if (mine.length && mine.every(t => sameWs(extOf(t)?.workspaceId ?? null, ws))) return true;
          await new Promise(r => setTimeout(r, 70));
        }
        return false;
      };
      await toDesk(id, ws);
      render();                                                      // gone from this desktop before the swipe starts
      let ok = await arrived(1500);
      ntrace("moved", { ok, err: tpMove.lastErr || null, ids });
      for (let i = 0; !ok && i < 2; i++) {                           // not there: once or twice more
        await tpMove(ids, ws);
        ok = await arrived(1200);
        ntrace("retry", { ok, err: tpMove.lastErr || null });
      }
      if (!ok) { wsErr("new + move", "the window did not reach the new desktop"); return; }
      await new Promise(r => setTimeout(r, 120));                   // Vivaldi's own page list catches up
      const pa = vivPages(), wid = await winId();
      swipeTo({ id: ws, name: "", keep: ids, go: async () => {       // and you go with it, swiping, onto the window
        if (pa?.setActiveWorkspace) await pa.setActiveWorkspace(wid, ws);
        else await switchWs({ id: ws }, (await prefGet("vivaldi.workspaces.list")) || list);
        chrome.tabs.update(Number(id), { active: true }, () => void chrome.runtime.lastError);
      } }, list, 1);
      setTimeout(() => ntrace("shown", { now: curWs() ?? null, want: ws }), 1200);
    });
  }
  /* Vivaldi's page actions (move to a desktop, show a desktop), found like the workspace ones */
  let pagesApi = null;
  function vivPages() {
    if (pagesApi) return pagesApi;
    try {
      let host = null;
      try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      if (!ch?.push) return null;
      let req = null;
      ch.push([["vos-pages-" + Date.now()], {}, r => { req = r; }]);
      const isPA = v => v && typeof v.setActiveWorkspace === "function" && typeof v.moveToWorkspace === "function";
      for (const id of Object.keys(req?.m || {})) {
        let src = "";
        try { src = Function.prototype.toString.call(req.m[id]); } catch (e) { continue; }
        if (!src.includes("PageActions.moveToWorkspace")) continue;
        let ex; try { ex = req(id); } catch (e) { continue; }
        if (isPA(ex)) return (pagesApi = ex);
        for (const k of Object.keys(ex || {})) { let v; try { v = ex[k]; } catch (e) { continue; } if (isPA(v)) return (pagesApi = v); }
      }
    } catch (e) { LOG("pages: Vivaldi's actions not found", e); }
    return null;
  }
  /* SWIPE BETWEEN DESKTOPS: two fingers sideways over the Mission Control (Workspaces) button */
  async function swipeDesk(dir) {
    const info = deskInfo && sameWs(deskInfo.ws, curWs()) ? deskInfo : await desksNow(true);   // known already: at once
    const t = info?.ds[info.i + dir];
    if (info?.i < 0 || !t) return;                                   // nothing that way
    if (wsStrip) closeWsStrip(false, !!mission);
    deskDots(true);
    swipeTo({ id: t.id, name: t.name, ms: 260, ease: "cubic-bezier(0.2, 0.8, 0.25, 1)" }, info.list, dir);
  }
  /* the desktops of this window, in order, and which one is shown (kept for a moment) */
  let deskInfo = null;
  async function desksNow(fresh) {
    if (!fresh && deskInfo && Date.now() - deskInfo.at < 30000 && sameWs(deskInfo.ws, curWs())) return deskInfo;
    const list = (await prefGet("vivaldi.workspaces.list")) || [];
    const tabs = await tabsQuery({ currentWindow: true });
    const mine = await myDesks(list, tabs, curWs());
    const ds = list.filter(w => mine.has(String(w.id)));
    return (deskInfo = { list, ds, front: deskFronts(tabs), i: ds.findIndex(w => sameWs(w.id, curWs())), ws: curWs(), at: Date.now() });
  }
  function deskFronts(tabs) {                                        // desktop -> the tab it shows (the last one used there)
    const front = new Map();
    for (const t of tabs || []) {                                    // known: the one it showed last
      const w = wsOfTab.get(String(t.id));
      if (w != null && deskShown.get(String(w)) === String(t.id)) front.set(String(w), { ...t, lastAccessed: Infinity });
    }
    for (const t of tabs || []) {
      if (t.pinned) continue;
      const w = wsOfTab.get(String(t.id)); if (w == null) continue;
      const o = front.get(String(w));
      if (!o || (t.lastAccessed || 0) > (o.lastAccessed || 0)) front.set(String(w), t);
    }
    return front;
  }
  const shownEl = pg => !pg ? null : isTiled(pg) ? (rootOf(pg) || tileOf(pg)?.parentElement || null) : pg;   // a page, or its whole split
  function fullOf(t) {                                               // that tab, shown full screen (not a window, not the Launchpad)? what shows: its page or its split
    const id = t && String(t.id);
    if (!id || winOf(id) || minimized.has(id) || /startpage/.test(t.url || t.pendingUrl || "")) return null;
    const pg = pageOf(id);
    return pg && !isStart(pg) ? shownEl(pg) : null;
  }
  /* SCROLL BETWEEN DESKTOPS: two fingers sideways (or a mouse's side wheel) over the Mission Control
     (Workspaces) button. One gesture, one desktop: a short push turns to the next desktop at once (the
     macOS slide); the rest of that gesture - its momentum too - is let go until the scrolling stops.
     Nothing is moved by hand while scrolling: no work per event, no guessing when the fingers lift. */
  let sw = null;                                                     // (no hand-moved swipe any more)
  const swItems = () => [...document.querySelectorAll(SWIPE_ITEMS)];
  const dotsRow = () => dotsEl?.querySelector(".vos-ws-dots-row");
  /* MACOS SLIDE: the whole desktop moves - its wallpaper too - with a thin black line between two desktops:
     two copies of the wallpaper on black, under the windows, only while it slides */
  const SW_GAP = 6;
  const swDist = () => (document.getElementById("webpage-stack")?.clientWidth || innerWidth) + SW_GAP;   // one desktop over
  function scene() {
    const stack = document.getElementById("webpage-stack");
    if (!stack) return null;
    let sc = stack.querySelector(":scope > .vos-sw-scene");
    if (sc) return sc;
    sc = document.createElement("div"); sc.className = "vos-sw-scene";
    const r = stack.getBoundingClientRect();
    for (let i = 0; i < 2; i++) {                                  // each one as big as the screen, as the real one is laid out
      const w = document.createElement("i"); w.className = "vos-sw-wall";
      Object.assign(w.style, { left: -r.left + "px", top: -r.top + "px", width: innerWidth + "px", height: innerHeight + "px",
        clipPath: `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px)` });
      if (i) w.style.visibility = "hidden";
      sc.appendChild(w);
    }
    stack.prepend(sc);
    browserEl()?.setAttribute("data-vos-sliding", "");
    return sc;
  }
  function sceneAt(here, there) {                                    // px: this desktop's wallpaper, the other one's (null: none)
    const sc = scene(); if (!sc) return;
    const [a, b] = sc.children;
    a.getAnimations().forEach(x => x.cancel()); b.getAnimations().forEach(x => x.cancel());
    a.style.translate = `${Math.round(here)}px 0px`;
    if (there == null) b.style.visibility = "hidden";
    else { b.style.visibility = ""; b.style.translate = `${Math.round(there)}px 0px`; }
  }
  function sceneGo(here, there, ms, ease) {                          // both glide to where they end
    const sc = document.querySelector("#webpage-stack > .vos-sw-scene"); if (!sc) return;
    [here, there].forEach((x, i) => {
      const w = sc.children[i]; if (x == null) return;
      const from = w.style.translate || "0px 0px", to = `${Math.round(x)}px 0px`;
      w.style.translate = to;
      w.animate([{ translate: from }, { translate: to }], { duration: ms, easing: ease });
    });
  }
  function sceneEnd() {
    document.querySelectorAll("#webpage-stack > .vos-sw-scene").forEach(x => x.remove());
    browserEl()?.removeAttribute("data-vos-sliding");
  }
  /* the desktop follows the fingers: one number on the page area (--vos-dx, px) per scroll event;
     CSS moves every window, its frame, the Launchpad and the wallpapers by it (no per-window work).
     Let go: it settles - on the next desktop when pushed far or fast enough, else back. The rest
     of that flick is let go. One desktop per swipe; none that way: a little stretch. */
  try { CSS.registerProperty({ name: "--vos-dx", syntax: "<number>", inherits: false, initialValue: "0" }); } catch (e) {}
  try { CSS.registerProperty({ name: "--vos-in", syntax: "<number>", inherits: false, initialValue: "0" }); } catch (e) {}
  /* (performance) only what moves carries the swipe's numbers - each window, its frame, the wallpapers - and they
     are written once per frame at most; the rest of the page area is never restyled while you swipe */
  const SW_MOVERS = "#webpage-stack :is([data-ft-float]:not([data-ft-min]):not([data-ft-away]), .ft-frame:not([data-ft-away]), [data-vos-out], [data-vos-incoming], .ft-veil, [data-vos-swmax], [data-vos-swmax-in]), #webpage-stack > .lp-layer.lp-desktop, #webpage-stack > .vos-sw-scene > .vos-sw-wall";
  function swMovers(s) {
    s.movers = [...document.querySelectorAll(SW_MOVERS)];
    for (const el of s.movers) { el.style.setProperty("--vos-in", String(s.inV || 0)); el.style.setProperty("--vos-dx", String(s.dxV || 0)); }
  }
  function swSetDx(s, v) {
    s.dxV = v;
    if (s.raf) return;
    s.raf = requestAnimationFrame(() => { s.raf = 0; for (const el of s.movers || []) el.style.setProperty("--vos-dx", String(s.dxV)); });
  }
  function swUnmove(list) {
    for (const el of list) { el.getAnimations().forEach(a => { if (a.effect?.getKeyframes?.().some(k => "--vos-dx" in k)) a.cancel(); }); el.style.removeProperty("--vos-dx"); el.style.removeProperty("--vos-in"); }
  }
  const SW_QUIET = 700, SW_HUSH = 220, SW_QUIET_AFTER = 280, SW_FLICK = 1.8;   // SW_FLICK: px per ms - faster than a hand guiding it
  let swQuietUntil = 0, swAfter = [], swLastDir = 0;            // swAfter: the last steps after a swipe; swLastDir: its way                                // a finger resting is not a release: only the lift (or a long stop) lets go
  let swHushAt = 0, swHushLast = 0, swLastEvt = 0;
  /* WINDOWS (and Linux): a mouse wheel - notches, or a touch strip like the Arc Mouse's - and Windows touchpads send short
     scroll steps, never the long glide a Mac trackpad makes: there a scroll over the Desktops widget is a step - one
     desktop that way (sideways, or up / down with a plain wheel: down / right = the next one), the same slide; keep
     scrolling and it steps on, one desktop at a time */
  const WHEEL_STEPS = !/Mac/i.test(navigator.platform || navigator.userAgent || "");
  const STEP_AT = 40, STEP_REST = 450, STEP_GAP = 220;
  let stepAcc = 0, stepLast = 0, stepLock = 0;
  function wheelStep(dx, dy, now) {
    const d = Math.abs(dx) >= Math.abs(dy) ? dx : dy;               // the stronger way
    if (!d) return;
    if (now - stepLast > STEP_GAP) stepAcc = 0;                      // a new scroll
    stepLast = now;
    swQuietUntil = Math.max(swQuietUntil, now + SW_QUIET_AFTER);     // (no hover opening the desktops meanwhile)
    if (now < stepLock || swiping || sw) { stepAcc = 0; return; }    // the step just taken (its slide)
    if (Math.sign(d) !== Math.sign(stepAcc)) stepAcc = 0;
    stepAcc += d;
    if (Math.abs(stepAcc) < STEP_AT) return;
    const dir = Math.sign(stepAcc);
    stepAcc = 0; stepLock = now + STEP_REST;
    swipeDesk(dir);
  }
  addEventListener("wheel", ev => {
    if (!ev.target?.closest?.(".vos-chain-vosmission") || document.querySelector("#browser.toolbar-edit-mode")) return;
    const k = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? innerWidth : 1, dx = ev.deltaX * k, dy = ev.deltaY * k;
    const now = performance.now();
    if (window.__vosWheelSteps ?? WHEEL_STEPS) { ev.preventDefault(); ev.stopImmediatePropagation(); return wheelStep(dx, dy, now); }
    // after a swipe: what the trackpad still sends (its momentum - only ever fading) is not a swipe; a NEW swipe is:
    // steps growing (fingers pushing again), the other way, or after a pause - so you can swipe on and on, at once
    const gap = now - swLastEvt; swLastEvt = now;
    if (swiping || (sw && sw.settling) || now < swQuietUntil) {
      const h = swAfter; h.push(dx); if (h.length > 4) h.shift();
      const growing = h.length >= 3 && Math.abs(h[h.length - 1]) >= 6 && Math.abs(h[h.length - 1]) > Math.abs(h[h.length - 2]) * 1.15 && Math.abs(h[h.length - 2]) > Math.abs(h[h.length - 3]) * 1.15 && Math.sign(h[h.length - 1]) === Math.sign(h[h.length - 2]);
      const other = swLastDir && Math.sign(dx) === -swLastDir && Math.abs(dx) >= 4;
      const fresh = !swiping && !(sw && sw.settling) && Math.abs(dx) > Math.abs(dy) && (growing || other || (gap > 150 && Math.abs(dx) >= 2));
      if (!fresh) { swQuietUntil = Math.max(swQuietUntil, now + SW_QUIET_AFTER); if (Math.abs(dx) >= Math.abs(dy)) ev.preventDefault(); return; }
      swQuietUntil = 0; swAfter = [];
    }
    if (sw && !dx && !dy) { ev.preventDefault(); return swRelease(); }   // the end of the gesture (macOS sends an empty one): the fingers let go
    if (!sw && Math.abs(dx) <= Math.abs(dy)) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }   // up / down: nothing (no tab switching here)
    ev.preventDefault();                                             // not Vivaldi's back / forward swipe
    if (!dx) return;
    if (!sw && !swStart()) return;
    swMove(dx, now);
  }, { capture: true, passive: false });
  function swStart() {
    const stack = document.getElementById("webpage-stack"), b = browserEl();
    if (!stack || !b) return false;
    try { shootPanes(curWs()); } catch (e) {}                       // (this desktop's split panes, photographed while they are drawn)
    if (wsStrip) closeWsStrip(false, !!mission);
    const info = deskInfo && sameWs(deskInfo.ws, curWs()) ? deskInfo : null;
    sw = { stack, b, info, acc: 0, vs: [], dir: 0, inc: [], D: swDist(), timer: 0 };
    if (!info) { const s = sw; desksNow(true).then(i => { if (sw === s && !s.info) { s.info = i; s.dir = 0; swMove(0, performance.now()); } }); }
    const sc = scene();
    const ap = activePage(), apId = ap?.dataset.id;                  // a full-screen page: it slides as it is, on black (no wallpaper)
    const upS = !mcMax && b.hasAttribute("data-ft-desktop") && underId && !awayWs(underId) ? pageOf(underId) : null;
    const apFull = ap && !winOf(apId) && !isStart(ap) && (b.hasAttribute("data-ft-maxpage") || isTiled(ap)) ? shownEl(ap) : null;   // a full-screen page, or a full-screen split
    if (apFull) { apFull.setAttribute("data-vos-swmax", ""); sw.max = apFull; if (sc) sc.children[0].style.visibility = "hidden"; }
    else if (upS?.hasAttribute("data-ft-under")) { upS.setAttribute("data-vos-swmax", "under"); sw.max = upS; if (sc) sc.children[0].style.visibility = "hidden"; }   // a full-screen page under the windows: it slides with them
    else if (cover && sc) sc.children[0].style.visibility = "hidden";   // a window in full view: the same
    swUnmove([...document.querySelectorAll("#webpage-stack [style*='--vos-dx'], #webpage-stack [style*='--vos-in']")]);   // nothing left from a swipe before
    stack.style.removeProperty("--vos-dx"); stack.style.removeProperty("--vos-in");
    b.setAttribute("data-vos-dragdesk", "");
    sw.dxV = 0; sw.inV = 0; swMovers(sw);
    deskDots(true);
    return true;
  }
  /* BENTO is the space at the far left: from the first desktop, swipe left - Bento on; in Bento,
     swipe right - back to the desktop (Bento off). In Bento there is nothing further left. */
  const BENTO_IN = { bento: true }, BENTO_OUT = { bento: false };
  function swTarget(dir) {
    const i = sw?.info;
    if (!i || i.i < 0) return null;
    const t = i.ds[i.i + dir] || null;
    return t && !("bento" in t) ? t : null;                          // Bento is each desktop's own: a swipe only changes the desktop (never a pull or a Bento switch)
  }
  const isBentoT = t => !!t && "bento" in t;
  function swUnprep() {
    for (const el of sw.inc) {
      if (el.classList.contains("vos-lp-ghost")) { el.remove(); continue; }
      el.removeAttribute("data-vos-incoming"); el.removeAttribute("data-ft-ws-leave"); el.removeAttribute("data-vos-swmax-in");
      if (el.__vosPlaced) { el.__vosPlaced = false; if (!floating.has(el.dataset.id)) unplace(el); }   // a pane laid out for the slide: Vivaldi's own place again
    }
    sw.inc = [];
  }
  function swPrep(dir) {                                             // the desktop that way, beside this one: its windows, or its Launchpad
    swUnprep();
    sw.dir = dir;
    const t = swTarget(dir);
    sw.inV = dir * sw.D;
    const sc = scene(); if (sc) sc.children[1].style.visibility = t && !isBentoT(t) ? "" : "hidden";
    if (!t || isBentoT(t)) return;                                   // Bento: the same windows, tiled - nothing comes in
    const ft = sw.info?.front?.get(String(t.id)), fp = fullOf(ft);  // that desktop shows a full-screen app: it comes in as it is
    if (fp) {
      // a split full screen there (Vivaldi draws it only on the desktop shown): its panes, laid out as it is seen
      const ss = stackRect(), parts = fp.classList.contains("webpageview") && !isTiled(fp) ? splitParts(String(ft.id), ss) : null;
      const els = parts ? parts.map(({ id: pid, r }) => { const pg = pageOf(pid); if (pg) { place(pg, r, ss); pg.__vosPlaced = true; } return pg; }).filter(Boolean) : [fp];
      for (const el of els) { el.setAttribute("data-vos-incoming", ""); el.setAttribute("data-vos-swmax-in", ""); }
      if (sc) sc.children[1].style.visibility = "hidden";
      sw.inc = els;
      return;
    }
    const els = [...floating].filter(id => !minimized.has(id) && sameWs(wsOfTab.get(String(id)), t.id))
      .flatMap(id => [...winEls(id), frames.get(id)]).filter(Boolean);
    if (!els.length) {                                               // no windows there: its Launchpad (a copy, for the slide)
      const lp = document.querySelector("#webpage-stack > .lp-layer.lp-desktop:not(.vos-lp-ghost)");
      if (lp) {
        const g = lp.cloneNode(true);
        g.classList.add("vos-lp-ghost"); g.setAttribute("aria-hidden", "true");
        g.removeAttribute("data-ft-swipe-out"); g.removeAttribute("data-ft-ws-leave"); g.style.removeProperty("visibility"); g.style.removeProperty("translate");
        sw.stack.appendChild(g); els.push(g);
      }
    }
    els.forEach(el => { el.setAttribute("data-vos-incoming", ""); if (!el.classList.contains("vos-lp-ghost")) el.setAttribute("data-ft-ws-leave", ""); });
    sw.inc = els;
  }
  function swMove(d, now) {
    const s = sw;
    s.acc = Math.max(-s.D, Math.min(s.D, s.acc + d));
    if (d) { s.vs.push([now, d / Math.max(4, Math.min(60, now - (s.at || now - 16)))]); s.at = now; while (s.vs.length && now - s.vs[0][0] > 120) s.vs.shift(); }
    const dir = s.acc > 0 ? 1 : s.acc < 0 ? -1 : s.dir;
    if (dir && dir !== s.dir && s.info) { swPrep(dir); swMovers(s); }
    const tg = swTarget(dir), shown = isBentoT(tg) ? s.acc * 0.3 : tg ? s.acc : 0;   // nothing that way (the first or last desktop): it stays still; Bento: a pull
    swSetDx(s, Math.round(shown));
    clearTimeout(s.timer);
    if (Math.abs(s.acc) >= s.D) return swRelease();                  // all the way: there
    // the fingers lifted: the trackpad's momentum follows - each step a little smaller than the one before,
    // smoothly, the same way: settle now (on, or back), as natural scrolling does
    if (d) {
      (s.hist ||= []).push(d); if (s.hist.length > 6) s.hist.shift();
      const h = s.hist;
      if (h.length >= 4 && h.every(x => Math.sign(x) === Math.sign(h[0])) &&
          h.slice(1).every((x, i) => Math.abs(x) <= Math.abs(h[i]) * 0.99 && Math.abs(x) >= Math.abs(h[i]) * 0.7)) return swRelease();
    }
    // a FAST swipe: straight to that desktop (no need to carry it there); a slow one is the hand's - it only follows
    if (dir && swTarget(dir) && Math.abs(s.acc) > 24 && Math.max(0, ...s.vs.map(([, x]) => x * dir)) > SW_FLICK) return swRelease(true);
    s.timer = setTimeout(swRelease, SW_QUIET);                       // the scrolling stopped: let go
  }
  async function swRelease(flick) {
    const s = sw;
    if (!s || s.settling) return;
    clearTimeout(s.timer);
    s.settling = true; swHushAt = performance.now();
    const dir = s.dir, t = swTarget(dir), D = s.D;
    const v = Math.max(0, ...s.vs.map(([, x]) => x * dir));         // px per ms that way, just now
    if (isBentoT(t)) {                                               // Bento: the pull springs back as the windows tile (or untile)
      const goB = Math.abs(s.acc) > D * 0.18 || (v > 0.5 && Math.abs(s.acc) > 30);
      if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
      const fromB = s.dxV || 0;
      const a = (s.movers || []).map(el => el.animate([{ "--vos-dx": String(fromB) }, { "--vos-dx": "0" }], { duration: 180, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)", fill: "forwards" }))[0] || { finished: Promise.resolve() };
      await Promise.race([a.finished.catch(() => {}), new Promise(r => setTimeout(r, 380))]);
      swClean(s);
      if (goB) bentoToggle(t.bento);
      return;
    }
    // natural: it goes the way it was moving when the fingers lifted - still moving on: on to that desktop; moved back: back
    // let go: where the hand left it - past half way (or still moving on, a good way along): on; else back
    const last = (s.hist || []).slice(-2).reduce((a, x) => a + x, 0) * dir;   // the last steps: on (>0) or back (<0)
    const go = !!t && (flick === true || Math.abs(s.acc) >= D * 0.5 || (Math.abs(s.acc) > D * 0.15 && last > 0 && v > 0.6));
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    const from = s.dxV || 0, to = go ? dir * D : 0;
    const dist = Math.max(1, Math.abs(to - from));
    // it goes on at the fingers' own speed and only slows down from there (never a pause, then a push): a slow lift
    // takes a little longer to arrive, a fast one is there at once
    const vv = Math.max(0.05, v), ms = Math.round(go ? Math.max(220, Math.min(380, 1.5 * dist / vv)) : Math.max(160, Math.min(300, 1.4 * dist / Math.max(vv, 1.2))));
    const k = vv * ms / dist;                                         // its first speed, as a slope of the curve
    const y1 = Math.max(0.05, Math.min(1, 0.3 * k));
    const ease = go ? `cubic-bezier(0.3, ${y1.toFixed(3)}, 0.35, 1)` : "cubic-bezier(0.25, 0.8, 0.3, 1)";
    s.movers = (s.movers || []).filter(el => el.isConnected);
    const anim = s.movers.map(el => el.animate([{ "--vos-dx": String(from) }, { "--vos-dx": String(to) }], { duration: ms, easing: ease, fill: "forwards" }))[0] || { finished: Promise.resolve(), cancel() {} };
    if (go) {
      swiping = true;
      const out = swItems().filter(el => !s.inc.includes(el));      // this desktop's windows: kept in sight while they slide out
      out.forEach(el => { el.setAttribute("data-vos-out", ""); el.setAttribute("data-ft-ws-leave", ""); });
      s.out = out;
      s.b.setAttribute("data-vos-swipe", dir > 0 ? "next" : "prev");
      dotsMark(s.info.ds.findIndex(w => sameWs(w.id, t.id)));
      // (performance) the slide first, all of it, on the graphics card - then Vivaldi's switch, unseen: its work (pages and
      // splits drawn again) never lands in the middle of the motion
      await Promise.race([anim.finished.catch(() => {}), new Promise(r => setTimeout(r, ms + 150))]);
      const t1 = Date.now();
      // that desktop shows its Launchpad (no window there): it slides in with its wallpaper - caught the moment
      // Vivaldi draws it, before it is ever seen in its place
      const toLp = !s.inc.length || s.inc.every(el => el.classList?.contains("vos-lp-ghost"));
      const join = (el, inc) => {                                   // drawn anew mid-swipe: it rides on the same clock as the rest
        if (!el || s.movers.includes(el)) return;
        if (inc) { el.setAttribute("data-vos-incoming", ""); el.removeAttribute("data-ft-swipe-out"); s.inc.push(el); el.style.setProperty("--vos-in", String(s.inV || dir * D)); }
        else { el.setAttribute("data-vos-out", ""); el.setAttribute("data-ft-ws-leave", ""); s.out.push(el); }
        s.movers.push(el);
        const a = el.animate([{ "--vos-dx": String(from) }, { "--vos-dx": String(to) }], { duration: ms, easing: ease, fill: "forwards" });
        try { a.startTime = anim.startTime; } catch (e) {}
      };
      const lpQ = "#webpage-stack > .lp-layer.lp-desktop:not(.vos-lp-ghost)";
      const outIds = [...new Set(out.map(el => el.dataset.ftFloat || "").filter(Boolean))];
      const inIds = [...new Set(s.inc.map(el => el.dataset?.ftFloat || el.dataset?.ftFor || "").filter(Boolean))];
      let joinQ = false;
      const keep = () => {                                           // what Vivaldi re-draws on the switch keeps sliding (a split it takes apart: its panes)
        joinQ = false;
        if (s.cleaned) return;
        if (toLp) join(document.querySelector(lpQ), true);
        for (const id of outIds) for (const el of winEls(id)) if (el && el.isConnected && !el.hasAttribute("data-vos-out")) join(el, false);
        for (const id of inIds) for (const el of [...winEls(id), frames.get(id)]) if (el && el.isConnected && !el.hasAttribute("data-vos-incoming")) join(el, true);   // a split Vivaldi draws again on arrival: still coming in
      };
      let joinN = 0;
      const watch = new MutationObserver(() => { if (!joinQ && joinN < 30) { joinQ = true; joinN++; queueMicrotask(() => { render(); keep(); }); } });
      watch.observe(s.stack, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      s.watch = watch;
      setTimeout(() => watch.disconnect(), ms + 2500);
      try {
        await Promise.race([switchWs({ id: t.id, name: t.name }, s.info.list), new Promise(r => setTimeout(r, 2000))]);
        while (Date.now() - t1 < 1500 && !sameWs(curWs(), t.id)) { wsNowAt = 0; await new Promise(r => setTimeout(r, 20)); }
        render();
        keep();
      } catch (e) { wsErr("swipe", e); }
    }
    await Promise.race([anim.finished.catch(() => {}), new Promise(r => setTimeout(r, ms + 200))]);
    for (const el of s.movers || []) el.style.setProperty("--vos-dx", String(Math.round(to)));   // exactly at its place (no last little snap)
    await new Promise(r => requestAnimationFrame(r));
    swClean(s);
    if (go) { swiping = false; deskInfo = null; deskDots(true); arrive(t.id); }
  }
  function swClean(s) {                                              // all in one frame: everything where it really is
    s.cleaned = true; s.watch?.disconnect();
    swQuietUntil = Math.max(swQuietUntil, performance.now() + SW_QUIET_AFTER);   // (what the trackpad still sends: not a new swipe)
    swAfter = []; swLastDir = s.dir || 0;
    s.b.removeAttribute("data-vos-dragdesk");
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    swUnmove(s.movers || []); s.movers = [];
    s.stack.getAnimations().forEach(a => a.cancel());
    s.stack.style.removeProperty("--vos-dx"); s.stack.style.removeProperty("--vos-in");
    for (const el of s.out || []) { el.removeAttribute("data-vos-out"); el.removeAttribute("data-ft-ws-leave"); }
    sw = s; swUnprep(); sw = null;
    s.max?.removeAttribute("data-vos-swmax");
    s.b.removeAttribute("data-vos-swipe");
    sceneEnd();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && sw && !sw.settling) { const s = sw; clearTimeout(s.timer); swClean(s); } });   // hidden mid-swipe: put back
  /* DESKTOP DOTS: over the Mission Control (Workspaces) button, a small pill shows the desktops of
     this window as dots, the shown one bright, with its name - also while you swipe */
  let dotsEl = null, dotsTimer = 0;
  function dotsSkin(el) {                                            // the address field's own look (its colors, corners, height)
    const af = document.querySelector("#tabs-tabbar-container .UrlBar-AddressField") || document.querySelector(".UrlBar-AddressField");
    if (!af?.offsetHeight) return;
    const cs = getComputedStyle(af), set = (k, v) => { if (v) el.style.setProperty(k, v, "important"); };
    // (its colours come from the same theme colours as the address field - CSS - so they change with it at once)
    set("border-radius", cs.borderTopLeftRadius);
    if (cs.backdropFilter && cs.backdropFilter !== "none") set("backdrop-filter", cs.backdropFilter);
    set("height", af.offsetHeight + "px");
  }
  function dotsLive() {                                              // the address field's look, read once each time it shows (no per-frame work)
    if (dotsEl) dotsSkin(dotsEl);
    return;
    if (dotsLive.on) return;
    dotsLive.on = true;
    const tick = () => {
      if (!dotsEl || dotsEl.hasAttribute("data-out")) { dotsLive.on = false; return; }
      dotsSkin(dotsEl);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function dotsMark(i) {                                             // light that desktop's dot now
    const row = dotsRow();
    if (row && i >= 0) [...row.children].forEach((d, j) => d.toggleAttribute("data-on", j === i));
  }
  function dotsDraw(info, btn) {
    if (!dotsEl) { dotsEl = document.createElement("div"); dotsEl.className = "vos-ws-dots"; dotsEl.setAttribute("data-out", ""); (browserEl() || document.body).appendChild(dotsEl); }
    const row = document.createElement("div"); row.className = "vos-ws-dots-row";
    info.ds.forEach((w, j) => { const d = document.createElement("i"); if (j === info.i) d.setAttribute("data-on", ""); row.appendChild(d); });
    dotsEl.replaceChildren(row);
    dotsSkin(dotsEl);
    const r = btn.getBoundingClientRect(), w = dotsEl.offsetWidth;   // to the right of the button (or left, at the screen's edge)
    const x = r.right + 6 + w > innerWidth - 4 ? r.left - 6 - w : r.right + 6;
    dotsEl.style.left = Math.round(x) + "px";
    dotsEl.style.top = Math.round(r.top + r.height / 2) + "px";
  }
  async function deskDots(show) {
    if (show) { dotsEl?.setAttribute("data-out", ""); return; }      // (the Workspaces icon shows the desktops now: no pill)
    const btn = document.querySelector(".vos-chain-vosmission");
    if (!show || !btn) { clearTimeout(dotsTimer); dotsTimer = setTimeout(() => { dotsEl?.setAttribute("data-out", ""); }, 600); return; }
    clearTimeout(dotsTimer);
    if (deskInfo && sameWs(deskInfo.ws, curWs())) { dotsDraw(deskInfo, btn); dotsEl.removeAttribute("data-out"); dotsLive(); }   // at once from what is known
    const info = await desksNow(true);
    if ((swiping || sw) && dotsRow()) { dotsEl.removeAttribute("data-out"); dotsLive(); return; }   // a switch under way: its dot is already lit
    dotsDraw(info, btn);
    dotsEl.removeAttribute("data-out");
    dotsLive();
    if (!sw && !btn.matches(":hover")) deskDots(false);
  }
  addEventListener("pointerover", ev => {
    if (document.querySelector("#browser.toolbar-edit-mode") || wsStrip) return;
    const on = ev.target?.closest?.(".vos-chain-vosmission");
    const was = ev.relatedTarget?.closest?.(".vos-chain-vosmission");
    if (on && on !== was) {
      for (const n of [on, ...on.querySelectorAll("[title]")]) if (n.hasAttribute("title")) { n.dataset.vosTitle = n.getAttribute("title"); n.removeAttribute("title"); }
      deskDots(true); desksNow();
    }
  }, true);
  addEventListener("pointerout", ev => {
    const from = ev.target?.closest?.(".vos-chain-vosmission");
    if (from && !from.contains(ev.relatedTarget)) deskDots(false);
  }, true);
  /* Mission Control shows a window smaller by scaling it (the page keeps its size): its
     top-left goes to disp; null: back to normal */
  function missionLook(id, el, disp, r) {
    const f = frames.get(id);
    if (!disp || !mission) {
      for (const n of [el, f]) if (n?.__mt) {
        n.__mt = false; n.style.removeProperty("transform");         // the origin stays while it glides back
        setTimeout(() => { if (!n.__mt) n.style.removeProperty("transform-origin"); }, 360);
      }
      return;
    }
    const t = `translate(${Math.round(disp.x - r.x)}px, ${Math.round(disp.y - r.y)}px) scale(${disp.k ?? mission.k})`;
    el.__mt = true; setStyle(el, "transform-origin", "0 0"); setStyle(el, "transform", t);
    if (f) { const g = f.hasAttribute("data-ft-grab") ? GRAB : 0; f.__mt = true; setStyle(f, "transform-origin", `${RING}px ${RING + g}px`); setStyle(f, "transform", t); }
  }
  /* Mission Control over a full-screen page: the page gets smaller too, as a window does
     (scaled, not resized), on the wallpaper below the panel; a click goes back into it */
  let mcMax = null;
  function missionMax(s, slots) {
    const b = browserEl(), sl = mission && underId ? slots?.get(underId) : null;
    const page = sl ? pageOf(underId) : null;
    if (mcMax && mcMax !== page) {
      const o = mcMax; mcMax = null;
      o.style.removeProperty("transform"); o.removeAttribute("data-vos-mc-max");
      setTimeout(() => { if (mcMax !== o) o.style.removeProperty("transform-origin"); }, 360);
      if (!page) setTimeout(() => { if (!mcMax) b?.removeAttribute("data-vos-mc-maxpage"); }, 340);   // the wallpaper stays while it glides back
    }
    if (!page) return;
    mcMax = page; page.setAttribute("data-vos-mc-max", ""); b.setAttribute("data-vos-mc-maxpage", "");
    setStyle(page, "transform-origin", "0 0");
    setStyle(page, "transform", `translate(${Math.round(sl.x)}px, ${Math.round(sl.y)}px) scale(${sl.k.toFixed(4)})`);
  }
  /* Mission Control: the full-screen app is picked up like a window - onto another desktop (or New);
     a click goes back into it */
  function mcMaxDrag(ev, page) {
    const id = page.dataset.id, pid = ev.pointerId, sx = ev.clientX, sy = ev.clientY;
    const icon = mcIcons?.querySelector(`[data-id="${CSS.escape(id)}"]`);
    let moved = false, card = null, last = [0, 0];
    const move = e => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true; last = [dx, dy];
      page.style.setProperty("translate", `${dx}px ${dy}px`, "important");
      page.setAttribute("data-vos-mc-held", ""); icon?.setAttribute("data-held", "");
      const c = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains("vos-ws-card") && !n.hasAttribute("data-current")) || null;
      if (c !== card) { card?.removeAttribute("data-drop"); card = c; card?.setAttribute("data-drop", ""); }
    };
    const up = e => {
      if (e.pointerId !== pid) return;
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
      card?.removeAttribute("data-drop");
      if (!moved) { icon?.removeAttribute("data-held"); closeWsStrip(); if (activePage()?.dataset.id !== id) { activate(id); render(); } return; }
      const done = () => { page.getAnimations().forEach(a => a.cancel()); page.style.removeProperty("translate"); page.removeAttribute("data-vos-mc-held"); icon?.removeAttribute("data-held"); };
      if (card && e.type === "pointerup") {
        const list = wsStrip?.__list || [];
        const box = (card.querySelector(".vos-ws-mini") || card).getBoundingClientRect(), pr = page.getBoundingClientRect();
        const tx = last[0] + box.left + box.width / 2 - (pr.left + pr.width / 2), ty = last[1] + box.top + box.height / 2 - (pr.top + pr.height / 2);
        page.animate([{ translate: `${last[0]}px ${last[1]}px`, opacity: 1, scale: "1" }, { translate: `${tx}px ${ty}px`, opacity: 0, scale: "0.25" }],
                     { duration: 240, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" });
        const isNew = card.classList.contains("vos-ws-more");
        const ws = isNew ? null : (list.find(w => String(w.id) === card.dataset.ws)?.id ?? null);
        if (!isNew) {                                                // its picture moves into that desktop's card
          const mini = wsStrip?.querySelector(`.vos-ws-card[data-current] .vos-ws-full`);
          card.querySelector(".vos-ws-empty")?.remove();
          if (mini) card.querySelector(".vos-ws-mini")?.prepend(mini);
        }
        setTimeout(async () => {
          try { if (isNew) { closeWsStrip(); await toNewDeskNow(id, list); } else { underId = null; await toDesk(id, ws); } }
          catch (err) { wsErr("move", err); }
          finally { setTimeout(done, 300); queueRender(); }
        }, 250);
        return;
      }
      page.animate([{ translate: `${last[0]}px ${last[1]}px` }, { translate: "0px 0px" }], { duration: 220, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)" });
      page.style.removeProperty("translate"); page.removeAttribute("data-vos-mc-held"); icon?.removeAttribute("data-held");
    };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }
  /* Mission Control: each window's app icon sits on its lower edge, as in macOS */
  let mcIcons = null;
  function missionIcons(slots, s) {
    if (!mission || !slots?.size || mission.frozen) {
      if (mcIcons) { const box = mcIcons; mcIcons = null; box.setAttribute("data-out", ""); setTimeout(() => box.remove(), 180); }
      return;
    }
    if (!mcIcons) { mcIcons = document.createElement("div"); mcIcons.className = "vos-mc-icons"; (browserEl() || document.body).appendChild(mcIcons); }
    const seen = new Set();
    for (const [id, sl] of slots) {
      const url = mission.urls?.get(String(id)) || mission.urls?.get(String(splitFocus.get(id) || ""));
      if (!url) continue;
      seen.add(id);
      let ic = mcIcons.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
      if (!ic) { ic = document.createElement("div"); ic.className = "vos-mc-icon"; ic.dataset.id = String(id); ic.innerHTML = `<img alt="" decoding="async">`; ic.firstChild.src = favicon(url); mcIcons.appendChild(ic); }
      const r = sl.r || pxRect(id, s), cx = s.left + sl.x + r.w * sl.k / 2, by = s.top + sl.y + r.h * sl.k;
      ic.style.setProperty("translate", `${Math.round(cx - 22)}px ${Math.round(by - 22)}px`);
      ic.toggleAttribute("data-held", missionDrag?.id === id);
    }
    for (const ic of [...mcIcons.children]) if (!seen.has(ic.dataset.id)) ic.remove();
  }
  /* Mission Control: a window let go on a desktop shrinks into its thumbnail, then moves there */
  function flyInto(id, el, card, held, then) {
    const box = card.querySelector(".vos-ws-mini") || card, f = frames.get(id);
    const er = el.getBoundingClientRect(), cr = box.getBoundingClientRect();
    if (!er.width || !cr.width) return then();
    if (held) missionDrag = held;                                   // it stays where it was let go meanwhile
    const sc = Math.max(0.04, Math.min(1, cr.width * 0.4 / er.width));
    const dx = cr.left + cr.width / 2 - (er.left + er.width * sc / 2), dy = cr.top + cr.height / 2 - (er.top + er.height * sc / 2);
    const opts = { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" };
    f?.animate([{ filter: "opacity(1)" }, { filter: "opacity(0)" }], { duration: 120, fill: "forwards" });
    let fired = false;
    const fire = () => {
        if (fired) return; fired = true;                             // once: the animation's end, or the timer (no frames)
        if (missionDrag?.id === id) missionDrag = null;
        then();
        setTimeout(() => { el.getAnimations().forEach(a => a.cancel()); f?.getAnimations().forEach(a => a.cancel()); }, 700);   // gone from this desktop by then
    };
    el.animate([{ translate: "0px 0px", scale: "1", filter: "opacity(1)" },
                { translate: `${Math.round(dx)}px ${Math.round(dy)}px`, scale: String(sc), filter: "opacity(0)" }], opts)
      .finished.catch(() => {}).then(fire);
    setTimeout(fire, opts.duration + 150);
  }
  function missionGlide() {                           // the windows glide to their new places (not jump)
    const b = browserEl();
    b?.setAttribute("data-vos-mission-anim", "");
    clearTimeout(missionMode.t); missionMode.t = setTimeout(() => b?.removeAttribute("data-vos-mission-anim"), 340);
  }
  function missionMode(m, instant) {
    if (!m && !mission) return;
    mission = m;
    const b = browserEl();
    b?.toggleAttribute("data-vos-mission", !!m);
    if (!instant) missionGlide();                                    // a short glide in and out
    render();
  }
  function closeWsStrip(instant, keepMission) {
    if (!wsStrip) return;
    const st = wsStrip; wsStrip = null;
    if (!keepMission) missionMode(null, instant);                    // a swipe: the small windows slide out as they are
    if (instant) {                                                  // a swipe follows: gone at once
      st.__back?.remove(); closeWsMenu(); st.remove();
      removeEventListener("keydown", wsKey, true); removeEventListener("pointerdown", wsOut, true);
      return;
    }
    st.__back?.remove(); closeWsMenu();
    removeEventListener("keydown", wsKey, true);
    removeEventListener("pointerdown", wsOut, true);
    const pn = st.querySelector(".vos-ws-panel") || st;            // back up, under the tab bar
    st.querySelector(".vos-ws-row")?.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-16px)", opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
    pn.animate([{ clipPath: "inset(0 0 0 0 round 18px)" }, { clipPath: "inset(0 0 100% 0 round 18px)" }], { duration: 220, easing: "cubic-bezier(0.4, 0, 0.8, 0.4)", fill: "forwards" })
      .finished.catch(() => {}).then(() => st.remove()) && setTimeout(() => st.remove(), 2500);
  }
  // a click outside the strip closes it - its own right-click menu and the Workspaces button are not outside
  const wsOut = ev => { if (wsStrip && ev.target !== wsStrip.__back && !wsStrip.contains(ev.target) && !ev.target?.closest?.(WS_BTN + ", .vos-ws-menu")) closeWsStrip(); };
  const wsKey = ev => {
    if (ev.key !== "Escape" || !wsStrip) return;
    ev.preventDefault(); ev.stopPropagation();
    if (wsMenuEl) closeWsMenu(); else closeWsStrip();             // the menu first, then the strip
  };
  let wsOpening = false;                              // a second click while it opens: not a second panel
  async function openWsStrip() {
    if (wsStrip) return closeWsStrip();
    if (wsOpening) return;
    wsOpening = true;
    try { await openWsStripNow(); } finally { wsOpening = false; }
  }
  async function openWsStripNow(opts) {                            // opts.refresh: redrawn in place (opts.born: a desktop just made)
    if (wsStrip && !opts?.refresh) return;
    const list = (await prefGet("vivaldi.workspaces.list")) || [];
    defaultIcons(list);
    const tabs = await tabsQuery({ currentWindow: true });
    if (await noDefault(list, tabs)) return new Promise(r => setTimeout(() => r(openWsStripNow(opts)), 350));   // made "Desktop 1": open with it (the caller waits for it)
    const urls = new Map((tabs || []).map(t => [String(t.id), t.url || t.pendingUrl || ""]));
    const info = new Map((tabs || []).map(t => [String(t.id), t]));
    const fronts = deskFronts(tabs);
    const ss = stackRect(), cur = curWs();
    const wall = getComputedStyle(browserEl()).getPropertyValue("--browserBackgroundImage").trim();
    const mine = await myDesks(list, tabs, cur);
    const loose = !list.length && (tabs || []).some(t => !t.pinned && wsOfTab.has(String(t.id)) && wsOfTab.get(String(t.id)) == null);   // a "Desktop" card only before any desktop exists
    const spaces = [...(loose ? [{ id: null, name: "Desktop", icon: null }] : []), ...list.filter(w => mine.has(String(w.id))).map(w => ({ id: w.id, name: w.name || "Workspace", icon: w.icon, emoji: w.emoji }))];
    const cardW = Math.round(Math.min(220, 128 * (ss.width / Math.max(1, ss.height))));   // at most 128px high

    const strip = document.createElement("div");
    strip.className = "vos-ws-strip";                               // a clip starting at the tab bar's lower edge
    const panel = document.createElement("div");
    panel.className = "vos-ws-panel";                               // slides out from under the tab bar
    strip.appendChild(panel);
    const row = document.createElement("div");
    row.className = "vos-ws-row";
    panel.appendChild(row);
    for (const sp of spaces) {
      const card = document.createElement("div");
      card.className = "vos-ws-card"; card.tabIndex = 0; card.setAttribute("role", "button");
      const same = (a, b) => (a == null && b == null) || a === b || String(a) === String(b);
      if (same(sp.id, cur)) card.setAttribute("data-current", "");
      const mini = document.createElement("div");
      mini.className = "vos-ws-mini";
      mini.style.aspectRatio = `${Math.max(1, ss.width)} / ${Math.max(1, ss.height)}`;
      card.style.setProperty("flex-basis", cardW + "px", "important");
      card.style.setProperty("width", cardW + "px", "important");
      if (wall && wall !== "none") mini.style.backgroundImage = wall;
      // its windows, where they are (the front ones on top)
      const bE = browserEl(), here = same(sp.id, cur);
      const apH = here ? activePage() : null, splitHere = !!apH && !bE.hasAttribute("data-ft-desktop") && isTiled(apH) && !winOf(apH.dataset.id) && !isStart(apH);   // a split shown full screen, here
      const fullId = here ? (bE.hasAttribute("data-ft-maxpage") || splitHere ? apH?.dataset.id : bE.hasAttribute("data-ft-desktop") && underId && !awayWs(underId) && pageOf(underId)?.hasAttribute("data-ft-under") ? underId : null)
                          : (fullOf(fronts.get(String(sp.id))) ? String(fronts.get(String(sp.id)).id) : null);
      const onlyFull = !!fullId && (!here || bE.hasAttribute("data-ft-maxpage") || splitHere);   // a full-screen app in front: only it
      const parts = fullId ? splitParts(fullId, ss) : null;
      if (parts) for (const { id: pid, r } of parts) {                 // a full-screen split: its panes, as they are seen
        const w = document.createElement("div");
        w.className = "vos-ws-win vos-ws-pane"; w.dataset.tab = String(pid);
        Object.assign(w.style, { left: (r.x / ss.width * 100) + "%", top: (r.y / ss.height * 100) + "%", width: (r.w / ss.width * 100) + "%", height: (r.h / ss.height * 100) + "%" });
        const t = info.get(String(pid));
        if (t?.url) { const im = document.createElement("img"); im.src = favicon(t.url); im.alt = ""; w.appendChild(im); }
        pagePicture(w, Number(pid), r);
        mini.appendChild(w);
      }
      else if (fullId) {
        const w = document.createElement("div");
        w.className = "vos-ws-win vos-ws-full"; w.dataset.tab = String(fullId);
        Object.assign(w.style, { left: "0%", top: "0%", width: "100%", height: "100%" });
        const t = info.get(String(fullId));
        if (t?.url) { const im = document.createElement("img"); im.src = favicon(t.url); im.alt = ""; w.appendChild(im); }
        pagePicture(w, Number(fullId), { x: 0, y: 0, w: ss.width, h: ss.height });
        mini.appendChild(w);
      }
      const wins = onlyFull ? [] : [...zOrder].filter(id => floating.has(id) && !minimized.has(id) && wsOfTab.has(String(id)) && same(wsOfTab.get(String(id)), sp.id));
      for (const id of wins) {
        const seen = same(sp.id, cur) ? null : deskLook?.get(sp.id == null ? "default" : String(sp.id)), was = seen?.map.get(id);
        const r = same(sp.id, cur) ? pxRect(id, ss) : was && was.pin === pip.includes(id) && seen.w === ss.width && seen.h === ss.height ? was.r   // as you last saw it there
          : pip.includes(id) ? pipSide((pipCorner.get(id) || "bl")[1], ss, sp.id).get(id)   // pinned there: pinned in its preview
          : (otherTiles(sp.id, ss).get(id) || (() => { const f = frac[id]; return f ? { x: f.x * ss.width, y: f.y * ss.height, w: f.w * ss.width, h: f.h * ss.height } : null; })());
        if (!r) continue;
        const w = document.createElement("div");
        w.className = "vos-ws-win"; w.dataset.tab = String(id);
        Object.assign(w.style, { left: (r.x / ss.width * 100) + "%", top: (r.y / ss.height * 100) + "%", width: (r.w / ss.width * 100) + "%", height: (r.h / ss.height * 100) + "%" });
        const t = info.get(String(id));
        if (t?.url) { const im = document.createElement("img"); im.src = favicon(t.url); im.alt = ""; w.appendChild(im); }
        pagePicture(w, Number(id), r);                               // the web page itself (Vivaldi's tab thumbnail)
        mini.appendChild(w);
      }
      if (!wins.length && !fullId) { const e = document.createElement("span"); e.className = "vos-ws-empty"; e.textContent = "No windows"; mini.appendChild(e); }
      card.appendChild(mini);
      const label = document.createElement("div");
      label.className = "vos-ws-label";
      const nm = document.createElement("span"); nm.className = "vos-ws-name"; nm.textContent = sp.name; label.appendChild(nm);
      if (sp.id != null) nm.__edit = editableName(nm, sp);          // click the name to rename it (Default is Vivaldi's own)
      card.appendChild(label);
      if (sp.id != null) {
        card.dataset.ws = String(sp.id);
        card.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); wsMenu(sp, card, ev.clientX, ev.clientY, tabs, list); });
        if (spaces.filter(x => x.id != null).length > 1) {           // a hover X deletes it (its windows go to the nearest desktop)
          const x = document.createElement("button"); x.type = "button"; x.className = "vos-ws-close"; x.title = "Delete desktop";
          x.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
          x.addEventListener("pointerdown", ev => ev.stopPropagation());
          x.addEventListener("click", ev => { ev.stopPropagation(); ev.preventDefault(); card.style.opacity = "0.4"; deskDelete(sp, list, true); });
          card.appendChild(x);
        }
      }
      card.addEventListener("click", ev => {
        if (card.__dragged) { card.__dragged = false; ev.stopPropagation(); return; }   // it was a drag, not a click
        if (ev.target.closest(".vos-ws-input, .vos-ws-name")) return;   // the name: renaming, not switching
        ev.stopPropagation();
        if (same(sp.id, cur)) return closeWsStrip();
        const order = [...row.querySelectorAll(".vos-ws-card[data-ws]")];
        const dir = order.indexOf(card) - order.findIndex(c => c.hasAttribute("data-current"));
        closeWsStrip(false, true);                                   // the panel slides up as the windows swipe
        swipeTo(sp, list, dir >= 0 ? 1 : -1);
      });
      row.appendChild(card);
    }
    wsWindowDrag(row, list);                                          // a small window onto another desktop (first: it wins)
    wsReorder(row, list);
    // New: another desktop (a workspace), and you are on it
    const more = document.createElement("div");
    more.className = "vos-ws-card vos-ws-more"; more.tabIndex = 0; more.setAttribute("role", "button");
    more.innerHTML = '<div class="vos-ws-mini"><span class="vos-ws-plus">+</span></div><div class="vos-ws-label"><span>New</span></div>';
    more.querySelector(".vos-ws-mini").style.aspectRatio = `${Math.max(1, ss.width)} / ${Math.max(1, ss.height)}`;
    more.style.setProperty("flex-basis", cardW + "px", "important");
    more.style.setProperty("width", cardW + "px", "important");
    more.addEventListener("click", async ev => {                    // a new desktop joins the row - you stay here
      ev.stopPropagation();
      if (more.__busy) return;
      const p = newDesk(list, true);
      if (!p) { closeWsStrip(); openVivaldiWs(false); return; }     // fallback: Vivaldi's own list (its New button)
      more.__busy = true;
      const id = await p;
      deskInfo = null;
      if (id === undefined || wsStrip !== strip) { more.__busy = false; return; }
      for (let i = 0; i < 20; i++) {                                 // Vivaldi has saved it
        if (((await prefGet("vivaldi.workspaces.list")) || []).some(w => sameWs(w.id, id))) break;
        await new Promise(r => setTimeout(r, 50));
      }
      if (wsStrip !== strip || wsOpening) { more.__busy = false; return; }
      wsOpening = true;
      try { await openWsStripNow({ refresh: true, born: id }); } finally { wsOpening = false; }
    });
    row.appendChild(more);

    panel.addEventListener("pointerdown", ev => ev.stopPropagation());
    const back = document.createElement("div");                    // clicking anywhere else closes it (also over a page)
    back.className = "vos-ws-back";
    back.addEventListener("pointerdown", ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (wsMenuEl) return closeWsMenu();                           // a menu open: that closes first, the strip stays
      if (mission) {                                                // Mission Control: a window under it - pick it up
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find(n => n !== back && !n.closest?.(".vos-ws-strip"));
        const fr = under?.closest?.(".ft-frame");
        const w = under?.closest?.("[data-ft-float]") || (fr ? targetOf(pageOf(fr.dataset.ftFor)) : null);
        if (w?.hasAttribute("data-ft-float") && !w.hasAttribute("data-ft-away")) return startGesture(ev, w, "move");
        const mp = under?.closest?.("[data-vos-mc-max]");
        if (mp?.dataset.id) return mcMaxDrag(ev, mp);
      }
      closeWsStrip();
    });
    strip.__back = back;
    if (opts?.refresh) { if (!wsStrip) return; closeWsStrip(true, true); }   // the old one goes as the new one comes: no gap
    else if (wsStrip) return;                                        // opened meanwhile
    (browserEl() || document.body).appendChild(back);
    (browserEl() || document.body).appendChild(strip);
    const top = ss.top;
    strip.style.top = top + "px";
    // the frosted panel itself never moves (a moving blur flickers): it is revealed from the top,
    // and only its desktops slide down
    if (!opts?.refresh) {
      panel.animate([{ clipPath: "inset(0 0 100% 0 round 18px)" }, { clipPath: "inset(0 0 0 0 round 18px)" }], { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
      row.animate([{ transform: "translateY(-24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
    }
    wsStrip = strip; strip.__list = list;
    { const pb = strip.offsetTop + panel.offsetTop + panel.offsetHeight;   // Mission Control: the windows below the panel
      const oy = Math.max(0, pb - ss.top) + 16, k = Math.max(0.3, Math.min(0.8, (ss.height - oy - 16) / Math.max(1, ss.height)));
      missionMode({ k, ox: (ss.width - ss.width * k) / 2, oy, urls }, !!opts?.refresh); }
    addEventListener("keydown", wsKey, true);
    setTimeout(() => addEventListener("pointerdown", wsOut, true));
    { const born = opts?.born != null ? row.querySelector(`.vos-ws-card[data-ws="${CSS.escape(String(opts.born))}"]`) : null;
      const cur = born || row.querySelector("[data-current]");       // the current (or the new) desktop in view (the row only scrolls itself)
      if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = cur.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2;
      born?.animate([{ transform: "scale(0.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.15)" }); }
  }
  /* Vivaldi's own workspace actions - the ones its menu calls - found by their names
     (setName, addWorkspace, activateWorkspaceByIndex) in its module registry, which is in
     Vivaldi's background page (its interface code runs there and draws into the window) */
  let wsApi = null;
  function vivWs() {
    if (wsApi) return wsApi;
    try {
      let host = null;
      try { host = chrome.extension?.getBackgroundPage?.(); } catch (e) {}
      const ch = (host || self).webpackChunkgapp_browser_react || self.webpackChunkgapp_browser_react;
      if (!ch?.push) return null;
      let req = null;
      ch.push([["vos-ws-" + Date.now()], {}, r => { req = r; }]);
      // the registry has the module definitions (no cache): the one with the workspace actions
      const isWs = v => v && typeof v.setName === "function" && typeof v.addWorkspace === "function" && typeof v.activateWorkspaceByIndex === "function";
      for (const id of Object.keys(req?.m || {})) {
        let src = "";
        try { src = Function.prototype.toString.call(req.m[id]); } catch (e) { continue; }
        if (!src.includes("activateWorkspaceByIndex(") || !src.includes("SET_WORKSPACE_NAME")) continue;
        let ex; try { ex = req(id); } catch (e) { continue; }
        if (isWs(ex)) return (wsApi = ex);
        for (const k of Object.keys(ex || {})) { let v; try { v = ex[k]; } catch (e) { continue; } if (isWs(v)) return (wsApi = v); }
      }
    } catch (e) { LOG("workspaces: Vivaldi's actions not found", e); }
    return null;
  }
  const winId = () => window.vivaldiWindowId != null ? Promise.resolve(window.vivaldiWindowId) : new Promise(r => chrome.windows.getCurrent(w => r(w?.id)));
  /* every desktop shows Vivaldi's default workspace icon (the stacked layers): any icon
     or emoji of its own is cleared, through Vivaldi's own setters */
  async function defaultIcons(list) {
    const api = vivWs();
    if (!api) return;
    for (const w of list || (await prefGet("vivaldi.workspaces.list")) || []) {
      try {
        if (w.icon) api.setIcon(w.id, undefined);
        if (w.emoji) api.setEmoji?.(w.id, undefined);
      } catch (e) {}
    }
  }
  setTimeout(() => defaultIcons(), 8000);

  /* open Vivaldi's own workspace list (silent: only to press one of its items) */
  function openVivaldiWs(silent) {
    const w = document.querySelector(WS_BTN);
    const b = w && (w.matches("button") ? w : w.querySelector("button")) || w;   // the button itself: a press never travels down
    if (!b) return false;
    document.documentElement.toggleAttribute("data-vos-ws-silent", !!silent);
    wsPass = true;
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: "mouse" };
    b.dispatchEvent(new PointerEvent("pointerdown", o));
    setTimeout(() => { wsPass = false; }, 50);
    return true;
  }
  /* DESKTOP SWIPE (like macOS Spaces): what is on this desktop slides away toward the one
     you chose, and the new desktop's windows slide in from that side - one transform on
     elements already on the graphics card (no pictures taken, nothing re-laid out) */
  const SWIPE_ITEMS = "#webpage-stack [data-ft-float]:not([data-ft-min]):not([data-ft-away]), .ft-frame:not([data-ft-away]), #webpage-stack > .lp-layer.lp-desktop:not([style*='visibility']):not(.vos-lp-ghost), #webpage-stack .ft-veil";
  let swipeGen = 0;
  async function swipeTo(sp, list, dir) {
    const b = browserEl(), gen = ++swipeGen;
    if (!b || matchMedia("(prefers-reduced-motion: reduce)").matches) {   // no animation (Windows "Animation effects" off): the same work
      swiping = true;
      const items = swItems();                                        // before the switch hides them
      try { const made = await (sp.go ? sp.go() : switchWs(sp, list)); if (sp.id == null && made != null) sp.id = made; }
      catch (e) { wsErr("switch", e); }
      finally {
        missionMode(null, true);
        for (const el of sp.incoming || []) { el.removeAttribute("data-vos-incoming"); el.removeAttribute("data-ft-ws-leave"); el.style.removeProperty("translate"); }
        for (const el of items) el.style.removeProperty("translate");
        sceneEnd();
        if (gen === swipeGen) swiping = false;
      }
      return;
    }
    if (deskInfo) dotsMark(deskInfo.ds.findIndex(w => sameWs(w.id, sp.id)));   // the dot moves on now, not after the slide
    const side = dir > 0 ? "next" : "prev";
    const ms = sp.ms || 300, ease = sp.ease || "cubic-bezier(0.25, 0.8, 0.3, 1)";
    b.style.setProperty("--vos-swipe-ms", ms + "ms"); b.style.setProperty("--vos-swipe-ease", ease);
    const D = swDist(); b.style.setProperty("--vos-swipe-dist", D + "px");
    // full-screen apps slide as they are seen: this desktop's out, the other desktop's in (never its bare wallpaper first)
    const fullOut = (() => {
      const ap = activePage();
      if (ap && !winOf(ap.dataset.id) && !isStart(ap) && (b.hasAttribute("data-ft-maxpage") || isTiled(ap))) return shownEl(ap);
      const up = b.hasAttribute("data-ft-desktop") && underId && !awayWs(underId) ? pageOf(underId) : null;
      return up?.hasAttribute("data-ft-under") ? up : null;
    })();
    let fullIn = null, frIn = null;
    if (sp.id != null && !(sp.incoming || []).length) {
      try {
        const fr = deskInfo?.front && Date.now() - deskInfo.at < 30000 ? deskInfo.front : deskFronts(await tabsQuery({ currentWindow: true }));
        frIn = fr;
        fullIn = fullOf(fr.get(String(sp.id)));
      } catch (e) {}
      if (fullIn === fullOut) fullIn = null;
    }
    const holdSwitch = !!fullOut && !fullOut.classList.contains("webpageview") && sp.id != null;   // a split: it slides out first, then the switch
    if (holdSwitch && !fullIn && !(sp.incoming || []).length) {     // that desktop's windows come in with it, from the side
      const inc = [...floating].filter(id => !minimized.has(id) && sameWs(wsOfTab.get(String(id)), sp.id)).flatMap(id => [...winEls(id), frames.get(id)]).filter(Boolean);
      inc.forEach(el => { el.setAttribute("data-vos-incoming", ""); el.setAttribute("data-ft-ws-leave", ""); el.style.translate = `${dir * D}px 0px`; });
      sp.incoming = inc;
    }
    const fullAnims = [];
    if (fullOut) { fullOut.setAttribute("data-vos-swo", fullOut.hasAttribute("data-ft-under") ? "under" : ""); fullAnims.push([fullOut, fullOut.animate([{ translate: "0px 0px" }, { translate: `${-dir * D}px 0px` }], { duration: ms, easing: ease, fill: "forwards" })]); }
    if (fullIn) {                                                    // (a split full screen there: all its panes, laid out as it is seen)
      const ss0 = stackRect(), ftIn = frIn?.get?.(String(sp.id)), parts = fullIn.classList.contains("webpageview") && !isTiled(fullIn) && ftIn ? splitParts(String(ftIn.id), ss0) : null;
      const ins = parts ? parts.map(({ id: pid, r }) => { const pg = pageOf(pid); if (pg) { place(pg, r, ss0); pg.__vosPlaced = true; } return pg; }).filter(Boolean) : [fullIn];
      for (const el of ins) { el.setAttribute("data-vos-swi", ""); fullAnims.push([el, el.animate([{ translate: `${dir * D}px 0px` }, { translate: "0px 0px" }], { duration: ms, easing: ease, fill: "forwards" })]); }
    }
    { const sc = scene();                                            // the wallpapers slide too: this one out, the other in
      if (sc && sc.children[1].style.visibility === "hidden") sceneAt(parseFloat(sc.children[0].style.translate) || 0, dir * D);
      sceneGo(-dir * D, 0, ms, ease);
      if (sc && fullOut) sc.children[0].style.visibility = "hidden";   // an app over it: no wallpaper to see
      if (sc && fullIn) sc.children[1].style.visibility = "hidden"; }
    swiping = true;
    const keep = new Set((sp.keep || []).map(String));                // the window that moves along: not left behind
    const leaving = [...document.querySelectorAll(SWIPE_ITEMS)].filter(el => !keep.has(el.dataset.ftFloat || el.dataset.ftFor || ""));
    if (mission) mission.frozen = new Set(mission.slots ? mission.slots.keys() : []);   // the new desktop's windows come in at full size
    b.setAttribute("data-vos-swipe", side);
    b.setAttribute("data-vos-swipe-in", side);
    b.toggleAttribute("data-vos-lp-ghost", !!(sp.incoming || []).some(el => el.classList?.contains("vos-lp-ghost")));                        // set first: a new window never shows before it slides in
    // the leaving windows stay visible while they slide out, even once they belong to another desktop
    leaving.forEach(el => { el.setAttribute("data-ft-swipe-out", ""); el.setAttribute("data-ft-ws-leave", ""); });
    for (const el of sp.incoming || []) {                            // already on their way in (the fingers): they finish from there
      const from = el.style.getPropertyValue("translate") || "0px 0px";
      el.animate([{ translate: from }, { translate: "0px 0px" }], { duration: ms, easing: ease, fill: "forwards" })
        .finished.catch(() => {}).then(() => {
          el.style.removeProperty("translate"); el.getAnimations().forEach(a => a.cancel());
          el.removeAttribute("data-ft-ws-leave");                     // its "incoming" mark stays until the swipe is over:
        });                                                          // without it, the slide-in would play a second time
    }
    const t1 = Date.now();
    let shownAt = 0;
    try {
      if (holdSwitch) await new Promise(r => setTimeout(r, ms));      // the split has slid out (it would vanish on the switch)
      const made = await Promise.race([sp.go ? sp.go() : switchWs(sp, list), new Promise(r => setTimeout(r, 2000))]);   // at once: both desktops move together (never stuck half-way)
      if (sp.id == null && made != null) sp.id = made;                // a desktop made just now
      while (Date.now() - t1 < 1500) { wsNowAt = 0; if (sameWs(curWs(), sp.id)) break; await new Promise(r => setTimeout(r, 20)); }
      render(); shownAt = holdSwitch ? Date.now() - ms : Date.now();  // the new desktop's other windows slide in from now (already in, after a split)
      await new Promise(r => setTimeout(r, Math.max(0, ms - (Date.now() - t1))));
    } catch (e) { wsErr("swipe", e); }
    finally {                                                        // whatever happened: nothing stays half-done
      missionMode(null, true);                                        // Mission Control ends with the old desktop out of sight
      const lpOut = leaving.filter(el => el.classList.contains("lp-layer"));   // the Launchpad stays slid out until it is put aside
      leaving.forEach(el => { if (lpOut.includes(el)) return; el.removeAttribute("data-ft-swipe-out"); el.removeAttribute("data-ft-ws-leave"); el.style.removeProperty("translate"); });
      setTimeout(() => {                                             // once the last window has slid in
        for (const [el, a] of fullAnims) { el.removeAttribute("data-vos-swo"); el.removeAttribute("data-vos-swi"); a.cancel(); if (el.__vosPlaced) { el.__vosPlaced = false; if (!floating.has(el.dataset.id)) unplace(el); } }
        for (const el of sp.incoming || []) { if (el.classList?.contains("vos-lp-ghost")) el.remove(); else el.removeAttribute("data-vos-incoming"); }
        if (gen === swipeGen) { b.removeAttribute("data-vos-swipe"); b.removeAttribute("data-vos-lp-ghost"); }   // (the Launchpad is put aside first, then shown again if wanted)
        lpOut.forEach(el => { el.removeAttribute("data-ft-swipe-out"); el.removeAttribute("data-ft-ws-leave"); el.style.removeProperty("translate"); });
        if (gen !== swipeGen) return;                                // a newer swipe owns the rest
        b.removeAttribute("data-vos-swipe-in"); b.removeAttribute("data-vos-swipe"); swiping = false; sceneEnd(); deskDots(true);
        if (sp.id != null) arrive(sp.id);
      }, Math.max(0, (shownAt || Date.now()) + ms - Date.now()) + 40);
    }
  }
  /* (performance) STILL UNDER THE LAUNCHPAD: the open Launchpad blurs everything behind it (44px), so a page moving
     behind it (a video, a spinner, an ad) makes the graphics card blur the whole screen again on every frame. Once it is
     open, each page behind it is photographed and the photo takes its place; the page itself rests (hidden: it draws
     nothing). Under that blur the photo looks the same. Closing, the pages draw again first, then the photos go.
     A page playing sound stays live (its video keeps moving). */
  var frozen = new Map();                           // webview -> its photo   (var: a redraw before this line runs finds it empty, not an error)
  var freezeGen = 0;
  const lpOverlay = () => !!browserEl()?.hasAttribute("data-launchpad");
  /* the same under the focus veil (22px): the windows below it rest, the ones lifted over it stay live */
  const veilOn = () => !!veil && !veil.__leaving && !lpOverlay();
  const blurOver = () => lpOverlay() || veilOn();
  const VEIL_Z = 999;
  const underVeil = pg => { const w = pg.closest("[data-ft-float]"); if (!w) return true; const z = parseInt(w.style.getPropertyValue("z-index"), 10); return !(z >= VEIL_Z); };
  function freezeUnder() {
    const gen = ++freezeGen, cap = vivaldi?.thumbnails?.captureTab, host = stack();
    if (!cap || !host) return;
    const lp = lpOverlay();
    setTimeout(() => {                              // after the Launchpad's (or the veil's) own fade in (the pages still move under it)
      if (gen !== freezeGen || !blurOver()) return;
      const ss = stackRect(), veilNow = !lpOverlay();
      for (const wv of $$("webview", host)) {
        if (frozen.has(wv)) continue;
        const pg = wv.closest(".webpageview[data-id]"), id = pg?.dataset.id, r = wv.getBoundingClientRect();
        if (!id || r.width < 60 || r.height < 60 || getComputedStyle(wv).visibility !== "visible") continue;
        if (veilNow && !underVeil(pg)) continue;                      // lifted over the veil: live
        if (r.right < ss.left || r.left > ss.right || r.bottom < ss.top || r.top > ss.bottom) continue;
        chrome.tabs.get(Number(id), t => {
          void chrome.runtime.lastError;
          if (!t || t.audible || gen !== freezeGen || !blurOver() || frozen.has(wv)) return;
          const k = veilNow ? 2 : 3, W = Math.max(64, Math.round(r.width / k)), H = Math.max(64, Math.round(r.height / k));   // a small photo: under the blur nothing finer shows
          const done = d => {
            void chrome.runtime.lastError;
            const url = typeof d === "string" ? d : d?.image || d?.dataUrl || "";
            if (!url || gen !== freezeGen || !blurOver() || frozen.has(wv) || !wv.isConnected || (!lpOverlay() && !underVeil(pg))) return;
            const now = wv.getBoundingClientRect();
            if (Math.abs(now.left - r.left) > 2 || Math.abs(now.top - r.top) > 2 || Math.abs(now.width - r.width) > 2) return;   // it moved meanwhile: left live
            const c = document.createElement("div"); c.className = "vos-freeze";
            c.style.setProperty("background-image", `url("${url}")`, "important");
            c.style.setProperty("border-radius", getComputedStyle(pg).borderTopLeftRadius, "important");
            const win = pg.closest("[data-ft-float]") || pg, z = getComputedStyle(win).zIndex;
            host.appendChild(c);
            place(c, { x: r.left - ss.left, y: r.top - ss.top, w: r.width, h: r.height }, ss);
            c.style.setProperty("z-index", z && z !== "auto" ? z : "1", "important");
            frozen.set(wv, c);
            requestAnimationFrame(() => { if (frozen.get(wv) === c) wv.setAttribute("data-vos-frozen", ""); });   // the photo is drawn: the page rests
          };
          try { const q = cap.call(vivaldi.thumbnails, Number(id), { encodeFormat: "jpg", encodeQuality: 80, fullPage: false, width: W, height: H }, done); if (q && typeof q.then === "function") q.then(done, () => {}); } catch (e) {}
        });
      }
    }, lp ? 380 : 300);
  }
  /* (each redraw, while the veil is up) a window lifted over the veil is live again at once: its photo goes with it */
  function freezeKeep() {
    if (!frozen?.size || lpOverlay()) return;
    if (!veilOn()) return thawUnder();
    for (const [wv, c] of [...frozen]) {
      const pg = wv.closest(".webpageview[data-id]");
      if (pg && underVeil(pg) && wv.isConnected) continue;
      wv.removeAttribute("data-vos-frozen"); c.remove(); frozen.delete(wv);
    }
  }
  const dropCover = c => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => c.remove()) && setTimeout(() => c.remove(), 2500);
  function thawUnder() {
    freezeGen = (freezeGen || 0) + 1;
    if (!frozen?.size) return;
    const covers = [...frozen.values()];
    for (const wv of frozen.keys()) wv.removeAttribute("data-vos-frozen");   // the pages draw again first (under their photos)
    frozen.clear();
    setTimeout(() => covers.forEach(dropCover), 160);
  }
  const freezeWatch = () => (blurOver() ? freezeUnder() : thawUnder());
  (function watchLp() {
    const b = browserEl(); if (!b) return setTimeout(watchLp, 200);
    new MutationObserver(freezeWatch).observe(b, { attributes: true, attributeFilter: ["data-launchpad"] });
    vosBeat(() => {                                 // (never left behind)
      if (blurOver()) return;
      if (frozen.size) thawUnder();
      for (const w of $$("webview[data-vos-frozen]")) w.removeAttribute("data-vos-frozen");
      setTimeout(() => { if (!blurOver() && !frozen.size) for (const c of $$(".vos-freeze")) c.remove(); }, 400);
    });
  })();
  /* NO BLINK: Vivaldi draws a desktop's splits only once you are on it, and moving their pages into the split leaves
     each page empty for a moment. Leaving a desktop, its split panes are photographed; arriving, each pane holds its
     photo on top until the page has drawn itself again, then the photo fades. */
  const paneShots = new Map();                     // tab -> { url, at }
  const splitPanesOn = ws => [...floating].filter(id => groupFloat.has(id) && !minimized.has(id) && sameWs(wsOfTab.get(String(id)), ws))
    .flatMap(id => { const g = splitOfTab.get(String(id)); return g ? [...splitOfTab].filter(([k, v]) => v === g).map(([k]) => k) : []; });
  function shootPanes(ws) {
    const cap = vivaldi?.thumbnails?.captureTab;
    if (!cap) return;
    for (const pid of splitPanesOn(ws)) {
      const r = pageOf(pid)?.getBoundingClientRect();
      if (!r || r.width < 40) continue;
      const k = Math.min(2, devicePixelRatio || 1), W = Math.round(Math.min(1600, r.width * k)), H = Math.round(W * r.height / r.width);
      try {
        const done = d => { void chrome.runtime.lastError; const url = typeof d === "string" ? d : d?.image || d?.dataUrl || ""; if (url) paneShots.set(pid, { url, at: Date.now() }); };
        const q = cap.call(vivaldi.thumbnails, Number(pid), { encodeFormat: "jpg", encodeQuality: 85, fullPage: false, width: W, height: H }, done);
        if (q && typeof q.then === "function") q.then(done, () => {});
      } catch (e) {}
    }
  }
  function coverPanes(ws) {
    const out = [], host = stack(), ss = stackRect();
    if (!host || (swiping && !sw)) return () => {};                 // (a desktop sliding in as a whole: its panes move - no still photo)
    for (const pid of splitPanesOn(ws)) {
      const pg = pageOf(pid), sh = paneShots.get(pid), r = pg?.getBoundingClientRect();
      if (!pg || !sh || !r || r.width < 20 || Date.now() - sh.at > 10 * 60000) continue;
      const win = pg.closest("[data-ft-float]") || pg, cs = getComputedStyle(pg);
      const c = document.createElement("div"); c.className = "vos-pane-cover"; c.dataset.pid = pid;
      c.style.setProperty("background-image", `url("${sh.url}")`, "important");
      c.style.setProperty("border-radius", cs.borderTopLeftRadius, "important");
      host.appendChild(c);
      place(c, { x: r.left - ss.left, y: r.top - ss.top, w: r.width, h: r.height }, ss);
      c.style.setProperty("z-index", getComputedStyle(win).zIndex || "100", "important");   // just over its window (after it), under the windows in front
      out.push(c);
    }
    // the photos go only once every pane is really drawn in its split (Vivaldi may draw it later - a split alone on its
    // desktop is drawn once it is brought to the front) and has had a moment to paint; never longer than 3 s
    const pids = out.map(c => c.dataset.pid);
    return () => {
      if (!out.length) return;
      const t0 = Date.now();
      let drawnAt = 0;
      const check = () => {
        const drawn = pids.every(pid => isTiled(pageOf(pid)));
        if (drawn && !drawnAt) drawnAt = Date.now();
        if (!drawn) drawnAt = 0;
        if ((drawnAt && Date.now() - drawnAt >= 380) || Date.now() - t0 > 3000) {
          out.forEach(c => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => c.remove()) && setTimeout(() => c.remove(), 2500));
          return;
        }
        setTimeout(check, 60);
      };
      setTimeout(check, 60);
    };
  }
  async function switchWs(sp, list) {
    const was = curWs();
    shootPanes(was);                                                 // (the desktop left: its split panes, as they are)
    const uncover = sp.id != null ? coverPanes(sp.id) : null;       // (the one coming: its split panes held by their photos)
    try { return await switchWsNow(sp, list); } finally { uncover?.(); }
  }
  async function switchWsNow(sp, list) {
    const was = curWs();
    if (sp.id != null) {
      const tabs = await tabsQuery({ currentWindow: true });
    }
    const fresh = await prefGet("vivaldi.workspaces.list");
    if (Array.isArray(fresh) && fresh.some(w => sameWs(w.id, sp.id))) list = fresh;   // the order as it is now
    const api = vivWs();
    if (api) {                                                      // Vivaldi's own switch
      try {
        const i = sp.id == null ? undefined : (list || []).findIndex(w => String(w.id) === String(sp.id));
        if (sp.id == null || i >= 0) { api.activateWorkspaceByIndex(await winId(), i); return; }
      } catch (e) { LOG("workspaces: switch failed", e); }
    }
    if (!openVivaldiWs(true)) return wsByTab(sp);
    const t0 = Date.now();
    const look = () => {
      const pop = document.querySelector(".WorkspacePopup");
      const item = !pop ? null : sp.id == null ? pop.querySelector("button.this-window")
        : [...pop.querySelectorAll("button.workspace-item-wrapper")].find(b => (b.getAttribute("title") || "").trim().startsWith(sp.name));
      if (item) {
        item.click();
        setTimeout(() => {
          document.documentElement.removeAttribute("data-vos-ws-silent");
          if (document.querySelector(".WorkspacePopup")) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          wsNowAt = 0;
          if (String(curWs()) !== String(sp.id)) wsByTab(sp);      // not switched: show one of its tabs instead
        }, 500);
        return;
      }
      if (Date.now() - t0 < 900) return setTimeout(look, 30);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.documentElement.removeAttribute("data-vos-ws-silent");
      wsByTab(sp);                                                  // fallback: show one of its tabs
    };
    look();
  }
  try {
    Object.defineProperty(window, "__vosQA", { configurable: true, value: {
      curWs, toDesk, newDesk, switchWs, swipeTo, openWsStrip, closeWsStrip, desksNow, wsOfTab, wsPending, floating, minimized,
      pageOf, targetOf, awayWs, vivWs, prefGet, tabsQuery, render, get zOrder() { return zOrder; },
      vivWsStore, vivActiveWs, emptySwitch, swipeDesk, holdAct, pip, pipCorner, pipH, focusSet, toggleFocus, get sw() { return sw; }, toNewDeskNow, toOtherWindow, dropBlanks,
      get wsStrip() { return wsStrip; }, get mission() { return mission; }, get swiping() { return swiping; },
      splitInto, splitTargetAt, vivTile, swStart, swMove, get mcMax() { return mcMax; }, get cover() { return cover; }, get bentoOn() { return !!bento.on; }, get underId() { return underId; }, deskFronts, fullOf, splitPreview, groupFloat, splitOfTab, tileMeta, vSplit, act, get perf() { return perf; }, paneShots, splitPanesOn, shootPanes, waCode: () => WA_CODE, owaCode: () => OWA_CODE,
    } });
  } catch (e) {}
  async function wsByTab(sp) {
    const tabs = await tabsQuery({ currentWindow: true });
    const t = (tabs || []).filter(x => { const k = String(x.id); return wsOfTab.has(k) && String(wsOfTab.get(k)) === String(sp.id); })
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (t) chrome.tabs.update(t.id, { active: true }, () => void chrome.runtime.lastError);
  }
  // (Vivaldi's Workspaces button is its own again: the Desktops widget is separate)
  if (false) for (const type of ["pointerdown", "mousedown", "click"]) {
    addEventListener(type, ev => {
      if (wsPass || ev.button !== 0 || document.querySelector("#browser.toolbar-edit-mode")) return;   // the toolbar editor: Vivaldi's, to drag
      const b = ev.target?.closest?.(WS_BTN);
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      if (type === "pointerdown") openWsStrip();
    }, true);
  }

  /* the tab id of a click in the tab bar. Vivaldi puts id="tab-<id>" on an
     element of the tab (not always the one with class .tab), so look for the
     id itself, walking up, or inside the clicked tab's slot. */
  function tabIdAt(t) {
    for (let n = t; n && n.nodeType === 1; n = n.parentElement) {
      const m = /^tab-(\d+)$/.exec(n.id || "");
      if (m) return m[1];
      if (n.classList.contains("tab-position")) {
        return /^tab-(\d+)$/.exec($('[id^="tab-"]', n)?.id || "")?.[1] ?? null;
      }
      if (n.id === "tabs-container" || n.id === "browser") return null;
    }
    return null;
  }

  /* ---------------- touch ----------------
     #browser gets data-ft-touch while the last input was a finger or pen:
     the CSS then makes buttons, edges and the title bar bigger.
     Controls that only appear on hover (a page's corner lights, the buttons
     of a hidden title bar) appear on the FIRST tap; the second tap acts. */
  let lastPointer = "mouse";
  const isTouch = () => lastPointer === "touch" || lastPointer === "pen";
  function hiddenControls(btn) {
    const box = btn.closest(".ft-lights, .ft-right");
    if (!box) return null;
    if (box.parentElement?.classList.contains("webpageview")) return box;          // page corner
    if (box.closest(".ft-titlebar") && box.closest("[data-ft-notitle]")) return box; // hidden title bar
    return null;
  }
  let shownTimer = 0;
  function hideShown(keep = []) {
    $$("[data-ft-shown]").forEach(b => { if (!keep.includes(b)) b.removeAttribute("data-ft-shown"); });
  }
  function reveal(box) {
    const bar = box.closest(".ft-titlebar");                        // a hidden title bar: both groups
    const boxes = bar ? $$(":scope > .ft-lights, :scope > .ft-right", bar) : [box];
    hideShown(boxes);
    boxes.forEach(b => b.setAttribute("data-ft-shown", ""));
    clearTimeout(shownTimer);
    shownTimer = setTimeout(() => hideShown(), 4000);
  }
  // double tap on a title bar = double-click (back to its place)
  let tapDown = null, lastTap = null;
  function onPointerUp(e) {
    if (lpOn()) { tapDown = null; return; }
    if (!tapDown || e.pointerId !== tapDown.id) return;
    const d = tapDown; tapDown = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && e.timeStamp - d.t < 300) {
      lastTap = { bar: d.bar, x: e.clientX, y: e.clientY, t: e.timeStamp };
    }
  }

  /* Vivaldi's own dividers (between split tiles, the panel edge) only listen
     to the mouse, and a finger sends no mouse moves while dragging: replay a
     finger drag on them as mouse events. */
  function bridgeDivider(e, bar) {
    e.preventDefault();
    const pid = e.pointerId;
    const fire = (type, ev) => bar.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY,
      button: 0, buttons: type === "mouseup" ? 0 : 1,
    }));
    bar.setAttribute("data-ft-dragging", "");
    fire("mousedown", e);
    const move = ev => { if (ev.pointerId === pid) { ev.preventDefault(); fire("mousemove", ev); } };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      fire("mouseup", ev);
      bar.removeAttribute("data-ft-dragging");
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", up, true);
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
  }

  /* double-click on a title bar / the grab strip = focus mode. Detected here
     from two presses, because the first press starts a move whose shield
     takes the second click: the browser's own dblclick never reaches the bar. */
  let lastPress = null;
  function doublePress(e, key) {
    const lp = lastPress;
    lastPress = { key, x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (!lp || lp.key !== key || e.timeStamp - lp.t > 450 || Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) return false;
    lastPress = null;
    e.preventDefault(); e.stopPropagation();
    const w = winOf(key);
    if (w && pip.includes(w)) { holdAct("minimize", w); return true; }   // held small: back as it was
    toggleFocus(key);
    return true;
  }

  const lpOn = () => !!window.vosLaunchpad?.isOpen;   // js/launchpad.js: the windows are not touchable under it
  function onPointerDown(e) {
    if (lpOn()) return;
    clearTimeout(hoverTimer); hoverTimer = 0;                       // a click wins over a pending hover
    drag = null;                                                    // any old drag is over
    lastPointer = e.pointerType || "mouse";
    browserEl()?.toggleAttribute("data-ft-touch", isTouch());
    if (e.button !== 0 || !e.isPrimary) return;
    const t = e.target;
    if (!t.closest?.("[data-ft-shown]")) hideShown();               // tapping elsewhere hides them again
    const divider = isTouch() && t.closest?.("#webpage-stack .SlideBar, #panels-container .SlideBar");
    if (divider) return bridgeDivider(e, divider);
    const tabId = tabIdAt(t);                                       // a click on a tab in the tab bar
    if (tabId) {
      if (focusSet.size) {                                          // focus mode: the tab joins / leaves it
        if (focusTab(tabId)) { e.preventDefault(); e.stopPropagation(); swallowTab = Date.now(); return; }
        endFocus();
      }
      { const ap0 = activePage(), dk = !!browserEl()?.hasAttribute("data-ft-desktop");
        tabDown = { id: tabId, desktop: dk, active: ap0?.dataset.id, full: !dk && !!ap0 && !isStart(ap0) && !winOf(ap0.dataset.id), t: Date.now() }; }   // full: a full-screen app (or split) in front
      confirmTint(tabId);
      // a minimized window comes back — also when its tab is already active
      // (a single tab), where Vivaldi reports no tab switch
      const w = winOf(tabId);
      if (w && minimized.has(w)) {
        restoreGuard = { id: String(tabId), w, until: Date.now() + 900 };   // (Vivaldi's own click on the active tab may switch to the tab before it)
        setTimeout(() => restore(w), 0);
      }
      return;
    }
    if (t.closest?.(".ft-max-grab")) return startMaxDrag(e);        // a full-screen page: drag it out
    { const cb = t.closest?.("[data-ft-float] > .ft-titlebar .ft-lights, [data-ft-float] > .ft-titlebar .ft-right, .webpageview > .ft-lights, .tiled[data-ft-float] .webpageview > .ft-inner");   // the window buttons: dragged out of the window, they are put away
      if (cb && !mission) return ctrlDrag(e, cb); }                    // (from a button, or the gaps between them)
    if (t.closest?.(".ft-lights, .ft-right, .ft-inner")) return;
    { const ph = t.closest?.(".vos-pip-hdiv");                      // the line between two held windows: both
      if (ph) { e.preventDefault(); e.stopPropagation(); return pipRowResize(e, ph.dataset.a, ph.dataset.b, Number(ph.dataset.k) || 1); } }
    const bd = t.closest?.(".bento-divider");                       // Bento: a gap between windows
    if (bd && (bento.on || roomActive()) && bd.classList.contains("vos-pip-divider")) { e.preventDefault(); e.stopPropagation(); return pipColumnResize(e, bd.dataset.side); }
    if (bd && bento.on) {
      e.preventDefault(); e.stopPropagation();
      const ss = stackRect(), hit = bHit(bento.handles, { x: e.clientX - ss.left, y: e.clientY - ss.top });
      return hit && bentoResize(e, [hit.d], hit.d.axis === "h" ? "ew-resize" : "ns-resize", hit.root);
    }
    if (t.closest?.(".ft-veil") && focusSet.size) {                 // a click outside the windows in focus: focus ends - nothing else
      e.preventDefault(); e.stopPropagation();
      // the rest of that click (its release) would land on the window under the fading veil and bring it up: swallowed
      const eat = ev => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
      const types = ["pointerup", "mouseup", "click", "dblclick", "auxclick"];
      const off = () => { for (const ty of types) removeEventListener(ty, eat, true); };
      addEventListener("pointerup", () => setTimeout(off, 0), { capture: true, once: true });   // (first: it still hears the release)
      for (const ty of types) addEventListener(ty, eat, true);
      setTimeout(off, 1500);                                         // (never left on)
      return endFocus();
    }
    const grab = t.closest?.(".ft-frame > .ft-grab");                // outside grab strip: moves the window
    if (grab) {
      if (doublePress(e, grab.parentElement.dataset.ftFor)) return;
      const w = targetOf(pageOf(grab.parentElement.dataset.ftFor));
      if (w?.hasAttribute("data-ft-float")) return startGesture(e, w, "move");
      return;
    }
    const handle = t.closest?.(".ft-frame > .ft-resize");
    if (handle) {
      const w = targetOf(pageOf(handle.parentElement.dataset.ftFor));
      if (w?.hasAttribute("data-ft-float")) return startGesture(e, w, handle.dataset.edge);
      return;
    }
    const bar = t.closest?.(".ft-titlebar") || t.closest?.(".mosaic-tile");
    const el = bar?.closest("[data-ft-float]");
    if (!el && bar?.classList.contains("mosaic-tile") && !lpOn() && !tbEditing()) {   // a split shown full screen: its panes drag like a window's
      const pg = bar.closest(".webpageview[data-id]"), root = pg && isTiled(pg) ? rootOf(pg) : null;
      if (root) return tileGesture(e, bar, root);
    }
    if (!el) return;
    if (bar.classList.contains("mosaic-tile") && isSplitWindow(el)) return tileGesture(e, bar, el);   // a tile: its icon goes with the pointer
    if (bar.classList.contains("ft-titlebar") && pageOf(bar.dataset.ftPage) && doublePress(e, bar.dataset.ftPage)) return;
    startGesture(e, el, "move");
  }

  /* A FLOATING SPLIT'S TILE, grabbed by its grabber: only its app icon follows the pointer (as in the
     Launchpad and Mission Control); the window is not taken out until you let go -
       on the desktop: it leaves the split and opens there as its own window
       on another window: the half it would take shows; let go - it joins that window on that side
       on its own window, or nothing moved: nothing happens */
  /* the app's icon as the tab bar shows it (already loaded there); else the tab's own icon */
  /* 1.0.307: ONE ICON: a pinned app's circle and a window's circle are its tab's circle - the very picture the tab shows, on
     the very colour it has (its tile, its tint, its plate, its look) - copied from the tab, and kept so */
  function mirrorTab(el, im, tid) {
    const w = document.getElementById("tab-" + tid), tab = w && (w.classList.contains("tab") ? w : (w.querySelector(".tab") || w.closest(".tab"))); if (!tab || !el) return;   // (the circle itself, not its wrapper)
    const bg = getComputedStyle(tab).backgroundColor, clear = /rgba\(0, 0, 0, 0\)|transparent/.test(bg);
    if (el.__vosBg !== bg) { el.__vosBg = bg; if (clear) el.style.removeProperty("background"); else el.style.setProperty("background", bg, "important"); }
    const src = tabIcon(tid); if (im && src && im.getAttribute("src") !== src) im.src = src;
    const dim = tab.hasAttribute("data-vos-dim"); if (el.hasAttribute("data-vos-dim") !== dim) el.toggleAttribute("data-vos-dim", dim);   // (1.0.316: its icon brightened as the tab's)
  }
  /* 1.0.346: JOINED APPS (a split): each icon on its own app's circle - its colour, tint and look, as in its tab - and the
     pill they share light or dark by most of them (a tie: as it was) - in the tab bar, a window's buttons, full screen's
     buttons, a pinned split's circle */
  function tabCircle(tid) { const w = document.getElementById("tab-" + tid); return w && (w.classList.contains("tab") ? w : (w.querySelector(".tab") || w.closest(".tab"))); }
  function circleOf(id) {                                              // 1.0.347: an app's circle colour - its tab's, or (no tint: see-through) its look's
    const t = tabCircle(id); let bg = t ? getComputedStyle(t).backgroundColor : "";
    const m = (bg.match(/[\d.]+/g) || []).map(Number);
    if (!t || m.length < 3 || (m.length > 3 && m[3] < 0.5)) {
      const look = lookWins.get(String(id)) || (browserEl()?.classList.contains("theme-dark") ? "dark" : "light");
      return { bg: look === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)", L: look === "light" ? 1 : 0, own: false };
    }
    return { bg, L: (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255, own: true };
  }
  function circleLum(t) { const m = (getComputedStyle(t).backgroundColor.match(/[\d.]+/g) || []).map(Number); return m.length < 3 || (m.length > 3 && m[3] < 0.5) ? null : (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }
  function pillToneOf(ids, front) {                                    // most of its apps; a tie: the app in front
    let l = 0, d = 0;
    for (const id of ids || []) { if (circleOf(id).L > 0.5) l++; else d++; }
    if (l !== d) return l > d ? "light" : "dark";
    const f = front && ids.includes(String(front)) ? front : ids?.[0];
    return f == null ? "" : circleOf(f).L > 0.5 ? "light" : "dark";
  }
  function pillSetTone(el, tone) { if ((el.getAttribute("data-vos-pill-tone") || "") !== tone) { if (tone) el.setAttribute("data-vos-pill-tone", tone); else el.removeAttribute("data-vos-pill-tone"); } }
  function skinMulti(ic, ids, front) {
    if (!ic || !ids?.length) return;
    const imgs = [...ic.querySelectorAll(":scope > img")];
    ids.forEach((id, i) => {
      const im = imgs[i], t = tabCircle(id); if (!im) return;
      const bg = circleOf(id).bg;                                         // (1.0.347: no tint - its look's circle)
      if (im.__vosBg !== bg) { im.__vosBg = bg; im.style.setProperty("background-color", bg, "important"); }
      const dim = !!t?.hasAttribute("data-vos-dim"); if (im.hasAttribute("data-vos-dim") !== dim) im.toggleAttribute("data-vos-dim", dim);
    });
    pillSetTone(ic, pillToneOf(ids, front));
  }
  function tabPillTones() {
    let grp = [];
    const flush = () => { if (!grp.length) return;
      const ids = grp.map(tp => (tp.querySelector(".tab-wrapper[id^='tab-']")?.id || "").slice(4));
      const act = grp.find(tp => tp.querySelector(".tab.active")), w = winOf(ids[0]);
      const front = act ? ids[grp.indexOf(act)] : (w && splitFocus.get(w)) || null;
      const tone = pillToneOf(ids, front); grp.forEach(tp => pillSetTone(tp, tone)); grp = []; };
    for (const tp of document.querySelectorAll("#tabs-container .tab-position[data-ft-pill]")) { grp.push(tp); if (tp.dataset.ftPill === "last") flush(); }
    flush();
  }
  const circlesSync = () => {                                        // (the tab's circle changes - a tint read, a look switched: they follow)
    tabPillTones();
    for (const [w, b] of pinBadges) if (b.hasAttribute("data-multi")) skinMulti(b, b.__vosIds, splitFocus.get(w));
    if (wctl?.hasAttribute("data-on")) { const ic = wctl.querySelector(".vos-wctl-ic[data-multi]"); if (ic) skinMulti(ic, ic.__vosIds, splitFocus.get(wctlFor)); }
    if (fsctl?.hasAttribute("data-on")) { const ic = fsctl.querySelector(".vos-wctl-ic[data-multi]"); if (ic) skinMulti(ic, ic.__vosIds, fsctl.dataset.ftPage); }
    for (const [id, b] of pinBadges) { if (b.hasAttribute("data-multi")) continue; const t = groupFloat.has(id) ? (splitFocus.get(id) || id) : id; mirrorTab(b, b.querySelector(":scope > img"), t); }
    if (wctl && wctlFor && wctl.hasAttribute("data-on") && !wctl.querySelector(".vos-wctl-ic[data-multi]")) { const t = groupFloat.has(wctlFor) ? (splitFocus.get(wctlFor) || wctlFor) : wctlFor; mirrorTab(wctl.querySelector(".vos-wctl-ic"), wctl.querySelector(".vos-wctl-ic img"), t); }
  };
  /* 1.0.320: A PAGE FULL SCREEN (no Bento, no pinned apps over it - the page alone): its window buttons, with its app's
     circle, sit in the toolbar right after the Desktops button - the same component as a window's, side by side */
  let fsctl = null;
  function fsCtlSync() {
    const pg = activePage(), id = pg?.dataset.id;
    const mem = pg && isTiled(pg) ? membersOf(pg) : [];             // 1.0.339: a split full screen too (none of its apps a window)
    const full = !!pg && !!id && !isStart(pg) && !mission && !lpOn() &&
      (mem.length ? mem.every(m => !floating.has(m) && !winOf(m)) : (!floating.has(id) && !isTiled(pg) && !winOf(id)));
    const desk = document.querySelector("#browser .vos-chain-vosmission");
    if (!full || !desk) {                                            // 1.0.321: going as the hover ones go - its entrance backwards
      if (fsctl?.hasAttribute("data-on")) { const f = fsctl; f.removeAttribute("data-on"); f.setAttribute("data-out", ""); clearTimeout(f.__outT); f.__outT = setTimeout(() => f.removeAttribute("data-out"), 380); }
      return; }
    if (!fsctl || !fsctl.isConnected) {
      fsctl = document.createElement("div"); fsctl.className = "vos-fsctl ft-titlebar";
      fsctl.innerHTML = `<span class="vos-wctl-ic"><img alt=""></span><div class="vos-pin-ctl" data-dir="h">` +
        [["red", "close", "Close"], ["yellow", "minimize", "Exit full screen"], ["green", "zoom", "Exit full screen"], ["gray", "res", "Light / dark - hold: page size"]].map(([c, a, t]) => `<button class="vos-pc vos-pc-${c} ft-light" data-act="${a}" title="${t}"></button>`).join("") + `</div>`;
    }
    if (fsctl.previousElementSibling !== desk) desk.after(fsctl);
    { const lk = lookWins.get(id) || ""; if ((fsctl.getAttribute("data-vos-look") || "") !== lk) { if (lk) fsctl.setAttribute("data-vos-look", lk); else fsctl.removeAttribute("data-vos-look"); } }   // 1.0.340
    const key = mem.length > 1 ? "split:" + [...mem].sort().join(",") : id;   // (another app of the same split in front: the same buttons, not again)
    fsctl.dataset.ftPage = id;
    if (fsctl.dataset.ftKey !== key) { fsctl.dataset.ftKey = key; fsctl.removeAttribute("data-on"); }
    const ic = fsctl.querySelector(".vos-wctl-ic"), multi = mem.length > 1;
    { const imgs = () => [...ic.querySelectorAll(":scope > img")], want = multi ? mem.length : 1;   // (a split: its apps' icons side by side in one pill)
      while (imgs().length < want) { const x = document.createElement("img"); x.alt = ""; ic.appendChild(x); }
      while (imgs().length > want) imgs().pop().remove();
      if (ic.hasAttribute("data-multi") !== multi) ic.toggleAttribute("data-multi", multi);
      if (fsctl.hasAttribute("data-split") !== multi) fsctl.toggleAttribute("data-split", multi);
      if (multi) {
        mem.forEach((m, i) => { let v = tabIcon(m); if (!v) { const u = pageOf(m)?.querySelector("webview")?.getAttribute("src") || ""; if (/^https?:/.test(u)) try { v = favicon(u); } catch (e) {} }
          const x = imgs()[i]; if (v && x.getAttribute("src") !== v) x.src = v; x.style.visibility = v ? "" : "hidden"; });
        for (const a of ["data-plate", "data-tint", "data-vos-dim", "data-empty"]) ic.removeAttribute(a);
        for (const v of ["--vos-tint", "--vos-tint-d", "--vos-tint-l"]) ic.style.removeProperty(v);
        ic.__vosIds = mem; skinMulti(ic, mem, id);
      } else { imgs()[0].style.visibility = ""; mirrorTab(ic, imgs()[0], id); } }
    if (!fsctl.hasAttribute("data-on")) { clearTimeout(fsctl.__outT); fsctl.removeAttribute("data-out"); void fsctl.offsetWidth; fsctl.setAttribute("data-on", ""); }
  }
  const hintSync = () => {                                           // 1.0.328: the address field's hint without the search engine's name
    for (const i of document.querySelectorAll("#browser .UrlBar-AddressField input[placeholder]")) {
      const ph = i.getAttribute("placeholder"), clean = ph.replace(/^(\S+)\s+.+?\s+(or\s+.+)$/i, "$1 $2");
      if (/google|bing|duckduckgo|ecosia|startpage|yahoo|qwant|brave|kagi|yandex|baidu/i.test(ph) && clean !== ph) i.setAttribute("placeholder", clean);
    }
  };
  setInterval(() => { if (document.hidden) return; circlesSync(); fsCtlSync(); hintSync(); }, 450);   // 1.0.332: one light beat for the three (none while not seen)
  function tabIcon(id) {
    const alt = document.getElementById("tab-" + id)?.closest(".tab-position")?.dataset.vosFavUrl; if (alt) return alt;   // 1.0.305: its icon's own version for its window's look
    const tab = document.getElementById("tab-" + id), im = tab?.querySelector("img");
    const src = im?.currentSrc || im?.src || "";
    if (src || !tab) return src;
    /* 1.0.344: Vivaldi's own pages (Settings, Downloads...) draw their tab icon as a drawing, not a picture: that drawing,
       in the colour it shows in */
    const svg = tab.querySelector(".favicon svg, .site-icon svg, svg"); if (!svg) return "";
    const ink = getComputedStyle(svg).color || "#888", key = svg.outerHTML.length + "|" + ink;
    if (svg.__vosIc?.key === key) return svg.__vosIc.url;
    try {
      const c = svg.cloneNode(true);
      if (!c.getAttribute("xmlns")) c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (!c.getAttribute("viewBox")) { const w = svg.getAttribute("width") || 16, h = svg.getAttribute("height") || 16; c.setAttribute("viewBox", `0 0 ${w} ${h}`); }
      c.setAttribute("width", "16"); c.setAttribute("height", "16"); c.setAttribute("color", ink); c.style.color = ink;
      const url = "data:image/svg+xml," + encodeURIComponent(new XMLSerializer().serializeToString(c).replace(/currentColor/g, ink));
      svg.__vosIc = { key, url }; return url;
    } catch (e) { return ""; }
  }
  function tileGesture(e, strip, win) {
    const page = strip.closest(".webpageview[data-id]"), id = page?.dataset.id;
    if (!id || e.button !== 0) return;
    e.stopPropagation();                                             // Vivaldi's own tile drag never starts (it took the tile out early)
    const src = win.dataset.ftFloat || null, full = !src, pid = e.pointerId, sx = e.clientX, sy = e.clientY;   // full: a split shown full screen
    const ownOf = () => full ? (rootOf(pageOf(id)) || win) : targetOf(pageOf(src));
    const icon = document.createElement("img"); icon.alt = ""; icon.decoding = "sync";   // loaded now, while the button is down
    icon.src = tabIcon(id) || favicon(page.querySelector("webview")?.getAttribute("src") || "");
    chrome.tabs.get(Number(id), t => { void chrome.runtime.lastError; if (!tabIcon(id) && t) icon.src = t.favIconUrl || favicon(t.url || t.pendingUrl || ""); });
    let ghost = null, tgt = null, side = null, pane = null, tgtPane = null;
    const paneAt = (el, x, y) => (el ? $$(".webpageview[data-id]", el) : []).find(p => p.dataset.id !== id && inRect(x, y, p.getBoundingClientRect())) || null;
    const move = ev => {
      if (ev.pointerId !== pid) return;
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        ghost = document.createElement("div"); ghost.className = "vos-mc-icon vos-tile-ghost";
        ghost.appendChild(icon);
        (browserEl() || document.body).appendChild(ghost);
        page.setAttribute("data-vos-tile-lift", "");
        browserEl()?.setAttribute("data-vos-tiledrag", "");          // no page takes the pointer while a pane is held (it would stop at the first one)
        try { strip.setPointerCapture(pid); } catch (e) {}
        ghost.animate([{ scale: "0.5", opacity: 0 }, { scale: "1", opacity: 1 }], { duration: 160, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
      }
      ev.preventDefault();
      ghost.style.translate = `${Math.round(ev.clientX - 22)}px ${Math.round(ev.clientY - 22)}px`;
      const ownEl = ownOf();
      if (full || inRect(ev.clientX, ev.clientY, ownEl?.getBoundingClientRect())) {   // inside its own window: onto another pane of it - the split re-arranged
        tgt = null;
        pane = paneAt(ownEl, ev.clientX, ev.clientY);
        side = pane ? splitPreview(src || pane.dataset.id, ev.clientX, ev.clientY, null, ownEl, pane.getBoundingClientRect()) : (splitPreview(null), null);
        return;
      }
      pane = null;
      const t = splitTargetAt(src, ev.clientX, ev.clientY);
      tgt = t ? t.w : null; tgtPane = t?.pane || null;
      side = tgt ? splitPreview(tgt, ev.clientX, ev.clientY, null, targetOf(pageOf(tgt)), tgtPane ? pageOf(tgtPane)?.getBoundingClientRect() : null) : (splitPreview(null), null);
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true);
      if (!ghost) { if (ev.type === "pointerup") { activate(id); render(); } return; }   // a click: that tile
      const g = ghost; ghost = null;
      browserEl()?.removeAttribute("data-vos-tiledrag");
      try { strip.releasePointerCapture(pid); } catch (e) {}
      splitPreview(null);
      page.removeAttribute("data-vos-tile-lift");
      g.animate([{ scale: "1", opacity: 1 }, { scale: "0.6", opacity: 0 }], { duration: 140, easing: "ease-in", fill: "forwards" }).finished.catch(() => {}).then(() => g.remove()) && setTimeout(() => g.remove(), 2500);
      setTimeout(() => g.remove(), 400);
      if (ev.type !== "pointerup") return;
      const x = ev.clientX, y = ev.clientY;
      const own = ownOf()?.getBoundingClientRect();
      if (pane && side) { rearrange(src || id, id, pane.dataset.id, side, full); return; }   // within its window: on that side of that pane
      if (full) return;                                              // a full-screen split: nothing else
      if (tgt && side) {                                            // onto another window: it joins it on that side
        tileToDesktop({ id, src }, x, y);
        const t1 = Date.now(), to = tgt, sd = side, tp = tgtPane;
        const wait = async () => {                                   // out of its split and a window of its own first, then into the other
          if (isTiled(pageOf(id)) || !floating.has(id)) { if (Date.now() - t1 < 3000) setTimeout(wait, 60); return; }
          await new Promise(r => setTimeout(r, 150));
          for (let k = 0; k < 4; k++) { if (await splitInto(id, to, sd, tp)) return; await new Promise(r => setTimeout(r, 300)); if (isTiled(pageOf(id))) return; }
        };
        setTimeout(wait, 120);
        return;
      }
      if (inRect(x, y, own) || !inRect(x, y, stackRect())) return;  // its own window, or outside: nothing
      tileToDesktop({ id, src }, x, y);                              // the desktop: its own window, there
      const f = frac[id];                                            // wholly on the screen
      if (f) { f.x = Math.max(0.01, Math.min(0.99 - f.w, f.x)); f.y = Math.max(0.01, Math.min(0.99 - f.h, f.y)); }
    };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }
  /* WHATSAPP WEB: its chat list can be put away - a button at the start of the chat's header hides / shows it, the chat
     then takes the whole width; in a narrow window it is away by itself (while a chat is open), until you show it */
  const WA_CODE = `(() => {
    if (window.__vosWa) { window.__vosWa(); return "again"; }
    /* three levels, the button steps through them: 0 all, 1 the chats as their pictures only (every other left panel away),
       2 only the chat. Kept for a narrow and a wide window apart; narrow starts at 2, wide at 0. */
    const NARROW = 900, mem = {};
    const get = k => { try { return localStorage.getItem(k); } catch (e) { return mem[k] ?? null; } };
    const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } };
    const key = () => innerWidth < NARROW ? "vosWaLevel:narrow" : "vosWaLevel:wide";
    const level = () => { const raw = get(key()), v = raw == null || raw === "" ? NaN : Number(raw); return v === 0 || v === 1 || v === 2 ? v : innerWidth < NARROW ? 2 : 0; };
    const st = document.createElement("style"); st.id = "vos-wa";
    st.textContent = [
      "[data-vos-wa-off]{display:none!important}",
      "[data-vos-wa-wide]{flex:1 1 auto!important;max-width:none!important;width:auto!important;min-width:0!important;border-left:0!important;box-shadow:none!important}",
      "[data-vos-wa-fit]{min-width:0!important;max-width:100%!important;width:100%!important}",
      "[data-vos-wa-thin]{flex:0 0 var(--vos-wa-w,76px)!important;width:var(--vos-wa-w,76px)!important;min-width:var(--vos-wa-w,76px)!important;max-width:var(--vos-wa-w,76px)!important;overflow:hidden!important;box-sizing:border-box!important;border-right:1px solid var(--border-stronger,rgba(134,150,160,.24))!important}",
      "[data-vos-wa-thin] [role=grid] *,[data-vos-wa-thin] [role=listbox] *{visibility:hidden!important}",
      "[data-vos-wa-thin] [data-vos-wa-av],[data-vos-wa-thin] [data-vos-wa-av] *{visibility:visible!important}",
      "[data-vos-wa-thin] [data-vos-wa-sel]{visibility:visible!important}",
      "[data-vos-wa-thin] [data-vos-wa-sel]::before{content:'';position:absolute;top:4px;bottom:4px;left:6px;right:7px;border-radius:14px;background:var(--background-default-active,rgba(134,150,160,.22));visibility:visible;pointer-events:none;z-index:0}",
      "[data-vos-wa-thin] [data-vos-wa-sel] [data-vos-wa-av]{position:relative;z-index:1}",
      "[data-vos-wa-thin] header{display:none!important}",
      "#vos-wa-btn{flex:none;width:34px;height:34px;margin:0 6px 0 2px;border:0;border-radius:50%;background:transparent;color:inherit;opacity:.75;display:grid;place-items:center;cursor:pointer;position:relative;z-index:5}",
      "#vos-wa-btn:hover{opacity:1;background:rgba(127,127,127,.18)}",
      "#vos-wa-btn svg{width:20px;height:20px}",
      "#vos-wa-btn.vos-wa-float{position:absolute;top:12px;left:12px;margin:0;z-index:50}",
      "[data-vos-wa-host]{position:relative!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
    const ICONS = [
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M10 4.5v15"/></svg>',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 4.5v15"/><circle cx="5.6" cy="9" r=".6" fill="currentColor"/><circle cx="5.6" cy="12" r=".6" fill="currentColor"/><circle cx="5.6" cy="15" r=".6" fill="currentColor"/></svg>',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/></svg>'];
    const TITLES = ["Chats: all - click: pictures only", "Chats: pictures only - click: only the chat", "Only the chat - click: show the chats"];
    const fit = from => {                           // the page follows the window: no part of it wider than it (WhatsApp keeps 748px)
      for (let e = from; e && e !== document.documentElement; e = e.parentElement)
        if (!e.hasAttribute("data-vos-wa-fit") && parseFloat(getComputedStyle(e).minWidth) >= 300) e.setAttribute("data-vos-wa-fit", "");
    };
    const clear = () => document.querySelectorAll("[data-vos-wa-off],[data-vos-wa-wide],[data-vos-wa-thin],[data-vos-wa-host]").forEach(e => { e.removeAttribute("data-vos-wa-off"); e.removeAttribute("data-vos-wa-wide"); e.removeAttribute("data-vos-wa-thin"); e.removeAttribute("data-vos-wa-host"); });
    const button = (host, float) => {
      let b = document.getElementById("vos-wa-btn");
      if (b && b.parentElement !== host) { b.remove(); b = null; }
      if (!b) {
        b = document.createElement("button"); b.id = "vos-wa-btn"; b.type = "button";
        b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); set(key(), String((level() + 1) % 3)); apply(); }, true);
        host.insertBefore(b, host.firstChild);
      }
      b.classList.toggle("vos-wa-float", !!float);
      return b;
    };
    const apply = () => {
      const side = document.getElementById("side"), main = document.getElementById("main");
      fit(main || side);
      if (!side) return;
      clear();                                                       // (measured as WhatsApp lays it out)
      // the row of columns: the list's column (the first one with a wide column on its right) and that column (the chat - or the empty panel)
      let colList = null;
      for (let e = side; e && e.parentElement && e !== document.body; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        if ([...e.parentElement.children].some(x => x !== e && x.getBoundingClientRect().left >= r.right - 4 && x.getBoundingClientRect().width > 120)) { colList = e; break; }
      }
      if (!colList) return;
      const row = colList.parentElement;
      let colChat = main; if (colChat) while (colChat.parentElement && colChat.parentElement !== row) colChat = colChat.parentElement;
      if (!colChat || colChat.parentElement !== row) colChat = [...row.children].filter(x => x !== colList && x.getBoundingClientRect().width > 120).sort((p, q) => q.getBoundingClientRect().left - p.getBoundingClientRect().left)[0] || null;   // the empty panel: the right-most wide one
      if (!colChat) return;
      let lv = level(); if (!main && lv === 2) lv = 1;               // no chat open: the chats stay (as pictures at least)
      const cl = colChat.getBoundingClientRect().left;
      if (lv >= 1) {
        // every other left panel away: the drawer in that row, the icon bar beside the row
        for (const x of row.children) if (x !== colList && x !== colChat && x.getBoundingClientRect().left < cl + 4) x.setAttribute("data-vos-wa-off", "");
        for (let e = row; e && e.id !== "app"; e = e.parentElement) {
          const par = e.parentElement; if (!par) break;
          for (const x of par.children) if (x !== e && !x.contains(colChat) && x.getBoundingClientRect().right <= colChat.getBoundingClientRect().left + 4 && x.getBoundingClientRect().height > 200) x.setAttribute("data-vos-wa-off", "");
        }
        colChat.setAttribute("data-vos-wa-wide", "");
        if (lv === 2) colList.setAttribute("data-vos-wa-off", "");
        else {                                                       // the chats as their pictures: only the list, a narrow strip
          colList.setAttribute("data-vos-wa-thin", "");
          const list = side.querySelector("[role=grid],[role=listbox]");
          if (list) for (const x of side.children) if (!x.contains(list)) x.setAttribute("data-vos-wa-off", "");
          // as wide as a picture with the same room on both sides (its own left gap, again on its right)
          // in each row only its picture shows (a photo, or WhatsApp's own default picture): the left-most square of picture size
          // (only the picture itself - the photo, or WhatsApp's own default picture - never a bigger box around it, which also
          // holds other marks; and looked at again every time: WhatsApp reuses its rows for other chats as the list scrolls)
          for (const rowEl of (list || side).querySelectorAll("[role=row],[role=listitem]")) {
            const rr = rowEl.getBoundingClientRect();
            const sq = el => { const r = el.getBoundingClientRect(); return r.width >= 28 && r.width <= 64 && Math.abs(r.width - r.height) < 3 && r.left - rr.left < 40 ? r : null; };
            let pick = null, pr = null;
            for (const im of rowEl.querySelectorAll("img")) { const r = sq(im); if (r && (!pr || r.width > pr.width)) { pick = im; pr = r; } }   // a photo
            if (!pick) for (const sv of rowEl.querySelectorAll("svg")) {                                     // no photo: the default picture
              const r = sq(sv); if (!r) continue;
              let el = sv;                                                                                   // (with its own round box, when that box is the same size)
              for (let up = sv.parentElement; up && up !== rowEl; up = up.parentElement) { const u = up.getBoundingClientRect(); if (Math.abs(u.width - r.width) < 2 && Math.abs(u.height - r.height) < 2) el = up; else break; }
              if (!pr || r.width > pr.width) { pick = el; pr = r; }
            }
            for (const m of rowEl.querySelectorAll("[data-vos-wa-av]")) if (m !== pick) m.removeAttribute("data-vos-wa-av");
            if (pick && !pick.hasAttribute("data-vos-wa-av")) pick.setAttribute("data-vos-wa-av", "");
          }
          // the chat that is open: highlighted (WhatsApp's own selected mark - or the row with the open chat's picture)
          const rowsAll = [...(list || side).querySelectorAll("[role=row],[role=listitem]")];
          let selRow = rowsAll.find(rw => rw.getAttribute("aria-selected") === "true" || rw.querySelector("[aria-selected=true]"));
          if (!selRow && main) {
            const hp = main.querySelector("header img")?.getAttribute("src");
            if (hp) selRow = rowsAll.find(rw => [...rw.querySelectorAll("img")].some(im => im.getAttribute("src") === hp));
          }
          for (const rw of rowsAll) { const on = rw === selRow; if (rw.hasAttribute("data-vos-wa-sel") !== on) rw.toggleAttribute("data-vos-wa-sel", on); }
          const pic = [...(list || side).querySelectorAll("img")].find(im => { const r = im.getBoundingClientRect(); return r.width >= 28 && r.width <= 80 && Math.abs(r.width - r.height) < 4; });
          for (let e = side; e && e !== colList.parentElement; e = e.parentElement) if (e.scrollLeft) e.scrollLeft = 0;   // (never scrolled sideways)
          if (pic) {
            const row = pic.closest("[role=row],[role=listitem]") || colList;
            const r = pic.getBoundingClientRect(), gap = Math.max(6, Math.min(30, r.left - row.getBoundingClientRect().left));   // its own row's left room
            const w = Math.round(gap * 2 + r.width + 1) + "px";      // (+ its 1px line)
            if (colList.style.getPropertyValue("--vos-wa-w") !== w) colList.style.setProperty("--vos-wa-w", w);
          }
        }
      }
      const head = main ? main.querySelector("header") : null;
      if (!head) colChat.setAttribute("data-vos-wa-host", "");
      const b = head ? button(head, false) : button(colChat, true);
      if (!b.firstChild) b.innerHTML = ICONS[0];                     // one icon at every level
      b.title = TITLES[lv];
    };
    addEventListener("resize", () => apply());
    // (WhatsApp changes all the time - messages, typing, its list while scrolling: looked at once soon, then at most ~7 times a second)
    let q = 0, lastWa = 0; new MutationObserver(ms => { if (ms.every(m => [...m.addedNodes, ...m.removedNodes].every(n => n.id === "vos-wa-btn"))) return; if (q) return; const wait = Math.max(0, 150 - (performance.now() - lastWa)); q = setTimeout(() => requestAnimationFrame(() => { q = 0; lastWa = performance.now(); apply(); }), wait); }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.__vosWa = apply; apply(); return "set";
  })()`;
  function waHook(wv) {
    if (!wv || wv.__vosWaHook || typeof wv.executeScript !== "function") return;
    const src = wv.getAttribute("src") || "";
    if (!/^https:\/\/web\.whatsapp\.com\//.test(src)) return;
    wv.__vosWaHook = true;
    const run = () => { try { wv.executeScript({ code: WA_CODE }, () => void chrome.runtime.lastError); } catch (e) {} };
    wv.addEventListener("loadstop", () => setTimeout(run, 400));
    run();
  }
  (window.vosBeat || (f => setInterval(f, 2500)))(() => { for (const wv of document.querySelectorAll("#webpage-stack webview")) if (!wv.__vosWaHook) waHook(wv); });
  /* OUTLOOK ON THE WEB (a company's webmail): its "Mail" title at the top names the mailbox - the main mailbox of the
     folder list ("Contoso" -> "Contoso Mail"), so two mail windows are told apart at a glance. Read from the page
     itself (nothing about any account is kept in Bento OS) */
  const OWA_CODE = `(() => {
    const isTop = e => { const r = e.getBoundingClientRect(); return r.top < 70 && r.left < innerWidth / 2 && r.width > 0; };
    const label = () => {                            // the app title: a short "Mail" in the top bar
      for (const e of document.querySelectorAll("span, div, a, button")) {
        if (e.childElementCount) continue;
        const t = (e.getAttribute("data-vos-owa") || e.textContent || "").trim();
        if (t === "Mail" && isTop(e)) return e;
        if (e.hasAttribute("data-vos-owa") && isTop(e)) return e;
      }
      return null;
    };
    // a folder's own name: unread counts and screen-reader words taken off ("Inbox 9 9 Unread" -> "Inbox")
    const clean = t => String(t || "").replace(/\\b\\d+\\s+(unread|items?)\\b.*$/i, "").replace(/\\b(unread|selected|expanded|collapsed|has subfolders)\\b.*$/i, "").replace(/(\\s+\\d+)+\\s*$/, "").replace(/\\s+/g, " ").trim();
    const FOLDER = /^(favou?rites|inbox|drafts|sent items|sent|deleted items|deleted|junk e-?mail|junk|archive|notes|outbox|conversation history|rss (feeds|subscriptions)|search folders|clutter|scheduled|snoozed)$/i;
    const mailbox = () => {                          // the main mailbox: the top folder that HAS folders (not Favorites - whose
      const items = [...document.querySelectorAll("[role=treeitem]")];   // Inbox, Sent Items... are only shortcuts)
      const own = e => {                             // its own name (not its subfolders'), without an unread count
        const a = e.getAttribute("aria-label") || e.getAttribute("title");
        if (a) return a.split(",")[0];
        for (const c of e.childNodes) {
          if (c.nodeType === 3 && c.textContent.trim()) return c.textContent;
          if (c.nodeType === 1 && !c.matches("[role=group],[role=treeitem]") && !c.querySelector("[role=treeitem]") && (c.innerText || c.textContent || "").trim()) return c.innerText || c.textContent;
        }
        return "";
      };
      const lvl = e => Number(e.getAttribute("aria-level")) || (() => { let n = 1; for (let p = e.parentElement; p; p = p.parentElement) if (p.matches?.("[role=treeitem]")) n++; return n; })();
      const hasKids = (e, i) => e.hasAttribute("aria-expanded") || !!e.querySelector("[role=treeitem]") || (items[i + 1] && lvl(items[i + 1]) > lvl(e));
      const roots = items.map((e, i) => ({ e, i, l: lvl(e) })).filter(x => hasKids(x.e, x.i));
      const top = Math.min(...roots.map(x => x.l));
      for (const x of roots.filter(x => x.l === top)) {
        const t = clean(own(x.e).split("\\n")[0]);
        if (t && !FOLDER.test(t) && t.length < 60) return t;
      }
      const m = /^(?:mail|outlook|inbox)(?:\\s*\\(\\d+\\))?\\s*[-–]\\s*(.+?)\\s*[-–]\\s*outlook/i.exec(document.title || "");   // "Mail - Name - Outlook"
      const t = m ? clean(m[1]) : "";
      return t && !FOLDER.test(t) ? t : "";
    };
    const KEEP = "vosOwaMailbox:" + location.host;   // (the last right name: kept while the folder list is not drawn yet)
    const apply = () => {
      const l = label(); let n = mailbox();
      if (n) { try { localStorage.setItem(KEEP, n); } catch (e) {} }
      else { try { n = localStorage.getItem(KEEP) || ""; } catch (e) {} }
      if (!l) return false;
      if (!n) { if (l.hasAttribute("data-vos-owa") && l.textContent !== "Mail") l.textContent = "Mail"; return false; }   // (never a folder's name - plain Mail until it is known)
      if (!l.hasAttribute("data-vos-owa")) l.setAttribute("data-vos-owa", "Mail");
      const want = n + " Mail";
      if (l.textContent !== want) l.textContent = want;
      return true;
    };
    if (!window.__vosOwa) {
      window.__vosOwa = apply;
      let q = 0; new MutationObserver(() => { if (!q) q = setTimeout(() => { q = 0; apply(); }, 300); }).observe(document.documentElement, { childList: true, subtree: true });
    }
    return apply() ? "named" : "not yet";
  })()`;
  const OWA_URL = /^https:\/\/[^/]*(webmail|mail|outlook|owa)[^/]*\/(owa|mail)\b|^https:\/\/[^/]*webmail\.[^/]+\//i;
  function owaHook(wv) {
    if (!wv || wv.__vosOwaHook || typeof wv.executeScript !== "function") return;
    if (!OWA_URL.test(wv.getAttribute("src") || "")) return;
    wv.__vosOwaHook = true;
    const run = () => { try { wv.executeScript({ code: OWA_CODE }, () => void chrome.runtime.lastError); } catch (e) {} };
    wv.addEventListener("loadstop", () => { setTimeout(run, 800); setTimeout(run, 3000); });
    run();
  }
  (window.vosBeat || (f => setInterval(f, 2500)))(() => { for (const wv of document.querySelectorAll("#webpage-stack webview")) if (!wv.__vosOwaHook) owaHook(wv); });
  /* SMART GRABBERS: the colour at the top of each page, read from the page now and then (and when it loads):
     its grabbers are white on a dark page, dark on a light one (CSS: data-vos-tone) */
  const TONE_CODE = "(() => { if (document.getElementById('vos-dark')) return ['rgb(24, 24, 24)', '', 'dark']; const solid = c => { const m = /rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?/.exec(c || ''); return !!m && (m[4] == null || +m[4] >= 0.5); }; let e = document.elementFromPoint(innerWidth / 2, 6), fg = ''; while (e) { const cs = getComputedStyle(e); if (!fg) fg = cs.color; if (solid(cs.backgroundColor)) return [cs.backgroundColor, fg]; e = e.parentElement; } const r = getComputedStyle(document.documentElement), b = getComputedStyle(document.body || document.documentElement); const c = [b.backgroundColor, r.backgroundColor].find(solid) || ''; return [c, fg || b.color, r.colorScheme]; })()";   // see-through colours (a faint tint over the page) are skipped: the page's own colour counts
  let toneRead = new WeakMap();
  addEventListener("vos-appearance", () => { toneRead = new WeakMap(); setTimeout(queueRender, 400); setTimeout(queueRender, 1200); });   // dark / light changed: every page's colour read again
  const toneOf = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ""); if (!m || (m[4] != null && +m[4] < 0.2)) return "light"; return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.5 ? "dark" : "light"; };
  function readTone(page) {
    const wv = page?.querySelector("webview");
    if (!wv || typeof wv.executeScript !== "function") return;
    const tiledNow = page.classList.contains("tiled");
    if (page.__vosToneTiled !== tiledNow) { page.__vosToneTiled = tiledNow; wv.__vosToneN = 0; toneRead.delete(wv); }   // just split (or out of a split): read now
    const quick = (wv.__vosToneN || 0) < 6;                          // new here: read often at first (a page drawing its colours), then every 4s
    if (Date.now() - (toneRead.get(wv) || 0) < (quick ? 350 : 4000)) return;
    wv.__vosToneN = (wv.__vosToneN || 0) + 1;
    toneRead.set(wv, Date.now());
    if (quick) setTimeout(() => readTone(page), 400);
    if (!wv.__vosTone) { wv.__vosTone = true; wv.addEventListener("loadstop", () => { toneRead.delete(wv); wv.__vosToneN = 0; setTimeout(() => readTone(page), 150); }); }
    try {
      wv.executeScript({ code: TONE_CODE }, x => {
        void chrome.runtime.lastError;
        const v = Array.isArray(x) ? x[0] : x, [bg, fg, scheme] = Array.isArray(v) ? v : [v];
        const lum = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c || ""); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : null; };
        const t = bg ? toneOf(bg) : (lum(fg) ?? 0) > 0.6 || /^dark/.test(scheme || "") ? "dark" : "light";   // no colour of its own at the top: its text (light text: a dark page)
        if (page.dataset.vosTone !== t) { page.dataset.vosTone = t; toneFrames(); }
      });
    } catch (e) {}
  }
  function toneFrames() {                            // a split's own grabber: the tone of the page at its top centre
    for (const [id, f] of frames) {
      if (!f.hasAttribute("data-ft-grab")) continue;
      const el = targetOf(pageOf(id)), r = el?.getBoundingClientRect();
      if (!r) continue;
      const cx = r.left + r.width / 2;
      const pg = $$(".webpageview[data-id]", el).find(p => { const q = p.getBoundingClientRect(); return cx >= q.left && cx <= q.right && q.top - r.top < 40; });
      const t = pg?.dataset.vosTone || "light";
      if (f.dataset.vosTone !== t) f.dataset.vosTone = t;
    }
    const b = browserEl(), t = activePage()?.dataset.vosTone || "light";
    if (b && b.dataset.vosMaxtone !== t) b.dataset.vosMaxtone = t;
  }
  const isSplitWindow = el => !!el && !el.classList.contains("tile") && !el.classList.contains("webpageview");
  const inRect = (x, y, r) => !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  function windowAt(x, y, except) {                 // the top-most floating window under a point
    return [...zOrder].reverse().find(z => z !== except && !minimized.has(z) && inRect(x, y, targetOf(pageOf(z))?.getBoundingClientRect())) || null;
  }
  /* the window of a tab being dragged lets the pointer through to the windows
     behind it (see-through while the drag lasts) */
  let seeing = null;                                 // the window marked see-through
  function seeThrough(id) {
    const el = id ? targetOf(pageOf(id)) : null;
    if (seeing && seeing !== el) seeing.removeAttribute("data-ft-dragging");
    if (!id) for (const o of $$("#webpage-stack [data-ft-dragging]")) if (!o.classList.contains("SlideBar")) o.removeAttribute("data-ft-dragging");
    seeing = el;
    if (el && !el.hasAttribute("data-ft-dragging")) el.setAttribute("data-ft-dragging", "");
  }
  setInterval(() => { if (!document.hidden && !drag && seeing) seeThrough(null); }, 500);
  /* the keyboard focus never rests in a window behind the front one: a click there is then always heard
     (the page takes the focus again) and brings that window up - checked often, not only on redraws */


  /* ================= drag and drop with windows =================
     - over a window: that window becomes the active page right away, because
       Vivaldi splits a dropped tab/tile with the ACTIVE page (unless the page
       under the pointer is already split)
     - the window you drop onto keeps its place and holds the split (applyDrop)
     - on the empty desktop the mod takes the drop (Vivaldi would open a new
       browser window): a tile leaves its split, a tab floats there
     - a cancelled drag (Esc) does nothing */
  let drag = null, dropInfo = null, tabDown = null, lastOver = null;

  function dragIds(dt) {
    for (const t of dt?.types || []) {
      try {
        const v = JSON.parse(dt.getData(t));
        if (Array.isArray(v?.ids)) return v.ids.map(String);
        if (Array.isArray(v) && v.length && v.every(n => /^\d+$/.test(String(n)))) return v.map(String);
      } catch (_) {}
    }
    return [];
  }
  /* Vivaldi opens a NEW browser window when a tab drag ends without a drop it
     handled. A drop event without data tells it "handled", and nothing else. */
  const dropHandled = () => window.dispatchEvent(new DragEvent("drop"));
  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    dropHandled();
    drag = null;
  }

  let dragIcon = null;                               // a tile's app icon, made when it is pressed (its picture loads before the drag)
  addEventListener("pointerdown", e => {
    const strip = e.button === 0 && e.target.closest?.(".mosaic-tile");
    if (!strip || strip.closest("[data-ft-float]") || isTiled(strip.closest(".webpageview[data-id]"))) return;   // (a split's tile, floating or full screen: tileGesture)
    const page = strip.closest(".webpageview[data-id]"), url = page?.querySelector("webview")?.getAttribute("src") || "";
    if (!url) return;
    dragIcon?.remove();
    dragIcon = document.createElement("div"); dragIcon.className = "vos-mc-icon vos-drag-img";
    const im = document.createElement("img"); im.alt = ""; im.src = favicon(url); dragIcon.appendChild(im);
    (browserEl() || document.body).appendChild(dragIcon);
  }, true);
  addEventListener("dragstart", e => {                 // last of all (after Vivaldi's own): its picture is the icon
    if (!dragIcon || !e.target.closest?.(".mosaic-tile") || !e.dataTransfer) return;
    try { e.dataTransfer.setDragImage(dragIcon, 22, 22); } catch (_) {}
    const d = dragIcon; dragIcon = null; setTimeout(() => d.remove(), 0);
  });
  addEventListener("pointerup", () => { if (dragIcon) { dragIcon.remove(); dragIcon = null; } }, true);
  const tbEditing = () => !!document.querySelector("#browser.toolbar-edit-mode");   // Vivaldi's toolbar editor: its drags are its own (dropped outside: removed)
  function onDragStart(e) {
    if (tbEditing()) return;
    const strip = e.target.closest?.(".mosaic-tile");
    if (strip) { e.preventDefault(); return; }                      // a split's tile (floating or full screen): the mod's own drag (tileGesture)
    if (e.target.closest?.("[data-ft-float], .ft-lights")) { e.preventDefault(); return; }
    const id = tabIdAt(e.target);
    if (!id) return;
    // pressing the tab made it active and may have left the desktop: go back to it
    const down = tabDown && tabDown.id === id ? tabDown : null;
    tabDown = null;
    const desktop = !!down?.desktop;
    if ((desktop || down?.full) && down.active && down.active !== id) activate(down.active, { quiet: true });   // the desktop - or the full-screen app - stays shown while the tab is dragged
    drag = { kind: "tab", id, src: winOf(id), desktop, x: e.clientX, y: e.clientY, over: null };
  }

  function onDragOver(e) {
    if (tbEditing()) return;
    if (!e.isTrusted || !(e.clientX || e.clientY)) return;
    if (!drag) {                                                    // its dragstart never reached us
      // a tab dragged out of the tab bar (Vivaldi starts those drags itself):
      // pressing it made it active and may have left the desktop - go back
      const down = tabDown && Date.now() - (tabDown.t || 0) < 3000 ? tabDown : null;
      tabDown = null;
      if (down?.full && !down.desktop && down.active && down.active !== down.id) { activate(down.active, { quiet: true }); drag = { kind: "tab", id: down.id, src: winOf(down.id), desktop: false, x: e.clientX, y: e.clientY, over: null }; return; }   // a full-screen app in front: it stays
      if (down?.desktop) {
        if (down.active && down.active !== down.id) activate(down.active, { quiet: true });
        drag = { kind: "tab", id: down.id, src: winOf(down.id), desktop: true, x: e.clientX, y: e.clientY, over: null };
      } else {
        if (!browserEl()?.hasAttribute("data-ft-desktop")) return;
        const a = activePage()?.dataset.id;
        drag = { kind: "unknown", id: a || null, src: winOf(a), desktop: true, x: e.clientX, y: e.clientY, over: null };
      }
    }
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.desktop) return;
    const through = drag.kind === "tab" ? drag.src : null;          // its own window: look behind it
    seeThrough(through);
    const hit = windowAt(e.clientX, e.clientY, through);
    if (hit !== drag.over) {
      drag.over = hit;
      if (hit && hit !== drag.src) {                                // the drop target comes to the front
        lastOver = { id: hit, t: Date.now() };
        raise(hit);
        render();
      }
    }
    // a tab over a lone window: the half it takes shows (as a window held over it); the drop is ours
    const tabSplit = !!hit && !focusSet.size && hit !== drag.src && drag.kind === "tab" && drag.id != null && String(drag.id) !== hit &&
      !isTiled(pageOf(drag.id)) && !groupFloat.has(String(drag.src ?? "")) && !!vivTile();
    if (tabSplit) {
      const t = targetOf(pageOf(hit));
      const pane = isTiled(pageOf(hit)) ? membersOf(pageOf(hit)).map(m => pageOf(m)).find(p => p && inRect(e.clientX, e.clientY, p.getBoundingClientRect())) : null;
      drag.split = { to: hit, pane: pane?.dataset.id || null, side: splitPreview(hit, e.clientX, e.clientY, null, t, pane ? pane.getBoundingClientRect() : null) };
      e.preventDefault(); e.stopImmediatePropagation();
      try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
      return;
    }
    if (drag.split) { drag.split = null; splitPreview(null); }
    // Vivaldi splits a lone window with the ACTIVE tab: keep the target active
    // all the way to the drop (asked again until it lands)
    if (hit && hit !== drag.src) {
      // the page under the pointer; over a split that is not the active page,
      // Vivaldi hides its tiles from the pointer (no drop areas), so find the
      // tile by its place and make it active - then its drop areas appear
      let under = e.target.closest?.(".webpageview[data-id]")?.dataset.id;
      if (!under && isTiled(pageOf(hit))) {
        under = membersOf(pageOf(hit)).find(m => inRect(e.clientX, e.clientY, pageOf(m)?.getBoundingClientRect()))
             || splitFocus.get(hit) || hit;
      }
      const want = under && winOf(under) === hit ? under : (isTiled(pageOf(hit)) ? null : hit);
      if (want && want !== String(drag.id) && activePage()?.dataset.id !== want && pendingActive !== want) activate(want, { quiet: true });
    }
    // the middle of a page would open the tab in a new Vivaldi window:
    // there, the drop goes to the nearer side instead
    const zone = hit && e.target.closest?.(".tab-dropzone");
    const wv = zone?.closest(".webpageview[data-id]")?.querySelector("webview");
    const r = wv?.getBoundingClientRect();
    if (r && r.width && r.height) {
      const tx = (e.clientX - r.left) / r.width, ty = (e.clientY - r.top) / r.height;
      if (tx > 0.3 && tx < 0.7 && ty > 0.3 && ty < 0.7) {
        e.preventDefault();
        e.stopImmediatePropagation();
        zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true,
          clientX: r.left + r.width * (tx < 0.5 ? 0.15 : 0.85), clientY: e.clientY,
          screenX: e.screenX, screenY: e.screenY }));
        return;
      }
    }
    if (!hit && inRect(e.clientX, e.clientY, stackRect())) {
      e.preventDefault();                                           // the empty desktop takes the drop
      e.stopImmediatePropagation();
    }
  }

  function onDrop(e) {
    if (tbEditing()) return;
    if (!e.isTrusted) return;                                       // our own "handled" signal
    const d = drag;
    if (!d) return;
    const x = e.clientX || d.x, y = e.clientY || d.y;
    const ids = dragIds(e.dataTransfer);
    if (ids.length && d.kind !== "tile") { d.id = ids[0]; if (d.kind === "unknown") d.src = winOf(ids[0]); }
    seeThrough(null);
    if (d.split) {                                                  // a tab on a window's half: that split
      const sp = d.split; d.split = null;
      splitPreview(null);
      swallow(e);
      const src = String(ids[0] ?? d.id);
      if (src !== sp.to && sp.side) splitInto(src, sp.to, sp.side, sp.pane);
      return;
    }
    if (!d.desktop) return;
    const hit = windowAt(x, y, d.kind === "tab" ? d.src : null);
    if (hit) {
      const zone = e.target.closest?.(".tab-dropzone");
      const own = d.kind !== "tile" && [d.id, ...ids].some(i => i != null && (String(i) === hit || winOf(String(i)) === hit));
      const lone = !isTiled(pageOf(hit));
      // nothing to split: its own window, outside a page (title bar, frame),
      // the middle of a page, or the target is not the active tab yet
      // (Vivaldi would open a new window or split with a new blank page)
      if (own || !zone || zone.classList.contains("dropcenter") ||
          (lone && activePage()?.dataset.id !== hit)) return swallow(e);
      dropInfo = { target: hit, dragged: d.id, src: d.src, kind: d.kind, t: Date.now() };  // it keeps its place
      selected = hit;
      return;                                                       // Vivaldi splits it
    }
    if (!inRect(x, y, stackRect())) return;
    swallow(e);                                                     // the empty desktop: ours
    if (d.kind === "tile") tileToDesktop(d, x, y); else if (d.id) tabToDesktop(d, x, y);
  }

  function dropFrac(x, y, w, h) {
    const s = stackRect();
    return { x: (x - s.left) / s.width - w / 2, y: (y - s.top) / s.height - 0.04, w, h };
  }
  /* a tile dropped on the desktop leaves its floating split and floats there */
  function tileToDesktop(d, x, y) {
    const page = pageOf(d.id);
    const untile = page && $$(".mosaic-tile .controls > button", page)[0];
    if (!untile) return;
    if (d.id === d.src) {                                           // the split window stays with the other tiles
      const heir = membersOf(page).find(m => m !== d.id);
      if (heir) passWindow(d.id, heir);
      groupFloat.delete(d.id);
    }
    frac[d.id] = dropFrac(x, y, 0.45, 0.55);
    if (!floating.has(d.id)) inSplit.add(d.id);
    setTimeout(() => untile.click(), 30);                           // Vivaldi takes it out of the split
    queueRender();
  }
  /* a tab dropped on the desktop floats there (a split's tab: the whole split) */
  function tabToDesktop(d, x, y) {
    const page = pageOf(d.id);
    if (!page) return;
    const w = winOf(d.id);
    if (w) {                                                        // already a window: it moves there
      const r = targetOf(pageOf(w))?.getBoundingClientRect(), s = stackRect();
      if (r) frac[w] = { ...pxFrac(w), x: (x - s.left - r.width / 2) / s.width, y: (y - s.top) / s.height - 0.04 };
      raise(w); persist(w); activate(d.id); render();
      return;
    }
    frac[d.id] = dropFrac(x, y, 0.55, 0.6);
    if (isTiled(page)) groupFloat.add(d.id);                        // the whole split
    floatNow(d.id, page);
    if (isTiled(page)) origin.set(d.id, { tiled: true, group: groupOf(page) });
    activate(d.id);
    render();
    popIn(targetOf(pageOf(d.id)));                                  // dropped here: no icon to come from
  }

  /* the mouse over a background window makes it the active tab (no raise, no
     tab bar color), so it scrolls and reacts right away, without a click first */
  let hoverTimer = 0, noRaise = null, hover = null, hoverKey = null, hoverMoved = 0;
  /* (performance) one timer per place, not one per mouse move: it fires once the pointer has rested there */
  const restThen = (ms, f) => { const go = () => { const left = ms - (performance.now() - hoverMoved); if (left > 4) { hoverTimer = setTimeout(go, left); return; } hoverTimer = 0; f(); }; hoverTimer = setTimeout(go, ms); };
  function onHoverMove(e) {
    if (lpOn()) return;
    if (!e.buttons && drag) drag = null;                            // a drag that ended unseen
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (e.buttons || drag || !browserEl()?.hasAttribute("data-ft-desktop")) return;
    // a swipe (and its moment after): windows slide under a still pointer - no window is "hovered" then, and never one
    // of another desktop (making its tab active would take Vivaldi back to that desktop)
    if (sw || swiping || performance.now() < swQuietUntil + 150) { clearTimeout(hoverTimer); hoverTimer = 0; hoverKey = null; return; }
    const win = e.target.closest?.("[data-ft-float]:not([data-ft-min]):not([data-ft-away]):not([data-vos-incoming]):not([data-vos-out]):not([data-ft-ws-leave])");
    const inner = win && isSplitWindow(win) ? e.target.closest?.(".webpageview[data-id]")?.dataset.id : null;
    const key = win ? (inner || win.dataset.ftFloat) : "-";
    hoverMoved = performance.now();
    if (key === hoverKey && hoverTimer) return;                    // (performance) the same place: its timer runs already
    hoverKey = key;
    clearTimeout(hoverTimer); hoverTimer = 0;
    if (!win) {
      const sel = selected, a = activePage()?.dataset.id;
      if (sel && a && a !== sel && pageOf(sel) && window.__ftQuietTint === a) {
        restThen(120, () => { noRaise = sel; activate(sel); });
      }
      return;
    }
    const want = key;
    if (activePage()?.dataset.id === want || pendingActive === want) return;
    restThen(90, () => {
      if (sw || swiping || awayWs(winOf(want) || want)) return;        // (a swipe began meanwhile, or it is not on this desktop)
      noRaise = want;
      hover = { id: want, t: Date.now() };
      window.__vosHoverFocusAt = Date.now();                         // (a popup is not closed by this focus: it is no click)
      activate(want, { quiet: true });
      // Vivaldi focuses the page it activates; take that focus back, so the
      // first real click in the page counts as a click (front + color)
      setTimeout(() => { if (window.__ftQuietTint === want) unfocusPage(); }, 300);
    });
  }

  /* move the keyboard focus off a hovered page (onto an invisible spot in the
     browser), so a click in the page focuses it again and we hear about it */
  let sink = null;
  function unfocusPage() {
    const a = document.activeElement;
    if (!a || !a.closest?.("[data-ft-float]")) return;
    if (!sink || !sink.isConnected) {
      sink = document.createElement("div");
      sink.tabIndex = -1;
      sink.className = "ft-focus-sink";
      sink.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(sink);
    }
    sink.focus({ preventScroll: true });
    if (document.activeElement === a) a.blur();
  }

  function onFocusIn(e) {                            // click inside a window: bring it to the front
    if (lpOn()) return;
    if (e.target.closest?.("[data-ft-float]")) focusInAt = Date.now();
    const under = e.target.closest?.("[data-ft-under]");             // the full-screen page under them: it comes back
    if (under?.dataset.id) { activate(under.dataset.id); render(); return; }
    const win = e.target.closest?.("[data-ft-float]");
    if (!win) return;
    const id = win.dataset.ftFloat;
    const inner = e.target.closest?.(".webpageview[data-id]")?.dataset.id;
    const want = groupFloat.has(id) && inner ? inner : id;
    const own = hover && hover.id === want &&
      (hover.landed ? Date.now() - hover.landed < 60 : Date.now() - hover.t < 120);   // (narrow: a quick real click is never mistaken for it)
    if (own) {                                                      // Vivaldi's own focus after a hover:
      hover = null;                                                 // give it back right away, so the
      setTimeout(() => { if (window.__ftQuietTint === want) unfocusPage(); }, 0);   // next click is heard
      return;
    }
    activate(want);                                                 // also recolors the tab bar
    if (zOrder[zOrder.length - 1] !== id) raise(id);
    render();
  }

  /* ---------------- watching Vivaldi ---------------- */
  let queued = false;
  /* the shown desktop changed (any way: the mod, Vivaldi's own menu, a shortcut) - drawn again, even
     when no tab became active (back from an empty desktop to the same tab) */
  let wsShownSeen;
  setInterval(() => {
    if (document.hidden) return;
    let v; try { v = vivActiveWs(); } catch (e) { return; }
    if (v === undefined || (wsShownSeen !== undefined && sameWs(v, wsShownSeen))) return;
    const first = wsShownSeen === undefined;
    wsShownSeen = v; wsNowAt = 0; queueRender();
    if (first) return;
    window.dispatchEvent(new Event("ft-tint"));                      // the tab bar's colour: this desktop's front tab
    deskIndicatorNow();
    arrive(v);
  }, 150);
  /* arrived on a desktop: its windows are shown - never hidden behind its Launchpad page (Vivaldi may bring
     that page to the front a little later: looked at a few times) */
  let arriveGen = 0;
  function arrive(v) {
    const gen = ++arriveGen;
    for (const ms of [140, 400, 900]) setTimeout(() => {
      if (gen !== arriveGen || swiping || sw || !sameWs(vivActiveWs(), v)) return;
      const a = activePage(); if (!a || !isStart(a)) return;
      const w = [...zOrder].reverse().find(z => floating.has(z) && !minimized.has(z) && !pip.includes(z) && pageOf(z) && !awayWs(z));
      if (!w) return;
      vstore.set("vosArriveDiag", JSON.stringify({ ws: v, ms, front: w, t: Date.now() }));   // (a record, to see when it happens)
      raise(w); activate(groupFloat.has(w) ? (splitFocus.get(w) || w) : w);
    }, ms);
  }
  /* THE DESKTOP INDICATOR (Ubuntu): on the Workspaces button, a dot per desktop of this window -
     the one shown a short line - drawn from what is known, again whenever it changes */
  function deskIndicator(info) {
    const n = Math.max(1, Math.min(9, info?.ds?.length || 1)), i = Math.max(0, Math.min(n - 1, info?.i ?? 0)), key = n + ":" + i;
    let x = 1; const parts = [];
    for (let j = 0; j < n; j++) {
      if (j === i) { parts.push(`<rect x="${x}" y="6.4" width="14" height="5.2" rx="2.6"/>`); x += 14 + 3.5; }
      else { parts.push(`<circle cx="${x + 2.6}" cy="9" r="2.6" opacity="0.5"/>`); x += 5.2 + 3.5; }
    }
    const w = Math.ceil(x - 3.5 + 1);
    document.querySelectorAll(":is(.workspace-popup, .tabbar-workspace-button) .vos-desks-ic").forEach(x => x.remove());   // Vivaldi's Workspaces button: its own icon
    for (const host of document.querySelectorAll("#browser .vos-chain-vosmission .ToolbarButton-Button")) {   // the Desktops widget
      host.querySelector(":scope > .vos-chain-ic")?.remove();
      let ic = host.querySelector(":scope > .vos-desks-ic");
      if (ic && ic.__key === key) continue;
      if (!ic) { ic = document.createElement("span"); ic.className = "vos-desks-ic"; host.appendChild(ic); }
      ic.__key = key;
      ic.innerHTML = `<svg viewBox="0 0 ${w} 18" width="${w}" height="18" fill="currentColor" aria-hidden="true">${parts.join("")}</svg>`;
    }
  }
  const deskIndicatorNow = () => desksNow(true).then(deskIndicator).catch(() => {});
  /* which side Vivaldi's panel is on (its own setting, also while the panel is closed): the panel button's icon follows */
  const panelSide = () => prefGet("vivaldi.panels.position").then(p => browserEl()?.toggleAttribute("data-vos-panel-right", p === 1 || p === "right")).catch(() => {});
  /* (performance) the desktop dots and the panel side are read when something changes - a tab made, closed or
     moved, a setting changed - not every 2-3 seconds; a slow backstop catches anything missed */
  let dotsQ = 0;
  const dotsSoon = () => { clearTimeout(dotsQ); dotsQ = setTimeout(() => { if (!document.hidden) deskIndicatorNow(); }, 250); };
  try { for (const ev of ["onCreated", "onRemoved", "onAttached", "onDetached"]) chrome.tabs[ev].addListener(dotsSoon); } catch (e) {}
  try { chrome.tabs.onUpdated.addListener((id, info) => { if (info.vivExtData != null) dotsSoon(); }); } catch (e) {}
  try { chrome.tabs.onUpdated.addListener((id, info) => { if (info.favIconUrl && pip.some(p => p === String(id) || splitFocus.get(p) === String(id))) queueRender(); }); } catch (e) {}   // 1.0.245: a pinned app's icon arrived: its circle shows it
  try { vivaldi.prefs.onChanged.addListener(p => { const k = String(p?.path ?? p ?? ""); if (/workspaces/.test(k)) dotsSoon(); if (/panels/.test(k)) panelSide(); }); } catch (e) {}
  setTimeout(panelSide, 1200); setInterval(() => { if (!document.hidden) panelSide(); }, 15000);
  setInterval(() => { if (!document.hidden) deskIndicatorNow(); }, 15000);
  setTimeout(deskIndicatorNow, 1500);
  function queueRender() {
    if (queued) return;
    queued = true;
    const go = () => { if (!queued) return; queued = false; render(); };
    requestAnimationFrame(go); setTimeout(go, 120);                    // also when Vivaldi draws no frames (out of sight)
  }

  // windows keep relative places when the desktop resizes (sidebar, window size)
  let observedStack = null;
  const ro = new ResizeObserver(() => { stackMoved(); queueRender(); });
  function watchStack() {
    const s = stack();
    if (!s || s === observedStack) return;
    if (observedStack) ro.unobserve(observedStack);
    ro.observe(s);
    observedStack = s;
  }

  // after the tab bar moves, make Vivaldi measure the tabs again
  let tabPos = "";
  function checkTabbarMove() {
    const b = browserEl();
    const pos = ["tabs-top", "tabs-bottom", "tabs-left", "tabs-right", "tabs-off"].find(c => b?.classList.contains(c)) || "";
    if (pos === tabPos) return;
    const first = !tabPos;
    tabPos = pos;
    if (first) return;
    const nudge = () => {
      dispatchEvent(new Event("resize"));
      $$(".tabbar-wrapper, #tabs-container").forEach(e => {
        e.style.setProperty("padding-right", "1px", "important");
        requestAnimationFrame(() => requestAnimationFrame(() => e.style.removeProperty("padding-right")));
      });
    };
    [60, 250, 600].forEach(ms => setTimeout(nudge, ms));
  }

  /* only react to changes in the page area (not every hover in the tab bar) */
  const ours = n => n.nodeType === 1 && (n.classList.contains("ft-lights") || n.classList.contains("ft-titlebar") ||
                                         n.classList.contains("ft-resize") || n.classList.contains("ft-probe") ||
                                         n.classList.contains("ft-clock") || n.classList.contains("ft-frame"));
  const RELEVANT = ".webpageview, .tile, .tiled, #webpage-stack, .startpage";
  function onPageMutations(records) {
    for (const r of records) {
      if (r.type === "attributes") {
        if (r.oldValue === r.target.className) continue;            // no real change
        if (r.target.matches?.(RELEVANT)) return queueRender();
        continue;
      }
      if (!r.target.closest?.("#webpage-stack") || r.target.closest(".ft-titlebar")) continue;  // address bar etc.
      if ([...r.addedNodes, ...r.removedNodes].some(n => !ours(n))) {
        if (floatOnLoad.size) return render();                     // before the new page is painted
        return queueRender();
      }
    }
  }

  function start() {
    const b = browserEl();
    const area = $("#main") || b;
    if (!b || !window.chrome?.tabs) return setTimeout(start, 50);

    // Home opens the Launchpad (js/launchpad.js); without it, Home shows the
    // desktop in full view (it never loads the Start Page inside a floating window)
    document.addEventListener("click", e => {
      if (e.button !== 0) return;
      const btn = e.target.closest?.("button, .button-toolbar");
      if (!btn || !btn.closest(".toolbar")) return;
      const isHome = v => /^(go to )?home ?page\b/i.test((v || "").trim());   // the tooltip may add a shortcut
      const els = [btn, btn.closest(".button-toolbar"), btn.querySelector?.("button")].filter(Boolean);
      if (!els.some(el => isHome(el.getAttribute("title")) || isHome(el.getAttribute("aria-label")))) return;
      if (window.vosLaunchpad) return;                              // js/launchpad.js owns Home
      e.preventDefault();
      e.stopImmediatePropagation();
      showDesktop();
    }, true);
    document.addEventListener("click", e => {
      const btn = e.target.closest?.(".ft-lights button, .ft-titlebar button, .ft-inner button");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (isTouch()) {                                              // first tap only shows hidden buttons
        const box = hiddenControls(btn);
        if (box && !box.hasAttribute("data-ft-shown")) return reveal(box);
        hideShown();
      }
      if (btnHeldAt && Date.now() - btnHeldAt < 1500 && btn.matches('[data-act="zoom"], [data-act="minimize"], [data-act="res"]')) { btnHeldAt = 0; return; }   // it was held
      const barId = btn.closest(".ft-titlebar")?.dataset.ftPage;
      const page = barId ? pageOf(barId) : btn.closest(".webpageview");
      if (page && btn.closest(".vos-fsctl[data-split]") && /^(zoom|minimize)$/.test(btn.dataset.act) && isTiled(page)) {   // 1.0.339: a split full screen - yellow / green: the whole split a window again
        const id = page.dataset.id, mem = [...groupMemory].find(([w, ids]) => ids.has(id) && pageOf(w) && rootOf(pageOf(w)) === rootOf(page));
        const w = mem ? mem[0] : id; if (mem) groupMemory.delete(w);
        activate(id);
        flip([rootOf(page)], () => { groupFloat.add(w); floatNow(w, pageOf(w)); origin.set(w, { tiled: true, group: groupOf(page) }); render(); });
        return;
      }
      if (page && btn.dataset.act === "res") { toggleDark(barId || page.dataset.id); return; }   // 1.0.349: the grey one clicked - light <-> dark (held: page size)
      if (page) act(btn.dataset.act, page);
    }, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", e => {
      const strip = e.button === 0 && e.target.closest?.(".mosaic-tile");
      const win = strip && strip.closest("[data-ft-float]");
      if (win && isSplitWindow(win) && !lpOn()) { e.preventDefault(); e.stopPropagation(); }   // the mod's own tile drag (tileGesture)
      else if (strip && !win && !lpOn() && !tbEditing() && isTiled(strip.closest(".webpageview[data-id]"))) { e.preventDefault(); e.stopPropagation(); }   // a full-screen split: the mod's too
    }, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", () => { if (drag?.split) splitPreview(null); drag = null; }, true);
    document.addEventListener("pointermove", onHoverMove, { capture: true, passive: true });

    // Which Vivaldi window is this? Ask about a tab whose page lives in this
    // document (chrome.windows.getCurrent() can name another window here).
    const learnWindow = () => {
      if (myWindowId != null) return;
      const t = tabIdOf($("#webpage-stack .webpageview[data-id]")?.dataset.id);
      if (t) chrome.tabs.get(t, tab => { if (!chrome.runtime.lastError && tab) myWindowId = tab.windowId; });
    };
    learnWindow();
    const mine = windowId => { learnWindow(); return myWindowId == null || windowId === myWindowId; };

    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      if (!mine(windowId)) return;
      const id = String(tabId);
      if (restoreGuard && Date.now() < restoreGuard.until && id !== restoreGuard.id && winOf(restoreGuard.id) === restoreGuard.w) {   // a window just brought back by its tab: it stays in front
        const g = restoreGuard; restoreGuard = null;
        setTimeout(() => { activate(g.id); raise(g.w); render(); }, 0);
        return;
      }
      if (hover && hover.id === id && !hover.landed) hover.landed = Date.now();   // the hover's switch landed
      pendingActive = null; clearTimeout(pendingTimer);             // any activation ends the wait
      if (window.__ftQuietTint != null && window.__ftQuietTint !== id) window.__ftQuietTint = null;
      if (window.__ftQuietTint !== id) selected = id;               // chosen, not just hovered
      if (holdDesktop === id) { holdDesktop = null; queueRender(); return; } // keep it minimized
      holdDesktop = null;
      const w = winOf(id);
      if (w && minimized.has(w)) return restore(w);                 // its tab was clicked
      const stale = wantActive && wantActive.id !== id && Date.now() - wantActive.at < 1500;   // an earlier switch reported late:
      if (wantActive?.id === id) wantActive = null;                  // it never puts that window back on top
      if (w && floating.has(w) && noRaise !== id && !stale) raise(w);   // hover activation keeps the order
      noRaise = null;
      queueRender();
    });
    chrome.tabs.onCreated.addListener(tab => {
      // every new site opens as a floating window (the default).
      // No window check here: a tab from another window never gets a page in
      // this document, so it can't be floated here by mistake.
      const id = String(tab.id);
      floatOnLoad.add(id); floatOnLoadAt.set(id, Date.now());
      const fromPage = tab.openerTabId != null && !/^chrome:\/\/vivaldi-webui\/startpage/.test(tab.pendingUrl || tab.url || "");   // a link opened from an app
      const u0 = tab.pendingUrl || tab.url || "";                       // 1.0.344: Vivaldi's own pages too (Settings...) - a window from its first frame
      if (fromPage || (u0 && !/^chrome:\/\/vivaldi-webui\/startpage|^about:blank|^chrome:\/\/newtab/i.test(u0))) siteReady.add(id);   // (a site: a floating window from its first frame - never full size first)
      else if (/^chrome:\/\/vivaldi-webui\/startpage/.test(tab.pendingUrl || tab.url || "") || !(tab.pendingUrl || tab.url)) startBorn.set(id, Date.now());
      droppedHere(tab);
      render();                                                     // float before it is ever drawn
    });
    const gone = tabId => {
      const id = String(tabId);
      const rest = (lastGroup.get(id) || "").split(",").filter(m => m && m !== id && pageOf(m));
      if (rest.length) {
        const floatingSplit = groupFloat.has(id) || rest.some(m => groupFloat.has(m) && floating.has(m));
        if (!floatingSplit) rest.forEach(m => inSplit.delete(m));   // a full-size split: the rest stays put
        else if (groupFloat.has(id)) {                              // the floating split keeps its window
          if (rest.length >= 2) passWindow(id, rest[0]);
          else frac[rest[0]] = { ...pxFrac(id) };                    // one tile left: it floats right there
        }
      }
      const wasWin = floating.has(id) && !awayWs(id);
      floatOnLoadAt.delete(id); sawStart.delete(id);
      floatOnLoad.delete(id); siteReady.delete(id); inSplit.delete(id); delete frac[id]; noTitle.delete(id);
      groupMemory.delete(id); splitFocus.delete(id);
      forget(id);
      queueRender();
      // a window closed (a held-small one too): Vivaldi shows the tab beside it - when that is the Launchpad page
      // while windows are still here, the desktop stays as it was (its front window), nothing shrinks away or re-tiles
      if (wasWin) for (const ms of [120, 450]) setTimeout(() => {
        const a = activePage();
        if (!a || !isStart(a) || swiping || sw) return;
        const w = topWindow(null);
        if (w) { activate(groupFloat.has(w) ? (splitFocus.get(w) || w) : w); render(); }
      }, ms);
    };
    chrome.tabs.onMoved.addListener(() => { setTimeout(queueRender, 50); readTiling(); });   // tab bar order (split pills)
    chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.vivExtData != null) readTiling(); });
    chrome.tabs.onCreated.addListener(() => readTiling());
    chrome.tabs.onRemoved.addListener(() => readTiling());
    readTiling();
    vosBeat(readTiling);                                              // anything missed
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { readTiling(); queueRender(); } });
    chrome.tabs.onRemoved.addListener(gone);
    chrome.tabs.onDetached.addListener(gone);                       // moved to another window
    chrome.tabs.onAttached.addListener(arrived);                    // came from another window: it floats
    chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
      const id = String(tabId);
      const u = info.url || "";
      if (floatOnLoad.has(id) && !siteReady.has(id) && u && !/^chrome:\/\/vivaldi-webui\/startpage|^about:blank|^chrome:\/\/newtab/i.test(u)) { siteReady.add(id); render(); }   // (at once - not a frame later)
      if (info.title != null && titles.has(id)) { titles.set(id, info.title); queueRender(); }
      if (info.title != null && !titles.has(id) && [...splitFocus.values()].includes(id)) { titles.set(id, info.title); queueRender(); }
      if ((info.title != null || info.url != null) && (selected ? String(tab?.id) === selected : tab?.active)) updateSiteName();
    });

    // #browser itself: tab bar position and other top-level classes
    new MutationObserver(() => { checkTabbarMove(); queueRender(); })
      .observe(b, { attributes: true, attributeFilter: ["class"] });
    // the page area: pages, tiles, active/visible changes
    new MutationObserver(onPageMutations)
      .observe(area, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
    addEventListener("resize", queueRender);

    checkTabbarMove();
    render();
    restoreSession();
    Promise.all([vstore.get(BENTO_KEY), vstore.get(BENTO_LAYOUT)]).then(([on, layout]) => {
      try { const o = JSON.parse(on || "{}"); if (o && typeof o === "object") Object.assign(bentoOn, o); } catch (e) {}
      try { const l = JSON.parse(layout || "{}"); if (l && typeof l === "object" && !l.s && !l.w) Object.assign(bentoLayouts, l); } catch (e) {}
      setTimeout(() => { bento.ws = null; bentoWs.clear(); queueRender(); }, 1500);   // this desktop's own Bento
    });
    document.addEventListener("pointermove", bentoHover, { capture: true, passive: true });
    document.addEventListener("keydown", ev => {                     // Bento undo / redo
      if (lpOn() || !bento.on || !(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== "z" || bento.gesture) return;
      if (ev.target?.closest?.("input, textarea, [contenteditable]")) return;
      if (bentoHistory(ev.shiftKey)) { ev.preventDefault(); ev.stopPropagation(); }
    }, true);
    LOG("loaded");
  }
  start();
})();

/* 1.0.337: EXTENSION SIDE PANELS THAT REFUSE VIVALDI'S PANEL (Claude in Chrome) - INSIDE VIVALDI'S OWN PANEL. Vivaldi runs an
   extension's side panel page in a hidden tab; Claude's page asks "am I in a tab?" and, being in one, says it is not
   available on this page. Its panel stays Vivaldi's own (its icon in the panel bar, its width, opening and closing as any
   panel) - only the page in it is Bento OS's: a frame, not a tab, as Chrome's side panel, for the app window in front
   (one per window, as Chrome keeps one per tab). The extension itself is left as it is */
(() => {
  const HOSTED = { fcoeoabgfenejglbffodgkkbkcdhcgfn: "sidepanel.html" };
  const KEEP = 3;                                                     // (frames kept for the last windows it was open for)
  const frames = new Map();                                           // app tab id -> its frame (most recent last)
  let activeTab = null, openSince = 0;
  const slotOf = () => {
    for (const ext in HOSTED) {
      const wv = document.querySelector(`#panels-container .webpanel webview:not(.vos-hosted)[src^="chrome-extension://${ext}/"]`);
      if (wv) return { ext, wv, slot: wv.parentElement, panel: wv.closest(".webpanel") };
    }
    return null;
  };
  const isOpen = h => !!h && h.panel?.classList.contains("visible") && document.getElementById("panels-container")?.classList.contains("expanded") && h.slot.offsetWidth > 0;
  function frameFor(h, tab) {
    let f = frames.get(tab);
    if (f && f.parentElement !== h.slot) { f.remove(); frames.delete(tab); f = null; }   // (its panel was made anew)
    if (!f) {
      f = document.createElement("webview"); f.className = "vos-hosted";
      f.setAttribute("src", `chrome-extension://${h.ext}/${HOSTED[h.ext]}?tabId=${tab}`);
      f.addEventListener("close", () => { frames.delete(tab); f.remove(); sync(); });   // (its own close: window.close() in it)
      f.addEventListener("newwindow", e => { try { chrome.tabs.create({ url: e.targetUrl, openerTabId: tab }); } catch (x) {} });
      f.addEventListener("permissionrequest", e => { if (e.permission === "media" || e.permission === "fullscreen") e.request.allow(); });
      h.slot.appendChild(f);
    }
    frames.delete(tab); frames.set(tab, f);
    while (frames.size > KEEP) { const [old, of] = frames.entries().next().value; if (old === tab) break; of.remove(); frames.delete(old); }
    return f;
  }
  function sync() {
    const h = slotOf();
    if (!isOpen(h)) { openSince = 0; return; }
    if (!openSince) openSince = Date.now();
    if (activeTab == null) return;
    const f = frameFor(h, activeTab);
    for (const g of frames.values()) { const on = g === f; if (g.hasAttribute("data-on") !== on) g.toggleAttribute("data-on", on); }
  }
  function setActive() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const t = tabs?.[0]; if (chrome.runtime.lastError || !t) return;
      const panelTab = (() => { try { return JSON.parse(t.vivExtData || "{}").panelId != null; } catch (e) { return false; } })();
      if (panelTab || /^chrome-extension:\/\//.test(t.url || "")) return;   // (not a page Claude works on)
      activeTab = t.id; sync();
    });
  }
  /* its toolbar button (or shortcut) asks again while its panel is open: closed, as the same button does in Chrome */
  function onAsk(ext, action) {
    if (!HOSTED[ext] || action !== "show") return;
    const h = slotOf();
    if (!(isOpen(h) && openSince && Date.now() - openSince > 400)) return setTimeout(setActive, 50);
    const btn = document.querySelector(`#switch button[data-name="EXT_PANEL_${ext}"]`);
    if (btn) setTimeout(() => { for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      btn.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" })); }, 120);
  }
  let syncT = 0;
  const kick = () => { if (!syncT) syncT = setTimeout(() => { syncT = 0; sync(); }, 50); };
  function start() {
    const pc = document.getElementById("panels-container");
    if (!pc) return setTimeout(start, 1000);
    new MutationObserver(kick).observe(pc, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "src"] });
    try { vivaldi.extensionActionUtils.onSidePanelActionRequested.addListener(onAsk); } catch (e) {}
    chrome.tabs.onActivated.addListener(setActive);
    chrome.windows.onFocusChanged.addListener(setActive);
    chrome.tabs.onRemoved.addListener(tab => { const f = frames.get(tab); if (f) { f.remove(); frames.delete(tab); } });
    setActive();
  }
  start();
})();
