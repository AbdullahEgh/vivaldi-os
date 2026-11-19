/* ==========================================================================
   Vivaldi as an OS — Launchpad (the + button)
   The Bookmark Bar as a Launchpad, like macOS. The + button in the tab bar
   opens and closes it (instead of a new tab); Home shows the desktop.
     • type            search every bookmark in it, folders included - it is
                       an address bar too: an address opens the site, other
                       words search the web ("Search the web" tile, or Enter
                       when no bookmark matches)
     • a site          opens it - or goes to its window if one is open
                       (Cmd/Ctrl-click: always a new one)
     • a folder        shows its first nine icons; click: it opens as a card
                       in the middle (click its name to rename it); folders
                       inside open in the same card (‹ goes back)
     • drag an icon    the others make room: drop to put it there
       hold it on another site         they become a new folder
       hold it on a folder             it goes into the folder
       drag it out of an open folder   it goes back to the Launchpad
                                       (an emptied folder disappears)
     • right-click     Open, Open in New Window, Edit… (name and address,
                       like the bookmark's properties), Copy Address, Delete;
                       a folder: Open, Rename…, Delete Folder (asks first)
     • Esc, a click on the empty space, or Home again   closes it
     • Folder          (editing mode, top left) Bookmarks, a manager in columns
                       like the Finder: every folder and bookmark, new, rename,
                       edit the address, delete, drag to move - and Show in
                       Launchpad picks the folder the Launchpad shows (saved)
     • Websites        (editing mode) open tabs and recent sites, ⊕ adds one;
                       the suggestions while typing have a ⊕ too (on hover)
     • typing          a suggestion list like the address bar: open tabs,
                       bookmarks, history, the address, a web search (↑ ↓ ⏎)
     • long-press      iOS editing mode: the icons jiggle, ⊖ deletes; the
                       edges show Folder (left) and Widgets / Done (right)
     • widgets         Clock (numbers or pills), Calendar (month), Timer -
                       small or medium, added from Widgets in editing mode;
                       drag one to put it anywhere among the icons
   While it is open the windows under it take no clicks, hovers or keys.
   The desktop: with no windows on it, the same Launchpad lives on the wallpaper
   (no blur); with windows, only the wallpaper. Right-click the empty space:
   Edit Home Screen, Change Wallpaper (the current theme's background image).
   Every change is saved in the bookmarks. Light or dark with the system.
   Styling: css/09-launchpad.css
   ========================================================================== */
