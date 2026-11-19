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

  /* ---------------- state, keyed by tab id (= the page's data-id) ---------------- */
  const floating = new Set();       // windows on the desktop
  const minimized = new Set();      // hidden windows / split tiles (tab stays in the tab bar)
  const minKind = new Map();        // id -> "float" | "tile" | "max" (what was minimized)
  const origin = new Map();         // id -> { tiled, group } where it was when floated
  const frac = {};                  // id -> {x,y,w,h} as fractions of the desktop
  const noTitle = new Set();        // floating windows with the title bar hidden
  let cover = null;                 // the window held to full view (over the tab bar and Vivaldi's buttons)
  const pip = [];                   // windows held small in the bottom-left corner, oldest first
  const PIP_K = 0.7, PIP_GAP = 8;   // their size (of what they were), and the space between them
  const pipCorner = new Map();      // id -> "bl" | "br" | "tl" | "tr"
  const pipW = new Map();           // corner -> the width of every window there
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
    raise(w); activate(groupFloat.has(w) ? (splitFocus.get(w) || w) : w); render();
    setTimeout(() => chrome.tabs.remove(Number(sid), () => void chrome.runtime.lastError), 120);
  }
  const wsPending = new Map();                        // tab -> { ws, until }: sent to a desktop, not confirmed yet
  const pend = (ids, ws) => { const until = Date.now() + 2500; for (const i of ids) { wsPending.set(String(i), { ws, until }); wsOfTab.set(String(i), ws); } wsNowAt = 0; };
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
    const items = list.map(({ id }) => ({ id, r: pxRect(id, s) })).sort((a, b) => (a.r.y + a.r.h / 2) - (b.r.y + b.r.h / 2) || a.r.x - b.r.x);
    const n = items.length;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {                         // the grid that shows them largest
      const rows = Math.ceil(n / cols), cw = (aw - GAP * (cols - 1)) / cols, ch = (ah - GAP * (rows - 1)) / rows;
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
        slots.set(it.id, { k, x: PAD + off + c * (cw + GAP) + (cw - w) / 2, y: top + row * (ch + GAP) + (ch - h) / 2 });
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
  /* the window a tab belongs to: itself, or the floating split it is part of */
  function winOf(id) {
    if (id == null) return null;
    id = String(id);
    if (floating.has(id) || minimized.has(id)) return id;
    const page = pageOf(id);
    if (!isTiled(page)) return null;
    const r = rootOf(page);
    for (const a of groupFloat) if (floating.has(a) && r && rootOf(pageOf(a)) === r) return a;
    return null;
  }
  const siblingOf = tile => tile && [...tile.parentElement.children].find(c => c !== tile && c.classList.contains("tile"));
  const activePage = () => $("#webpage-stack .webpageview.active.visible") || $("#webpage-stack .webpageview.active");
  const tabIdOf = id => { const n = Number(id); return Number.isFinite(n) && n > 0 ? n : null; };
  const vivaldiClose = page => { const b = $$(".mosaic-tile .controls > button", page); return b[b.length - 1]; };
  const raise = id => { zOrder = zOrder.filter(z => z !== id); zOrder.push(id); };
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
  let tilingRead = false, tilingTimer = 0;
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
  /* workspaces: the desktop shows only the windows of the current workspace */
  const wsOfTab = new Map();                        // tab id -> its workspace (null: none)
  /* the workspace shown: the one of the tabs in the tab bar (Vivaldi only lists
     the current workspace's tabs there) - not the active tab's, which is wrong
     for a moment after a tab is moved to another workspace */
  let wsNow, wsNowAt = 0;
  function curWs() {
    const t = performance.now();
    if (t - wsNowAt < 40) return wsNow;
    wsNowAt = t;
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
          if (splitOfTab.get(k) !== g) { splitOfTab.set(k, g); changed = true; }
          let w = extOf(t)?.workspaceId ?? null;
          const pd = wsPending.get(k);                                 // just moved: Vivaldi may not say so yet
          if (pd) { if (sameWs(w, pd.ws) || Date.now() > pd.until) wsPending.delete(k); else w = pd.ws; }
          if (wsOfTab.get(k) !== w) { wsOfTab.set(k, w); wsChanged = true; wsNowAt = 0; }
          // a Start Page is the desktop, never a window (one that became a window by mistake)
          if (floating.has(k) && !groupFloat.has(k) && /^chrome:\/\/vivaldi-webui\/startpage/.test(t.url || t.pendingUrl || "")) { forget(k); wsChanged = true; }
        }
        for (const k of [...wsOfTab.keys()]) if (!live.has(k)) wsOfTab.delete(k);
        for (const k of [...extCache.keys()]) if (!live.has(k)) extCache.delete(k);
        if (wsChanged) queueRender();
        for (const k of [...splitOfTab.keys()]) if (!live.has(k)) { splitOfTab.delete(k); changed = true; }
        tilingRead = true;
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
  function placePopup(p) {
    const af = document.querySelector("#browser .UrlBar-AddressField"), ar = af?.getBoundingClientRect();
    const w = p.offsetWidth || 320, h = p.offsetHeight || 160;
    let tx, ty;
    if (ar && ar.width) {
      tx = Math.max(8, Math.min(ar.left, innerWidth - w - 8));
      ty = ar.top > innerHeight / 2 ? ar.top - h - 6 : ar.bottom + 6;  // the tab bar at the bottom: above it
    } else { tx = (innerWidth - w) / 2; ty = 48; }
    const set = (x, y) => { p.style.setProperty("--vos-pop-x", Math.round(x) + "px"); p.style.setProperty("--vos-pop-y", Math.round(y) + "px"); };
    p.setAttribute("data-vos-pop", "");
    set(tx, ty);
    requestAnimationFrame(() => {                                    // inside a box that moves it: make up the difference
      const r = p.getBoundingClientRect(), dx = tx - r.left, dy = ty - r.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) set(tx + dx, ty + dy);
    });
  }
  const tiledSeen = new Map();                                       // tab id -> { on, at }
  let pillRecheck = 0;
  let wsSeen;
  function markPills() {
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
  function activate(id, opts) {
    const t = tabIdOf(id);
    if (opts?.quiet) window.__ftQuietTint = String(id);
    else { confirmTint(id); selected = String(id); queueRender(); }   // the name and tab marks follow the choice
    if (!t || activePage()?.dataset.id === String(id)) return;     // already active: no event comes back
    pendingActive = String(id);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingActive = null; queueRender(); }, 1500);
    chrome.tabs.update(t, { active: true });
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
    if (fresh) veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
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
        const want = floating.has(id) ? { r: frac[id] || bento.pre[id], nt: noTitle.has(id), g: groupFloat.has(id) || undefined,
                                          z: zoomOf[id] ? +zoomOf[id].toFixed(3) : undefined,
 } : undefined;
        if (JSON.stringify(ext[EXT_KEY]) === JSON.stringify(want)) return;
        if (want) ext[EXT_KEY] = want; else delete ext[EXT_KEY];
        chrome.tabs.update(t, { vivExtData: JSON.stringify(ext) });
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
        let f;
        try { f = JSON.parse(tab.vivExtData || "{}")?.[EXT_KEY]; } catch { continue; }
        if (!f) continue;
        const id = String(tab.id);
        const home = splitHome.get(String(ext(tab).tiling?.id || ""));
        if (home && home !== id) { persist(id); continue; }       // floating.has(id) is false: clears it
        if (f.r) frac[id] = f.r;
        noTitle.add(id);                                          // floating windows never show a title bar
        if (f.g) groupFloat.add(id);
        if (f.z && Math.abs(f.z - 1) > 0.01) zoomOf[id] = f.z;
        floating.add(id); raise(id);
        any = true;
      }
      // every site tab is a window after a restart: a tab whose saved window was
      // lost (or that was never floated) becomes one too; a split, one window
      const isSite = t => /^https?:/i.test(t.url || t.pendingUrl || "");
      const splitsDone = new Set(splitHome.keys());
      for (const tab of tabs || []) {
        const id = String(tab.id);
        if (floating.has(id) || !isSite(tab)) continue;
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
  function stackRect() {
    const s = stack();
    return s ? s.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
  }
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
  function pxRect(id, s = stackRect()) {
    if (bentoDrag?.id === id) return bentoDrag.rect;              // Bento: being dragged
    if (cover === id) return { x: -s.left, y: -s.top, w: innerWidth, h: innerHeight };   // the whole Vivaldi window
    if (pip.includes(id)) return pipRect(id, s);                    // the corner stack
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
  function pipRect(id, s) {
    const c = pipCorner.get(id) || "bl", bottom = c[0] === "b";
    const W = Math.max(180, Math.min(s.width - 2 * MARGIN, pipW.get(c) || 360));
    const x = c[1] === "r" ? s.width - MARGIN - W : MARGIN;
    let edge = bottom ? s.height - MARGIN : MARGIN;
    for (const p of [...pip].reverse()) {
      if ((pipCorner.get(p) || "bl") !== c) continue;
      const h = Math.max(120, Math.min(s.height - 2 * MARGIN, pipH.get(p) || 240));
      const y = bottom ? edge - h : edge;
      if (p === id) return { x, y: Math.max(0, Math.min(s.height - h, y)), w: W, h };
      if (!awayWs(p) && !minimized.has(p)) edge = bottom ? y - PIP_GAP : y + h + PIP_GAP;   // only the ones on this desktop take room
    }
    return { x, y: MARGIN, w: W, h: 240 };
  }
  function setPx(id, r, s = stackRect()) {
    frac[id] = { x: r.x / s.width, y: r.y / s.height, w: r.w / s.width, h: r.h / s.height };
  }
  /* exact position:fixed origin for children of `parent` (a probe that never animates) */
  function fixedOrigin(parent) {
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
  const SPR_MOVE = spring(0.42, 0.90);   // move / resize / place changes
  const SPR_SHUT = spring(0.30, 1.00);   // close / minimize: quick, no bounce
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
      e.animate(
        [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
         { transformOrigin: "0 0", transform: "none" }],
        SPR_MOVE
      );
    });
  }
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
    // the window drops in: a gentle press down, then a soft rise back
    icon.animate([
      { transform: "none", transformOrigin: "50% 100%" },
      { transform: "translateY(1.5px) scale(1.04, 0.92)", transformOrigin: "50% 100%", offset: 0.3 },
      { transform: "translateY(-1px) scale(0.99, 1.03)", transformOrigin: "50% 100%", offset: 0.65 },
      { transform: "none", transformOrigin: "50% 100%" },
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
      bar.innerHTML = `<div class="ft-lights">${LIGHTS_HTML}</div><div class="ft-title"></div>` +
        `<div class="ft-right"><button class="ft-light ft-gray ft-res" data-act="res"></button></div>`;
      el.appendChild(bar);
    }
    if (bar.dataset.ftPage !== id) bar.dataset.ftPage = id;
    const pct = Math.round((zoomOf[id] || 1) * 100);
    const gray = $(".ft-res", bar), tip = `Resolution ${pct}% - click for more room`;
    if (gray.title !== tip) gray.title = tip;
    const tid = groupFloat.has(id) ? (splitFocus.get(id) || id) : id;   // a split: its selected tile
    fetchTitle(tid);
    const tEl = $(".ft-title", bar), raw = titles.get(tid) || "";
    const title = /^(chrome|vivaldi|about):/i.test(raw) ? "" : raw;     // never an internal address
    if (tEl.textContent !== title) tEl.textContent = title;
  }
  const removeChrome = el => $$(":scope > .ft-titlebar, :scope > .ft-resize", el).forEach(e => e.remove());

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
  const GRAB = 10;
  function placeFrame(id, el, r, s, o) {
    const f = frameFor(id, el);
    const g = noTitle.has(id) && isSplitWindow(el) ? GRAB : 0;
    if (f.hasAttribute("data-ft-grab") !== !!g) f.toggleAttribute("data-ft-grab", !!g);
    place(f, { x: r.x - RING, y: r.y - RING - g, w: r.w + 2 * RING, h: r.h + 2 * RING + g }, s, o);
    setStyle(f, "z-index", el.style.getPropertyValue("z-index") || "100");
  }

  /* inside a floating split the scale is per page: each page has its own
     scale button on a small frosted corner (top right). The window's three
     buttons (top edge) stay as they were, for the whole split. */
  const INNER_HTML = `<button class="ft-light ft-gray ft-res" data-act="page-res" title="This page's scale"></button>`;
  function ensureInner(pages) {
    for (const page of pages) {
      if (!isTiled(page) || $(":scope > .ft-inner", page)) continue;
      const box = document.createElement("div");
      box.className = "ft-inner";
      box.innerHTML = INNER_HTML;
      page.appendChild(box);
    }
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
                  { duration: 1100, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => label.remove());
  }
  function pageAct(what, page) {
    const id = page.dataset.id, w = winOf(id);
    if (what === "res") {                           // only this page's scale
      const steps = [1, 0.85, 0.7, 0.55], now = pageZoom[id] ?? zoomOf[w] ?? 1;
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
  function render() {
    reconcile();
    bentoForDesk();
    {                                                // the selected tile of a floating split
      const a0 = pendingActive ?? activePage()?.dataset.id, w0 = winOf(a0);
      if (w0 && groupFloat.has(w0) && pageOf(a0)) splitFocus.set(w0, String(a0));
    }
    if (focusSet.size) {                             // windows that left drop out; the chosen tab joins
      for (const f of [...focusSet]) if (!floating.has(f) || minimized.has(f)) focusSet.delete(f);
      const aid = activePage()?.dataset.id, aw = winOf(aid);
      if (focusSet.size && aid && !pendingActive && aw !== focusSeenWin) {   // another tab was chosen (keyboard)
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
    for (const p of [...pip]) if (!floating.has(p) || !pageOf(p)) pipOff(p);
    if (cover) coverWas = cover;
    else if (coverWas) { coverWas = null; coverTill = Date.now() + 450; setTimeout(queueRender, 470); }   // it glides back first
    b.toggleAttribute("data-ft-cover", !!cover || Date.now() < coverTill);   // (before anything is measured: the page area stops clipping)
    { // the keyboard focus never stays in a window behind the front one: a click in it is
      // then always heard (it focuses the page) and brings that window to the front
      const aw = document.activeElement?.closest?.("[data-ft-float]");
      if (aw && front && aw.dataset.ftFloat !== front) setTimeout(() => {
        const w = document.activeElement?.closest?.("[data-ft-float]");
        if (w && w.dataset.ftFloat !== topWindow(null)) unfocusPage();
      }, 0);
    }
    const windows = [];
    for (const id of new Set([...floating, ...minimized])) {
      const page = pageOf(id), el = targetOf(page);
      if (!el) continue;
      if (isTiled(page) && el.classList.contains("tile")) { mark(el.parentElement, "data-ft-parent"); mark(siblingOf(el), "data-ft-sibling"); }
      if (minimized.has(id)) { mark(el, "data-ft-min", id); continue; }
      mark(el, "data-ft-float", id);
      if (id === front) mark(el, "data-ft-front");
      if (noTitle.has(id) && cover !== id) mark(el, "data-ft-notitle");   // full view: its title bar moves the Vivaldi window
      if (cover === id) mark(el, "data-ft-cover");
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
      else if (String(a0) !== underId && !awayWs(underId)) {
        mark(up, "data-ft-under");
        for (let p = up.parentElement; p && p.id !== "webpage-stack"; p = p.parentElement) mark(p, "data-ft-chain");
      }
    }
    // measure everything first (one layout), then write
    const origins = new Map();
    for (const w of windows) {
      if (!origins.has(w.el.parentElement)) origins.set(w.el.parentElement, fixedOrigin(w.el.parentElement));
    }
    bentoSync(s);
    { const w = curWs(); if (w !== undefined && w !== lastWsShown) { lastWsShown = w; setTimeout(noBlankFront, 150); } }
    const slots = mission && b.hasAttribute("data-ft-desktop") ? missionSlots(windows.filter(w => !awayWs(w.id) && w.id !== missionSkip && (!mission.frozen || mission.frozen.has(w.id))), s) : null;
    if (mission) mission.slots = slots;
    missionIcons(slots, s);
    for (const { id, el } of windows) {
      addChrome(el, id);
      const held = missionDrag?.id === id;
      const r = held ? missionDrag.r : liveMove?.id === id ? liveMove.base : pxRect(id, s), o = origins.get(el.parentElement);
      place(el, r, s, o);
      const lifted = focusSet.has(id) || focusLeave.has(id) || (!focusSet.size && focusLift.has(id));   // above the blur
      setStyle(el, "z-index", bentoDrag?.id === id ? "2000"          // Bento: the dragged window rides above the drop preview
        : cover === id ? "90000"                                     // full view: over the tab bar and Vivaldi's buttons (under the Launchpad and alerts)
        : pip.includes(id) ? String(1900 + (id === front ? 50 : pip.indexOf(id)))   // the corner stack: always on top
        : String((lifted ? 1000 : 100) + zOrder.indexOf(id)));
      placeFrame(id, el, r, s, o);
      missionLook(id, el, held ? { x: r.x, y: r.y, k: missionDrag.k } : slots?.get(id) || null, r);   // Mission Control: scaled, not resized
      frames.get(id)?.toggleAttribute("data-ft-focused", focusSet.has(id));
      frames.get(id)?.toggleAttribute("data-ft-away", awayWs(id));
      frames.get(id)?.toggleAttribute("data-ft-hide", cover === id);   // full view: not resized there
    }
    if (focusSet.size) focusLift = new Set(focusSet);
    wsAnimate(windows);
    b.toggleAttribute("data-ft-wins", windows.some(w => !awayWs(w.id)));   // windows on this desktop (js/launchpad.js)
    veilFor(focusSet.size > 0, s);
    bentoAfterPlace(s);
    {
      const live = new Set(windows.map(w => w.id));
      for (const [id, f] of frames) if (!live.has(id)) { f.remove(); frames.delete(id); }
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
    const desktop = !!act && !!winOf(actId);
    if (act && !isStart(act)) onDesktop = desktop;
    b.toggleAttribute("data-ft-desktop", desktop);
    b.toggleAttribute("data-ft-has-floats", floating.size > 0);
    b.toggleAttribute("data-ft-home", !!act && isStart(act));     // the Start Page (empty desktop)
    b.toggleAttribute("data-ft-maxpage", !!act && !desktop && !isStart(act) && !isTiled(act));   // a full-screen page
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
    if (selId !== lastSiteTab) { lastSiteTab = selId; updateSiteName(); }
    else if (siteFor != null) for (const f of $$(".UrlBar-AddressField .UrlField")) {   // a re-drawn field
      if (f.getAttribute("data-ft-site") !== siteFor) f.setAttribute("data-ft-site", siteFor);
    }
    ensureClock();

    ensureLights($$("#webpage-stack .webpageview[data-id]"));
  }

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
  let toneFor = null, toneBusy = false, toneTimer = 0;
  function clockTone() {
    const b = browserEl();
    if (!b || toneBusy) return;
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
      const name = /^chrome:\/\/vivaldi-webui\/startpage/.test(url) || !url ? "" : siteName(tab.title || "", url);
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
    const tabs = await tabsQuery({ currentWindow: true });
    const others = tabs.filter(t => t.id !== tabIdOf(exceptId) && !minimized.has(String(t.id)));
    if (!others.length) return null;
    return others.filter(t => t.lastAccessed).sort((a, b) => b.lastAccessed - a.lastAccessed)[0] || others[others.length - 1];
  }

  function restore(id) {
    if (!minimized.delete(id)) return;
    minKind.delete(id);
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

    if (action === "zoom") {
      const win = winOf(id);
      if (win && (cover === win || pip.includes(win))) return holdAct(cover === win ? "zoom" : "minimize", win);   // back as it was
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
      if (!floating.has(id)) return;
      const steps = [1, 0.85, 0.7, 0.55], now = zoomOf[id] || 1;
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
                      { duration: 1100, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => label.remove());
      }
      persist(id);
      render();
      return;
    }

    { const w = winOf(id);                                           // minimized or closed: no longer full view / in the corner
      if (w && action === "minimize" && pip.includes(w)) return holdAct("minimize", w);   // in the corner: back to normal
      if (w && (action === "minimize" || action === "close")) { if (cover === w) cover = null; const ps = pip.filter(p => p !== w).map(p => targetOf(pageOf(p))); if (pipOff(w)) flip(ps, () => render()); } }
    busy.add(id);
    let fade = null;
    try {
      if (action === "close") {
        const wasFloating = floating.has(id);
        fade = await animateOut(el, "close");                       // stays invisible (fill) until removed
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
          minimized.add(id); minKind.set(id, "float");
          const next = topWindow(id);
          if (next) { raise(next); activate(next); }
        } else if (tiled) {
          minimized.add(id); minKind.set(id, "tile");
          if (sibPage) activate(sibPage.dataset.id);
        } else {
          // maximized page: go back to the previous tab; if it is the only tab,
          // keep it minimized on the desktop (wallpaper). Its tab brings it back.
          const t = await previousTab(id);
          if (t) activate(t.id);
          else { minimized.add(id); minKind.set(id, "max"); }
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
    const shield = document.createElement("div");
    shield.className = "ft-shield"; shield.style.cursor = CURSOR[how] || "grabbing";
    document.body.appendChild(shield);
    let frame = 0, last = null, moved = false;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const dx = last.clientX - sx, dy = last.clientY - sy;
      if (how === "move") {                                          // it follows the pointer, to whichever corner
        moved = moved || Math.hypot(dx, dy) > 4;
        const t = `${Math.round(dx)}px ${Math.round(dy)}px`;
        el.style.setProperty("translate", t, "important"); frames.get(id)?.style.setProperty("translate", t, "important");
        return;
      }
      if (/[lr]/.test(how)) pipW.set(c, Math.max(180, Math.min(s0.width * 0.85, w0 + (how.includes("r") ? dx : -dx))));   // every window in this corner
      if (/[tb]/.test(how)) pipH.set(id, Math.max(120, Math.min(s0.height - 2 * MARGIN, h0 + (how.includes("b") ? dy : -dy))));   // only this one
      render();
    };
    const onMove = ev => { if (ev.pointerId !== pid) return; last = ev; if (!frame) frame = requestAnimationFrame(apply); };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      cancelAnimationFrame(frame); frame = 0;
      shield.remove();
      removeEventListener("pointermove", onMove, true); removeEventListener("pointerup", onUp, true); removeEventListener("pointercancel", onUp, true);
      if (how !== "move") return render();
      const f = frames.get(id), clear = () => { el.style.removeProperty("translate"); f?.style.removeProperty("translate"); };
      if (!moved || ev.type !== "pointerup") return clear();
      const sr = stackRect();
      const to = (ev.clientY < sr.top + sr.height / 2 ? "t" : "b") + (ev.clientX < sr.left + sr.width / 2 ? "l" : "r");
      const els = pip.map(p => targetOf(pageOf(p)));
      flip(els, () => {                                              // it glides into that corner (newest there: at the corner)
        clear();
        if (!pip.some(p => p !== id && (pipCorner.get(p) || "bl") === to)) pipW.set(to, pipW.get(c) || w0);   // an empty corner takes its width
        pipCorner.set(id, to);
        pip.splice(pip.indexOf(id), 1); pip.push(id);
        render();
      });
    };
    shield.__end = () => { try { onUp({ pointerId: pid, type: "pointercancel", clientX: 0, clientY: 0 }); } catch (err) {} };
    addEventListener("pointermove", onMove, true); addEventListener("pointerup", onUp, true); addEventListener("pointercancel", onUp, true);
  }
  let btnHold = null;
  function pipZoom(id, on) {
    webviewsOf(id).forEach(wv => {
      const own = pageZoom[wv.closest(".webpageview")?.dataset.id];
      setWebZoom(wv, (own ?? zoomOf[id] ?? 1) * (on ? PIP_K : 1));
    });
  }
  function pipOff(id) {
    const i = pip.indexOf(id);
    if (i < 0) return false;
    pip.splice(i, 1); pipZoom(id, false); pipH.delete(id); pipCorner.delete(id);
    return true;
  }
  function holdAct(what, win) {
    const el = targetOf(pageOf(win));
    if (!el || !floating.has(win)) return;
    raise(win); activate(splitFocus.get(win) || win);
    const others = [...floating].filter(p => p !== win && !minimized.has(p) && !awayWs(p)).map(p => targetOf(pageOf(p)));   // the stack, and Bento closing / opening the gap, glide too
    if (what === "zoom") flip([el, ...others], () => { if (cover === win) cover = null; else { pipOff(win); cover = win; } render(); });
    else {
      const r = el.getBoundingClientRect();                          // 70% of the size it has on the screen now
      flip([el, ...others], () => {
        if (!pipOff(win)) {
          if (cover === win) cover = null;
          const c = "bl";
          if (!pip.some(p => (pipCorner.get(p) || "bl") === c)) pipW.set(c, Math.max(180, r.width * PIP_K));   // a corner in use keeps its width
          pipH.set(win, Math.max(120, r.height * PIP_K));
          pipCorner.set(win, c); pip.push(win); pipZoom(win, true);
        }
        render();
      });
    }
  }
  addEventListener("pointerdown", ev => {
    btnHeldAt = 0;                                                   // a new press: the last hold's click is long gone
    if (btnHold) { clearTimeout(btnHold.t); btnHold.btn.removeAttribute("data-ft-holding"); btnHold = null; }
    if (ev.button !== 0) return;
    const btn = ev.target?.closest?.('.ft-titlebar .ft-light[data-act="zoom"], .ft-titlebar .ft-light[data-act="minimize"]');
    const win = btn && winOf(btn.closest(".ft-titlebar")?.dataset.ftPage);
    if (!win || !floating.has(win) || minimized.has(win)) return;
    const hold = { btn, x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
    btn.setAttribute("data-ft-holding", "");
    hold.t = setTimeout(() => {
      btn.removeAttribute("data-ft-holding");
      if (btnHold === hold) btnHold = null;
      btnHeldAt = Date.now();                                        // the click on letting go is not a click
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
  function setWebZoom(wv, z) {
    if (!wv || typeof wv.setZoom !== "function") return;
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
      if (pip.includes(id)) z = (z || 1) * PIP_K;                    // in the corner stack
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
  function bentoForDesk() {                            // another desktop: its own Bento comes out
    const k = deskKey();
    if (bento.ws === k) return;
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
                { transformOrigin: "0 0", transform: "none" }], MJ);
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
  const bArea = (s = stackRect()) => ({ x: MARGIN, y: MARGIN, w: Math.round(s.width - 2 * MARGIN), h: Math.round(s.height - 2 * MARGIN) });
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
        let el = host.querySelector(`:scope > .bento-divider[data-id="${d.id}"]`);
        if (!el) { el = document.createElement("div"); el.className = "bento-divider"; el.dataset.id = d.id; host.appendChild(el); }
        el.dataset.axis = d.axis;
        place(el, d.r, s, o);
        setStyle(el, "z-index", "950");
      }
    }
    for (const el of document.querySelectorAll(".bento-divider")) if (!want.has(el.dataset.id)) el.remove();
    bentoGrips(s);
    bentoDim(s);
    bentoSave();
    bentoButton();
  }

  function bentoGrips(s) {
    const host = stack();
    if (!host || !bento.layout || !bento.root) {
      bento.handles = []; bento.handlesKey = "";
      document.querySelectorAll(".bento-grip").forEach(g => g.remove());
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
      let el = host.querySelector(`:scope > .bento-grip[data-key="${x.key}"]`);
      if (!el) { el = document.createElement("div"); el.className = "bento-grip"; el.dataset.key = x.key; host.appendChild(el); }
      el.toggleAttribute("data-long", long);
      place(el, g, s, o);
      setStyle(el, "z-index", long ? "951" : "952");            // the singles sit on the joined line
    }
    for (const el of document.querySelectorAll(".bento-grip")) if (!want.has(el.dataset.key)) el.remove();
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
          .finished.catch(() => {}).then(() => d.remove());
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
    for (const g of document.querySelectorAll(".bento-grip"))
      if (g.hasAttribute("data-hot") !== hot.has(g.dataset.key)) g.toggleAttribute("data-hot", hot.has(g.dataset.key));
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

  function bentoToggle(force) {
    const on = force ?? !bento.on;
    if (on === bento.on) return;
    bTransition(() => {
      if (on) {
        bento.on = true; bento.pre = {}; bento.skip = new Set(); bento.shape = ""; bento.undo = []; bento.redo = [];
        for (const id of floating) if (frac[id]) bento.pre[id] = { ...frac[id] };
        const members = bMembers();
        bento.root = members.length ? (bRestore(members, bArea()) || bActivate(members.map(bLeaf), bArea())) : null;
      } else {
        bento.on = false; bento.root = null; bento.shape = ""; bento.undo = []; bento.redo = []; bentoDrag = null; bento.memo.clear();
        for (const id of floating) {                // every window back to where it was before Bento
          if (bento.pre[id]) frac[id] = bento.pre[id];
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
            desk = true; show(null);
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
      if (w?.hasAttribute("data-ft-float")) startGesture(ev, w, "move");
    };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      cancelAnimationFrame(frame); clearTimeout(holdTimer); clearTimeout(topTimer); clearTimeout(deskT); bEnded = true;
      let toCard = null, deskList = [];
      if (desk) {                                                    // let go over the desktops
        toCard = ev.type === "pointerup" ? deskOn : null; deskOn?.removeAttribute("data-drop");
        deskList = wsStrip?.__list || [];
        ntrace("bento drop", { card: toCard ? (toCard.classList.contains("vos-ws-more") ? "new" : toCard.dataset.ws) : null });
        closeWsStrip(); proposal = null;
      }
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
        toDesk(id, toCard.dataset.ws ? (deskList.find(w => String(w.id) === toCard.dataset.ws)?.id ?? null) : null);
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
  const bentoIcon = on => `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill-rule="evenodd" d="` +
    BENTO_SLOTS.map(([x, y, w, h]) => rrect(x, y, w, h, 1.9) + (on ? "" : rrect(x + 1.3, y + 1.3, w - 2.6, h - 2.6, 0.8))).join("") + `"/></svg>`;
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
    { key: "vosmission", label: "OS · Mission Control" },
    { key: "vostimer", label: "OS · Timer" },
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
      if (!vals.some(v => Array.isArray(v) && v.includes(BENTO_CHAIN))) {
        const tb = Array.isArray(vals[4]) ? [...vals[4]] : [];
        const at = tb.indexOf("WorkspaceButton");
        tb.splice(at >= 0 ? at + 1 : 0, 0, BENTO_CHAIN);
        await prefSet("vivaldi.toolbars.tabbar_before", tb);
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
  const MC_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><rect x="2" y="3" width="6" height="5" rx="1.3"/><rect x="10" y="3" width="6" height="5" rx="1.3"/><rect x="2" y="10" width="14" height="5" rx="1.3"/></svg>';
  const TIMER_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="9" cy="10.2" r="5.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 10.2V7.2M7 2.6h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function osWidgets() {                            // Mission Control and Timer: their drawing and click
    const found = osChainButtons();
    for (const [key, icon, act] of [["vosmission", MC_ICON, () => openWsStrip()], ["vostimer", TIMER_ICON, b => window.vosTimer?.toggle(b)]]) {
      const btn = found[key];
      if (!btn) continue;
      const wrap = btn.closest(".button-toolbar") || btn;
      if (!wrap.__vosChain) {
        wrap.__vosChain = true;
        wrap.classList.add("vos-chain", "vos-chain-" + key);
        wrap.addEventListener("pointerdown", ev => { if (!editingToolbar()) ev.stopPropagation(); }, true);
        wrap.addEventListener("click", ev => { if (editingToolbar()) return; ev.preventDefault(); ev.stopPropagation(); act(wrap); }, true);
      }
      if (!btn.querySelector(":scope > .vos-chain-ic")) { const ic = document.createElement("span"); ic.className = "vos-chain-ic"; ic.innerHTML = icon; btn.appendChild(ic); }
    }
  }
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
        wrap.addEventListener("click", ev => { if (editingToolbar()) return; ev.preventDefault(); ev.stopPropagation(); bentoToggle(); }, true);
      }
      let ic = chain.querySelector(":scope > .vos-bento-ic");
      if (!ic) { ic = document.createElement("span"); ic.className = "vos-bento-ic"; chain.appendChild(ic); ic.__on = null; }
      if (ic.__on !== bento.on) { ic.__on = bento.on; ic.innerHTML = bentoIcon(bento.on); }
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
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); bentoToggle(); });
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

  function startGesture(e, el, how) {
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
    const pid = e.pointerId;
    const shield = document.createElement("div");
    shield.className = "ft-shield";
    shield.style.cursor = CURSOR[how];
    document.body.appendChild(shield);
    shield.__end = () => { try { onUp({ pointerId: pid, type: "pointercancel", clientX: 0, clientY: 0, screenX: 0, screenY: 0 }); } catch (e) {} };   // a stale drag can always be ended
    let frame = 0, last = null;
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
    const shake = shaker();
    const snapCheck = (x, y) => {
      if (how !== "move" || deskDrop) return;
      const z = snapZone(x, y);
      if (z === zone) return;
      zone = z;
      clearTimeout(zoneTimer); clearTimeout(deskTimer);
      if (shown) { snapPreview(null); shown = null; }
      if (z) zoneTimer = setTimeout(() => { shown = z; snapPreview(z, el); }, SNAP_HOLD);
      if (z === "full") deskTimer = setTimeout(openDeskDrop, SNAP_HOLD + 700);
    };
    const deskCheck = (x, y) => {
      if (!deskDrop) return;
      const card = document.elementsFromPoint(x, y).find(n => n.classList?.contains("vos-ws-card") && !n.classList.contains("vos-ws-more") && !n.hasAttribute("data-current")) || null;
      if (card !== deskOver) { deskOver?.removeAttribute("data-drop"); deskOver = card; deskOver?.setAttribute("data-drop", ""); }
    };

    const onMove = ev => {
      if (ev.pointerId !== pid) return;                             // another finger
      last = ev; px = ev.clientX; py = ev.clientY;
      const out = how === "move" && isOutside(ev);                  // past the edge of this Vivaldi window
      if (out !== leaving) { leaving = out; out ? dragOutStart(id, el, ev) : dragOutCancel(); }
      if (out) { dragOutMove(ev.screenX, ev.screenY); return; }
      snapCheck(px, py);
      deskCheck(px, py);
      if (how === "move" && bento.on && shake(px, ev.timeStamp)) bentoToggle(false);   // shake: Bento off
      if (Math.hypot(px - sx, py - sy) > 4) moved = true;
      if (frame) return;                                            // at most one update per frame
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (mission && inMission && how === "move") {                // Mission Control: the small window follows the pointer
          const cur = pxRect(id, ss);
          const d = { x: last.clientX - ss.left - gOff.x, y: last.clientY - ss.top - gOff.y, w: cur.w, h: cur.h };
          missionDrag = { id, r: d, k: kHeld };
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
      clearTimeout(holdTimer);
      if (scaling) { breathOut(el); label?.remove(); }
      holdTimer = 0;
      shield.remove();
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
      removeEventListener("pointercancel", onUp, true);
      clearTimeout(zoneTimer); clearTimeout(deskTimer);
      const heldMD = missionDrag?.id === id ? missionDrag : null, wasHeld = !!heldMD; missionDrag = null;
      if (missionSkip === id) missionSkip = null;
      if (deskDrop) {                                               // the desktops panel is open
        const card = deskOver; deskOver?.removeAttribute("data-drop");
        ntrace("drop", { card: card ? (card.classList.contains("vos-ws-more") ? "new" : card.dataset.ws) : null, type: ev.type, inMission });
        const strip = wsStrip, list = strip?.__list || [];
        const keep = inMission && card && !card.classList.contains("vos-ws-more");   // Mission Control stays open
        if (!keep && (!inMission || card || !moved)) closeWsStrip();
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
          return toDesk(id, ws);
        }
        if (inMission) { if (wasHeld) { missionGlide(); queueRender(); } return; }   // let go elsewhere: it glides back
      }
      if (leaving) {                                                // let go outside: to the Vivaldi window under it
        const target = dragOutEnd(ev.screenX, ev.screenY, ev.type === "pointerup");
        if (ev.type === "pointerup") { if (shown) snapPreview(null); persist(id); return toOtherWindow(id, ev.screenX, ev.screenY, target); }
      }
      const snap = ev.type === "pointerup" ? shown : null;
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
    let img = "";
    try { img = await new Promise(res => chrome.tabs.captureVisibleTab(tab?.windowId, { format: "jpeg", quality: 55 }, d => { void chrome.runtime.lastError; res(d || ""); })); } catch (e) {}
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
  let ghost = null;
  if (dragCh) dragCh.onmessage = ({ data: m }) => {
    if (!m || m.from === myWin()) return;
    if (m.to != null) {                                   // an answer to my own drag
      if (m.to === myWin() && dragOut && m.type === "over") { dragOut.over = m.win; dragOut.overAt = Date.now(); }
      return;
    }
    if (m.type === "start") {
      ghost?.el.remove();
      const g = document.createElement("div");
      g.className = "vos-drag-ghost";
      Object.assign(g.style, { width: m.w + "px", height: m.h + "px", display: "none" });
      if (m.img) g.style.backgroundImage = `url("${m.img}")`;
      else g.innerHTML = `<img src="chrome://favicon2/?size=64&scaleFactor=2x&pageUrl=${encodeURIComponent(m.url)}&allowGoogleServerFallback=0">`;
      (browserEl() || document.body).appendChild(g);
      ghost = { el: g, ox: m.ox, oy: m.oy, from: m.from };
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
      if (m.drop && g.style.display !== "none") setTimeout(() => g.remove(), 900);   // stays until the window itself arrives
      else g.remove();
    }
  };
  async function toOtherWindow(id, sx, sy, toWin) {
    const page = pageOf(id);
    const ids = (groupFloat.has(id) && page ? membersOf(page) : [id]).map(tabIdOf).filter(Boolean);
    if (!ids.length) return;
    const tabs = (await Promise.all(ids.map(t => new Promise(r => chrome.tabs.get(t, x => { void chrome.runtime.lastError; r(x); })))))
      .filter(t => t && /^https?:/i.test(t.url || t.pendingUrl || ""));
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
    if (target) {
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
      floatOnLoad.add(id); floatOnLoadAt.set(id, Date.now()); siteReady.add(id);
      vstore.get(DROP_KEY).then(d => {
        if (d && Date.now() - d.t < 8000 && d.ids?.includes(id)) {
          const ss = stackRect();
          const lx = d.sx - window.screenX - ss.left, ly = d.sy - window.screenY - (window.outerHeight - window.innerHeight) - ss.top;
          setPx(id, clampRect({ x: lx - (d.ox ?? d.w / 2), y: Math.max(0, ly - (d.oy ?? 14)), w: d.w, h: d.h }, ss), ss);
        }
        floatNow(id, pageOf(id) || null); raise(id); queueRender();
      });
    });
  }

  /* SHAKE: a window shaken left-right while you drag it (4 quick turns) */
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
    const r = stack()?.getBoundingClientRect();
    if (!r) return null;
    if (y <= r.top + 1) return "full";                               // at the top edge, or on the tab bar above it
    if (x <= r.left + 1 || x <= 1) return "left";                    // at the left edge
    if (x >= r.right - 2 || x >= innerWidth - 2) return "right";     // at the right edge
    return null;
  }
  let snapEl = null;
  function snapPreview(zone, fromEl, taken) {
    const host = stack();
    if (!zone) {
      const old = snapEl; snapEl = null;
      if (!old) return;
      if (taken) { old.remove(); return; }                          // the window takes its place now
      old.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.96)" }], { duration: 160, easing: "ease-in", fill: "forwards" })
        .finished.catch(() => {}).then(() => old.remove());
      return;
    }
    if (!host) return;
    const ss = stackRect(), a = bArea(ss), half = Math.round((a.w - BGAP) / 2);
    const r = zone === "full" ? { x: 0, y: 0, w: ss.width, h: ss.height }
            : zone === "left" ? { x: a.x, y: a.y, w: half, h: a.h } : { x: a.x + a.w - half, y: a.y, w: half, h: a.h };
    const el = document.createElement("div");
    el.className = "ft-snap-preview";
    el.dataset.zone = zone;
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
    if (!id || floating.has(id) || isTiled(page) || isStart(page)) return;
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
      const tabs = await tabsQuery({ currentWindow: true });
      if (!tabs.some(t => ids.includes(String(t.id)) && t.active)) return;
      const z = [...zOrder].reverse().find(o => !ids.includes(o) && floating.has(o) && !minimized.has(o) && sameWs(wsOfTab.get(o), cur));
      const other = tabs.find(t => String(t.id) === z) || tabs.find(t => !ids.includes(String(t.id)) && sameWs(wsOfTab.get(String(t.id)), cur));
      await new Promise(r => other ? chrome.tabs.update(other.id, { active: true }, () => { void chrome.runtime.lastError; r(); })
                                   : chrome.tabs.create({ url: "chrome://vivaldi-webui/startpage", active: true }, () => { void chrome.runtime.lastError; r(); }));
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
  async function toDesk(id, ws) {
    { const w = winOf(String(id)) || String(id); if (cover === w) cover = null; pipOff(w); }   // to another desktop: as it normally is
    const key = String(id), cur = curWs();
    const pg = pageOf(key);                                          // every page of the window (a split has several)
    const ids = [...new Set([key, ...(pg && isTiled(pg) && groupFloat.has(key) ? membersOf(pg) : [])])];
    await handOver(ids, cur);
    pend(ids, ws);
    queueRender();                                                   // gone from this desktop at once
    await tpMove(ids, ws);
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
      ev.stopPropagation();                                          // not a reorder of the desktop
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
  let wsMenuEl = null;
  const closeWsMenu = () => { wsMenuEl?.remove(); wsMenuEl = null; };
  function wsMenu(sp, card, x, y, tabs, list) {
    closeWsMenu();
    const m = document.createElement("div");
    m.className = "lp-menu vos-vars vos-ws-menu";
    const add = (label, svg, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item" + (cls ? " " + cls : "");
      b.innerHTML = `<svg class="lp-mi-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svg}</svg><span class="lp-mi-text"></span>`;
      b.querySelector(".lp-mi-text").textContent = label;
      b.addEventListener("click", ev => { ev.stopPropagation(); fn(b); });
      m.appendChild(b); return b;
    };
    add("Rename", '<path d="M4 20l1.2-4.2L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M14 7l3 3"/>',
        () => { closeWsMenu(); card.querySelector(".vos-ws-name")?.__edit?.(); });
    const ids = (tabs || []).filter(t => wsOfTab.has(String(t.id)) && String(wsOfTab.get(String(t.id))) === String(sp.id)).map(t => t.id);
    const n = ids.length;
    const BIN = '<path d="M4.5 7h15M10 4h4M6.5 7l.9 12a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12M10 11v6M14 11v6"/>';
    // the nearest desktop of this window: the one before it, else the one after
    const shown = list.filter(w => wsStrip?.querySelector(`.vos-ws-card[data-ws="${CSS.escape(String(w.id))}"]`));
    const at = shown.findIndex(w => String(w.id) === String(sp.id));
    const near = at > 0 ? shown[at - 1] : shown[at + 1];
    const doDelete = async keep => {
      closeWsMenu();
      const api = vivWs();
      if (!api?.removeWorkspace || !near) return;
      lastDelete = Date.now();
      try {
        const wid = await winId();
        const now = await tabsQuery({ currentWindow: true });          // its tabs as they are now
        const its = now.filter(t => sameWs(extOf(t)?.workspaceId ?? null, sp.id)).map(t => String(t.id));
        if (keep && its.length) {                                    // its windows go to the nearest desktop - checked
          await tpMove(its, near.id);
          if (!(await arrivedAt(its, near.id, 2000))) { wsErr("delete", "its windows did not move - not deleted"); return; }
        }
        if (sameWs(curWs(), sp.id)) {                                // on it now: go to that desktop first (not to "no desktop")
          await switchWs({ id: near.id, name: near.name }, list);     // (it reads the order as it is now)
          await new Promise(r => setTimeout(r, 250));
        }
        await api.removeWorkspace(wid, sp.id);
        lastDelete = Date.now(); deskInfo = null;
        closeWsStrip(); setTimeout(openWsStrip, 300);
      } catch (e) { wsErr("delete", e); }
    };
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
  const tpMove = (ids, ws) => new Promise(res => {
    try {
      tpMove.lastErr = null;
      const r = vivaldi.tabsPrivate.move({ tabIds: ids.map(Number), target: "last", tweaks: ["do-not-reparent"], workspaceId: ws ?? "window" },
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
      // this window has desktops already: the pages go to its first one (no new desktop)
      const own = await myDesks(list, tabs, curWs());
      const first = list.find(w => own.has(String(w.id)) && (tabs || []).some(t => sameWs(wsOfTab.get(String(t.id)), w.id)));
      if (first) {
        await tpMove(loose.map(t => t.id), first.id);
        loose.forEach(t => wsOfTab.set(String(t.id), first.id)); wsNowAt = 0;
        return true;
      }
      if (list.some(w => own.has(String(w.id)))) return false;       // only empty ones: leave the pages be
      const names = new Set(list.map(w => w.name));
      let n = 1, name;
      do { name = "Desktop " + n++; } while (names.has(name));
      const id = await newDesk(list, true, name);
      if (id === undefined) return false;
      await tpMove(loose.map(t => t.id), id);                        // the active one too: you go along with it
      loose.forEach(t => wsOfTab.set(String(t.id), id)); wsNowAt = 0;
      const nl = (await prefGet("vivaldi.workspaces.list")) || [];
      try { vivWs()?.setOrder([id, ...nl.map(w => w.id).filter(x => String(x) !== String(id))]); } catch (e) { wsErr("order", e); }
      return true;
    } finally { unDefaulting = false; }
  }
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
    const list = (await prefGet("vivaldi.workspaces.list")) || [];
    const tabs = await tabsQuery({ currentWindow: true });
    const mine = await myDesks(list, tabs, curWs());
    const ds = list.filter(w => mine.has(String(w.id)));
    const i = ds.findIndex(w => sameWs(w.id, curWs()));
    const t = ds[i + dir];
    if (i < 0 || !t) return;
    if (wsStrip) closeWsStrip(false, !!mission);
    swipeTo({ id: t.id, name: t.name }, list, dir);
  }
  /* the desktops of this window, in order, and which one is shown (kept for a moment) */
  let deskInfo = null;
  async function desksNow(fresh) {
    if (!fresh && deskInfo && Date.now() - deskInfo.at < 30000 && sameWs(deskInfo.ws, curWs())) return deskInfo;
    const list = (await prefGet("vivaldi.workspaces.list")) || [];
    const tabs = await tabsQuery({ currentWindow: true });
    const mine = await myDesks(list, tabs, curWs());
    const ds = list.filter(w => mine.has(String(w.id)));
    return (deskInfo = { list, ds, i: ds.findIndex(w => sameWs(w.id, curWs())), ws: curWs(), at: Date.now() });
  }
  /* SWIPE THAT FOLLOWS THE FINGERS: two fingers sideways over the Mission Control (Workspaces)
     button move the windows with them; let go past a fifth of the screen (or flick) and the
     next desktop comes in, else they spring back. No desktop that way: they only stretch a little. */
  let sw = null, swTail = null, swQueue = null;
  const springs = new Set();                                         // spring-back animations still running
  const swItems = () => [...document.querySelectorAll(SWIPE_ITEMS)];
  const swFar = () => Math.min(220, innerWidth * 0.12);               // let go past this: the next desktop
  const dotsRow = () => dotsEl?.querySelector(".vos-ws-dots-row");
  addEventListener("wheel", ev => {
    if (!ev.target?.closest?.(WS_BTN + ", .vos-chain-vosmission") || document.querySelector("#browser.toolbar-edit-mode")) return;
    const k = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? innerWidth : 1, d = ev.deltaX * k;
    if (!sw && !swTail && Math.abs(d) <= Math.abs(ev.deltaY * k)) return;
    ev.preventDefault();                                             // not Vivaldi's back / forward swipe
    const now = ev.timeStamp || performance.now(), a = Math.abs(d);
    if (swTail) {                                                    // after a page turn: the flick's momentum is swallowed -
      const t = swTail;                                              // until new fingers start (a pause, growing again, the other way)
      t.rise = a > t.last * 1.3 + 1 ? t.rise + 1 : 0;
      const fresh = now - t.at > 140 || t.rise >= 2 || (a > 3 && Math.sign(d) !== t.dir);
      t.last = a; t.at = now;
      if (!fresh) return;
      swTail = null;
      if (!sw && a <= Math.abs(ev.deltaY * k)) return;               // new fingers going up / down: not a swipe
    }
    if (!a) return;
    if (swiping) {                                                   // the last desktop still sliding in: this swipe goes on right after
      if (!swQueue || now - swQueue.at > 140) swQueue = { acc: 0, at: now };
      swQueue.acc += d; swQueue.at = now;
      return;
    }
    if (!sw) swBegin(0, now);
    swFeed(d, now);
  }, { capture: true, passive: false });
  function swBegin(acc, now) {
    for (const a of springs) a.cancel();                             // a spring-back still running: the fingers take over
    springs.clear();
    sw = { acc, items: swItems(), info: deskInfo && sameWs(deskInfo.ws, curWs()) ? deskInfo : null, v: 0, at: now, hist: [] };
    if (!sw.info) { const s = sw; desksNow().then(d => { if (sw === s && !s.info) { s.info = d; swDraw(s); } }); }
    deskDots(true);
    if (acc) { swDraw(sw); sw.timer = setTimeout(swipeEnd, 110); }
  }
  function swFeed(d, now) {
    const s = sw, a = Math.abs(d), dt = Math.min(50, Math.max(4, now - s.at));
    s.v = s.hist.length ? s.v * 0.5 + (d / dt) * 0.5 : d / 16;       // px per ms, smoothed
    s.hist.push(a); if (s.hist.length > 4) s.hist.shift();
    s.at = now; s.acc += d;
    swDraw(s);
    clearTimeout(s.timer);
    const h = s.hist;                                                // only shrinking, steadily: the fingers have left (momentum)
    const coasting = h.length === 4 && h[1] <= h[0] && h[2] <= h[1] && h[3] <= h[2] && h[3] < h[0] * 0.92;
    if (coasting && Math.abs(s.v) > 0.5) return swipeEnd();          // a flick: the page turns now, not when the momentum dies out
    s.timer = setTimeout(swipeEnd, 110);                             // the fingers stopped or let go
  }
  function swDraw(s) {
    const info = s.info, dir = s.acc > 0 ? 1 : -1;
    const has = !info || !!info.ds[info.i + dir];
    const shown = has ? s.acc : s.acc * 0.2;                         // nothing there: a little rubber band
    for (const el of s.items) el.style.setProperty("translate", `${Math.round(-shown)}px 0px`);
    // the next desktop's windows come in from the side, with the fingers (macOS)
    const t = info?.ds[info.i + dir];
    if (s.inc && s.incDir !== dir) clearIncoming(s);
    if (t && !s.inc) { s.inc = incomingFor(t.id); s.incDir = dir; }
    for (const el of s.inc || []) el.style.setProperty("translate", `${Math.round(dir * innerWidth - shown)}px 0px`);
  }
  function incomingFor(ws) {                                         // another desktop's windows (and frames), shown for the swipe
    const els = [...floating].filter(id => !minimized.has(id) && sameWs(wsOfTab.get(String(id)), ws))
      .flatMap(id => [targetOf(pageOf(id)), frames.get(id)]).filter(Boolean);
    els.forEach(el => { el.setAttribute("data-ft-ws-leave", ""); el.setAttribute("data-vos-incoming", ""); });
    return els;
  }
  function clearIncoming(s) {
    for (const el of s.inc || []) {
      el.removeAttribute("data-ft-ws-leave"); el.removeAttribute("data-vos-incoming"); el.style.removeProperty("translate");
      el.getAnimations().forEach(a => { if (!(a instanceof CSSAnimation)) a.cancel(); });   // never left shifted off the screen
    }
    s.inc = null;
  }
  async function swipeEnd() {
    const s = sw; sw = null;
    if (!s) return;
    clearTimeout(s.timer);
    swTail = { last: s.hist[s.hist.length - 1] || 0, at: s.at, dir: Math.sign(s.acc) || 1, rise: 0 };   // what still comes is the flick's momentum
    const info = s.info || await desksNow();                         // still looking: wait for it, don't give up
    const dir = s.acc > 0 ? 1 : -1, t = info?.ds[info.i + dir];
    const v = Math.sign(s.v) === dir ? Math.abs(s.v) : 0;            // the fingers' speed toward that desktop (px per ms)
    const go = t && (Math.abs(s.acc) + v * 120 > swFar() || (v > 0.35 && Math.abs(s.acc) > 24));   // a paged scroll: where it would coast to
    if (go) {                                                        // carries on from where the fingers left it, as fast as they went
      dotsMark(info.i + dir);
      if (wsStrip) closeWsStrip(false, !!mission);
      const left = Math.max(40, innerWidth - Math.abs(s.acc));
      const ms = Math.round(Math.max(160, Math.min(320, v > 0.05 ? left / v * 1.7 : 320)));
      const y1 = Math.max(0.3, Math.min(1, 0.25 * v * ms / left));
      swipeTo({ id: t.id, name: t.name, incoming: s.incDir === dir ? s.inc : null, ms, ease: `cubic-bezier(0.25, ${y1.toFixed(2)}, 0.3, 1)` }, info.list, dir);
      return;
    }
    const ease = { duration: 260, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)" };
    for (const el of s.items) {                                       // springs back
      const from = el.style.getPropertyValue("translate") || "0px 0px";
      el.style.removeProperty("translate");
      const a = el.animate([{ translate: from }, { translate: "0px 0px" }], ease);
      springs.add(a); a.finished.catch(() => {}).then(() => springs.delete(a));
    }
    const inc = s.inc, d = s.incDir;                                  // the other desktop's windows slide back out
    for (const el of inc || []) {
      const from = el.style.getPropertyValue("translate") || "0px 0px";
      el.style.removeProperty("translate");
      const a = el.animate([{ translate: from }, { translate: `${d * innerWidth}px 0px` }], { ...ease, fill: "forwards" });
      springs.add(a);
      a.finished.catch(() => {}).then(() => {
          springs.delete(a);
          if (sw?.inc?.includes(el)) return;                         // a new swipe has it again: leave it be
          el.removeAttribute("data-ft-ws-leave"); el.removeAttribute("data-vos-incoming");   // hidden again first, then the animation goes
          el.getAnimations().forEach(a => a.cancel());
        });
    }
  }
  /* DESKTOP DOTS: over the Mission Control (Workspaces) button, a small pill shows the desktops of
     this window as dots, the shown one bright, with its name - also while you swipe */
  let dotsEl = null, dotsTimer = 0;
  function dotsSkin(el) {                                            // the address field's own look (its colors, corners, height)
    const af = document.querySelector("#tabs-tabbar-container .UrlBar-AddressField") || document.querySelector(".UrlBar-AddressField");
    if (!af?.offsetHeight) return;
    const cs = getComputedStyle(af), set = (k, v) => { if (v) el.style.setProperty(k, v, "important"); };
    const clear = /rgba\([^)]*,\s*0\)|transparent/.test(cs.backgroundColor) && cs.backgroundImage === "none";
    if (!clear) { set("background-color", cs.backgroundColor); set("background-image", cs.backgroundImage); }
    set("border", `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`);
    set("border-radius", cs.borderTopLeftRadius);
    if (cs.backdropFilter && cs.backdropFilter !== "none") set("backdrop-filter", cs.backdropFilter);
    set("height", af.offsetHeight + "px");
    set("color", cs.color);
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
    const btn = document.querySelector(".vos-chain-vosmission") || document.querySelector(WS_BTN);
    if (!show || !btn) { clearTimeout(dotsTimer); dotsTimer = setTimeout(() => { dotsEl?.setAttribute("data-out", ""); }, 600); return; }
    clearTimeout(dotsTimer);
    if (deskInfo && sameWs(deskInfo.ws, curWs())) { dotsDraw(deskInfo, btn); dotsEl.removeAttribute("data-out"); }   // at once from what is known
    const info = await desksNow(true);
    if ((swiping || sw) && dotsRow()) { dotsEl.removeAttribute("data-out"); return; }   // a switch under way: its dot is already lit
    dotsDraw(info, btn);
    dotsEl.removeAttribute("data-out");
    if (!sw && !btn.matches(":hover")) deskDots(false);
  }
  addEventListener("pointerover", ev => {
    if (document.querySelector("#browser.toolbar-edit-mode") || wsStrip) return;
    const on = ev.target?.closest?.(WS_BTN + ", .vos-chain-vosmission");
    const was = ev.relatedTarget?.closest?.(WS_BTN + ", .vos-chain-vosmission");
    if (on && on !== was) {
      for (const n of [on, ...on.querySelectorAll("[title]")]) if (n.hasAttribute("title")) { n.dataset.vosTitle = n.getAttribute("title"); n.removeAttribute("title"); }
      deskDots(true); desksNow();
    }
  }, true);
  addEventListener("pointerout", ev => {
    const from = ev.target?.closest?.(WS_BTN + ", .vos-chain-vosmission");
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
      const r = pxRect(id, s), cx = s.left + sl.x + r.w * sl.k / 2, by = s.top + sl.y + r.h * sl.k;
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
    el.animate([{ translate: "0px 0px", scale: "1", filter: "opacity(1)" },
                { translate: `${Math.round(dx)}px ${Math.round(dy)}px`, scale: String(sc), filter: "opacity(0)" }], opts)
      .finished.catch(() => {}).then(() => {
        if (missionDrag?.id === id) missionDrag = null;
        then();
        setTimeout(() => { el.getAnimations().forEach(a => a.cancel()); f?.getAnimations().forEach(a => a.cancel()); }, 700);   // gone from this desktop by then
      });
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
      .finished.catch(() => {}).then(() => st.remove());
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
    const ss = stackRect(), cur = curWs();
    const wall = getComputedStyle(browserEl()).getPropertyValue("--browserBackgroundImage").trim();
    const mine = await myDesks(list, tabs, cur);
    const loose = (tabs || []).some(t => wsOfTab.has(String(t.id)) && wsOfTab.get(String(t.id)) == null);
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
      const wins = [...zOrder].filter(id => floating.has(id) && !minimized.has(id) && wsOfTab.has(String(id)) && same(wsOfTab.get(String(id)), sp.id));
      for (const id of wins) {
        const r = same(sp.id, cur) ? pxRect(id, ss) : (otherTiles(sp.id, ss).get(id) || (() => { const f = frac[id]; return f ? { x: f.x * ss.width, y: f.y * ss.height, w: f.w * ss.width, h: f.h * ss.height } : null; })());
        if (!r) continue;
        const w = document.createElement("div");
        w.className = "vos-ws-win"; w.dataset.tab = String(id);
        Object.assign(w.style, { left: (r.x / ss.width * 100) + "%", top: (r.y / ss.height * 100) + "%", width: (r.w / ss.width * 100) + "%", height: (r.h / ss.height * 100) + "%" });
        const t = info.get(String(id));
        if (t?.url) { const im = document.createElement("img"); im.src = favicon(t.url); im.alt = ""; w.appendChild(im); }
        pagePicture(w, Number(id), r);                               // the web page itself (Vivaldi's tab thumbnail)
        mini.appendChild(w);
      }
      if (!wins.length) { const e = document.createElement("span"); e.className = "vos-ws-empty"; e.textContent = "No windows"; mini.appendChild(e); }
      card.appendChild(mini);
      const label = document.createElement("div");
      label.className = "vos-ws-label";
      const nm = document.createElement("span"); nm.className = "vos-ws-name"; nm.textContent = sp.name; label.appendChild(nm);
      if (sp.id != null) nm.__edit = editableName(nm, sp);          // click the name to rename it (Default is Vivaldi's own)
      card.appendChild(label);
      if (sp.id != null) {
        card.dataset.ws = String(sp.id);
        card.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); wsMenu(sp, card, ev.clientX, ev.clientY, tabs, list); });
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
  const SWIPE_ITEMS = "#webpage-stack [data-ft-float]:not([data-ft-min]):not([data-ft-away]), .ft-frame:not([data-ft-away])";
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
        if (gen === swipeGen) swiping = false;
      }
      return;
    }
    if (deskInfo) dotsMark(deskInfo.ds.findIndex(w => sameWs(w.id, sp.id)));   // the dot moves on now, not after the slide
    const side = dir > 0 ? "next" : "prev";
    const ms = sp.ms || 300, ease = sp.ease || "cubic-bezier(0.25, 0.8, 0.3, 1)";
    b.style.setProperty("--vos-swipe-ms", ms + "ms"); b.style.setProperty("--vos-swipe-ease", ease);
    swiping = true;
    const keep = new Set((sp.keep || []).map(String));                // the window that moves along: not left behind
    const leaving = [...document.querySelectorAll(SWIPE_ITEMS)].filter(el => !keep.has(el.dataset.ftFloat || el.dataset.ftFor || ""));
    if (mission) mission.frozen = new Set(mission.slots ? mission.slots.keys() : []);   // the new desktop's windows come in at full size
    b.setAttribute("data-vos-swipe", side);
    b.setAttribute("data-vos-swipe-in", side);                        // set first: a new window never shows before it slides in
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
      const made = await (sp.go ? sp.go() : switchWs(sp, list));    // at once: both desktops move together
      if (sp.id == null && made != null) sp.id = made;                // a desktop made just now
      while (Date.now() - t1 < 1500) { wsNowAt = 0; if (sameWs(curWs(), sp.id)) break; await new Promise(r => setTimeout(r, 20)); }
      render(); shownAt = Date.now();                                 // the new desktop's other windows slide in from now
      await new Promise(r => setTimeout(r, Math.max(0, ms - (Date.now() - t1))));
    } catch (e) { wsErr("swipe", e); }
    finally {                                                        // whatever happened: nothing stays half-done
      missionMode(null, true);                                        // Mission Control ends with the old desktop out of sight
      leaving.forEach(el => { el.removeAttribute("data-ft-swipe-out"); el.removeAttribute("data-ft-ws-leave"); el.style.removeProperty("translate"); });
      setTimeout(() => {                                             // once the last window has slid in
        for (const el of sp.incoming || []) el.removeAttribute("data-vos-incoming");
        if (gen !== swipeGen) return;                                // a newer swipe owns the rest
        b.removeAttribute("data-vos-swipe-in"); b.removeAttribute("data-vos-swipe"); swiping = false; deskDots(true);
        const q = swQueue; swQueue = null;                           // fingers already swiping again: they go on from here
        if (q && performance.now() - q.at < 160 && !sw) swBegin(Math.max(-innerWidth / 2, Math.min(innerWidth / 2, q.acc)), q.at);
      }, Math.max(0, (shownAt || Date.now()) + ms - Date.now()) + 40);
    }
  }
  async function switchWs(sp, list) {
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
  async function wsByTab(sp) {
    const tabs = await tabsQuery({ currentWindow: true });
    const t = (tabs || []).filter(x => { const k = String(x.id); return wsOfTab.has(k) && String(wsOfTab.get(k)) === String(sp.id); })
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (t) chrome.tabs.update(t.id, { active: true }, () => void chrome.runtime.lastError);
  }
  // the Workspaces button opens the strip (Vivaldi's own list only through "Manage…")
  for (const type of ["pointerdown", "mousedown", "click"]) {
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
    if (w && (cover === w || pip.includes(w))) { holdAct(cover === w ? "zoom" : "minimize", w); return true; }   // back as it was
    toggleFocus(key);
    return true;
  }

  const lpOn = () => !!window.vosLaunchpad?.isOpen;   // js/launchpad.js: the windows are not touchable under it
  function onPointerDown(e) {
    if (lpOn()) return;
    clearTimeout(hoverTimer);                                       // a click wins over a pending hover
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
      tabDown = { id: tabId, desktop: !!browserEl()?.hasAttribute("data-ft-desktop"), active: activePage()?.dataset.id, t: Date.now() };
      confirmTint(tabId);
      // a minimized window comes back — also when its tab is already active
      // (a single tab), where Vivaldi reports no tab switch
      const w = winOf(tabId);
      if (w && minimized.has(w)) setTimeout(() => restore(w), 0);
      return;
    }
    if (t.closest?.(".ft-max-grab")) return startMaxDrag(e);        // a full-screen page: drag it out
    if (t.closest?.(".ft-lights, .ft-right, .ft-inner")) return;
    const bd = t.closest?.(".bento-divider");                       // Bento: a gap between windows
    if (bd && bento.on) {
      e.preventDefault(); e.stopPropagation();
      const ss = stackRect(), hit = bHit(bento.handles, { x: e.clientX - ss.left, y: e.clientY - ss.top });
      return hit && bentoResize(e, [hit.d], hit.d.axis === "h" ? "ew-resize" : "ns-resize", hit.root);
    }
    if (t.closest?.(".ft-veil") && focusSet.size) {                 // a click outside the windows in focus
      e.preventDefault(); e.stopPropagation();
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
    if (!el) return;
    if (bar.classList.contains("mosaic-tile") && isSplitWindow(el)) return;   // tile drag (Vivaldi)
    if (bar.classList.contains("ft-titlebar") && pageOf(bar.dataset.ftPage) && doublePress(e, bar.dataset.ftPage)) return;
    startGesture(e, el, "move");
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
  setInterval(() => { if (!drag && seeing) seeThrough(null); }, 500);

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

  function onDragStart(e) {
    const strip = e.target.closest?.(".mosaic-tile");
    if (strip) {
      const win = strip.closest("[data-ft-float]");
      if (!win) return;                                             // a full-size split: Vivaldi's own
      if (!isSplitWindow(win)) { e.preventDefault(); return; }       // a lone floating tile moves as a window
      const id = strip.closest(".webpageview[data-id]")?.dataset.id;
      if (id) drag = { kind: "tile", id, src: win.dataset.ftFloat, desktop: true, x: e.clientX, y: e.clientY, over: null };
      return;
    }
    if (e.target.closest?.("[data-ft-float], .ft-lights")) { e.preventDefault(); return; }
    const id = tabIdAt(e.target);
    if (!id) return;
    // pressing the tab made it active and may have left the desktop: go back to it
    const down = tabDown && tabDown.id === id ? tabDown : null;
    tabDown = null;
    const desktop = !!down?.desktop;
    if (desktop && down.active && down.active !== id) activate(down.active, { quiet: true });
    drag = { kind: "tab", id, src: winOf(id), desktop, x: e.clientX, y: e.clientY, over: null };
  }

  function onDragOver(e) {
    if (!e.isTrusted || !(e.clientX || e.clientY)) return;
    if (!drag) {                                                    // its dragstart never reached us
      // a tab dragged out of the tab bar (Vivaldi starts those drags itself):
      // pressing it made it active and may have left the desktop - go back
      const down = tabDown && Date.now() - (tabDown.t || 0) < 3000 ? tabDown : null;
      tabDown = null;
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
    if (!e.isTrusted) return;                                       // our own "handled" signal
    const d = drag;
    if (!d) return;
    const x = e.clientX || d.x, y = e.clientY || d.y;
    const ids = dragIds(e.dataTransfer);
    if (ids.length && d.kind !== "tile") { d.id = ids[0]; if (d.kind === "unknown") d.src = winOf(ids[0]); }
    seeThrough(null);
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
  let hoverTimer = 0, noRaise = null, hover = null;
  function onHoverMove(e) {
    if (lpOn()) return;
    if (!e.buttons && drag) drag = null;                            // a drag that ended unseen
    if (e.pointerType && e.pointerType !== "mouse") return;
    if (e.buttons || drag || !browserEl()?.hasAttribute("data-ft-desktop")) return;
    const win = e.target.closest?.("[data-ft-float]:not([data-ft-min])");
    clearTimeout(hoverTimer);
    if (!win) {
      const sel = selected, a = activePage()?.dataset.id;
      if (sel && a && a !== sel && pageOf(sel) && window.__ftQuietTint === a) {
        hoverTimer = setTimeout(() => { noRaise = sel; activate(sel); }, 120);
      }
      return;
    }
    const id = win.dataset.ftFloat;
    const inner = isSplitWindow(win) ? e.target.closest?.(".webpageview[data-id]")?.dataset.id : null;
    const want = inner || id;
    if (activePage()?.dataset.id === want || pendingActive === want) return;
    hoverTimer = setTimeout(() => {
      noRaise = want;
      hover = { id: want, t: Date.now() };
      activate(want, { quiet: true });
      // Vivaldi focuses the page it activates; take that focus back, so the
      // first real click in the page counts as a click (front + color)
      setTimeout(() => { if (window.__ftQuietTint === want) unfocusPage(); }, 300);
    }, 90);
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
    const under = e.target.closest?.("[data-ft-under]");             // the full-screen page under them: it comes back
    if (under?.dataset.id) { activate(under.dataset.id); render(); return; }
    const win = e.target.closest?.("[data-ft-float]");
    if (!win) return;
    const id = win.dataset.ftFloat;
    const inner = e.target.closest?.(".webpageview[data-id]")?.dataset.id;
    const want = groupFloat.has(id) && inner ? inner : id;
    const own = hover && hover.id === want &&
      (hover.landed ? Date.now() - hover.landed < 60 : Date.now() - hover.t < 250);
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
  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }

  // windows keep relative places when the desktop resizes (sidebar, window size)
  let observedStack = null;
  const ro = new ResizeObserver(queueRender);
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
      if (btnHeldAt && Date.now() - btnHeldAt < 1500 && btn.matches('[data-act="zoom"], [data-act="minimize"]')) { btnHeldAt = 0; return; }   // it was held
      const barId = btn.closest(".ft-titlebar")?.dataset.ftPage;
      const page = barId ? pageOf(barId) : btn.closest(".webpageview");
      if (page) act(btn.dataset.act, page);
    }, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", () => { drag = null; }, true);
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
      if (hover && hover.id === id && !hover.landed) hover.landed = Date.now();   // the hover's switch landed
      pendingActive = null; clearTimeout(pendingTimer);             // any activation ends the wait
      if (window.__ftQuietTint != null && window.__ftQuietTint !== id) window.__ftQuietTint = null;
      if (window.__ftQuietTint !== id) selected = id;               // chosen, not just hovered
      if (holdDesktop === id) { holdDesktop = null; queueRender(); return; } // keep it minimized
      holdDesktop = null;
      const w = winOf(id);
      if (w && minimized.has(w)) return restore(w);                 // its tab was clicked
      if (w && floating.has(w) && noRaise !== id) raise(w);       // hover activation keeps the order
      noRaise = null;
      queueRender();
    });
    chrome.tabs.onCreated.addListener(tab => {
      // every new site opens as a floating window (the default).
      // No window check here: a tab from another window never gets a page in
      // this document, so it can't be floated here by mistake.
      const id = String(tab.id);
      floatOnLoad.add(id); floatOnLoadAt.set(id, Date.now());
      if (/^https?:/.test(tab.pendingUrl || tab.url || "")) siteReady.add(id);
      if (/^chrome:\/\/vivaldi-webui\/startpage/.test(tab.pendingUrl || tab.url || "") || !(tab.pendingUrl || tab.url)) startBorn.set(id, Date.now());
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
      floatOnLoadAt.delete(id); sawStart.delete(id);
      floatOnLoad.delete(id); siteReady.delete(id); inSplit.delete(id); delete frac[id]; noTitle.delete(id);
      groupMemory.delete(id); splitFocus.delete(id);
      forget(id);
      queueRender();
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
      if (floatOnLoad.has(id) && !siteReady.has(id) && u && !/^chrome:\/\/vivaldi-webui\/startpage|^about:blank|^chrome:\/\/newtab/i.test(u)) { siteReady.add(id); queueRender(); }
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
    vosBeat(bentoButton);                                             // the tab bar can be rebuilt
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