(() => {
  "use strict";
  if (typeof chrome === "undefined" || !chrome.bookmarks) return;

  const BAR_FALLBACK = "1";                         // Chromium's bookmarks bar, if no folder is marked
  const HOLD = 380;                                 // ms to hold over an icon before it makes a folder
  const icon = url => `chrome://favicon2/?size=64&scaleFactor=2x&pageUrl=${encodeURIComponent(url)}&allowGoogleServerFallback=0`;
  const mini = url => `chrome://favicon2/?size=16&scaleFactor=2x&pageUrl=${encodeURIComponent(url)}&allowGoogleServerFallback=0`;
  const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const isFolder = n => !n.url;
  const nameOf = n => n.title || host(n.url) || "Untitled";
  const bm = (fn, ...args) => new Promise(res => chrome.bookmarks[fn](...args, r => { void chrome.runtime.lastError; res(r); }));
  let root = null;                                  // the Bookmark Bar folder (with its whole tree)

  const loadBar = () => new Promise(res => chrome.bookmarks.getTree(tree => {
    if (chrome.runtime.lastError || !tree?.[0]) return res(null);
    let bar = null;
    const walk = n => { if (bar) return; if (!n.url && (n.bookmarkbar === true || n.bookmarkbar === "true")) bar = n; else (n.children || []).forEach(walk); };
    walk(tree[0]);
    if (!bar) { const find = n => n.id === BAR_FALLBACK ? n : (n.children || []).map(find).find(Boolean); bar = find(tree[0]); }
    res(bar || null);
  }));
  const LP_FOLDER = "vosLaunchpadFolder";           // the folder shown (saved); none: the Bookmark Bar
  let chosen;                                       // undefined: not read yet
  async function load() {
    if (chosen === undefined) chosen = (await vstore.get(LP_FOLDER)) || null;
    if (chosen) {
      const r = await bm("getSubTree", chosen);
      if (r?.[0] && !r[0].url) return r[0];
    }
    return loadBar();
  }
  const findNode = (id, n = root) => !n ? null : n.id === id ? n : (n.children || []).map(c => findNode(id, c)).find(Boolean) || null;
  /* Vivaldi's window has no localStorage (it is null there): settings that
     must survive a restart live in chrome.storage.local */
  const vstore = {
    get: k => new Promise(r => { try { chrome.storage.local.get(k, o => { void chrome.runtime.lastError; r(o ? o[k] : undefined); }); } catch (e) { r(undefined); } }),
    set: (k, v) => { try { chrome.storage.local.set({ [k]: v }, () => void chrome.runtime.lastError); } catch (e) {} },
    del: k => { try { chrome.storage.local.remove(k, () => void chrome.runtime.lastError); } catch (e) {} },
  };
  /* a fresh Vivaldi: the Launchpad apps of the package (js/launchpad-seed.js)
     are added once into the Bookmark Bar folder - only what is missing, so
     nothing is ever duplicated and your own changes stay */
  let seeding = false, seedDone = false, seedTimer = 0;
  async function seedOnce() {
    const S = window.vosLaunchpadSeed;
    if (!S?.items?.length || !root || seeding || seedDone) return;
    // right after a start Vivaldi may still be putting back its own folders
    // (e.g. its "Home" speed dial): wait, so that folder is reused, never doubled
    if (performance.now() < 8000) {
      if (!seedTimer) seedTimer = setTimeout(() => { seedTimer = 0; seedOnce(); }, 8500 - performance.now());
      return;
    }
    seeding = true;                                 // one run only, from here on
    const mark = "vosLaunchpadSeed:" + S.stamp;
    if (await vstore.get(mark)) { seedDone = true; seeding = false; return; }
    // the public starter set only fills an EMPTY Launchpad: it never touches yours
    if (S.starter && items(root).length) { vstore.set(mark, "1"); seedDone = true; seeding = false; return; }
    try {
      // the folder that is the Bookmark Bar on the Mac (e.g. "Home"): found by
      // name at the top, else created; it becomes Vivaldi's Bookmark Bar (and
      // speed dial) folder here too, exactly as there
      const tree = await bm("getTree");
      const top = tree?.[0]?.children?.find(n => n.id === BAR_FALLBACK) || tree?.[0]?.children?.[0];
      let target = S.title ? (top?.children || []).find(n => !n.url && n.title === S.title) : null;
      if (!target && S.title && top) target = await bm("create", { parentId: top.id, title: S.title });
      if (target) {
        const others = [];
        const walk = n => { if (!n.url && n.id !== target.id && (n.bookmarkbar === true || n.bookmarkbar === "true")) others.push(n); (n.children || []).forEach(walk); };
        if (tree?.[0]) walk(tree[0]);
        for (const o of others) await bm("update", o.id, { bookmarkbar: false });
        await bm("update", target.id, S.speeddial ? { bookmarkbar: true, speeddial: true } : { bookmarkbar: true });
        root = await load();
      }
      const bar = await loadBar();
      if (!bar) { seeding = false; return; }
      const have = new Set(flat(items(bar)).map(n => n.url));
      async function into(parent, list) {
        for (const it of list) {
          if (it.u) {
            if (have.has(it.u)) continue;
            have.add(it.u);
            await bm("create", { parentId: parent.id, title: it.t, url: it.u });
          } else {
            let f = (parent.children || []).find(c => !c.url && c.title === it.t);
            if (!f) f = await bm("create", { parentId: parent.id, title: it.t });
            if (f) await into({ id: f.id, children: f.children || [] }, it.c || []);
          }
        }
      }
      await into(bar, S.items);
      vstore.set(mark, "1");
      seedDone = true;
    } catch (e) { console.warn("Launchpad seed", e); }
    seeding = false;
    root = await load();
  }
  async function refresh() {
    root = await load();
    await seedOnce();
    lp?.picker?.draw?.();                            // the folder manager stays in step
    if (!lp || drag) return;
    render();
    if (lp.card) {                                  // keep an open folder in step
      const f = findNode(lp.card.__folder.id);
      if (f && (f.children || []).length) openFolder(f, lp.card.__trail, false, true); else closeFolder(true);
    }
  }

  /* ---------------- open a site: its window if open, else a new one ---------------- */
  function openUrl(url, fresh) {
    const h = host(url);
    chrome.windows.getCurrent(w => {
      chrome.tabs.query({ windowId: w.id }, tabs => {
        const t = !fresh && h && tabs.find(x => host(x.url || x.pendingUrl || "") === h);
        if (t) chrome.tabs.update(t.id, { active: true });
        else chrome.tabs.create({ url, active: true, windowId: w.id });
      });
    });
  }

  /* ---------------- icons ---------------- */
  function siteIcon(url, src, cls) {
    const i = document.createElement("img");
    i.className = cls; i.alt = ""; i.draggable = false; i.src = src(url);
    i.onerror = () => {                             // no icon: the site's first letter
      const d = document.createElement("span");
      d.className = cls + " lp-letter";
      d.textContent = (host(url)[0] || "?").toUpperCase();
      i.replaceWith(d);
    };
    return i;
  }
  function tile(n) {
    const t = document.createElement("span");
    if (isFolder(n)) {
      t.className = "lp-tile lp-folder";
      for (const c of (n.children || []).filter(x => x.url).slice(0, 9)) t.appendChild(siteIcon(c.url, mini, "lp-mini"));
    } else {
      t.className = "lp-tile";
      t.appendChild(siteIcon(n.url, icon, "lp-favicon"));
    }
    return t;
  }

  let justDragged = false;
  function app(n, onOpen) {
    const a = document.createElement("button");
    a.type = "button"; a.className = "lp-app"; a.title = n.url || nameOf(n);
    a.__node = n;
    a.appendChild(tile(n));
    const l = document.createElement("span");
    l.className = "lp-name"; l.textContent = nameOf(n);
    a.appendChild(l);
    a.appendChild(delBadge(() => askDelete(n)));
    a.addEventListener("click", ev => {
      ev.stopPropagation();
      if (lp?.swallow) { lp.swallow = false; return; }
      if (lp?.menuJustClosed) { lp.menuJustClosed = false; return; }
      if (lp?.editing && !isFolder(n)) return;      // editing: a tap opens nothing (folders still open)
      if (!justDragged) onOpen(n, ev);
    });
    return a;
  }

  /* ---------------- the Launchpad ---------------- */
  let lp = null;                                    // { layer, search, grid, card }
  const items = n => (n?.children || []).filter(c => c.url || c.children);
  function flat(nodes, out = []) {
    for (const n of nodes) { if (n.url) out.push(n); else if (n.children) flat(n.children, out); }
    return out;
  }
  function launch(n, ev) {
    if (isFolder(n)) return openFolder(n, []);
    openUrl(n.url, true);                           // always a new window, even when the site is open
    close();
  }
  /* the search field is an address bar too: an address opens the site, words
     search the web (when no bookmark matches, or with the "Search" tile) */
  const looksLikeUrl = q => /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^localhost(:\d+)?(\/|$)/i.test(q) ||
                            (!/\s/.test(q) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(q));
  const toUrl = q => /^[a-z][a-z0-9+.-]*:\/\//i.test(q) ? q : "https://" + q;
  function webSearch(q) {
    close();
    if (chrome.search?.query) chrome.search.query({ text: q, disposition: "NEW_TAB" }, () => void chrome.runtime.lastError);
    else openUrl("https://www.google.com/search?q=" + encodeURIComponent(q), true);
  }
  function goTo(q) { openUrl(toUrl(q), true); close(); }
  function special(label, sub, cls, run) {          // the "open address" / "search the web" tiles
    const a = document.createElement("button");
    a.type = "button"; a.className = "lp-app lp-special"; a.title = sub;
    const t = document.createElement("span");
    t.className = "lp-tile " + cls;
    a.appendChild(t);
    const l = document.createElement("span");
    l.className = "lp-name"; l.textContent = label;
    a.appendChild(l);
    a.addEventListener("click", ev => { ev.stopPropagation(); run(); });
    return a;
  }
  function render() {
    if (!lp) return;
    const raw = lp.search.value.trim(), q = raw.toLowerCase();
    lp.grid.textContent = "";
    lp.grid.dataset.parent = root?.id || "";
    const list = q ? flat(items(root)).filter(n => nameOf(n).toLowerCase().includes(q) || host(n.url).includes(q)) : items(root);
    if (false) lp.grid.appendChild(special(raw.replace(/^https?:\/\//i, "").replace(/\/$/, ""), "Open " + toUrl(raw), "lp-go", () => goTo(raw)));
    const kids = list.map(n => app(n, launch));
    if (!raw)                                       // the widgets at their places among the icons
      widgets.map((w, i) => ({ w, at: w.pos ?? i })).sort((x, y) => x.at - y.at)
        .forEach(({ w, at }) => kids.splice(Math.max(0, Math.min(at, kids.length)), 0, widgetEl(w)));
    lp.grid.append(...kids);
    if (false) lp.grid.appendChild(special("Search the web", `Search for "${raw}"`, "lp-web", () => webSearch(raw)));
    lp.layer.toggleAttribute("data-searching", !!q);
    if (!list.length && !raw && !widgets.length) {
      const e = document.createElement("div");
      e.className = "lp-empty";
      e.textContent = chosen ? "This folder is empty" : "Your Bookmark Bar is empty";
      lp.grid.appendChild(e);
    }
    suggest(raw);
  }

  function openFolder(n, trail, rename, quiet) {
    closeFolder(true);
    const card = document.createElement("div");
    card.className = "lp-card";
    card.__folder = n; card.__trail = trail;
    const head = document.createElement("div");
    head.className = "lp-card-head";
    if (trail.length) {
      const back = document.createElement("button");
      back.type = "button"; back.className = "lp-back"; back.textContent = "‹"; back.title = "Back";
      back.onclick = ev => { ev.stopPropagation(); openFolder(trail[trail.length - 1], trail.slice(0, -1)); };
      head.appendChild(back);
    }
    const title = document.createElement("div");
    title.className = "lp-card-title"; title.textContent = nameOf(n); title.title = "Rename";
    title.spellcheck = false;
    const save = () => {
      title.contentEditable = "false";
      const t = title.textContent.trim();
      if (t && t !== n.title) chrome.bookmarks.update(n.id, { title: t });
      else title.textContent = nameOf(n);
    };
    title.addEventListener("click", ev => {        // click the name to rename the folder
      ev.stopPropagation();
      if (title.isContentEditable) return;
      title.contentEditable = "true"; title.focus();
      getSelection().selectAllChildren(title);
    });
    title.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); title.blur(); }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); title.textContent = nameOf(n); title.blur(); }
    });
    title.addEventListener("blur", save);
    head.appendChild(title);
    card.appendChild(head);
    const grid = document.createElement("div");
    grid.className = "lp-card-grid";
    grid.dataset.parent = n.id;
    for (const c of items(n)) grid.appendChild(app(c, (x, ev) => isFolder(x) ? openFolder(x, [...trail, n]) : launch(x, ev)));
    if (!grid.children.length) { const e = document.createElement("div"); e.className = "lp-empty"; e.textContent = "Empty folder"; grid.appendChild(e); }
    card.appendChild(grid);
    card.addEventListener("click", ev => ev.stopPropagation());
    lp.layer.appendChild(card);
    lp.layer.setAttribute("data-folder", "");
    if (!trail.length && !quiet)
      card.animate([{ transform: "scale(0.7)", opacity: 0 }, { transform: "none", opacity: 1 }],
                   { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.06)" });
    lp.card = card;
    if (rename) setTimeout(() => title.click(), 320);
  }
  function closeFolder(instant) {
    if (!lp?.card) return false;
    const c = lp.card;
    lp.card = null;
    lp.layer.removeAttribute("data-folder");
    if (instant) { c.remove(); return true; }
    c.animate([{ transform: "none", opacity: 1 }, { transform: "scale(0.8)", opacity: 0 }],
              { duration: 170, easing: "ease-in", fill: "forwards" }).finished.catch(() => {}).then(() => c.remove());
    return true;
  }

  /* ---------------- drag: rearrange, make folders, move in / out ---------------- */
  let drag = null;
  function flipGrid(grid, mutate) {                 // the other icons glide to their new places
    const apps = [...grid.querySelectorAll(":scope > .lp-app, :scope > .lp-widget")], first = apps.map(a => a.getBoundingClientRect());
    mutate();
    apps.forEach((a, i) => {
      const l = a.getBoundingClientRect(), dx = first[i].left - l.left, dy = first[i].top - l.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      a.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    });
  }
  function setMerge(st, target) {
    if (st.merge === target) return;
    st.merge?.removeAttribute("data-merge");
    st.merge = target || null;
    st.merge?.setAttribute("data-merge", "");
  }
  function startDrag(st, e) {
    st.on = true; drag = st;
    const t = st.el.querySelector(".lp-tile"), r = t.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "lp-ghost";
    ghost.appendChild(t.cloneNode(true));
    ghost.style.left = r.left + "px"; ghost.style.top = r.top + "px";
    lp.layer.appendChild(ghost);
    st.ghost = ghost; st.dx = e.clientX - r.left; st.dy = e.clientY - r.top;
    st.el.setAttribute("data-drag-src", "");
    lp.layer.setAttribute("data-dragging", "");
  }
  function moveToMain(st) {                         // dragged out of an open folder
    closeFolder(true);
    st.el = app(st.node, launch);
    st.el.setAttribute("data-drag-src", "");
    st.grid = lp.grid;
    flipGrid(st.grid, () => st.grid.appendChild(st.el));
  }
  function dragMove(st, e) {
    st.ghost.style.left = (e.clientX - st.dx) + "px";
    st.ghost.style.top = (e.clientY - st.dy) + "px";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (lp.card && st.grid !== lp.grid) {          // leaving the open folder?
      if (!under?.closest(".lp-card")) { if (!st.leave) st.leave = setTimeout(() => { st.leave = 0; if (drag === st) moveToMain(st); }, 260); }
      else { clearTimeout(st.leave); st.leave = 0; }
    }
    const target = under?.closest(".lp-app");
    if (!target || target === st.el || target.parentElement !== st.grid) { clearTimeout(st.hold); st.hold = 0; st.holdOn = null; setMerge(st, null); return; }
    const tr = target.querySelector(".lp-tile").getBoundingClientRect();
    const inner = e.clientX > tr.left + tr.width * 0.22 && e.clientX < tr.right - tr.width * 0.22 &&
                  e.clientY > tr.top + tr.height * 0.22 && e.clientY < tr.bottom - tr.height * 0.22;
    if (inner && !isFolder(st.node)) {             // over the middle of an icon: hold to merge
      if (st.holdOn !== target) {
        clearTimeout(st.hold); setMerge(st, null); st.holdOn = target;
        st.hold = setTimeout(() => { if (drag === st && st.holdOn === target) setMerge(st, target); }, HOLD);
      }
      return;
    }
    clearTimeout(st.hold); st.hold = 0; st.holdOn = null; setMerge(st, null);
    const ar = target.getBoundingClientRect();
    const before = e.clientX < ar.left + ar.width / 2;
    const ref = before ? target : target.nextSibling;
    if (ref === st.el || st.el.nextSibling === ref) return;   // already there
    flipGrid(st.grid, () => st.grid.insertBefore(st.el, ref));
  }
  async function dragEnd(st, commit) {
    clearTimeout(st.hold); clearTimeout(st.leave);
    const merge = st.merge;
    setMerge(st, null);
    const goal = (merge || st.el).querySelector(".lp-tile").getBoundingClientRect();
    st.ghost.animate([{ left: st.ghost.style.left, top: st.ghost.style.top, opacity: 1 },
                      { left: goal.left + "px", top: goal.top + "px", opacity: merge ? 0 : 1 }],
                     { duration: 180, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => st.ghost.remove());
    st.el.removeAttribute("data-drag-src");
    lp?.layer.removeAttribute("data-dragging");
    justDragged = true; setTimeout(() => { justDragged = false; }, 60);
    const node = st.node, from = node.parentId, parentId = st.grid.dataset.parent;
    let newFolder = null;
    if (commit && parentId) {
      if (merge && isFolder(merge.__node)) {                         // into a folder
        await bm("move", node.id, { parentId: merge.__node.id });
      } else if (merge) {                                           // two sites make a folder
        const t = merge.__node;
        newFolder = await bm("create", { parentId, index: t.index, title: "Folder" });
        if (newFolder) { await bm("move", t.id, { parentId: newFolder.id }); await bm("move", node.id, { parentId: newFolder.id }); }
      } else {                                                      // a new place
        let k = [...st.grid.querySelectorAll(":scope > .lp-app")].indexOf(st.el);
        if (from === parentId && node.index < k) k += 1;            // Chromium counts the old place
        if (k >= 0) await bm("move", node.id, { parentId, index: k });
      }
      if (from !== parentId && from !== root?.id) {                 // an emptied folder disappears
        const left = await bm("getChildren", from);
        if (left && !left.length) await bm("remove", from);
      }
    }
    drag = null;
    await refresh();
    if (newFolder && lp) { const f = findNode(newFolder.id); if (f) openFolder(f, [], true); }   // name the new folder
  }
  function onDown(ev) {
    if (ev.button !== 0 || !lp || drag) return;
    armLongPress(ev);
    if (lp.search.value || ev.target.closest?.(".lp-del, .lp-wg-btn")) return;
    const wEl = ev.target.closest?.(".lp-widget");
    if (wEl) { if (wEl.parentElement === lp.grid) widgetDown(ev, wEl); return; }
    const el = ev.target.closest?.(".lp-app");
    if (!el?.__node) return;
    const st = { el, grid: el.parentElement, node: el.__node, x: ev.clientX, y: ev.clientY, pid: ev.pointerId, on: false };
    const move = e => {
      if (e.pointerId !== st.pid) return;
      if (!st.on) { if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return; startDrag(st, e); }
      dragMove(st, e);
    };
    const up = e => {
      if (e.pointerId !== st.pid) return;
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", up, true);
      if (st.on) dragEnd(st, e.type === "pointerup");
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
  }

  /* ---------------- right-click: the bookmark's properties ---------------- */
  function closeMenu() {
    if (!lp?.menu) return false;
    lp.menu.remove(); lp.menu = null;
    if (!lp.sheet) lp.layer.removeAttribute("data-raised");
    return true;
  }
  function closeSheet() {
    if (!lp?.sheet) return false;
    lp.sheet.remove(); lp.sheet = null; lp.picker = null;
    if (!lp.menu) lp.layer.removeAttribute("data-raised");
    return true;
  }
  function showMenu(n, x, y) {
    closeMenu();
    const m = document.createElement("div");
    m.className = "lp-menu";
    const add = (label, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item" + (cls ? " " + cls : ""); menuLabel(b, label);
      b.addEventListener("click", ev => { ev.stopPropagation(); fn(b); });
      m.appendChild(b);
      return b;
    };
    const sep = () => { const d = document.createElement("div"); d.className = "lp-menu-sep"; m.appendChild(d); };
    if (isFolder(n)) {
      add("Open", () => { closeMenu(); openFolder(n, []); });
      sep();
      add("Rename…", () => { closeMenu(); editSheet(n); });
    } else {
      add("Open", () => { closeMenu(); launch(n); });
      add("Open in New Window", () => { closeMenu(); openUrl(n.url, true); close(); });
      sep();
      add("Edit…", () => { closeMenu(); editSheet(n); });
      add("Copy Address", () => { closeMenu(); navigator.clipboard?.writeText(n.url).catch(() => {}); });
    }
    sep();
    const count = isFolder(n) ? flat(items(n)).length : 0;
    add(isFolder(n) ? "Delete Folder" : "Delete", b => {   // asks once: a second click deletes
      if (!b.hasAttribute("data-sure")) {
        b.setAttribute("data-sure", "");
        menuLabel(b, isFolder(n) ? `Delete folder and ${count} bookmark${count === 1 ? "" : "s"}?` : "Delete this bookmark?");
        return;
      }
      closeMenu();
      if (isFolder(n)) chrome.bookmarks.removeTree(n.id, () => void chrome.runtime.lastError);
      else chrome.bookmarks.remove(n.id, () => void chrome.runtime.lastError);
    }, "lp-danger");
    m.addEventListener("click", ev => ev.stopPropagation());
    m.addEventListener("pointerdown", ev => ev.stopPropagation());
    lp.layer.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(x, innerWidth - w - 8) + "px";
    m.style.top = Math.min(y, innerHeight - h - 8) + "px";
    lp.menu = m;
    lp.layer.setAttribute("data-raised", "");
  }
  function spaceMenu(x, y) {                       // the empty space: like the iOS / macOS desktop
    closeMenu();
    const m = document.createElement("div");
    m.className = "lp-menu";
    const add = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item"; menuLabel(b, label);
      b.addEventListener("click", ev => { ev.stopPropagation(); closeMenu(); fn(); });
      m.appendChild(b);
    };
    add(lp.editing ? "Done Editing" : "Edit Home Screen", () => (lp.editing ? exitEdit() : enterEdit()));
    add("Add Website…", () => { enterEdit(); siteGallery(); });
    add("Add Widget…", () => { enterEdit(); widgetGallery(); });
    add("Bookmarks…", () => { enterEdit(); folderPicker(); });
    const sep = () => { const d = document.createElement("div"); d.className = "lp-menu-sep"; m.appendChild(d); };
    sep();
    add("Change Wallpaper…", changeWallpaper);
    sep();
    add("Vivaldi OS Updates…" + (window.vosVersion ? "  (" + window.vosVersion + ")" : ""), () => checkUpdate(true));
    add("Settings…", openSettings);
    m.addEventListener("click", ev => ev.stopPropagation());
    m.addEventListener("pointerdown", ev => ev.stopPropagation());
    lp.layer.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight, r = lp.layer.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - w - 8) + "px";
    m.style.top = Math.min(y, innerHeight - h - 8) + "px";
    lp.menu = m;
    lp.layer.setAttribute("data-raised", "");
  }
  function editSheet(n) {                          // like Vivaldi's bookmark properties: name and address
    closeSheet();
    const folder = isFolder(n);
    const sheet = document.createElement("div");
    sheet.className = "lp-sheet";
    const form = document.createElement("form");
    form.className = "lp-sheet-box";
    const h = document.createElement("div");
    h.className = "lp-sheet-title"; h.textContent = folder ? "Rename Folder" : "Edit Bookmark";
    form.appendChild(h);
    const field = (label, value) => {
      const l = document.createElement("label"); l.className = "lp-field";
      const t = document.createElement("span"); t.textContent = label;
      const i = document.createElement("input"); i.value = value || ""; i.spellcheck = false;
      l.append(t, i); form.appendChild(l);
      return i;
    };
    const name = field("Name", n.title);
    const addr = folder ? null : field("Address", n.url);
    const row = document.createElement("div"); row.className = "lp-sheet-buttons";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.className = "lp-btn";
    const ok = document.createElement("button"); ok.type = "submit"; ok.textContent = "Save"; ok.className = "lp-btn lp-btn-main";
    row.append(cancel, ok); form.appendChild(row);
    cancel.onclick = ev => { ev.stopPropagation(); closeSheet(); };
    form.onsubmit = ev => {
      ev.preventDefault();
      const changes = {};
      const t = name.value.trim();
      if (t !== (n.title || "")) changes.title = t;
      if (addr) {
        let u = addr.value.trim();
        if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;   // "example.com" -> https://example.com
        try { if (u) new URL(u); } catch (e) { addr.setCustomValidity("Not a web address"); addr.reportValidity(); return; }
        if (u && u !== n.url) changes.url = u;
      }
      if (Object.keys(changes).length) chrome.bookmarks.update(n.id, changes, () => void chrome.runtime.lastError);
      closeSheet();
    };
    addr?.addEventListener("input", () => addr.setCustomValidity(""));
    sheet.appendChild(form);
    sheet.addEventListener("click", ev => { ev.stopPropagation(); if (ev.target === sheet) closeSheet(); });
    sheet.addEventListener("pointerdown", ev => ev.stopPropagation());
    lp.layer.appendChild(sheet);
    form.animate([{ transform: "scale(0.92)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    lp.sheet = sheet; lp.layer.setAttribute("data-raised", "");
    setTimeout(() => { name.focus(); name.select(); }, 30);
  }

  function open(opts) {
    if (lp) return;
    const desk = !!opts?.desktop;                    // the desktop: on the wallpaper, under the windows
    const layer = document.createElement("div");
    layer.className = "lp-layer" + (desk ? " lp-desktop" : "");
    const search = document.createElement("input");
    search.className = "lp-search"; search.type = "search"; search.placeholder = "Search or enter address"; search.spellcheck = false;
    const bar = document.createElement("div");
    bar.className = "lp-searchbar";
    bar.appendChild(search);
    const grid = document.createElement("div");
    grid.className = "lp-grid";
    const sug = document.createElement("div");
    sug.className = "lp-suggest"; sug.hidden = true;
    layer.append(bar, sug, grid, ...edges());
    (desk ? document.getElementById("webpage-stack") : document.getElementById("browser") || document.body).appendChild(layer);
    lp = { layer, search, grid, sug, rows: [], sel: -1, card: null, menu: null, sheet: null, editing: false, swallow: false, desktop: desk };
    render();
    ensureTick();
    search.addEventListener("input", () => { closeFolder(true); render(); });
    search.addEventListener("keydown", ev => {
      if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && lp.rows.length) {   // walk the suggestions
        ev.preventDefault();
        const n = lp.rows.length;
        selectRow(ev.key === "ArrowDown" ? (lp.sel + 1) % n : (lp.sel <= 0 ? n - 1 : lp.sel - 1));
        return;
      }
      if (ev.key !== "Enter") return;                // the chosen suggestion, an address, the first match, a web search
      const q = search.value.trim();
      if (!q) return;
      if (lp.sel >= 0 && lp.rows[lp.sel]) return lp.rows[lp.sel].run();
      if (looksLikeUrl(q)) return goTo(q);
      const first = grid.querySelector(".lp-app:not(.lp-special)");
      if (first) first.click(); else webSearch(q);
    });
    layer.addEventListener("pointerdown", ev => {   // a click anywhere first closes an open menu
      if (lp) lp.swallow = false;
      if (lp?.menu && !ev.target.closest(".lp-menu")) { closeMenu(); lp.menuJustClosed = true; return; }
      onDown(ev);
    });
    layer.addEventListener("contextmenu", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const a = ev.target.closest(".lp-app");
      if (a?.__node && !drag) showMenu(a.__node, ev.clientX, ev.clientY);
      else if (!drag && !ev.target.closest(".lp-widget, .lp-searchbar, .lp-suggest, .lp-card, .lp-sheet, .lp-edge")) spaceMenu(ev.clientX, ev.clientY);
      else closeMenu();
    });
    layer.addEventListener("click", ev => {          // the empty space: a folder closes first, then the Launchpad
      if (lp?.swallow) { lp.swallow = false; return; }
      if (lp?.menuJustClosed) { lp.menuJustClosed = false; return; }
      if (justDragged || ev.target.closest(".lp-searchbar, .lp-suggest")) return;
      if (closeFolder() || exitEdit()) return;      // a folder closes first, then editing ends, then the Launchpad
      close();
    });
    if (desk) return;                                // the desktop: just there, no focus taken
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    grid.animate([{ transform: "scale(1.08)", opacity: 0 }, { transform: "none", opacity: 1 }],
                 { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    setTimeout(() => search.focus(), 30);
    document.getElementById("browser")?.setAttribute("data-launchpad", "");
  }
  function close(force, instant) {
    if (!lp || drag) return;
    if (lp.desktop && !force) {                      // the desktop stays: back to its plain state
      closeSheet(); closeMenu(); closeFolder(true); exitEdit();
      if (lp.search.value) { lp.search.value = ""; render(); }
      lp.search.blur();
      return;
    }
    const { layer, grid } = lp, wasDesk = lp.desktop;
    lp = null;
    ensureTick();
    if (wasDesk || instant) { layer.remove(); if (!wasDesk) setTimeout(syncDesk); return; }
    setTimeout(syncDesk, 240);                       // the desktop Launchpad comes back after the overlay
    document.getElementById("browser")?.removeAttribute("data-launchpad");
    grid.animate([{ transform: "none", opacity: 1 }, { transform: "scale(1.06)", opacity: 0 }],
                 { duration: 200, easing: "ease-in", fill: "forwards" });
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" })
      .finished.catch(() => {}).then(() => layer.remove());
  }
  addEventListener("keydown", ev => {
    if (!lp || ev.key !== "Escape" || drag) return;
    if (lp.desktop && !lp.layer.contains(ev.target) && !lp.editing && !lp.sheet) return;   // the desktop: Esc elsewhere is not ours
    if (lp.picker?.edit) return;                    // renaming / adding in the folder manager: Esc is theirs
    if (lp.picker?.menu) { ev.preventDefault(); ev.stopPropagation(); lp.picker.menu.remove(); lp.picker.menu = null; return; }
    if (lp.sheet && ev.target?.closest?.(".lp-sheet")) { ev.preventDefault(); ev.stopPropagation(); closeSheet(); return; }
    if (ev.target?.isContentEditable) return;
    ev.preventDefault(); ev.stopPropagation();
    if (closeSheet() || closeMenu()) return;                             // Esc: an open menu or sheet first
    if (lp.search.value) { lp.search.value = ""; render(); return; }   // Esc: the search, the folder, editing, then close
    if (closeFolder() || exitEdit()) return;
    close();
  }, true);

  /* ---------------- the suggestion list: like the address bar ---------------- */
  let sugSeq = 0, sugTimer = 0;
  const GLYPH = {
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    go: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  const SUB = { tab: "Switch to Tab", bookmark: "Bookmark", history: "History", go: "Open Address", search: "Search the Web" };
  function suggest(raw) {
    clearTimeout(sugTimer);
    if (!lp) return;
    if (!raw) { lp.sug.textContent = ""; lp.sug.hidden = true; lp.rows = []; lp.sel = -1; return; }
    const seq = ++sugSeq;
    sugTimer = setTimeout(() => buildSuggest(raw, seq), 70);
  }
  const ask = (fn, arg) => new Promise(r => { try { fn(arg, x => { void chrome.runtime.lastError; r(x || []); }); } catch (e) { r([]); } });
  async function buildSuggest(raw, seq) {
    const q = raw.toLowerCase(), rows = [], seen = new Set();
    const add = (kind, title, url, run) => {
      if (url) { const k = url.replace(/\/$/, ""); if (seen.has(k)) return; seen.add(k); }
      rows.push({ kind, title, url, run });
    };
    if (looksLikeUrl(raw)) add("go", toUrl(raw).replace(/^https?:\/\//i, "").replace(/\/$/, ""), toUrl(raw), () => goTo(raw));
    const [tabs, marks, hist] = await Promise.all([
      ask((a, cb) => chrome.tabs.query(a, cb), { currentWindow: true }),
      ask((a, cb) => chrome.bookmarks.search(a, cb), raw),
      chrome.history?.search ? ask((a, cb) => chrome.history.search(a, cb), { text: raw, maxResults: 12, startTime: 0 }) : [],
    ]);
    if (seq !== sugSeq || !lp) return;
    const hit = (t, u) => (t || "").toLowerCase().includes(q) || (u || "").toLowerCase().includes(q);
    const web = u => /^(https?|file):/i.test(u || "");
    for (const t of tabs.filter(t => web(t.url) && hit(t.title, t.url)).slice(0, 3))
      add("tab", t.title || host(t.url), t.url, () => { chrome.tabs.update(t.id, { active: true }); close(); });
    for (const b of marks.filter(b => web(b.url)).slice(0, 4))
      add("bookmark", b.title || host(b.url), b.url, () => { openUrl(b.url); close(); });
    for (const h of hist.filter(h => web(h.url)).slice(0, 6))
      add("history", h.title || host(h.url), h.url, () => { openUrl(h.url, true); close(); });
    rows.splice(8);
    add("search", raw, null, () => webSearch(raw));     // a web search is always there, last
    lp.rows = rows; lp.sel = -1;
    const box = lp.sug;
    box.textContent = "";
    rows.forEach((r, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-row";
      const ic = document.createElement("span");
      ic.className = "lp-row-icon";
      if (r.url && r.kind !== "go") ic.appendChild(siteIcon(r.url, mini, "lp-row-fav"));
      else ic.innerHTML = GLYPH[r.kind] || GLYPH.search;
      const tx = document.createElement("span");
      tx.className = "lp-row-text";
      const t = document.createElement("span");
      t.className = "lp-row-title"; t.textContent = r.kind === "search" ? `"${r.title}"` : r.title;
      const u = document.createElement("span");
      u.className = "lp-row-sub";
      u.textContent = SUB[r.kind] + (r.url && r.kind !== "go" ? " — " + host(r.url) : "");
      tx.append(t, u);
      b.append(ic, tx);
      if (r.url) b.appendChild(addButton(r.url, r.kind === "go" ? "" : r.title));
      b.addEventListener("pointerenter", () => selectRow(i));
      b.addEventListener("click", ev => { ev.stopPropagation(); r.run(); });
      box.appendChild(b);
    });
    box.hidden = false;
  }
  function selectRow(i) {
    if (!lp) return;
    lp.sel = i;
    [...lp.sug.children].forEach((b, k) => b.toggleAttribute("data-sel", k === i));
    lp.sug.children[i]?.scrollIntoView({ block: "nearest" });
  }

  /* ---------------- iOS alert (deletes ask first) ---------------- */
  function askFirst(title, msg, okLabel, onOk) {   // in the Launchpad, or over the tab bar
    if (lp) return iosAlert(title, msg, okLabel, onOk);
    document.querySelector("#browser > .vos-alert")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "lp-sheet lp-alert-veil vos-vars vos-alert";
    const box = document.createElement("div");
    box.className = "lp-alert";
    const h = document.createElement("div"); h.className = "lp-alert-title"; h.textContent = title;
    const p = document.createElement("div"); p.className = "lp-alert-msg"; p.textContent = msg;
    const row = document.createElement("div"); row.className = "lp-alert-btns";
    const no = document.createElement("button"); no.type = "button"; no.textContent = "Cancel";
    const ok = document.createElement("button"); ok.type = "button"; ok.textContent = okLabel; ok.className = "lp-alert-danger";
    const shut = () => { sheet.remove(); removeEventListener("keydown", key, true); };
    const key = ev => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); shut(); } };
    no.onclick = ev => { ev.stopPropagation(); shut(); };
    ok.onclick = ev => { ev.stopPropagation(); shut(); onOk(); };
    row.append(no, ok); box.append(h, p, row); sheet.appendChild(box);
    sheet.addEventListener("pointerdown", ev => ev.stopPropagation());
    sheet.addEventListener("click", ev => { ev.stopPropagation(); if (ev.target === sheet) shut(); });
    addEventListener("keydown", key, true);
    (document.getElementById("browser") || document.body).appendChild(sheet);
    box.animate([{ transform: "scale(1.15)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    setTimeout(() => ok.focus(), 30);
  }
  function iosAlert(title, msg, okLabel, onOk) {
    closeSheet();
    const sheet = document.createElement("div");
    sheet.className = "lp-sheet lp-alert-veil";
    const box = document.createElement("div");
    box.className = "lp-alert";
    const h = document.createElement("div"); h.className = "lp-alert-title"; h.textContent = title;
    const p = document.createElement("div"); p.className = "lp-alert-msg"; p.textContent = msg;
    const row = document.createElement("div"); row.className = "lp-alert-btns";
    const no = document.createElement("button"); no.type = "button"; no.textContent = "Cancel";
    const ok = document.createElement("button"); ok.type = "button"; ok.textContent = okLabel; ok.className = "lp-alert-danger";
    no.onclick = ev => { ev.stopPropagation(); closeSheet(); };
    ok.onclick = ev => { ev.stopPropagation(); closeSheet(); onOk(); };
    row.append(no, ok);
    box.append(h, p, row);
    sheet.appendChild(box);
    sheet.addEventListener("click", ev => ev.stopPropagation());
    sheet.addEventListener("pointerdown", ev => ev.stopPropagation());
    lp.layer.appendChild(sheet);
    box.animate([{ transform: "scale(1.15)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    lp.sheet = sheet; lp.layer.setAttribute("data-raised", "");
    setTimeout(() => ok.focus(), 30);
  }
  function delBadge(run) {                          // the ⊖ on every icon and widget in editing mode
    const d = document.createElement("span");
    d.className = "lp-del"; d.title = "Remove";
    d.addEventListener("pointerdown", ev => ev.stopPropagation());
    d.addEventListener("click", ev => { ev.stopPropagation(); run(); });
    return d;
  }
  function askDelete(n) {
    if (isFolder(n)) {
      const c = flat(items(n)).length;
      iosAlert(`Delete "${nameOf(n)}"?`, `The folder and its ${c} bookmark${c === 1 ? "" : "s"} will be deleted.`, "Delete",
               () => chrome.bookmarks.removeTree(n.id, () => void chrome.runtime.lastError));
    } else {
      iosAlert(`Delete "${nameOf(n)}"?`, "This bookmark will be deleted.", "Delete",
               () => chrome.bookmarks.remove(n.id, () => void chrome.runtime.lastError));
    }
  }

  /* ---------------- editing mode: long-press, like iOS ---------------- */
  const LONG = 520;                                 // ms
  function armLongPress(ev) {
    if (!lp || lp.editing || lp.sheet || lp.search.value) return;
    if (ev.target.closest?.(".lp-searchbar, .lp-suggest, .lp-edge, .lp-menu, .lp-card-head, .lp-wg-btn, .lp-del")) return;
    const x = ev.clientX, y = ev.clientY, pid = ev.pointerId;
    const done = () => {
      clearTimeout(t);
      removeEventListener("pointermove", mv, true);
      removeEventListener("pointerup", done, true);
      removeEventListener("pointercancel", done, true);
    };
    const mv = e => { if (e.pointerId === pid && Math.hypot(e.clientX - x, e.clientY - y) > 6) done(); };
    const t = setTimeout(() => {
      done();
      if (!lp || drag) return;
      lp.swallow = true;                            // the release is not a click
      enterEdit();
    }, LONG);
    addEventListener("pointermove", mv, true);
    addEventListener("pointerup", done, true);
    addEventListener("pointercancel", done, true);
  }
  function enterEdit() {
    if (!lp || lp.editing) return;
    lp.editing = true;
    closeMenu();
    lp.layer.setAttribute("data-editing", "");
  }
  function exitEdit() {
    if (!lp?.editing) return false;
    lp.editing = false;
    lp.layer.removeAttribute("data-editing");
    return true;
  }
  /* right-click menus: an icon on the left of every item (like macOS / iOS menus) */
  const MI = (d, fill) => `<svg class="lp-mi-ic" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const MENU_ICONS = [
    [/^open in new|new tab|new window/i, MI('<rect x="3.5" y="5" width="13" height="12" rx="2.5"/><path d="M19.5 9v9a2.5 2.5 0 0 1-2.5 2.5H8"/><path d="M10 9v4M8 11h4"/>')],
    [/^open launchpad/i, MI('<rect x="4" y="4" width="6" height="6" rx="1.6"/><rect x="14" y="4" width="6" height="6" rx="1.6"/><rect x="4" y="14" width="6" height="6" rx="1.6"/><rect x="14" y="14" width="6" height="6" rx="1.6"/>')],
    [/^open/i, MI('<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>')],
    [/^(edit home|done editing)/i, MI('<rect x="4" y="4" width="6" height="6" rx="1.6"/><rect x="14" y="4" width="6" height="6" rx="1.6"/><rect x="4" y="14" width="6" height="6" rx="1.6"/><path d="M14.5 19.5l1-3 4-4 2 2-4 4z"/>')],
    [/rename|edit/i, MI('<path d="M4 20l1.2-4.2L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M14 7l3 3"/>')],
    [/^copy/i, MI('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>')],
    [/delete|remove/i, MI('<path d="M4.5 7h15M10 4h4M6.5 7l.9 12a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12M10 11v6M14 11v6"/>')],
    [/folder|show in launchpad|show "/i, MI('<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2H18a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z"/>')],
    [/bookmark/i, MI('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>')],
    [/add website|add to launchpad/i, MI('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>')],
    [/widget/i, MI('<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><path d="M16.5 14v5M14 16.5h5"/>')],
    [/wallpaper/i, MI('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M6 16.5l4.3-4.6 3.2 3.2 2-2 3 3.4"/><circle cx="15.5" cy="9.5" r="1.4"/>')],
    [/update/i, MI('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 4.6v4.2h-4.2"/>')],
    [/settings/i, MI('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>')],
    [/\bmin$/i, MI('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3.5h5"/>')],
  ];
  const BLANK_IC = '<svg class="lp-mi-ic" viewBox="0 0 24 24"></svg>';
  function menuLabel(b, label) {                    // an icon on the left, then the words
    const ic = (MENU_ICONS.find(([re]) => re.test(label)) || [null, BLANK_IC])[1];
    b.innerHTML = ic;
    const t = document.createElement("span"); t.className = "lp-mi-text"; t.textContent = label;
    b.appendChild(t);
  }
  const ICON = {
    update: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M19.6 4.6v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3.6 12h16.8M12 3.4c2.4 2.6 2.4 14.6 0 17.2M12 3.4c-2.4 2.6-2.4 14.6 0 17.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    wall: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 17l4.6-5 3.4 3.4 2.2-2.2 3.3 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="15.8" cy="8.8" r="1.6" fill="currentColor"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function edges() {                                // auto-hidden: they slide in at the edge (always, in editing mode)
    const mk = (side, list) => {
      const e = document.createElement("div");
      e.className = "lp-edge lp-edge-" + side;
      for (const [label, glyph, run, cls] of list) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "lp-edge-btn" + (cls ? " " + cls : ""); b.title = label;
        b.innerHTML = glyph;
        const l = document.createElement("span"); l.textContent = label;
        b.appendChild(l);
        b.addEventListener("click", ev => { ev.stopPropagation(); run(); });
        e.appendChild(b);
      }
      e.addEventListener("pointerdown", ev => ev.stopPropagation());
      e.addEventListener("click", ev => ev.stopPropagation());
      return e;
    };
    return [mk("l", [["Folder", ICON.folder, folderPicker], ["Wallpaper", ICON.wall, changeWallpaper],
                     ["Updates" + (window.vosVersion ? " · " + window.vosVersion : ""), ICON.update, () => checkUpdate(true)]]),
            mk("r", [["Websites", ICON.globe, siteGallery], ["Widgets", ICON.plus, widgetGallery], ["Done", ICON.check, exitEdit, "lp-edge-done"]])];
  }

  /* ---------------- which folder is the Launchpad (saved) ---------------- */
  function sheetBox(cls, title, onDone, left) {     // an iOS sheet: a title, Done, and maybe a button on the left
    closeSheet(); closeMenu();
    const sheet = document.createElement("div");
    sheet.className = "lp-sheet";
    const box = document.createElement("div");
    box.className = "lp-ios " + cls;
    const head = document.createElement("div");
    head.className = "lp-ios-head";
    const h = document.createElement("div"); h.className = "lp-ios-title"; h.textContent = title;
    const d = document.createElement("button"); d.type = "button"; d.className = "lp-ios-done"; d.textContent = "Done";
    d.onclick = ev => { ev.stopPropagation(); closeSheet(); onDone?.(); };
    head.append(h, d);
    if (left) {
      const box2 = document.createElement("div"); box2.className = "lp-ios-left";
      for (const [label, fn] of Array.isArray(left[0]) ? left : [left]) {
        const l = document.createElement("button"); l.type = "button"; l.textContent = label;
        l.onclick = ev => { ev.stopPropagation(); fn(); };
        box2.appendChild(l);
      }
      head.appendChild(box2);
    }
    const body = document.createElement("div"); body.className = "lp-ios-body";
    box.append(head, body);
    sheet.appendChild(box);
    sheet.addEventListener("click", ev => { ev.stopPropagation(); if (ev.target === sheet) closeSheet(); });
    sheet.addEventListener("pointerdown", ev => ev.stopPropagation());
    lp.layer.appendChild(sheet);
    box.animate([{ transform: "translateY(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    lp.sheet = sheet; lp.layer.setAttribute("data-raised", "");
    return body;
  }
  /* ---------------- Bookmarks: a manager in columns, like the Finder ----------------
     a folder opens in the next column; a bookmark shows its details (name and
     address, edited in place) · double-click: a folder is renamed, a bookmark
     opens · Enter: rename · drag: onto a folder = into it (hold to open it),
     above / below a row = next to it, a column's empty space = into that folder ·
     right-click: everything else · Show in Launchpad: that folder is the Launchpad */
  async function folderPicker() {
    if (!lp) return;
    const P = { edit: false, menu: null, path: null, sel: null, draft: null, confirm: null, renameId: null };
    const body = sheetBox("lp-finder", "Bookmarks", null, [["New Folder", () => newFolder()], ["New Bookmark", () => newBookmark()]]);
    lp.picker = P;
    body.classList.add("lp-finder-body");
    const cols = document.createElement("div"); cols.className = "lp-cols";
    const foot = document.createElement("div"); foot.className = "lp-finder-foot";
    body.append(cols, foot);
    const perm = n => !n || n.id === "0" || n.parentId === "0";        // Vivaldi's own top folders
    const isTrash = n => n && (n.trash || (n.parentId === "0" && /^trash$/i.test(n.title || "")));
    const kids = n => (n?.children || []).filter(c => !isTrash(c));
    const node = id => P.byId?.get(id);
    const folderOfSel = () => {                       // the folder new items go into
      const s = node(P.sel);
      if (s && !s.url) return s;
      if (s?.url) return node(s.parentId);
      return node(P.path?.[P.path.length - 1]) || P.bar;
    };
    const launchId = () => chosen || P.bar?.id;
    const setLaunch = f => {
      chosen = f.id === P.bar?.id ? null : f.id;
      if (chosen) vstore.set(LP_FOLDER, chosen); else vstore.del(LP_FOLDER);
      closeFolder(true);
      if (lp) lp.search.value = "";
      refresh();
    };

    async function draw() {
      if (!lp || lp.picker !== P || P.edit) return;
      const [tree, bar] = await Promise.all([bm("getTree"), loadBar()]);
      if (!lp || lp.picker !== P || P.edit || !tree?.[0]) return;
      const byId = new Map();
      const index = n => { byId.set(n.id, n); (n.children || []).forEach(index); };
      index(tree[0]);
      P.byId = byId; P.bar = bar; P.root = tree[0];
      if (!P.path) {                                   // the first time: open the way to the Launchpad's folder
        const chain = [];
        for (let n = byId.get(launchId()); n && n.id !== "0"; n = byId.get(n.parentId)) chain.unshift(n.id);
        P.path = chain; P.sel = launchId();
      }
      const ok = [];                                   // what was deleted / moved away is left out
      for (const id of P.path) { const n = byId.get(id); if (!n || n.url || (ok.length ? n.parentId !== ok[ok.length - 1] : n.parentId !== "0")) break; ok.push(id); }
      P.path = ok;
      if (P.sel && !byId.has(P.sel)) P.sel = P.path[P.path.length - 1] || null;
      cols.textContent = "";
      [tree[0], ...P.path.map(id => byId.get(id))].forEach((f, i) => cols.appendChild(column(f, i)));
      const s = byId.get(P.sel);
      if (P.draft) cols.appendChild(details(null));
      else if (s?.url) cols.appendChild(details(s));
      cols.scrollLeft = cols.scrollWidth;
      drawFoot();
      if (!P.draft && !body.contains(document.activeElement)) body.closest(".lp-ios")?.focus({ preventScroll: true });   // for Enter / Delete
      if (P.renameId) {
        const r = cols.querySelector(`.lp-frow[data-id="${CSS.escape(P.renameId)}"]`);
        P.renameId = null;
        if (r) { r.scrollIntoView({ block: "nearest", inline: "nearest" }); rename(r, byId.get(r.dataset.id)); }
      }
    }
    P.draw = draw;

    function column(f, i) {
      const c = document.createElement("div");
      c.className = "lp-col"; c.dataset.id = f.id; c.__i = i;
      const active = P.sel && node(P.sel)?.parentId === f.id;
      for (const n of kids(f)) {
        const r = document.createElement("div");
        r.className = "lp-frow" + (n.url ? "" : " lp-frow-folder");
        r.dataset.id = n.id; r.tabIndex = -1;
        const ic = document.createElement("span"); ic.className = "lp-frow-icon";
        if (n.url) ic.appendChild(siteIcon(n.url, mini, "lp-frow-fav")); else ic.innerHTML = ICON.folder;
        const t = document.createElement("span"); t.className = "lp-frow-title"; t.textContent = nameOf(n);
        r.append(ic, t);
        if (!n.url && n.id === launchId()) { const b = document.createElement("span"); b.className = "lp-frow-badge"; b.title = "The Launchpad"; b.textContent = "Launchpad"; r.appendChild(b); }
        if (!n.url) { const ch = document.createElement("span"); ch.className = "lp-frow-chev"; ch.textContent = "›"; r.appendChild(ch); }
        const on = P.sel === n.id || P.path[i] === n.id;
        if (on) r.setAttribute(active && P.sel === n.id ? "data-sel" : "data-path", "");
        r.addEventListener("click", ev => {
          ev.stopPropagation();
          if (P.justDragged || P.edit) return;
          P.draft = null; P.confirm = null;
          P.path = P.path.slice(0, i).concat(n.url ? [] : [n.id]);
          P.sel = n.id;
          draw();
        });
        r.addEventListener("dblclick", ev => {
          ev.stopPropagation();
          if (n.url) { openUrl(n.url); close(); } else if (!perm(n)) rename(r, n);
        });
        r.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); openMenu(n, f, ev.clientX, ev.clientY); });
        r.addEventListener("pointerdown", ev => rowDown(ev, r, n));
        c.appendChild(r);
      }
      if (!kids(f).length) { const e = document.createElement("div"); e.className = "lp-col-empty"; e.textContent = "Empty"; c.appendChild(e); }
      c.addEventListener("contextmenu", ev => { if (ev.target !== c && !ev.target.classList.contains("lp-col-empty")) return; ev.preventDefault(); ev.stopPropagation(); openMenu(null, f, ev.clientX, ev.clientY); });
      c.addEventListener("click", ev => {             // its empty space: that folder is selected
        if (ev.target !== c && !ev.target.classList.contains("lp-col-empty")) return;
        if (f.id === "0") return;
        P.path = P.path.slice(0, i); P.sel = f.id; P.draft = null; draw();
      });
      return c;
    }

    /* a bookmark's details: its icon, name and address - edited in place */
    function details(n) {
      const d = document.createElement("div");
      d.className = "lp-col lp-col-details";
      const big = document.createElement("div"); big.className = "lp-det-icon";
      if (n) big.appendChild(siteIcon(n.url, icon, "lp-favicon")); else big.innerHTML = GLYPH.go;
      const form = document.createElement("form"); form.className = "lp-det-form";
      const field = (label, value, ph) => {
        const l = document.createElement("label"); l.className = "lp-field";
        const s = document.createElement("span"); s.textContent = label;
        const i = document.createElement("input"); i.value = value || ""; i.placeholder = ph || ""; i.spellcheck = false;
        i.addEventListener("focus", () => { P.edit = true; });
        l.append(s, i); form.appendChild(l);
        return i;
      };
      const name = field("Name", n?.title, "Name");
      const addr = field("Address", n?.url, "example.com");
      const fix = u => { u = u.trim(); if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u; try { if (u) new URL(u); return u; } catch (e) { return null; } };
      const row = document.createElement("div"); row.className = "lp-det-btns";
      const btn = (label, cls, fn, type = "button") => { const b = document.createElement("button"); b.type = type; b.className = "lp-btn " + (cls || ""); b.textContent = label; if (fn) b.onclick = ev => { ev.stopPropagation(); fn(); }; row.appendChild(b); return b; };
      addr.addEventListener("input", () => addr.setCustomValidity(""));
      if (n) {
        const save = async () => {
          const ch = {}, t = name.value.trim(), u = fix(addr.value);
          if (u === null) { addr.setCustomValidity("Not a web address"); addr.reportValidity(); return false; }
          if (t !== (n.title || "")) ch.title = t;
          if (u && u !== n.url) ch.url = u;
          P.edit = false;
          if (Object.keys(ch).length) await bm("update", n.id, ch);
          return true;
        };
        for (const i of [name, addr]) i.addEventListener("blur", () => setTimeout(() => { if (!form.contains(document.activeElement)) save().then(ok => ok && draw()); }, 0));
        form.onsubmit = ev => { ev.preventDefault(); save().then(ok => ok && draw()); };
        btn("Open", "lp-btn-main", () => { openUrl(n.url); close(); });
        btn("New Tab", "", () => { openUrl(n.url, true); close(); });
      } else {                                         // a new bookmark, not saved yet
        name.addEventListener("focus", () => { P.edit = true; });
        form.onsubmit = async ev => {
          ev.preventDefault();
          const u = fix(addr.value);
          if (!u) { addr.setCustomValidity("Not a web address"); addr.reportValidity(); return; }
          const b = await bm("create", { parentId: P.draft.parentId, title: name.value.trim() || host(u), url: u });
          P.draft = null; P.edit = false;
          if (b) P.sel = b.id;
          draw();
        };
        btn("Cancel", "", () => { P.draft = null; P.edit = false; draw(); });
        btn("Add", "lp-btn-main", null, "submit");
        setTimeout(() => addr.focus(), 40);
      }
      form.appendChild(row);
      form.addEventListener("keydown", ev => {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); P.edit = false; P.draft = null; document.activeElement?.blur?.(); draw(); }
      });
      d.append(big, form);
      return d;
    }

    /* the bar at the bottom: where you are, and Show in Launchpad (or a delete to confirm) */
    function drawFoot() {
      foot.textContent = "";
      if (P.confirm) {
        const n = P.confirm, total = n.url ? 0 : flat(kids(n)).length;
        const t = document.createElement("span"); t.className = "lp-foot-ask";
        t.textContent = n.url ? `Delete "${nameOf(n)}"?` : `Delete "${nameOf(n)}"${total ? ` and its ${total} bookmark${total === 1 ? "" : "s"}` : ""}?`;
        const no = document.createElement("button"); no.type = "button"; no.className = "lp-btn"; no.textContent = "Cancel";
        const yes = document.createElement("button"); yes.type = "button"; yes.className = "lp-btn lp-btn-danger"; yes.textContent = "Delete";
        no.onclick = ev => { ev.stopPropagation(); P.confirm = null; drawFoot(); };
        yes.onclick = ev => {
          ev.stopPropagation();
          P.confirm = null;
          if (!n.url && (n.id === chosen)) setLaunch(P.bar || n);
          if (n.url) chrome.bookmarks.remove(n.id, () => { void chrome.runtime.lastError; draw(); });
          else chrome.bookmarks.removeTree(n.id, () => { void chrome.runtime.lastError; draw(); });
        };
        foot.append(t, no, yes);
        setTimeout(() => yes.focus(), 20);
        return;
      }
      const crumbs = document.createElement("span"); crumbs.className = "lp-foot-path";
      crumbs.textContent = P.path.map(id => nameOf(node(id))).join("  ›  ") || "Bookmarks";
      foot.appendChild(crumbs);
      const f = folderOfSel();
      if (f && f.id !== "0") {
        const b = document.createElement("button"); b.type = "button";
        const on = f.id === launchId();
        b.className = "lp-btn " + (on ? "lp-btn-on" : "lp-btn-main");
        b.textContent = on ? `✓ "${nameOf(f)}" is the Launchpad` : `Show "${nameOf(f)}" in Launchpad`;
        b.disabled = on;
        b.onclick = ev => { ev.stopPropagation(); setLaunch(f); setTimeout(draw, 60); };
        foot.appendChild(b);
      }
    }

    /* rename in place (a folder or a bookmark) */
    function rename(r, n) {
      if (P.edit || !n || perm(n)) return;
      P.edit = true; closeMenuP();
      const t = r.querySelector(".lp-frow-title");
      const i = document.createElement("input");
      i.className = "lp-ios-input lp-frow-input"; i.value = n.title || ""; i.spellcheck = false;
      t.replaceWith(i);
      i.focus(); i.select();
      let done = false;
      const finish = save => {
        if (done) return; done = true;
        const v = i.value.trim();
        P.edit = false;
        if (save && v && v !== n.title) bm("update", n.id, { title: v }).then(draw); else draw();
      };
      i.addEventListener("keydown", ev => {
        ev.stopPropagation();
        if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      });
      i.addEventListener("blur", () => finish(true));
      for (const e of ["pointerdown", "click", "dblclick"]) i.addEventListener(e, ev => ev.stopPropagation());
    }
    async function newFolder(parent) {
      const p = parent || folderOfSel();
      if (!p) return;
      const f = await bm("create", { parentId: p.id, title: "New Folder" });
      if (!f) return;
      const chain = [];
      for (let n = node(p.id); n && n.id !== "0"; n = node(n.parentId)) chain.unshift(n.id);
      P.path = chain; P.sel = f.id; P.draft = null; P.renameId = f.id; P.edit = false;
      draw();
    }
    function newBookmark(parent) {
      const p = parent || folderOfSel();
      if (!p) return;
      const chain = [];
      for (let n = node(p.id); n && n.id !== "0"; n = node(n.parentId)) chain.unshift(n.id);
      P.path = chain; P.sel = p.id; P.draft = { parentId: p.id }; P.edit = false; P.confirm = null;
      draw().then(() => { P.edit = true; });
    }

    /* right-click */
    function closeMenuP() { P.menu?.remove(); P.menu = null; }
    function openMenu(n, f, x, y) {
      closeMenuP();
      if (P.edit) return;
      const m = document.createElement("div");
      m.className = "lp-menu";
      const add = (label, fn, cls) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "lp-menu-item" + (cls ? " " + cls : ""); menuLabel(b, label);
        b.addEventListener("click", ev => { ev.stopPropagation(); closeMenuP(); fn(); });
        m.appendChild(b);
      };
      const sep = () => { const d = document.createElement("div"); d.className = "lp-menu-sep"; m.appendChild(d); };
      const rowOf = id => cols.querySelector(`.lp-frow[data-id="${CSS.escape(id)}"]`);
      if (n?.url) {
        add("Open", () => { openUrl(n.url); close(); });
        add("Open in New Tab", () => { openUrl(n.url, true); close(); });
        add("Add to Launchpad", () => addToLaunchpad(n.url, n.title));
        sep();
        add("Rename", () => { const r = rowOf(n.id); if (r) rename(r, n); });
        add("Edit Address…", () => {
          const chain = [];
          for (let x = node(n.parentId); x && x.id !== "0"; x = node(x.parentId)) chain.unshift(x.id);
          P.path = chain; P.sel = n.id; P.draft = null;
          draw().then(() => { const i = cols.querySelectorAll(".lp-col-details input")[1]; i?.focus(); i?.select(); });
        });
        add("Copy Address", () => navigator.clipboard?.writeText(n.url).catch(() => {}));
        sep();
        add("Delete", () => { P.confirm = n; drawFoot(); }, "lp-danger");
      } else if (n) {
        add("Open", () => { const r = rowOf(n.id); r?.click(); });
        add("Show in Launchpad", () => { setLaunch(n); setTimeout(draw, 60); });
        sep();
        add("New Folder Inside", () => newFolder(n));
        add("New Bookmark Inside…", () => newBookmark(n));
        if (!perm(n)) {
          add("Rename", () => { const r = rowOf(n.id); if (r) rename(r, n); });
          sep();
          add("Delete Folder", () => { P.confirm = n; drawFoot(); }, "lp-danger");
        }
      } else if (f && f.id !== "0") {
        add("New Folder", () => newFolder(f));
        add("New Bookmark…", () => newBookmark(f));
        add("Show in Launchpad", () => { setLaunch(f); setTimeout(draw, 60); });
      } else return;
      m.addEventListener("pointerdown", ev => ev.stopPropagation());
      m.addEventListener("click", ev => ev.stopPropagation());
      lp.sheet.appendChild(m);
      const w = m.offsetWidth, h = m.offsetHeight;
      m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
      m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
      P.menu = m;
    }
    lp.sheet.addEventListener("pointerdown", ev => { if (!P.menu?.contains(ev.target)) closeMenuP(); }, true);
    body.closest(".lp-ios").tabIndex = -1;
    lp.sheet.addEventListener("keydown", ev => {     // Enter: rename the selected one · Delete: delete it (asks)
      if (P.edit || ev.target.closest?.("input")) return;
      const s = node(P.sel);
      if (!s || perm(s)) return;
      if (ev.key === "Enter") { const r = cols.querySelector(`.lp-frow[data-id="${CSS.escape(s.id)}"]`); if (r) { ev.preventDefault(); rename(r, s); } }
      if (ev.key === "Backspace" || ev.key === "Delete") { ev.preventDefault(); P.confirm = s; drawFoot(); }
    });

    /* drag: onto a folder = into it (hold: it opens), above / below = next to it,
       a column's empty space = into that column's folder */
    function rowDown(ev, r, n) {
      if (ev.button !== 0 || P.edit || perm(n)) return;
      const st = { x: ev.clientX, y: ev.clientY, pid: ev.pointerId, on: false, t: null, zone: null, el: null, hold: 0 };
      const inside = new Set();
      const collect = x => { inside.add(x.id); (x.children || []).forEach(collect); };
      collect(n);
      const mark = (el, zone) => {
        if (st.el === el && st.zone === zone) return;
        st.el?.removeAttribute("data-drop");
        clearTimeout(st.hold); st.hold = 0;
        st.el = el; st.zone = zone;
        el?.setAttribute("data-drop", zone);
        if (el && zone === "into" && el.classList.contains("lp-frow-folder")) {   // hold over a folder: it opens
          st.hold = setTimeout(() => {
            const col = el.closest(".lp-col"), id = el.dataset.id;
            if (!col || st.el !== el) return;
            P.path = P.path.slice(0, col.__i).concat(id); P.sel = id; draw();
          }, 650);
        }
      };
      const move = e => {
        if (e.pointerId !== st.pid) return;
        if (!st.on) {
          if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
          st.on = true;
          const rr = r.getBoundingClientRect();
          const g = r.cloneNode(true);
          g.className = "lp-frow lp-frow-ghost";
          g.style.width = rr.width + "px"; g.style.left = rr.left + "px"; g.style.top = rr.top + "px";
          lp.sheet.appendChild(g);
          st.g = g; st.dx = st.x - rr.left; st.dy = st.y - rr.top;
          r.setAttribute("data-dragging", "");
        }
        st.g.style.left = (e.clientX - st.dx) + "px"; st.g.style.top = (e.clientY - st.dy) + "px";
        const cr = cols.getBoundingClientRect();         // near the edges: the columns scroll
        if (e.clientX < cr.left + 30) cols.scrollLeft -= 14; else if (e.clientX > cr.right - 30) cols.scrollLeft += 14;
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const col = under?.closest(".lp-col:not(.lp-col-details)");
        if (col) { const k = col.getBoundingClientRect(); if (e.clientY < k.top + 24) col.scrollTop -= 10; else if (e.clientY > k.bottom - 24) col.scrollTop += 10; }
        const row = under?.closest(".lp-frow:not(.lp-frow-ghost)");
        if (row && row.dataset.id !== n.id) {
          const t = node(row.dataset.id);
          if (!t || inside.has(t.id)) return mark(null);
          const k = row.getBoundingClientRect(), rel = (e.clientY - k.top) / k.height;
          const zone = !t.url && (perm(t) || (rel > 0.28 && rel < 0.72)) ? "into" : perm(t) ? null : rel < 0.5 ? "before" : "after";
          st.t = t;
          return mark(zone ? row : null, zone);
        }
        if (col && !row) {
          const f = node(col.dataset.id);
          if (!f || f.id === "0" || inside.has(f.id)) return mark(null);
          st.t = f;
          return mark(col, "into");
        }
        mark(null);
      };
      const up = async e => {
        if (e.pointerId !== st.pid) return;
        removeEventListener("pointermove", move, true);
        removeEventListener("pointerup", up, true);
        removeEventListener("pointercancel", up, true);
        if (!st.on) return;
        P.justDragged = true; setTimeout(() => { P.justDragged = false; }, 60);
        st.g.remove();
        r.removeAttribute("data-dragging");
        const t = st.t, zone = st.zone, el = st.el;
        mark(null);
        if (!t || !el || e.type !== "pointerup") return draw();
        if (zone === "into") await bm("move", n.id, { parentId: t.id });
        else await bm("move", n.id, { parentId: t.parentId, index: t.index + (zone === "after" ? 1 : 0) });
        draw();
      };
      addEventListener("pointermove", move, true);
      addEventListener("pointerup", up, true);
      addEventListener("pointercancel", up, true);
    }
    draw();
  }

  /* ---------------- add a website to the Launchpad: open tabs and recent sites ---------------- */
  async function addToLaunchpad(url, title) {
    if (!root || !url) return false;
    if (inLaunchpad(url)) return false;
    await bm("create", { parentId: root.id, title: title || host(url), url });
    return true;
  }
  const urlKey = u => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, ""); } catch (e) { return u; } };
  const inLaunchpad = url => !!root && flat(items(root)).some(n => urlKey(n.url) === urlKey(url));
  function addButton(url, title, onAdded) {         // the green ⊕, shown on hover (iOS)
    const b = document.createElement("button");
    b.type = "button"; b.className = "lp-add"; b.title = "Add to Launchpad";
    b.addEventListener("pointerdown", ev => ev.stopPropagation());
    b.addEventListener("click", async ev => {
      ev.stopPropagation(); ev.preventDefault();
      if (b.hasAttribute("data-done")) return;
      await addToLaunchpad(url, title);
      b.setAttribute("data-done", ""); b.title = "In the Launchpad";
      b.animate([{ transform: "scale(0.6)" }, { transform: "scale(1.15)" }, { transform: "none" }], { duration: 300, easing: "ease-out" });
      onAdded?.();
    });
    if (inLaunchpad(url)) { b.setAttribute("data-done", ""); b.title = "In the Launchpad"; }
    return b;
  }
  async function siteGallery() {
    if (!lp) return;
    const body = sheetBox("lp-sites", "Add Website");
    const web = u => /^https?:/i.test(u || "");
    const [tabs, hist] = await Promise.all([
      ask((a, cb) => chrome.tabs.query(a, cb), { currentWindow: true }),
      chrome.history?.search ? ask((a, cb) => chrome.history.search(a, cb), { text: "", maxResults: 300, startTime: Date.now() - 45 * 864e5 }) : [],
    ]);
    if (!lp || !body.isConnected) return;
    const seen = new Set();
    const list = label => {
      const l = document.createElement("div"); l.className = "lp-ios-label"; l.textContent = label; body.appendChild(l);
      const g = document.createElement("div"); g.className = "lp-ios-group"; body.appendChild(g); return g;
    };
    const row = (g, url, title, sub) => {
      const k = urlKey(url);
      if (seen.has(k)) return; seen.add(k);
      const r = document.createElement("div"); r.className = "lp-ios-row lp-site-row";
      const ic = document.createElement("span"); ic.className = "lp-site-icon"; ic.appendChild(siteIcon(url, mini, "lp-row-fav"));
      const tx = document.createElement("span"); tx.className = "lp-row-text";
      const t = document.createElement("span"); t.className = "lp-row-title"; t.textContent = title || host(url);
      const s = document.createElement("span"); s.className = "lp-row-sub"; s.textContent = sub;
      tx.append(t, s);
      r.append(ic, tx, addButton(url, title));
      r.addEventListener("click", ev => { ev.stopPropagation(); r.querySelector(".lp-add")?.click(); });
      g.appendChild(r);
    };
    const open = tabs.filter(t => web(t.url));
    if (open.length) { const g = list("Open Now"); for (const t of open) row(g, t.url, t.title, host(t.url)); }
    const byHost = new Map();                          // recent: one per site, the page you visit most there
    for (const h of hist.filter(h => web(h.url))) {
      const k = host(h.url), cur = byHost.get(k);
      const home = (() => { try { return new URL(h.url).pathname === "/"; } catch (e) { return false; } })();
      if (!cur || (home && !cur.home) || (!cur.home && (h.visitCount || 0) > (cur.visitCount || 0))) byHost.set(k, { ...h, home });
    }
    const recent = [...byHost.values()].sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0)).slice(0, 60);
    if (recent.length) {
      const g = list("Recent");
      for (const h of recent) {
        const d = h.lastVisitTime ? new Date(h.lastVisitTime) : null;
        row(g, h.url, h.title, host(h.url) + (d ? " — " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""));
      }
    }
    if (!open.length && !recent.length) { const e = document.createElement("div"); e.className = "lp-empty"; e.textContent = "No recent websites"; body.appendChild(e); }
    const hint = document.createElement("div"); hint.className = "lp-ios-hint";
    hint.textContent = "Click a website (or its ⊕) to add it to the Launchpad. It goes into the folder the Launchpad shows.";
    body.appendChild(hint);
  }

  /* ---------------- widgets: Clock, Calendar, Timer (iOS) ---------------- */
  const WG_KEY = "vosLaunchpadWidgets";
  const WG = {
    "clock-num":  { name: "Clock", sub: "Numbers" },
    "clock-pill": { name: "Clock", sub: "Pills" },
    "clock-sq":   { name: "Clock", sub: "Square" },
    "cal":        { name: "Calendar", sub: "Month" },
    "timer":      { name: "Timer", sub: "" },
    "clockcal":   { name: "Clock & Calendar", sub: "", sizes: ["m"] },
  };
  const isClock = k => k === "clock-num" || k === "clock-pill" || k === "clock-sq" || k === "clockcal";
  const isCal = k => k === "cal" || k === "clockcal";
  let widgets = [];                                 // [{ id, k, s: "s" | "m" }], saved
  const saveWidgets = () => vstore.set(WG_KEY, widgets);
  function widgetEl(w, preview) {
    const box = document.createElement("div");
    box.className = "lp-widget lp-w-" + w.s;
    box.__w = w;
    const card = document.createElement("div");
    card.className = "lp-wcard lp-wk-" + w.k;
    box.appendChild(card);
    const name = document.createElement("span");
    name.className = "lp-name"; name.textContent = WG[w.k].name;
    box.appendChild(name);
    if (!preview) {
      box.appendChild(delBadge(() => iosAlert(`Remove "${WG[w.k].name}"?`, "Removing this widget will not delete any data.", "Remove", () => {
        widgets = widgets.filter(x => x.id !== w.id); saveWidgets(); render();
      })));
      box.addEventListener("click", ev => { ev.stopPropagation(); if (lp?.swallow) lp.swallow = false; });
    }
    buildWidget(card, w);
    return box;
  }
  const pad = n => String(n).padStart(2, "0");
  function buildWidget(card, w) {
    card.textContent = "";
    card.__key = "";
    if (w.k === "clockcal") {
      card.innerHTML = clockSvg(true) + '<div class="lp-cal-mon"><div class="lp-cal-month"></div><div class="lp-cal-grid"></div></div>';
      const n = new Date(), sh = card.querySelector(".lp-sh");
      if (sh) sh.style.animationDelay = -(n.getSeconds() + n.getMilliseconds() / 1000) + "s";
    } else if (w.k === "clock-num" || w.k === "clock-pill" || w.k === "clock-sq") {
      card.innerHTML = clockSvg(w.k === "clock-pill", w.k === "clock-sq") + (w.s === "m"
        ? '<div class="lp-dclock"><div class="lp-dtime"></div><div class="lp-dday"></div><div class="lp-ddate"></div></div>' : "");
      if (w.k === "clock-sq" && w.s === "s") requestAnimationFrame(() => drawWidget(card, w));   // once it has its size
      const n = new Date(), sh = card.querySelector(".lp-sh");   // the second hand sweeps smoothly
      if (sh) sh.style.animationDelay = -(n.getSeconds() + n.getMilliseconds() / 1000) + "s";
    } else if (w.k === "cal") {
      card.innerHTML = (w.s === "m" ? '<div class="lp-cal-left"><div class="lp-cal-wd"></div><div class="lp-cal-big"></div><div class="lp-cal-my"></div></div>' : "") +
                       '<div class="lp-cal-mon"><div class="lp-cal-month"></div><div class="lp-cal-grid"></div></div>';
    } else if (w.k === "timer") buildTimer(card, w);
    drawWidget(card, w);
  }
  function clockSvg(pills, square) {
    let s = '<svg class="lp-clock" viewBox="0 0 100 100"><circle class="lp-face" cx="50" cy="50" r="49"/>';
    if (square) return clockSq();
    if (pills) {
      // Apple's pill face: twelve equal grey pills (r 36.5 to 47), hands without a visible neck
      for (let i = 0; i < 12; i++)
        s += `<rect class="lp-pill" x="48.85" y="3" width="2.3" height="10.5" rx="1.15" transform="rotate(${i * 30} 50 50)"/>`;
      s = s.replace('viewBox="0 0 100 100"', 'viewBox="-10 -10 120 120"');   // the face at 83% of the widget, as Apple's
      return s + '<g class="lp-hh"><rect x="47.8" y="24.4" width="4.4" height="19.8" rx="2.2"/></g>' +
                 '<g class="lp-mh"><rect x="47.8" y="9.3" width="4.4" height="34.9" rx="2.2"/></g>' +
                 '<circle class="lp-hub" cx="50" cy="50" r="2.6"/>' +
                 '<g class="lp-sh"><rect x="49.6" y="5.3" width="0.8" height="53.7" rx="0.4"/></g>' +
                 '<circle class="lp-shub" cx="50" cy="50" r="1.9"/><circle class="lp-hub2" cx="50" cy="50" r="0.9"/></svg>';
    } else {
      for (let i = 1; i <= 12; i++) {
        const a = i * Math.PI / 6;
        s += `<text class="lp-num" x="${(50 + 38 * Math.sin(a)).toFixed(2)}" y="${(50 - 38 * Math.cos(a)).toFixed(2)}" text-anchor="middle" dominant-baseline="central">${i}</text>`;
      }
    }
    return s + '<g class="lp-hh"><rect x="49.3" y="38" width="1.4" height="12" rx="0.7"/><rect x="47.9" y="23" width="4.2" height="19" rx="2.1"/></g>' +
               '<g class="lp-mh"><rect x="49.3" y="38" width="1.4" height="12" rx="0.7"/><rect x="47.9" y="9" width="4.2" height="33" rx="2.1"/></g>' +
               '<circle class="lp-hub" cx="50" cy="50" r="2.8"/>' +
               '<g class="lp-sh"><rect x="49.45" y="7" width="1.1" height="52" rx="0.55"/></g>' +
               '<circle class="lp-shub" cx="50" cy="50" r="1.9"/><circle class="lp-hub2" cx="50" cy="50" r="0.8"/></svg>';
  }
  function clockSq(aspect = 1, rx = 16.6) {        // Square (Apple's square clock face): 164 high, as wide as the card
    // every mark points at the centre and ends on the same rounded rectangle just inside the edge,
    // whose corners follow the card's; the hour marks start on a circle (r 60), so they grow towards the corners
    const W = 164 * aspect, x0 = 82 - W / 2, Hx = W / 2 - 9, Hy = 73, R = Math.max(rx - 9, 3);   // R: same centre as the card's corner
    const edgeOf = (hx, hy, r) => (sn, cs) => {
      const ux = Math.abs(sn), uy = Math.abs(cs), d = Math.min(ux ? hx / ux : 1e9, uy ? hy / uy : 1e9);
      if (d * ux <= hx - r || d * uy <= hy - r) return d;
      const cx = hx - r, cy = hy - r, b = ux * cx + uy * cy;
      return b + Math.sqrt(b * b - cx * cx - cy * cy + r * r);
    };
    const edge = edgeOf(Hx, Hy, R), sq = edgeOf(73, 73, 28);   // sq: Apple's square face, for the marks' lengths
    const f = v => v.toFixed(2), dx = Hx - 73;
    let s = `<svg class="lp-clock lp-clock-sq" viewBox="${f(x0)} 0 ${f(W)} 164"><rect class="lp-sq-face" x="${f(x0)}" y="0" width="${f(W)}" height="164" rx="${rx}"/>`;
    for (let i = 0; i < 60; i++) {
      const a = i * Math.PI / 30, sn = Math.sin(a), cs = Math.cos(a), e = edge(sn, cs);
      const cls = i % 15 === 0 ? "lp-sq-q" : i % 5 === 0 ? "lp-sq-hr" : "lp-sq-min";
      const from = e - (i % 5 === 0 ? sq(sn, cs) - 59.5 : 7.5);   // each mark as long as on the square face
      s += `<line class="${cls}" x1="${f(82 + from * sn)}" y1="${f(82 - from * cs)}" x2="${f(82 + e * sn)}" y2="${f(82 - e * cs)}"/>`;
    }
    // numbers on their baseline (the digits' middle is 7.4 above it): centred at 12 (82,39), 3 (128.5,82.5) ...
    s += '<g class="lp-sq-nums" text-anchor="middle">' +
         '<text x="82" y="46.4">12</text><text x="' + f(128.5 + dx) + '" y="89.9">3</text><text x="82" y="133.9">6</text><text x="' + f(35.5 - dx) + '" y="89.9">9</text></g>' +
         // the hands of the round clock (Pills), on this 164 face
         '<g class="lp-hh"><rect x="80.85" y="62.32" width="2.3" height="19.68" rx="1.15"/><rect x="78.56" y="37.72" width="6.89" height="31.16" rx="3.44"/></g>' +
         '<g class="lp-mh"><rect x="80.85" y="62.32" width="2.3" height="19.68" rx="1.15"/><rect x="78.56" y="14.76" width="6.89" height="54.12" rx="3.44"/></g>' +
         '<circle class="lp-hub" cx="82" cy="82" r="4.59"/>' +
         '<g class="lp-sh"><rect x="81.1" y="11.48" width="1.8" height="85.28" rx="0.9"/></g>' +
         '<circle class="lp-shub" cx="82" cy="82" r="3.12"/><circle class="lp-hub2" cx="82" cy="82" r="1.31"/></svg>';
    return s;
  }
  // centre a number in its circle by the digits' real outline (fonts leave more room
  // below the digits than above them, so centring the line puts them a little low)
  let measureCtx = null;
  function centerDay(el) {
    const i = el.firstElementChild;
    if (!i || !el.isConnected) return;
    const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs;
    measureCtx ||= document.createElement("canvas").getContext("2d");
    measureCtx.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
    const m = measureCtx.measureText(i.textContent);
    const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const dy = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 - lh / 2;
    const dx = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 - m.width / 2;
    if (isFinite(dx) && isFinite(dy)) i.style.translate = `${(-dx).toFixed(2)}px ${(-dy).toFixed(2)}px`;
  }
  const WEEKEND = [5, 6];                           // Friday and Saturday
  function weekStart() {                            // 0 = Sunday ... (from the system's region)
    try {
      const l = new Intl.Locale(navigator.language);
      const f = (l.getWeekInfo?.() || l.weekInfo)?.firstDay;
      if (f) return f % 7;
    } catch (e) {}
    return 0;
  }
  function drawWidget(card, w, now = new Date()) {
    if (isClock(w.k)) {
      const sec = now.getSeconds(), min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
      if (w.k === "clock-sq" && w.s === "s" && card.clientHeight) {
        const asp = Math.round(card.clientWidth / card.clientHeight * 100) / 100;
        const r = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 20;
        if (asp !== card.__asp) {                      // the face takes the card's shape and corners
          card.__asp = asp;
          card.innerHTML = clockSq(asp, Math.round(r * 164 / card.clientHeight * 10) / 10);
          const sh = card.querySelector(".lp-sh");
          if (sh) sh.style.animationDelay = -(now.getSeconds() + now.getMilliseconds() / 1000) + "s";
        }
      }
      const c = card.querySelector(".lp-clock-sq") ? 82 : 50;     // the Square face's centre is (82, 82)
      const rot = (sel, deg) => card.querySelector(sel)?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${c} ${c})`);
      rot(".lp-hh", hr * 30); rot(".lp-mh", min * 6);
      if (w.s === "m" && w.k !== "clockcal") {
        const loc = undefined;
        card.querySelector(".lp-dtime").textContent = now.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
        card.querySelector(".lp-dday").textContent = now.toLocaleDateString(loc, { weekday: "long" });
        card.querySelector(".lp-ddate").textContent = now.toLocaleDateString(loc, { day: "numeric", month: "long" });
      }
    }
    if (isCal(w.k)) {
      const key = now.toDateString();
      if (card.__key === key) return;                // redrawn once a day
      card.__key = key;
      const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
      card.querySelector(".lp-cal-month").textContent = now.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
      const g = card.querySelector(".lp-cal-grid");
      g.textContent = "";
      const ws = weekStart();
      for (let i = 0; i < 7; i++) {
        const d = new Date(2024, 0, 7 + ((ws + i) % 7));   // 7 Jan 2024 was a Sunday
        const c = document.createElement("span"); c.className = "lp-cal-wh" + (WEEKEND.includes(d.getDay()) ? " lp-cal-we" : "");
        c.textContent = d.toLocaleDateString(undefined, { weekday: "narrow" });
        g.appendChild(c);
      }
      const lead = (new Date(y, m, 1).getDay() - ws + 7) % 7, days = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < lead; i++) g.appendChild(document.createElement("span"));
      for (let d = 1; d <= days; d++) {
        const c = document.createElement("span");
        c.className = "lp-cal-d" + (d === today ? " lp-today" : "");
        const dow = (lead + d - 1) % 7, real = (ws + dow) % 7;
        if (WEEKEND.includes(real)) c.classList.add("lp-cal-we");
        if (d === today) {                           // today: its number centred on the digits' own outline
          const i = document.createElement("i"); i.textContent = d; c.appendChild(i);
          requestAnimationFrame(() => centerDay(c));
        } else c.textContent = d;
        g.appendChild(c);
      }
      if (w.s === "m" && w.k === "cal") {
        card.querySelector(".lp-cal-wd").textContent = now.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase();
        card.querySelector(".lp-cal-big").textContent = today;
        card.querySelector(".lp-cal-my").textContent = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      }
    }
    if (w.k === "timer") drawTimer(card, w);
  }

  /* ---- the Timer: keeps running with the Launchpad closed; a chime at the end, then it
     counts up (+0:12) - grey for the first minute, red after - until you cancel it ---- */
  const TM_KEY = "vosLaunchpadTimer";
  const PRESETS = [1, 3, 15, 30, 60];               // minutes: 1 and 3 are short (green), the rest orange
  let tm = { dur: 5 * 60000, end: 0, left: 0, rang: false, mini: false };   // running: end > 0; paused: left > 0; mini: the ring is shown
  const tmLeft = () => tm.end ? Math.max(0, tm.end - Date.now()) : (tm.left || tm.dur);
  const tmOver = () => tm.end ? Math.max(0, Date.now() - tm.end) : 0;
  const tmState = () => tm.end ? (Date.now() >= tm.end ? "over" : "run") : tm.left ? "pause" : "idle";
  const saveTm = () => vstore.set(TM_KEY, tm);
  const fmt = ms => {
    const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };
  const fmtUp = ms => {                              // the time past the end
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return "+" + (h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
  };
  function tmDo(act, arg) {
    const st = tmState();
    if (act === "go") {
      if (st === "run") tm = { ...tm, left: tmLeft(), end: 0 };
      else if (st === "over") tm = { ...tm, end: Date.now() + tm.dur, left: 0, rang: false };   // again
      else tm = { ...tm, end: Date.now() + tmLeft(), left: 0, rang: false, mini: true };
    } else if (act === "cancel") tm = { ...tm, end: 0, left: 0, rang: false };                 // the ring stays
    else if (act === "remove") { tm = { ...tm, end: 0, left: 0, rang: false, mini: false }; closeTmPop(); }
    else if (act === "set") tm = { ...tm, dur: arg * 60000, end: 0, left: 0, rang: false };
    else if (act === "next" && st === "idle") {
      const i = PRESETS.indexOf(Math.round(tm.dur / 60000));
      tm = { ...tm, dur: PRESETS[(i + 1) % PRESETS.length] * 60000 };
    }
    saveTm(); ensureTick(); paintTimers();
  }
  /* another time while a timer is going: ask first */
  function tmChange(min) {
    if (tmState() === "idle") return tmDo("set", min);
    askFirst("Change the timer?", `The current timer will stop and be set to ${min} min.`, "Change", () => tmDo("set", min));
  }
  function tmRemove() {
    if (tmState() === "idle") return tmDo("remove");
    askFirst("Remove the timer?", "The current timer will stop and its ring will be removed.", "Remove", () => tmDo("remove"));
  }
  function buildTimer(card, w) {
    const btn = (cls, act, label, arg) => `<button type="button" class="lp-wg-btn ${cls}" data-act="${act}"${arg != null ? ` data-arg="${arg}"` : ""} title="${label}"></button>`;
    card.innerHTML =
      '<div class="lp-tm-ringbox"><svg class="lp-ring" viewBox="0 0 100 100"><circle class="lp-ring-bg" cx="50" cy="50" r="44"/>' +
      '<circle class="lp-ring-fg" cx="50" cy="50" r="44" pathLength="100" transform="rotate(-90 50 50)"/></svg>' +
      '<button type="button" class="lp-wg-btn lp-tm-time" data-act="next" title="Change the time"></button></div>' +
      (w.s === "m" ? '<div class="lp-tm-side"><div class="lp-tm-presets">' +
        PRESETS.map(p => `<button type="button" class="lp-wg-btn lp-tm-chip" data-act="set" data-arg="${p}"${p <= 3 ? " data-short-chip" : ""}>${p} min</button>`).join("") +
        '</div><div class="lp-tm-btns">' + btn("lp-tm-cancel", "cancel", "Cancel") + btn("lp-tm-go", "go", "Start") + "</div></div>"
      : '<div class="lp-tm-btns">' + btn("lp-tm-cancel", "cancel", "Cancel") + btn("lp-tm-go", "go", "Start") + "</div>");
    card.addEventListener("pointerdown", ev => { if (ev.target.closest(".lp-wg-btn")) ev.stopPropagation(); });
    card.addEventListener("click", ev => {
      const b = ev.target.closest(".lp-wg-btn");
      if (!b || (lp?.editing && !card.closest(".vos-tm-pop"))) return;
      ev.stopPropagation();
      if (b.dataset.act === "set") return tmChange(+b.dataset.arg);
      tmDo(b.dataset.act, b.dataset.arg != null ? +b.dataset.arg : undefined);
    });
    card.addEventListener("wheel", ev => {           // idle: the wheel sets the minutes
      if (tmState() !== "idle" || lp?.editing) return;
      ev.preventDefault(); ev.stopPropagation();
      const m = Math.round(tm.dur / 60000) + (ev.deltaY < 0 ? 1 : -1);
      tm = { ...tm, dur: Math.min(180, Math.max(1, m)) * 60000 }; saveTm(); paintTimers();
    }, { passive: false });
  }
  /* the ring runs down smoothly, like an analog hand: one animation over the time left
     (made again only when the timer changes), nothing to do each second */
  function ringSet(fg, st) {
    if (!fg) return;
    if (st === "run") {
      const key = tm.end + "|" + tm.dur;
      if (fg.__key === key && fg.getAnimations().length) return;
      fg.getAnimations().forEach(a => a.cancel());
      fg.__key = key;
      const left = tmLeft(), from = 100 - Math.max(0, Math.min(1, left / tm.dur)) * 100;
      fg.style.strokeDashoffset = "100";
      fg.animate([{ strokeDashoffset: String(from) }, { strokeDashoffset: "100" }], { duration: Math.max(1, left), easing: "linear", fill: "forwards" });
    } else {
      fg.__key = "";
      fg.getAnimations().forEach(a => a.cancel());
      fg.style.strokeDashoffset = st === "over" ? "0" : String(100 - Math.max(0, Math.min(1, tmLeft() / tm.dur)) * 100);
    }
  }
  function overTone(el, st) {                        // past the end: grey for a minute, then red (short ones stay green)
    el.toggleAttribute("data-short", tm.dur <= 3 * 60000);
    el.toggleAttribute("data-over", st === "over");
    el.toggleAttribute("data-late", st === "over" && tmOver() >= 60000);
  }
  function drawTimer(card) {
    const st = tmState(), left = tmLeft();
    card.toggleAttribute("data-run", st === "run");
    card.toggleAttribute("data-idle", st === "idle");
    overTone(card, st);
    const t = card.querySelector(".lp-tm-time");
    if (t) t.textContent = st === "over" ? fmtUp(tmOver()) : fmt(left);
    ringSet(card.querySelector(".lp-ring-fg"), st);
    const go = card.querySelector(".lp-tm-go");
    if (go) { go.textContent = st === "run" ? "Pause" : st === "pause" ? "Resume" : st === "over" ? "Restart" : "Start"; go.dataset.state = st; }
    const c = card.querySelector(".lp-tm-cancel");
    if (c) { c.textContent = "Cancel"; c.disabled = st === "idle"; }
    for (const ch of card.querySelectorAll(".lp-tm-chip")) ch.toggleAttribute("data-on", +ch.dataset.arg * 60000 === tm.dur);
  }
  const paintTimers = () => {
    lp?.layer.querySelectorAll(".lp-wk-timer").forEach(c => drawTimer(c));
    tmPop?.querySelectorAll(".lp-wk-timer").forEach(c => drawTimer(c));
  };
  function chime() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.32, 0.64].forEach(t => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.28);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.3);
      });
      setTimeout(() => ac.close(), 1500);
    } catch (e) {}
    try {
      chrome.notifications?.create("vos-timer", { type: "basic", iconUrl: "resources/vivaldi-icon-48.png", title: "Timer", message: "Time's up" }, () => void chrome.runtime.lastError);
    } catch (e) {}
  }

  /* a started timer: just a ring left of the tab bar clock, until it is cancelled;
     a click shows the Timer widget in a popup above it */
  let tmMini = null, tmPop = null;
  function paintMini() {
    const st = tmState();
    if (!tm.mini && st === "idle") { tmMini?.remove(); tmMini = null; closeTmPop(); closeTmMenu(); return; }
    const clock = document.querySelector("#browser .ClockButton");
    const anchor = clock?.closest(".button-toolbar") || clock;
    if (!anchor?.parentElement) { tmMini?.remove(); tmMini = null; return; }
    if (!tmMini) {
      tmMini = document.createElement("div");
      tmMini.className = "vos-tm-mini";
      tmMini.innerHTML = '<svg viewBox="0 0 20 20"><circle class="vos-tm-bg" cx="10" cy="10" r="8"/>' +
                         '<circle class="vos-tm-fg" cx="10" cy="10" r="8" pathLength="100" transform="rotate(-90 10 10)"/></svg>';
      tmMini.addEventListener("pointerdown", ev => ev.stopPropagation());
      tmMini.addEventListener("click", ev => { ev.stopPropagation(); closeTmMenu(); tmPop ? closeTmPop() : openTmPop(); });
      tmMini.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); closeTmPop(); openTmMenu(); });
    }
    if (tmMini.nextSibling !== anchor) anchor.parentElement.insertBefore(tmMini, anchor);
    tmMini.toggleAttribute("data-paused", st === "pause");
    overTone(tmMini, st);
    ringSet(tmMini.querySelector(".vos-tm-fg"), st);
    tmMini.toggleAttribute("data-idle", st === "idle");
    tmMini.title = (st === "over" ? "Timer " + fmtUp(tmOver()) : "Timer " + fmt(tmLeft())) + " - right-click to change or remove";
  }
  function openTmPop() {
    if (!tmMini || tmPop) return;
    closeClkPop();
    const pop = document.createElement("div");
    pop.className = "vos-tm-pop vos-vars";
    pop.appendChild(widgetEl({ id: "", k: "timer", s: "s" }, true));
    pop.addEventListener("pointerdown", ev => ev.stopPropagation());
    pop.addEventListener("click", ev => ev.stopPropagation());
    (document.getElementById("browser") || document.body).appendChild(pop);
    const r = tmMini.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const above = r.top - h - 10 >= 8;              // above the tab bar (bottom), else below it (top)
    pop.style.left = left + "px";
    pop.style.top = (above ? r.top - h - 10 : r.bottom + 10) + "px";
    pop.animate([{ transform: `translateY(${above ? 8 : -8}px) scale(0.96)`, opacity: 0 }, { transform: "none", opacity: 1 }],
                { duration: 220, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    tmPop = pop;
    drawTimer(pop.querySelector(".lp-wk-timer"));
    setTimeout(() => {
      addEventListener("pointerdown", outside, true);
      addEventListener("keydown", popKey, true);
    });
  }
  const outside = ev => { if (!tmPop?.contains(ev.target) && !tmMini?.contains(ev.target)) closeTmPop(); };
  const popKey = ev => { if (ev.key === "Escape" && tmPop) { ev.stopPropagation(); closeTmPop(); } };
  function closeTmPop() {
    if (!tmPop) return;
    const p = tmPop; tmPop = null;
    removeEventListener("pointerdown", outside, true);
    removeEventListener("keydown", popKey, true);
    p.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.97)" }], { duration: 140, easing: "ease-in", fill: "forwards" })
      .finished.catch(() => {}).then(() => p.remove());
  }

  /* a click on the tab bar clock: the Clock & Calendar widget in a popup above it */
  let clkPop = null, clkAt = null;
  function openClkPop(btn) {
    if (clkPop) return;
    closeTmPop(); closeTmMenu();
    const pop = document.createElement("div");
    pop.className = "vos-tm-pop vos-clk-pop vos-vars";
    pop.appendChild(widgetEl({ id: "", k: "clockcal", s: "m" }, true));
    pop.addEventListener("pointerdown", ev => ev.stopPropagation());
    pop.addEventListener("click", ev => ev.stopPropagation());
    (document.getElementById("browser") || document.body).appendChild(pop);
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const above = r.top - h - 10 >= 8;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = (above ? r.top - h - 10 : r.bottom + 10) + "px";
    pop.animate([{ transform: `translateY(${above ? 8 : -8}px) scale(0.96)`, opacity: 0 }, { transform: "none", opacity: 1 }],
                { duration: 220, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    clkPop = pop; clkAt = btn;
    ensureTick();
    setTimeout(() => { addEventListener("pointerdown", clkOut, true); addEventListener("keydown", clkKey, true); });
  }
  const clkOut = ev => { if (!clkPop?.contains(ev.target) && !clkAt?.contains(ev.target)) closeClkPop(); };
  const clkKey = ev => { if (ev.key === "Escape" && clkPop) { ev.stopPropagation(); closeClkPop(); } };
  function closeClkPop() {
    if (!clkPop) return;
    const p = clkPop; clkPop = null; clkAt = null;
    removeEventListener("pointerdown", clkOut, true);
    removeEventListener("keydown", clkKey, true);
    p.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.97)" }], { duration: 140, easing: "ease-in", fill: "forwards" })
      .finished.catch(() => {}).then(() => p.remove());
    ensureTick();
  }
  // Vivaldi's own clock popup is replaced: a left click never reaches it (right-click still does)
  const clockOf = ev => ev.button === 0 && ev.target?.closest?.("#browser .ClockButton");
  for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup"])
    addEventListener(type, ev => { if (clockOf(ev)) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  addEventListener("click", ev => {
    const btn = clockOf(ev);
    if (!btn) return;
    ev.stopPropagation(); ev.preventDefault();
    clkPop ? closeClkPop() : openClkPop(btn);
  }, true);

  /* right-click on the ring: another time (asks first while one is going), or remove it */
  let tmMenu = null;
  function openTmMenu() {
    closeTmMenu();
    if (!tmMini) return;
    const m = document.createElement("div");
    m.className = "lp-menu vos-vars vos-tm-menu";
    const add = (label, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item" + (cls ? " " + cls : ""); menuLabel(b, label);
      b.addEventListener("click", ev => { ev.stopPropagation(); closeTmMenu(); fn(); });
      m.appendChild(b);
    };
    const head = document.createElement("div"); head.className = "lp-menu-head"; head.textContent = "Timer";
    m.appendChild(head);
    for (const p of PRESETS) add(p + " min", () => tmChange(p), Math.round(tm.dur / 60000) === p ? "lp-menu-on" : "");
    const sep = document.createElement("div"); sep.className = "lp-menu-sep"; m.appendChild(sep);
    add("Remove Timer", tmRemove, "lp-danger");
    m.addEventListener("pointerdown", ev => ev.stopPropagation());
    m.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); });
    (document.getElementById("browser") || document.body).appendChild(m);
    const r = tmMini.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    m.style.top = (r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8) + "px";
    tmMenu = m;
    setTimeout(() => { addEventListener("pointerdown", menuOut, true); addEventListener("keydown", menuKey, true); });
  }
  const menuOut = ev => { if (!tmMenu?.contains(ev.target)) closeTmMenu(); };
  const menuKey = ev => { if (ev.key === "Escape" && tmMenu) { ev.stopPropagation(); closeTmMenu(); } };
  function closeTmMenu() {
    if (!tmMenu) return;
    tmMenu.remove(); tmMenu = null;
    removeEventListener("pointerdown", menuOut, true);
    removeEventListener("keydown", menuKey, true);
  }

  /* one clock for every widget: runs only while the Launchpad is open (or a timer is started) */
  let tick = 0, lastSec = -1;
  function ensureTick() {
    const want = (lp && widgets.length) || tmState() !== "idle" || tm.mini || clkPop;
    paintMini();
    if (want && !tick) tick = setInterval(onTick, 250);
    if (!want && tick) { clearInterval(tick); tick = 0; }
  }
  function onTick() {
    if (tmState() === "over" && !tm.rang) {
      tm = { ...tm, rang: true }; saveTm(); chime();
      paintMini();                                                 // time's up: the timer widget pops up from its ring
      if (tmMini && !tmPop) openTmPop();
    }
    if (document.hidden) return;
    const now = new Date();
    if (now.getSeconds() === lastSec) return;
    lastSec = now.getSeconds();
    if (tmState() !== "idle" || !tmMini?.isConnected) paintMini();
    if (tmPop) paintTimers();
    if (clkPop) for (const c of clkPop.querySelectorAll(".lp-wcard")) drawWidget(c, c.parentElement.__w, now);
    if (!lp) return;
    for (const c of lp.layer.querySelectorAll(".lp-wcard")) {
      const w = c.parentElement?.__w;
      if (w) drawWidget(c, w, now);
    }
  }

  /* ---- drag a widget to another place among the icons ---- */
  function widgetDown(ev, el) {
    const st = { el, x: ev.clientX, y: ev.clientY, pid: ev.pointerId, on: false };
    const move = e => {
      if (e.pointerId !== st.pid) return;
      if (!st.on) {
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
        st.on = true; drag = st;
        const card = el.querySelector(".lp-wcard"), r = card.getBoundingClientRect();
        const ghost = document.createElement("div");
        ghost.className = "lp-ghost lp-wghost";
        const copy = card.cloneNode(true);
        copy.style.setProperty("width", r.width + "px", "important");
        ghost.appendChild(copy);
        ghost.style.left = r.left + "px"; ghost.style.top = r.top + "px";
        lp.layer.appendChild(ghost);
        st.ghost = ghost; st.dx = st.x - r.left; st.dy = st.y - r.top;
        el.setAttribute("data-drag-src", "");
        lp.layer.setAttribute("data-dragging", "");
      }
      st.ghost.style.left = (e.clientX - st.dx) + "px";
      st.ghost.style.top = (e.clientY - st.dy) + "px";
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".lp-app, .lp-widget");
      if (!t || t === el || t.parentElement !== lp.grid) return;
      const r = t.getBoundingClientRect();
      const after = e.clientY > r.bottom - r.height * 0.25 ? true : e.clientY < r.top + r.height * 0.25 ? false : e.clientX > r.left + r.width / 2;
      const ref = after ? t.nextSibling : t;
      if (ref === el || el.nextSibling === ref) return;
      flipGrid(lp.grid, () => lp.grid.insertBefore(el, ref));
    };
    const up = e => {
      if (e.pointerId !== st.pid) return;
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", up, true);
      if (!st.on) return;
      const goal = el.querySelector(".lp-wcard").getBoundingClientRect();
      st.ghost.animate([{ left: st.ghost.style.left, top: st.ghost.style.top }, { left: goal.left + "px", top: goal.top + "px" }],
                       { duration: 180, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => st.ghost.remove());
      el.removeAttribute("data-drag-src");
      lp?.layer.removeAttribute("data-dragging");
      justDragged = true; setTimeout(() => { justDragged = false; }, 60);
      const order = [...lp.grid.children].filter(c => c.matches(".lp-app, .lp-widget"));
      widgets = widgets.map(w => {                  // each widget keeps its place among the icons
        const i = order.findIndex(c => c.__w?.id === w.id);
        return i >= 0 ? { ...w, pos: i } : w;
      });
      saveWidgets();
      drag = null;
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
  }

  /* ---- the widget gallery (Widgets, in editing mode) ---- */
  function widgetGallery() {
    if (!lp) return;
    const body = sheetBox("lp-gallery", "Widgets");
    let section = "";
    for (const k of Object.keys(WG)) {
      if (WG[k].name !== section) {
        section = WG[k].name;
        const l = document.createElement("div"); l.className = "lp-ios-label"; l.textContent = section;
        body.appendChild(l);
        body.appendChild(Object.assign(document.createElement("div"), { className: "lp-gal-row" }));
      }
      const rowEl = body.lastElementChild;
      for (const size of WG[k].sizes || ["s", "m"]) {
        const w = { id: "", k, s: size };
        const cell = document.createElement("button");
        cell.type = "button"; cell.className = "lp-gal-cell";
        const pv = widgetEl(w, true);
        cell.appendChild(pv);
        const cap = document.createElement("span");
        cap.className = "lp-gal-cap";
        cap.textContent = (WG[k].sub ? WG[k].sub + " · " : "") + (size === "s" ? "Small" : "Medium");
        cell.appendChild(cap);
        cell.addEventListener("click", ev => {
          ev.stopPropagation();
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          widgets = [...widgets.map((x, i) => ({ ...x, pos: (x.pos ?? i) + 1 })), { id, k, s: size, pos: 0 }];
          saveWidgets(); closeSheet(); render(); ensureTick();
          const el = [...lp.grid.querySelectorAll(".lp-widget")].find(e => e.__w?.id === id);
          el?.animate([{ transform: "scale(0.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.1)" });
        });
        rowEl.appendChild(cell);
      }
    }
  }

  /* ---------------- the + button opens the Launchpad; Home shows the desktop ---------------- */
  const isHomeLabel = v => /^(go to )?home ?page\b/i.test((v || "").trim());
  function homeButton(t) {
    const btn = t?.closest?.("button, .button-toolbar");
    if (!btn || !btn.closest(".toolbar") || btn.closest(".bento-toggle")) return null;
    const els = [btn, btn.closest(".button-toolbar"), btn.querySelector?.("button")].filter(Boolean);
    return els.some(el => isHomeLabel(el.getAttribute("title")) || isHomeLabel(el.getAttribute("aria-label"))) ? btn : null;
  }
  const plusButton = t => t?.closest?.("#tabs-tabbar-container .newtab, #tabs-tabbar-container #newtab-main") || null;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"])
    document.addEventListener(type, ev => {
      if (ev.button !== 0) return;                  // right-click / middle-click: Vivaldi's own
      const plus = plusButton(ev.target), home = !plus && homeButton(ev.target);
      if (!plus && !home) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (type !== "click") return;
      if (plus) { if (lp && !lp.desktop) close(); else { if (lp) close(true, true); open(); } }
      else { if (lp && !lp.desktop) close(true, true); window.vosShowDesktop?.(); setTimeout(syncDesk, 50); }
    }, true);

  window.vosLaunchpad = { open, close, toggle: () => (lp && !lp.desktop ? close() : (lp && close(true, true), open())),
                          get isOpen() { return !!lp && !lp.desktop; } };

  /* ---------------- the desktop: the Launchpad on the wallpaper ---------------- */
  function syncDesk() {
    const b = document.getElementById("browser"), stack = document.getElementById("webpage-stack");
    const want = !!b && !!stack && (b.hasAttribute("data-ft-home") ||
                 (b.hasAttribute("data-ft-desktop") && !b.hasAttribute("data-ft-wins")));   // windows open: only the wallpaper
    if (want && !lp) open({ desktop: true });
    else if (!want && lp?.desktop && !drag) close(true, true);
    else if (want && lp?.desktop && lp.layer.parentElement !== stack) { close(true, true); open({ desktop: true }); }   // the page area was rebuilt
  }
  (function watchDesk() {
    const b = document.getElementById("browser");
    if (!b) return setTimeout(watchDesk, 500);
    new MutationObserver(syncDesk).observe(b, { attributes: true, attributeFilter: ["data-ft-desktop", "data-ft-home", "data-ft-wins"] });
    setInterval(() => { if (!document.hidden) syncDesk(); }, 2000);
    syncDesk();
  })();
  /* the wallpaper is the background image of the theme in use: Vivaldi's own
     "Select Image..." of that theme's Background (the same picker and storage) */
  const pref = async path => { try { const v = await vivaldi.prefs.get(path); return v && typeof v === "object" && "value" in v ? v.value : v; } catch (e) { return undefined; } };
  async function themeInUse() {                    // as Vivaldi decides it: schedule off / by the system / by time
    const en = await pref("vivaldi.theme.schedule.enabled");
    if (en === "system" || en === 1) {
      const os = await pref("vivaldi.theme.schedule.o_s"), c = await pref("vivaldi.system.desktop_theme_color");
      const dark = c === "dark" || c === 1 || (c == null && matchMedia("(prefers-color-scheme: dark)").matches);
      if (os?.[dark ? "dark" : "light"]) return os[dark ? "dark" : "light"];
    }
    if (en === "timeline" || en === 2) {
      const tl = await pref("vivaldi.theme.schedule.timeline");
      if (Array.isArray(tl) && tl.length) {
        const at = t => (t.hours || 0) * 60 + (t.minutes || 0), now = new Date(), m = now.getHours() * 60 + now.getMinutes();
        const s = [...tl].sort((a, b) => at(a) - at(b));
        let cur = s[s.length - 1];
        for (const t of s) if (at(t) <= m) cur = t;
        if (cur?.themeId) return cur.themeId;
      }
    }
    return pref("vivaldi.themes.current");
  }
  async function changeWallpaper() {
    if (lp && !lp.desktop) close(true, true); else close();
    try {
      const themeId = await themeInUse();
      const win = await new Promise(r => chrome.windows.getCurrent(w => { void chrome.runtime.lastError; r(w); }));
      if (!themeId || !vivaldi?.utilities?.selectLocalImage) throw new Error("no picker");
      const ok = await vivaldi.utilities.selectLocalImage({ windowId: win?.id, title: "Select Background Image", themeId });
      if (!ok) return;
      for (const path of ["vivaldi.themes.user", "vivaldi.themes.system"]) {   // a picked image wins over a daily / preset source
        const list = await pref(path);
        const i = Array.isArray(list) ? list.findIndex(t => t?.id === themeId) : -1;
        if (i >= 0 && list[i].backgroundSource) { list[i] = { ...list[i], backgroundSource: "" }; vivaldi.prefs.set({ path, value: list }); }
      }
    } catch (e) {                                    // no picker here: Vivaldi's Themes settings instead
      console.warn("Vivaldi OS: wallpaper", e);
      wallpaperSettings();
    }
  }
  function openSettings() {                        // Vivaldi's Settings
    if (lp && !lp.desktop) close(true, true); else if (lp) close();
    chrome.tabs.create({ url: "vivaldi://settings/" }, () => void chrome.runtime.lastError);
  }
  function wallpaperSettings() {                   // Vivaldi's Themes settings (the theme's Background is in its Editor)
    if (lp && !lp.desktop) close(true, true); else close();
    chrome.tabs.create({ url: "vivaldi://settings/themes/" }, () => void chrome.runtime.lastError);
  }

  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"])
    chrome.bookmarks[ev]?.addListener(() => refresh());
  refresh();
  setTimeout(() => seedOnce(), 1500);
  vstore.get(WG_KEY).then(v => { if (Array.isArray(v)) { widgets = v.filter(w => WG[w?.k]); if (lp) render(); } });
  /* ---------------- updates: a newer Vivaldi OS on GitHub ----------------
     Vivaldi does not let its interface run downloaded code, so an update is one
     line pasted into Terminal / PowerShell / Command Prompt: it downloads the
     newest release and installs it (the same line also puts the mod back after
     a Vivaldi update). This only checks, tells, and copies that line. */
  const UPD_KEY = "vosUpdateSkip";
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  const relUrl = () => `https://github.com/${window.vosRepo}/releases/latest/download/`;
  const MANUAL_LINE = "(for /f \"delims=\" %Z in ('dir /b /o:d \"%USERPROFILE%\\Downloads\\VivaldiOS*Manual*.zip\"') do tar -xf \"%USERPROFILE%\\Downloads\\%Z\" -C \"%USERPROFILE%\\Documents\") & (for /d %D in (\"%LOCALAPPDATA%\\Vivaldi\\Application\\*.*.*.*\") do (copy /y \"%USERPROFILE%\\Documents\\VivaldiOS\\custom-vivaldi-os*.*\" \"%D\\resources\\vivaldi\\\" >nul & (if not exist \"%D\\resources\\vivaldi\\window.html.orig\" copy \"%D\\resources\\vivaldi\\window.html\" \"%D\\resources\\vivaldi\\window.html.orig\" >nul) & (findstr /v /l /x /c:\"</body>\" /c:\"</html>\" \"%D\\resources\\vivaldi\\window.html.orig\" & echo   ^<script src=\"custom-vivaldi-os.js\"^>^</script^>& echo ^</body^>& echo ^</html^>) > \"%D\\resources\\vivaldi\\window.html\" & echo Vivaldi OS installed in %D)) & start \"\" \"%LOCALAPPDATA%\\Vivaldi\\Application\\vivaldi.exe\"";
  function updateLines() {
    const R = relUrl();
    return isMac
      ? [["Terminal", `curl -fsSL ${R}VivaldiOS-Mac.command -o /tmp/vivaldi-os.command && bash /tmp/vivaldi-os.command`]]
      : [["PowerShell", `irm ${R}VivaldiOS-Windows.cmd -OutFile $env:TEMP\\vivaldi-os.cmd; & $env:TEMP\\vivaldi-os.cmd`],
         ["Command Prompt", `curl -L -o "%USERPROFILE%\\Downloads\\VivaldiOS-Windows-Manual.zip" ${R}VivaldiOS-Windows-Manual.zip & ` + MANUAL_LINE]];
  }
  const newer = (a, b) => {                        // is version a newer than b?
    const x = String(a).replace(/^v/, "").split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
    return false;
  };
  async function checkUpdate(manual) {
    if (!window.vosRepo || !window.vosVersion) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${window.vosRepo}/releases/latest`, { cache: "no-store" });
      if (!r.ok) { if (manual) updateNotice(null, "Couldn't reach GitHub", "Try again later."); return; }
      const tag = String((await r.json()).tag_name || "").replace(/^v/, "");
      if (tag && newer(tag, window.vosVersion)) {
        updTag(tag);                                                  // the tag at the left of the tab bar stays
        if (!manual && (await vstore.get(UPD_KEY)) === tag) return;   // "Later" for this version
        updateNotice(tag);
      } else if (manual) updateNotice(null, "Vivaldi OS is up to date", "Version " + window.vosVersion);
    } catch (e) { if (manual) updateNotice(null, "Couldn't reach GitHub", "Try again later."); }
  }
  /* Windows: download the one-file installer and open it (SmartScreen may ask once) */
  function winUpdate(b, msg) {
    b.textContent = "Downloading…"; b.disabled = true;
    const fail = text => { b.textContent = "Update Now"; b.disabled = false; msg.textContent = text; };
    chrome.downloads.download({ url: relUrl() + "VivaldiOS-Windows.cmd", filename: "VivaldiOS-Update.cmd", conflictAction: "overwrite", saveAs: false }, id => {
      if (chrome.runtime.lastError || !id) return fail("The download didn't start. Use Copy for PowerShell instead.");
      const on = d => {
        if (d.id !== id || !d.state) return;
        if (d.state.current === "complete") {
          chrome.downloads.onChanged.removeListener(on);
          b.textContent = "Opening…";
          try { chrome.downloads.open(id); msg.textContent = "The installer is starting: Vivaldi will close and come back with your tabs."; }
          catch (e) { chrome.downloads.show?.(id); msg.textContent = "Double-click VivaldiOS-Update.cmd (shown in its folder) to update."; }
        } else if (d.state.current === "interrupted") { chrome.downloads.onChanged.removeListener(on); fail("The download was stopped. Use Copy for PowerShell instead."); }
      };
      chrome.downloads.onChanged.addListener(on);
    });
  }
  let updEl = null;
  function updateNotice(tag, title, sub) {
    updEl?.remove();
    const n = document.createElement("div");
    n.className = "vos-upd vos-vars";
    const head = document.createElement("div"); head.className = "vos-upd-title";
    head.textContent = title || `Vivaldi OS ${tag} is available`;
    const p = document.createElement("div"); p.className = "vos-upd-sub";
    p.textContent = sub || (isMac
      ? `You have ${window.vosVersion}. Copy the update line, paste it into Terminal and press Enter. Vivaldi restarts with your tabs.`
      : `You have ${window.vosVersion}. Update Now downloads the installer and opens it (if Windows asks: More info → Run anyway). Vivaldi restarts with your tabs.`);
    n.append(head, p);
    const row = document.createElement("div"); row.className = "vos-upd-btns";
    const btn = (label, fn, cls) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "vos-upd-btn" + (cls ? " " + cls : ""); b.textContent = label;
      b.addEventListener("click", ev => { ev.stopPropagation(); fn(b); });
      row.appendChild(b); return b;
    };
    const close = () => { n.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, -8px)" }], { duration: 180, easing: "ease-in", fill: "forwards" }).finished.catch(() => {}).then(() => n.remove()); if (updEl === n) updEl = null; };
    if (tag) {
      btn("Later", () => { vstore.set(UPD_KEY, tag); close(); });
      if (!isMac && chrome.downloads?.download) btn("Update Now", b => winUpdate(b, p), "vos-upd-main");
      for (const [where, line] of updateLines()) {
        const label = updateLines().length > 1 ? `Copy for ${where}` : "Copy Update Line";
        btn(label, async b => {
          try { await navigator.clipboard.writeText(line); } catch (e) {
            const ta = document.createElement("textarea"); ta.value = line; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
          }
          b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = label), 1800);
        }, "vos-upd-main");
      }
    } else btn("OK", close, "vos-upd-main");
    n.appendChild(row);
    n.addEventListener("pointerdown", ev => ev.stopPropagation());
    (document.getElementById("browser") || document.body).appendChild(n);
    n.animate([{ opacity: 0, transform: "translate(-50%, -12px) scale(0.97)" }, { opacity: 1, transform: "translate(-50%, 0)" }],
              { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" });
    updEl = n;
  }
  /* the desktop's right-click menu also with floating windows on it: a right-click on
     the wallpaper between them (not on a window) shows it; Launchpad items open it first */
  let deskEl = null;
  const closeDesk = () => { deskEl?.remove(); deskEl = null; removeEventListener("pointerdown", deskOut, true); removeEventListener("keydown", deskKey, true); };
  const deskOut = ev => { if (!deskEl?.contains(ev.target)) closeDesk(); };
  const deskKey = ev => { if (ev.key === "Escape" && deskEl) { ev.stopPropagation(); closeDesk(); } };
  function deskMenu(x, y) {
    closeDesk();
    const m = document.createElement("div");
    m.className = "lp-menu vos-vars vos-desk-menu";
    const add = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item"; menuLabel(b, label);
      b.addEventListener("click", ev => { ev.stopPropagation(); closeDesk(); fn(); });
      m.appendChild(b);
    };
    const sep = () => { const d = document.createElement("div"); d.className = "lp-menu-sep"; m.appendChild(d); };
    const inLp = fn => () => { if (!lp) open(); if (lp) { enterEdit(); fn(); } };
    add("Open Launchpad", () => { if (!lp) open(); });
    add("Add Website…", inLp(siteGallery));
    add("Add Widget…", inLp(widgetGallery));
    add("Bookmarks…", inLp(folderPicker));
    sep();
    add("Change Wallpaper…", changeWallpaper);
    sep();
    add("Vivaldi OS Updates…" + (window.vosVersion ? "  (" + window.vosVersion + ")" : ""), () => checkUpdate(true));
    add("Settings…", openSettings);
    m.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); });
    (document.getElementById("browser") || document.body).appendChild(m);
    m.style.position = "fixed";
    m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + "px";
    deskEl = m;
    setTimeout(() => { addEventListener("pointerdown", deskOut, true); addEventListener("keydown", deskKey, true); });
  }
  addEventListener("contextmenu", ev => {
    const b = document.getElementById("browser"), t = ev.target;
    if (lp || !b?.hasAttribute("data-ft-desktop") || !t?.closest) return;     // the Launchpad has its own
    if (!t.closest("#webpage-stack") || t.closest("[data-ft-float], .ft-frame, .ft-lights, .ft-right, .lp-menu, .vos-tm-pop, input, textarea")) return;
    ev.preventDefault(); ev.stopPropagation();
    deskMenu(ev.clientX, ev.clientY);
  }, true);

  /* "New Update": a tag at the left end of the tab bar while a newer release exists */
  let tagFor = null, tagEl = null;
  function updTag(tag) {
    tagFor = tag;
    const bar = document.querySelector("#browser #tabs-container > .toolbar-tabbar-before") ||
                document.querySelector("#browser .toolbar-tabbar-before");
    if (!bar) return;
    if (!tagEl) {
      tagEl = document.createElement("button");
      tagEl.type = "button"; tagEl.className = "vos-upd-tag";
      tagEl.addEventListener("pointerdown", ev => ev.stopPropagation());
      tagEl.addEventListener("click", ev => { ev.stopPropagation(); updateNotice(tagFor); });
    }
    tagEl.textContent = "New Update";
    tagEl.title = `Vivaldi OS ${tag} is available (you have ${window.vosVersion})`;
    if (bar.firstChild !== tagEl) bar.insertBefore(tagEl, bar.firstChild);
  }
  setInterval(() => { if (tagFor && !tagEl?.isConnected) updTag(tagFor); }, 2000);   // a re-drawn tab bar gets it back
  setTimeout(() => checkUpdate(false), 20000);
  setInterval(() => checkUpdate(false), 12 * 3600 * 1000);

  vstore.get(TM_KEY).then(v => { if (v && typeof v === "object") { tm = { ...tm, ...v }; ensureTick(); } });              // the seed file may load after this one
})();
