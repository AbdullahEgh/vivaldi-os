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
  /* YOUR OWN ICON for a bookmark: an image you choose (right-click > Change Icon..., in the Launchpad or the bookmark
     manager - or a click on the big icon there), made a 128px square, kept on this computer by its address */
  const ICON_KEY = "vosIconsCustom";
  let customIcons = {};
  try { chrome.storage.local.get(ICON_KEY, o => { void chrome.runtime.lastError; customIcons = o?.[ICON_KEY] || {}; if (Object.keys(customIcons).length) setTimeout(() => { try { if (lp) render(); } catch (e) {} }, 0); }); } catch (e) {}
  const ownIcon = url => (url && customIcons[url]) || null;
  function setIcon(url, data) {
    if (!url) return;
    if (data) customIcons[url] = data; else delete customIcons[url];
    try { chrome.storage.local.set({ [ICON_KEY]: customIcons }, () => void chrome.runtime.lastError); } catch (e) {}
    try { if (lp) render(); } catch (e) {}
  }
  const moveIcon = (from, to) => { if (from && to && from !== to && customIcons[from]) { const d = customIcons[from]; delete customIcons[from]; setIcon(to, d); } };
  /* CHANGE ICON: icons from macOSicons.com, searched by the app's name (with your own free API key - kept on this
     computer only, never in Bento OS), or an image of your own. Searches are remembered (the free key has 50 a month) */
  const MI_KEY = "vosMacIconsKey", MI_CACHE = "vosMacIconsCache", MI_API = "https://api.macosicons.com/api/v1/search";
  const stGet = k => new Promise(r => { try { chrome.storage.local.get(k, o => { void chrome.runtime.lastError; r(o?.[k]); }); } catch (e) { r(undefined); } });
  const stSet = (k, v) => { try { chrome.storage.local.set({ [k]: v }, () => void chrome.runtime.lastError); } catch (e) {} };
  async function macIcons(q) {
    const key = String(q || "").trim().toLowerCase();
    if (!key) return [];
    const cache = (await stGet(MI_CACHE)) || {};
    if (cache[key]) return cache[key].hits;
    const api = await stGet(MI_KEY);
    if (!api) throw new Error("nokey");
    const r = await fetch(MI_API, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": api }, body: JSON.stringify({ query: String(q).trim() }) });
    if (r.status === 401 || r.status === 403) throw new Error("badkey");
    if (r.status === 429) throw new Error("limit");
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    const hits = (j.hits || []).filter(h => h?.lowResPngUrl).slice(0, 24).map(h => ({ n: h.appName || "", u: h.lowResPngUrl }));
    cache[key] = { hits, t: Date.now() };
    const keys = Object.keys(cache).sort((a, b) => cache[b].t - cache[a].t);
    for (const k of keys.slice(80)) delete cache[k];               // (the last 80 searches)
    stSet(MI_CACHE, cache);
    return hits;
  }
  function iconFrom(url, src, done, trim = 0) {     // an image (a file, or a picture's address) -> the bookmark's 128px icon
    const draw = im => {                             // (trim: the share of each side that is only margin - cut off)
      const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
      const iw = im.naturalWidth || im.width || S, ih = im.naturalHeight || im.height || S;
      let sx = iw * trim, sy = ih * trim, sw = iw - 2 * sx, sh = ih - 2 * sy;
      if (!trim) { const b = opaqueBox(im, iw, ih); if (b) { sx = b.x; sy = b.y; sw = b.w; sh = b.h; } }   // your own picture: its see-through border trimmed (a macOSicons one: its standard margin only)
      const g = c.getContext("2d"), k = Math.max(S / sw, S / sh), w = sw * k, h = sh * k;
      g.imageSmoothingQuality = "high";
      g.drawImage(im, sx, sy, sw, sh, (S - w) / 2, (S - h) / 2, w, h);   // filled, centred (as an app icon)
      setIcon(url, c.toDataURL("image/png"));
      done?.();
    };
    if (src instanceof Blob) return createImageBitmap(src).then(draw).catch(() => {});
    return fetch(src).then(r => r.blob()).then(b => createImageBitmap(b)).then(draw).catch(() => {});
  }
  function opaqueBox(im, iw, ih) {                 // the part of a picture that is not see-through (only a fully see-through border left out)
    try {
      const N = 128, c = document.createElement("canvas"); c.width = c.height = N;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data;
      let x0 = N, y0 = N, x1 = -1, y1 = -1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === N - 1 && y1 === N - 1)) return null;   // nothing see-through around it
      const kx = iw / N, ky = ih / N;
      return { x: x0 * kx, y: y0 * ky, w: (x1 - x0 + 1) * kx, h: (y1 - y0 + 1) * ky };
    } catch (e) { return null; }
  }
  setTimeout(async () => {                          // icons set before: their see-through border trimmed too (once)
    try {
      if (await stGet("vosIconsTrim1")) return;
      for (const [u, data] of Object.entries(customIcons)) await new Promise(r => { const im = new Image(); im.onload = () => { const b = opaqueBox(im, im.naturalWidth, im.naturalHeight); if (b) iconFrom(u, data, r); else r(); }; im.onerror = r; im.src = data; });
      stSet("vosIconsTrim1", true);
    } catch (e) {}
  }, 6000);
  function iconPicker(url, name, done) {
    document.querySelector(".lp-iconpick")?.remove();
    const host = lp?.layer || document.getElementById("browser"); if (!host) return;
    const box = document.createElement("div"); box.className = "lp-iconpick";
    box.innerHTML = `<div class="lp-ip-head"><input class="lp-ip-q" type="search" spellcheck="false" placeholder="Search macOSicons"><button type="button" class="lp-btn lp-ip-up">Upload Image…</button></div>
      <div class="lp-ip-msg"></div><div class="lp-ip-grid"></div>
      <div class="lp-ip-key" hidden><input class="lp-ip-k" type="password" spellcheck="false" autocomplete="off" placeholder="Your macOSicons API key"><button type="button" class="lp-btn lp-btn-main lp-ip-ks">Save</button>
      <a class="lp-ip-link" href="https://macosicons.com/developers">Get a free key</a></div>`;
    const q = box.querySelector(".lp-ip-q"), msg = box.querySelector(".lp-ip-msg"), grid = box.querySelector(".lp-ip-grid"), keyRow = box.querySelector(".lp-ip-key");
    const close = () => { box.remove(); removeEventListener("keydown", esc, true); removeEventListener("pointerdown", out, true); };
    const esc = ev => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); } };
    const out = ev => { if (box.contains(ev.target)) return; if (lp) lp.swallow = true; ev.stopPropagation(); close(); };   // (only the popup: the Launchpad stays)
    const search = async () => {
      grid.textContent = ""; msg.textContent = "Searching…"; keyRow.hidden = true;
      try {
        const hits = await macIcons(q.value);
        msg.textContent = hits.length ? "" : "No icons found.";
        for (const h of hits) {
          const b = document.createElement("button"); b.type = "button"; b.className = "lp-ip-cell"; b.title = h.n;
          const im = document.createElement("img"); im.src = h.u; im.alt = ""; im.decoding = "async"; im.loading = "lazy"; b.appendChild(im);
          b.addEventListener("click", ev => { ev.stopPropagation(); msg.textContent = "Setting…"; iconFrom(url, h.u, () => { close(); done?.(); }, 0.098); });   // (macOS icons: 100px of margin in 1024)
          grid.appendChild(b);
        }
      } catch (e) {
        const m = String(e?.message || e);
        if (m === "nokey" || m === "badkey") { msg.textContent = m === "nokey" ? "To search macOSicons, add your API key (once):" : "That API key was not accepted - check it:"; keyRow.hidden = false; }
        else msg.textContent = m === "limit" ? "This month's searches are used up - Upload Image… still works." : "Couldn't reach macOSicons.";
      }
    };
    q.value = name || ""; q.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); search(); } });
    box.querySelector(".lp-ip-up").addEventListener("click", ev => { ev.stopPropagation(); close(); pickIcon(url, done); });
    box.querySelector(".lp-ip-link").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); close(); openUrl("https://macosicons.com/developers", true); window.vosLaunchpad?.close?.(); });
    box.querySelector(".lp-ip-ks").addEventListener("click", ev => { ev.stopPropagation(); const v = box.querySelector(".lp-ip-k").value.trim(); if (v) { stSet(MI_KEY, v); search(); } });
    box.addEventListener("pointerdown", ev => ev.stopPropagation()); box.addEventListener("click", ev => ev.stopPropagation());
    host.appendChild(box);
    setTimeout(() => { addEventListener("keydown", esc, true); addEventListener("pointerdown", out, true); q.focus(); q.select(); }, 0);
    if (q.value) search(); else stGet(MI_KEY).then(k => { if (!k) { msg.textContent = "To search macOSicons, add your API key (once):"; keyRow.hidden = false; } });
  }
  function pickIcon(url, done) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", () => {
      const f = inp.files?.[0]; inp.remove();
      if (!f) return;
      const u = URL.createObjectURL(f), im = new Image();
      im.onload = () => {
        const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
        const g = c.getContext("2d"), k = Math.max(S / (im.naturalWidth || S), S / (im.naturalHeight || S));
        const w = (im.naturalWidth || S) * k, h = (im.naturalHeight || S) * k;
        g.imageSmoothingQuality = "high";
        g.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);              // filled, centred (as an app icon)
        URL.revokeObjectURL(u);
        setIcon(url, c.toDataURL("image/png"));
        done?.();
      };
      im.onerror = () => URL.revokeObjectURL(u);
      im.src = u;
    });
    setTimeout(() => inp.remove(), 120000);                          // (never chosen: not left behind)
    inp.click();
  }
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
    if (parked) parked.stale = true;                 // the hidden desktop Launchpad: drawn again when it comes back
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
        // opened from the Start Page (the empty desktop): the app takes that tab, no extra one
        const blank = tabs.find(x => x.active && /^chrome:\/\/vivaldi-webui\/startpage/.test(x.url || x.pendingUrl || ""));
        if (t) chrome.tabs.update(t.id, { active: true });
        else if (blank) { window.vosFloatNext?.(blank.id); chrome.tabs.update(blank.id, { url }); }
        else chrome.tabs.create({ url, active: true, windowId: w.id });
      });
    });
  }

  /* ---------------- icons ---------------- */
  function siteIcon(url, src, cls) {
    const i = document.createElement("img");
    i.className = cls; i.alt = ""; i.draggable = false;
    i.decoding = "async";                           // decoded off the main thread: opening never stutters
    const own = ownIcon(url);
    i.src = own || src(url);                        // your own icon first: it fills the icon's mask
    if (own) i.classList.add("lp-own");
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

  let justDragged = false, appOpenedAt = 0;
  function app(n, onOpen) {
    const a = document.createElement("button");
    a.type = "button"; a.className = "lp-app"; a.title = n.url || nameOf(n);
    a.__node = n;
    a.appendChild(tile(n));
    const l = document.createElement("span");
    l.className = "lp-name"; l.textContent = nameOf(n);
    a.appendChild(l);
    a.appendChild(delBadge(() => askDelete(n)));
    a.__open = onOpen;
    a.addEventListener("click", ev => {
      ev.stopPropagation();
      if (Date.now() - appOpenedAt < 600) return;                   // opened already on the release (onDown)
      if (lp?.swallow) { lp.swallow = false; return; }
      if (lp?.menuJustClosed) { lp.menuJustClosed = false; return; }
      if (lp?.editing && !isFolder(n)) return;      // editing: a tap opens nothing (folders still open)
      if (!justDragged) onOpen(n, ev);
    });
    return a;
  }

  /* ---------------- the Launchpad ---------------- */
  let lp = null;
  let parked = null;                                // the desktop Launchpad while windows are open: hidden, ready                                    // { layer, search, grid, card }
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
    if (parked) parked.stale = true;                                 // the hidden desktop one follows any change too
    if (!lp) return;
    const raw = lp.search.value.trim(), q = raw.toLowerCase();
    lp.grid.textContent = "";
    lp.grid.dataset.parent = root?.id || "";
    const list = q ? flat(items(root)).filter(n => nameOf(n).toLowerCase().includes(q) || host(n.url).includes(q)) : items(root);
    if (false) lp.grid.appendChild(special(raw.replace(/^https?:\/\//i, "").replace(/\/$/, ""), "Open " + toUrl(raw), "lp-go", () => goTo(raw)));
    const kids = q ? [] : list.map(n => app(n, launch));            // searching: the matching apps are rows of the list (Spotlight), no grid
    if (!raw)                                       // the widgets at their places among the icons
      widgets.map((w, i) => ({ w, at: w.pos ?? i })).sort((x, y) => x.at - y.at)
        .forEach(({ w, at }) => kids.splice(Math.max(0, Math.min(at, kids.length)), 0, widgetEl(w)));
    lp.grid.append(...kids);
    if (false) lp.grid.appendChild(special("Search the web", `Search for "${raw}"`, "lp-web", () => webSearch(raw)));
    lp.layer.toggleAttribute("data-searching", !!q);
    if (q) lp.grid.style.setProperty("display", "none", "important"); else lp.grid.style.removeProperty("display");   // searching: the list only, never the grid
    if (!list.length && !raw && !widgets.length) {
      const e = document.createElement("div");
      e.className = "lp-empty";
      e.textContent = chosen ? "This folder is empty" : "Your Bookmark Bar is empty";
      lp.grid.appendChild(e);
    }
    suggest(raw, q ? list : null);
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
    if (!trail.length && !quiet) {                  // it grows out of its own icon (iOS)
      const from = folderMorph(card, n);
      if (from) {
        card.animate([{ transform: from, opacity: 0.35 }, { transform: "none", opacity: 1 }],
                     { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
        grid.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
        head.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
      } else card.animate([{ transform: "scale(0.7)", opacity: 0 }, { transform: "none", opacity: 1 }],
                          { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.06)" });
    }
    lp.card = card;
    if (rename) setTimeout(() => title.click(), 320);
  }
  function closeFolder(instant) {
    if (!lp?.card) return false;
    const c = lp.card;
    lp.card = null;
    lp.layer.removeAttribute("data-folder");
    if (instant) { c.remove(); return true; }
    const to = !c.__trail?.length && folderMorph(c, c.__folder);   // back into its icon
    c.animate(to ? [{ transform: "none", opacity: 1 }, { transform: to, opacity: 0 }] : [{ transform: "none", opacity: 1 }, { transform: "scale(0.8)", opacity: 0 }],
              to ? { duration: 280, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" } : { duration: 170, easing: "ease-in", fill: "forwards" })
      .finished.catch(() => {}).then(() => c.remove()) && setTimeout(() => c.remove(), 2500);
    return true;
  }
  /* the transform that puts an open folder exactly over its icon (the card is centred on screen) */
  function folderMorph(card, n) {
    const icon = [...(lp?.grid?.querySelectorAll(":scope > .lp-app") || [])].find(a => a.__node?.id === n?.id)?.querySelector(".lp-tile");
    if (!icon) return null;
    const ir = icon.getBoundingClientRect(), cr = card.getBoundingClientRect();
    if (!ir.width || !cr.width) return null;
    const dx = ir.left + ir.width / 2 - (cr.left + cr.width / 2), dy = ir.top + ir.height / 2 - (cr.top + cr.height / 2);
    return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${(ir.width / cr.width).toFixed(3)}, ${(ir.height / cr.height).toFixed(3)})`;
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
                     { duration: 180, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => st.ghost.remove()) && setTimeout(() => st.ghost.remove(), 2500);
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
      if (st.on) return dragEnd(st, e.type === "pointerup");
      // a plain press and release on an app: it opens now - never lost when the grid redraws in between
      // (an icon still loading, a refresh), which sent the click to the background instead
      if (e.type !== "pointerup" || !lp || lp.swallow || lp.menuJustClosed || justDragged || (lp.editing && !isFolder(st.node))) return;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 6 || !st.el.__open) return;
      appOpenedAt = Date.now();
      st.el.__open(st.node, e);
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
    if (lp.sheetOnly) close(true, true);                            // opened for the sheet alone: it all goes
    return true;
  }
  function sheetOnly(fn) {                         // a sheet over the desktop as it is (no Launchpad behind it)
    if (lp && !lp.desktop) return fn();
    if (lp?.desktop) { lp.sheetOnlyDesk = true; return fn(); }       // the desktop's own Launchpad: just the sheet over it
    open(); if (!lp) return;
    lp.sheetOnly = true; lp.layer.setAttribute("data-sheet-only", "");
    document.getElementById("browser")?.removeAttribute("data-launchpad");
    fn();
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
      add("Change Icon…", () => { closeMenu(); iconPicker(n.url, nameOf(n)); });
      if (ownIcon(n.url)) add("Use the Site's Icon", () => { closeMenu(); setIcon(n.url, null); });
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
    add("Add Website…", () => { if (!lp.desktop) enterEdit(); siteGallery(); });   // the desktop: just the sheet, no editing
    add("Add Widget…", () => { if (!lp.desktop) enterEdit(); widgetGallery(); });
    add("Bookmarks…", () => folderPicker());   // just the Bookmarks sheet (no editing)
    const sep = () => { const d = document.createElement("div"); d.className = "lp-menu-sep"; m.appendChild(d); };
    sep();
    nestedItem(m, "Wallpaper", wallpaperItems(), closeMenu);
    add("Dark Mode", () => window.vosAppearance.toggle());
    isDarkNow().then(d => { const b = [...m.querySelectorAll(".lp-menu-item")].find(e => /^Dark Mode$/.test(e.textContent.trim())); b?.classList.toggle("lp-menu-on", d); });
    sep();
    add("Update" + (window.vosVersion ? "  v" + window.vosVersion : ""), () => checkUpdate(true));
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
      if (changes.url) moveIcon(n.url, changes.url);                 // your icon goes with it
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
      if (lp.rows[0]?.kind === "app") return lp.rows[0].run();       // the first matching app
      webSearch(q);
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
      if (Date.now() - appOpenedAt < 600) return;                  // the release opened an app: its click is not the background's
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
      .finished.catch(() => {}).then(() => layer.remove()) && setTimeout(() => layer.remove(), 2500);
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
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    go: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  const SUB = { app: "App", tab: "Switch to Tab", bookmark: "Bookmark", history: "History", go: "Open Address", search: "Search the Web" };
  function suggest(raw, apps) {
    clearTimeout(sugTimer);
    if (!lp) return;
    if (!raw) { lp.sug.textContent = ""; lp.sug.hidden = true; lp.rows = []; lp.sel = -1; return; }
    const seq = ++sugSeq;
    sugTimer = setTimeout(() => buildSuggest(raw, seq, apps || []), 70);
  }
  const ask = (fn, arg) => new Promise(r => { try { fn(arg, x => { void chrome.runtime.lastError; r(x || []); }); } catch (e) { r([]); } });
  async function buildSuggest(raw, seq, apps = []) {
    const q = raw.toLowerCase(), rows = [], seen = new Set();
    const add = (kind, title, url, run) => {
      if (url) { const k = url.replace(/\/$/, ""); if (seen.has(k)) return; seen.add(k); }
      rows.push({ kind, title, url, run });
    };
    for (const n of apps.slice(0, 8)) add("app", nameOf(n), n.url, () => launch(n));   // your apps first, as in Spotlight
    const nApps = rows.length;
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
    rows.splice(nApps + 8);
    add("search", raw, null, () => webSearch(raw));     // a web search is always there, last
    lp.rows = rows; lp.sel = -1;
    const box = lp.sug;
    box.textContent = "";
    rows.forEach((r, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-row";
      const ic = document.createElement("span");
      ic.className = "lp-row-icon";
      if (r.kind === "app") { ic.classList.add("lp-row-app"); ic.appendChild(siteIcon(r.url, icon, "lp-row-fav")); }
      else if (r.url && r.kind !== "go") ic.appendChild(siteIcon(r.url, mini, "lp-row-fav"));
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
      if (r.url && r.kind !== "app") b.appendChild(addButton(r.url, r.kind === "go" ? "" : r.title));
      if (r.kind === "app" && rows[i + 1] && rows[i + 1].kind !== "app") b.setAttribute("data-last-app", "");
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
    requestAnimationFrame(fitEdges);
  }
  /* the top buttons never cover the search field: short of room, only their icons */
  function fitEdges() {
    const L = lp?.layer;
    if (!L || !lp.editing) return;
    L.removeAttribute("data-edge-compact");
    const sb = L.querySelector(":scope > .lp-searchbar");
    sb?.style.removeProperty("width");
    const bar = sb?.getBoundingClientRect();
    if (!bar?.width) return;
    const btns = r => [...L.querySelectorAll(`:scope > .lp-edge-${r} .lp-edge-btn`)].map(b => b.getBoundingClientRect()).filter(x => x.width);
    const room = () => { const l = btns("l"), rr = btns("r"); return [l.length ? Math.max(...l.map(x => x.right)) : -Infinity, rr.length ? Math.min(...rr.map(x => x.left)) : Infinity]; };
    let [lx, rx] = room();
    if (lx <= bar.left - 12 && rx >= bar.right + 12) return;
    L.setAttribute("data-edge-compact", "");                      // first: only their icons
    [lx, rx] = room();
    if (lx <= bar.left - 12 && rx >= bar.right + 12) return;
    const cx = bar.left + bar.width / 2, half = Math.min(cx - lx, rx - cx) - 12;   // then: a shorter search field, still centred
    sb.style.setProperty("width", Math.max(120, Math.floor(half * 2)) + "px", "important");
  }
  addEventListener("resize", () => { if (lp?.editing) fitEdges(); });
  function exitEdit() {
    if (!lp?.editing) return false;
    lp.editing = false;
    lp.layer.removeAttribute("data-editing");
    return true;
  }
  /* right-click menus: an icon on the left of every item (like macOS / iOS menus) */
  const MI = (d, fill) => `<svg class="lp-mi-ic" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const MENU_ICONS = [                              // one thin line weight (as Vivaldi's own icons)
    [/^light mode/i, MI('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>')],
    [/^dark mode/i, MI('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>')],   // macOS: a circle, its left half dark
    [/^both modes/i, MI('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M20 4v12.5a3.5 3.5 0 0 1-3.5 3.5H4z" fill="currentColor" stroke="none"/>')],
    [/^dim wallpaper/i, MI('<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none" opacity="0.55"/>')],
    [/^blur wallpaper/i, MI('<circle cx="8" cy="9" r="3" opacity="0.5"/><circle cx="15.5" cy="10.5" r="4" opacity="0.75"/><circle cx="10" cy="16" r="3.2"/>')],
    [/^themes? settings/i, MI('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.7-.9 1.4-1.8-.4-1 .3-2.2 1.4-2.2H17a3.5 3.5 0 0 0 3.5-3.5c0-5.2-3.8-9.5-8.5-9.5z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="10.5" cy="7.3" r="1.1"/><circle cx="15" cy="7.8" r="1.1"/>')],
    [/^back$/i, MI('<path d="M14.5 6l-6 6 6 6"/>')],
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
    [/settings/i, MI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')],
    [/^\d+ (min|h)$/i, MI('<circle cx="12" cy="12.5" r="7.5"/><path d="M12 12.5V8.6"/>')],
  ];
  const BLANK_IC = '<svg class="lp-mi-ic" viewBox="0 0 24 24"></svg>';
  function menuLabel(b, label) {                    // an icon on the left, then the words
    const ic = (MENU_ICONS.find(([re]) => re.test(label)) || [null, BLANK_IC])[1];
    b.innerHTML = ic;
    const t = document.createElement("span"); t.className = "lp-mi-text"; t.textContent = label;
    b.appendChild(t);
  }
  const ICON = {                                    // one thin line weight
    update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 4.6v4.2h-4.2"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 2.4 14.4 0 17M12 3.5c-2.4 2.6-2.4 14.4 0 17"/></svg>',
    wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M6 16.5l4.3-4.6 3.2 3.2 2-2 3 3.4"/><circle cx="15.8" cy="9" r="1.4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2H18a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.3 4.3 8.7-9.3"/></svg>',
    widget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2.2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="3.75"/><rect x="3.5" y="13" width="17" height="7.5" rx="2.2"/></svg>',
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
    return [mk("l", [["Folder", ICON.folder, folderPicker], ["Wallpaper", ICON.wall, () => { const b = lp?.layer.querySelector('.lp-edge-btn[title="Wallpaper"]')?.getBoundingClientRect(); wallpaperMenu(b ? b.left : 40, b ? b.bottom + 8 : 120); }],
                     ["Update" + (window.vosVersion ? "  v" + window.vosVersion : ""), ICON.update, () => checkUpdate(true)]]),
            mk("r", [["Websites", ICON.globe, siteGallery], ["Widgets", ICON.widget, widgetGallery], ["Done", ICON.check, exitEdit, "lp-edge-done"]])];
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
    { // a scroll bar only while scrolling, over the content (the content goes edge to edge under it)
      const thumb = document.createElement("div"); thumb.className = "lp-ios-thumb"; box.appendChild(thumb);
      body.addEventListener("scroll", () => {
        const h = body.clientHeight, sh = body.scrollHeight;
        if (sh <= h + 1) return;
        const th = Math.max(32, h * h / sh);
        thumb.style.height = Math.round(th) + "px";
        thumb.style.top = Math.round(body.offsetTop + 3 + (h - th - 6) * body.scrollTop / (sh - h)) + "px";
        thumb.setAttribute("data-on", "");
        clearTimeout(thumb.__t); thumb.__t = setTimeout(() => thumb.removeAttribute("data-on"), 900);
      }, { passive: true });
    }
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
      if (n?.url) { big.classList.add("lp-det-icon-pick"); big.title = "Click to choose an icon"; big.addEventListener("click", ev => { ev.stopPropagation(); iconPicker(n.url, n.title, () => draw()); }); }
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
          if (ch.url) moveIcon(n.url, ch.url);                       // your icon goes with it
          if (Object.keys(ch).length) await bm("update", n.id, ch);
          return true;
        };
        let cancelling = false;
        for (const i of [name, addr]) i.addEventListener("blur", () => setTimeout(() => { if (cancelling) { cancelling = false; return; } if (!form.contains(document.activeElement)) save().then(ok => ok && draw()); }, 0));
        form.onsubmit = ev => { ev.preventDefault(); save().then(ok => ok && draw()); };
        // looking at it: Open / New Tab; editing it: Cancel / Save
        const bOpen = btn("Open", "lp-btn-main", () => { openUrl(n.url); close(); });
        const bTab = btn("New Tab", "", () => { openUrl(n.url, true); close(); });
        const bCancel = btn("Cancel", "", () => { name.value = n.title || ""; addr.value = n.url || ""; addr.setCustomValidity(""); P.edit = false; document.activeElement?.blur?.(); editing(false); });
        bCancel.addEventListener("pointerdown", () => { cancelling = true; });   // (before the field's blur: nothing saved)
        const bSave = btn("Save", "lp-btn-main", null, "submit");
        const shown = (b, on) => b.style.setProperty("display", on ? "" : "none", "important");
        const editing = on => { shown(bOpen, !on); shown(bTab, !on); shown(bCancel, on); shown(bSave, on); };
        editing(false);
        for (const i of [name, addr]) i.addEventListener("focus", () => editing(true));
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
        add("Change Icon…", () => iconPicker(n.url, n.title, () => draw()));
        if (ownIcon(n.url)) add("Use the Site's Icon", () => { setIcon(n.url, null); draw(); });
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
    if (!preview) pinEdge(box, w);
    return box;
  }
  /* a widget at the left or right edge stays at that edge whatever the width (the icons
     flow around it); one elsewhere flows with the icons */
  const edgeOfW = w => w.edge === undefined ? "l" : w.edge;
  function edgeRow(w) {                             // its row at its edge: where it was put, under the ones above it
    const same = widgets.filter(x => edgeOfW(x) === edgeOfW(w))
      .map((x, i) => ({ x, k: x.row ?? 0, p: x.pos ?? i })).sort((a, b) => a.k - b.k || a.p - b.p);
    let end = 1;
    for (const { x } of same) { const st = Math.max(x.row ?? 1, end); if (x.id === w.id) return st; end = st + 2; }
    return 1;
  }
  function pinEdge(box, w) {
    const span = w.s === "m" ? 4 : 2, edge = edgeOfW(w);
    if (!edge) { box.style.removeProperty("grid-column"); box.style.removeProperty("grid-row"); return; }
    box.style.setProperty("grid-column", edge === "l" ? `1 / span ${span}` : `${-span - 1} / -1`, "important");
    box.style.setProperty("grid-row", `${edgeRow(w)} / span 2`, "important");
  }
  function edgeOf(box, grid) {                      // where it sits now: { edge: "l" | "r" | null, row }
    const cs = getComputedStyle(grid);
    const tracks = cs.gridTemplateColumns.split(" ").map(parseFloat).filter(n => n > 0);
    const g = grid.getBoundingClientRect(), r = box.getBoundingClientRect(), half = (tracks[0] || 112) / 2;
    const step = (parseFloat(cs.gridAutoRows) || 96) + (parseFloat(cs.rowGap) || 30);
    const row = Math.max(1, Math.round((r.top - g.top) / step) + 1);
    return { edge: r.left - g.left < half ? "l" : g.right - r.right < half ? "r" : null, row };
  }
  const pad = n => String(n).padStart(2, "0");
  function buildWidget(card, w) {
    card.textContent = "";
    card.__key = "";
    if (w.k === "clockcal") {
      card.innerHTML = clockSvg(true) + '<div class="lp-cal-mon"><div class="lp-cal-month"></div><div class="lp-cal-grid"></div></div>';
      liftSecond(card);
    } else if (w.k === "clock-num" || w.k === "clock-pill" || w.k === "clock-sq") {
      card.innerHTML = clockSvg(w.k === "clock-pill", w.k === "clock-sq") + (w.s === "m"
        ? '<div class="lp-dclock"><div class="lp-dtime"></div><div class="lp-dday"></div><div class="lp-ddate"></div></div>' : "");
      if (w.k === "clock-sq" && w.s === "s") requestAnimationFrame(() => drawWidget(card, w));   // once it has its size
      liftSecond(card);                              // the second hand sweeps smoothly
    } else if (w.k === "cal") {
      card.innerHTML = (w.s === "m" ? '<div class="lp-cal-left"><div class="lp-cal-wd"></div><div class="lp-cal-big"></div><div class="lp-cal-my"></div></div>' : "") +
                       '<div class="lp-cal-mon"><div class="lp-cal-month"></div><div class="lp-cal-grid"></div></div>';
    } else if (w.k === "timer") buildTimer(card, w);
    drawWidget(card, w);
  }
  /* the second hand on a layer of its own: the same hand and hub, drawn over the face and
     turned by the graphics card - the clock is not painted again 60 times a second */
  function liftSecond(card) {
    const face = card.querySelector("svg.lp-clock:not(.lp-sec)");
    card.querySelector(":scope > svg.lp-sec")?.remove();
    if (!face) return;
    const sec = face.cloneNode(false);                // same class and viewBox as the face
    sec.classList.add("lp-sec"); sec.setAttribute("aria-hidden", "true");
    for (const sel of [".lp-sh", ".lp-shub", ".lp-hub2"]) { const n = face.querySelector(sel); if (n) sec.appendChild(n); }
    const n = new Date();
    sec.style.animationDelay = -(n.getSeconds() + n.getMilliseconds() / 1000) + "s";
    card.appendChild(sec);
    if (!card.__secRO) { card.__secRO = new ResizeObserver(() => fitSecond(card)); card.__secRO.observe(card); }
    fitSecond(card);
  }
  function fitSecond(card) {                        // exactly over the face (as laid out, scaled or not)
    const face = card.querySelector("svg.lp-clock:not(.lp-sec)"), sec = card.querySelector(":scope > svg.lp-sec");
    if (!face || !sec) return;
    const cr = card.getBoundingClientRect(), fr = face.getBoundingClientRect();
    if (!cr.width || !card.offsetWidth) return;
    const k = cr.width / card.offsetWidth;
    const px = v => (Math.round(v / k * 100) / 100) + "px";
    sec.style.setProperty("left", px(fr.left - cr.left - card.clientLeft * k), "important");
    sec.style.setProperty("top", px(fr.top - cr.top - card.clientTop * k), "important");
    sec.style.setProperty("width", px(fr.width), "important");
    sec.style.setProperty("height", px(fr.height), "important");
  }
  function clockSvg(pills, square) {
    let s = '<svg class="lp-clock" viewBox="0 0 100 100"><circle class="lp-face" cx="50" cy="50" r="49"/>';
    if (square) return clockSq();
    if (pills) {
      // twelve pills spread to the edge of the face (r 38 to 48); the hands: the Numbers clock's
      for (let i = 0; i < 12; i++)
        s += `<rect class="lp-pill" x="48.75" y="7" width="2.5" height="10" rx="1.25" transform="rotate(${i * 30} 50 50)"/>`;   // on the Numbers clock's circle (r 33 to 43, the digits' r 38)
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
      if (w.k === "clock-sq" && w.s === "s" && (card.__sized !== true || card.__asp === undefined) && card.clientHeight) {
        if (!card.__ro) { card.__ro = new ResizeObserver(() => { card.__sized = false; }); card.__ro.observe(card); }
        card.__sized = true;                           // measured again only when its size changes
        const asp = Math.round(card.clientWidth / card.clientHeight * 100) / 100;
        const r = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 20;
        if (asp !== card.__asp) {                      // the face takes the card's shape and corners
          card.__asp = asp;
          card.innerHTML = clockSq(asp, Math.round(r * 164 / card.clientHeight * 10) / 10);
          liftSecond(card);
        }
      }
      const c = card.querySelector(".lp-clock-sq") ? 82 : 50;     // the Square face's centre is (82, 82)
      const rot = (sel, deg) => { const e = card.querySelector(sel), v = `rotate(${deg.toFixed(1)} ${c} ${c})`; if (e && e.getAttribute("transform") !== v) e.setAttribute("transform", v); };
      rot(".lp-hh", hr * 30); rot(".lp-mh", min * 6);
      if (w.s === "m" && w.k !== "clockcal") {
        const loc = undefined;
        setText(card.querySelector(".lp-dtime"), now.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, ""));
        setText(card.querySelector(".lp-dday"), now.toLocaleDateString(loc, { weekday: "long" }));
        setText(card.querySelector(".lp-ddate"), now.toLocaleDateString(loc, { day: "numeric", month: "long" }));
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
  const PRESETS = [5, 10, 15, 20, 30, 45, 60, 90, 120];   // minutes
  const presetLabel = p => p >= 60 && p % 60 === 0 ? p / 60 + " h" : p + " min"
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
    } else if (act === "cancel") { tm = { ...tm, end: 0, left: 0, rang: false }; if (st === "over") closeTmPop(); }   // the ring stays; done: the widget goes too
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
        PRESETS.map(p => `<button type="button" class="lp-wg-btn lp-tm-chip" data-act="set" data-arg="${p}"${p <= 3 ? " data-short-chip" : ""}>${presetLabel(p)}</button>`).join("") +
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
  function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }   // no change: no DOM work
  function drawTimer(card) {
    const st = tmState(), left = tmLeft();
    card.toggleAttribute("data-run", st === "run");
    card.toggleAttribute("data-idle", st === "idle");
    overTone(card, st);
    const t = card.querySelector(".lp-tm-time");
    setText(t, st === "over" ? fmtUp(tmOver()) : fmt(left));
    if (t) { const n = String(Math.min(9, t.textContent.length)); if (t.dataset.len !== n) t.dataset.len = n; }   // longer: smaller (always inside the ring)
    ringSet(card.querySelector(".lp-ring-fg"), st);
    const go = card.querySelector(".lp-tm-go");
    if (go) { setText(go, st === "run" ? "Pause" : st === "pause" ? "Resume" : st === "over" ? "Restart" : "Start"); if (go.dataset.state !== st) go.dataset.state = st; }
    const c = card.querySelector(".lp-tm-cancel");
    if (c) { setText(c, "Cancel"); if (c.disabled !== (st === "idle")) c.disabled = st === "idle"; }
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
    const host = document.querySelector("#browser .vos-chain-vostimer");   // the Timer on the tab bar: always its ring, in its place
    if (!tm.mini && st === "idle" && !host) { tmMini?.remove(); tmMini = null; closeTmPop(); closeTmMenu(); return; }
    const clock = document.querySelector("#browser .ClockButton");
    const anchor = host || clock?.closest(".button-toolbar") || clock;
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
    const tt = (st === "over" ? "Timer " + fmtUp(tmOver()) : "Timer " + fmt(tmLeft())) + " - right-click to change or remove";
    if (tmMini.title !== tt) tmMini.title = tt;
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
    pageFocused();
    drawTimer(pop.querySelector(".lp-wk-timer"));
    setTimeout(() => {
      addEventListener("pointerdown", outside, true);
      addEventListener("keydown", popKey, true);
    });
  }
  const outside = ev => { if (!tmPop?.contains(ev.target) && !tmMini?.contains(ev.target)) closeTmPop(); };
  /* a click inside an app (a web page) closes the popups too: the page takes the focus (no
     pointer event reaches the browser's own document from there); a window only hovered does not */
  const pageFocused = () => { const a = document.activeElement; if (a?.closest?.("#webpage-stack")) a.blur?.(); };   // so the next click in a page is heard
  document.addEventListener("focusin", ev => {
    if (!tmPop && !clkPop && !tmMenu) return;
    if (!ev.target?.closest?.("#webpage-stack")) return;
    if (Date.now() - (window.__vosHoverFocusAt || 0) < 600) return;   // the mod's hover focus, not a click
    if (tmPop && !tmPop.matches(":hover")) closeTmPop();
    if (clkPop && !clkPop.matches(":hover")) closeClkPop();
    if (tmMenu) closeTmMenu();
  }, true);
  const popKey = ev => { if (ev.key === "Escape" && tmPop) { ev.stopPropagation(); closeTmPop(); } };
  function closeTmPop() {
    if (!tmPop) return;
    const p = tmPop; tmPop = null;
    removeEventListener("pointerdown", outside, true);
    removeEventListener("keydown", popKey, true);
    p.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.97)" }], { duration: 140, easing: "ease-in", fill: "forwards" })
      .finished.catch(() => {}).then(() => p.remove()) && setTimeout(() => p.remove(), 2500);
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
    pageFocused();
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
      .finished.catch(() => {}).then(() => p.remove()) && setTimeout(() => p.remove(), 2500);
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

  /* the popups by the tab bar follow their button when the Vivaldi window changes size */
  function placeNear(pop, anchor, gap = 10) {
    if (!pop?.isConnected || !anchor?.isConnected) return;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = (r.top - h - gap >= 8 ? r.top - h - gap : r.bottom + gap) + "px";
  }
  const shown = el => !!el?.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
  const followAll = () => {
    if (tmPop && !shown(tmMini)) closeTmPop();               // its ring hidden (a narrow window): the popup goes too
    if (tmMenu && !shown(tmMini)) closeTmMenu();
    if (clkPop && !shown(clkAt)) closeClkPop();
    placeNear(tmPop, tmMini); placeNear(clkPop, clkAt); placeNear(tmMenu, tmMini, 8);
  };
  addEventListener("resize", () => { requestAnimationFrame(followAll); setTimeout(followAll, 200); });   // (again once the tab bar has made room)
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
    for (const p of PRESETS) add(presetLabel(p), () => tmChange(p), Math.round(tm.dur / 60000) === p ? "lp-menu-on" : "");
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
    if (want && !tick) {                            // once a second, just after it turns (not 4 times)
      const next = () => {
        let ms = 1005 - (Date.now() % 1000);
        if (tmState() === "run") ms = Math.min(ms, Math.max(5, tmLeft() + 5));   // the timer's end, on time
        tick = setTimeout(() => { onTick(); if (tick) next(); }, ms);
      };
      next();
    }
    if (!want && tick) { clearTimeout(tick); tick = 0; }
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
        el.style.removeProperty("grid-column"); el.style.removeProperty("grid-row");   // it flows with the icons while dragged
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
      el.removeAttribute("data-drag-src");
      lp?.layer.removeAttribute("data-dragging");
      justDragged = true; setTimeout(() => { justDragged = false; }, 60);
      const order = [...lp.grid.children].filter(c => c.matches(".lp-app, .lp-widget"));
      const at = edgeOf(el, lp.grid);                // dropped at an edge: it stays at that edge
      widgets = widgets.map(w => {                  // each widget keeps its place among the icons
        const i = order.findIndex(c => c.__w?.id === w.id);
        const nw = i >= 0 ? { ...w, pos: i } : w;
        if (w.id === el.__w?.id) { nw.edge = at.edge; nw.row = at.row; }
        return nw;
      });
      el.__w = widgets.find(w => w.id === el.__w?.id) || el.__w;
      for (const c of lp.grid.querySelectorAll(".lp-widget")) if (c.__w) { c.__w = widgets.find(w => w.id === c.__w.id) || c.__w; pinEdge(c, c.__w); }
      const goal = el.querySelector(".lp-wcard").getBoundingClientRect();
      st.ghost.animate([{ left: st.ghost.style.left, top: st.ghost.style.top }, { left: goal.left + "px", top: goal.top + "px" }],
                       { duration: 180, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => st.ghost.remove()) && setTimeout(() => st.ghost.remove(), 2500);
      saveWidgets();
      drag = null;
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
  }

  /* ---- the tab bar's widgets: Desktops, Bento, Timer - each on or off (a switch) ---- */
  const galHead = (body, title, sub) => {
    const h = document.createElement("div"); h.className = "lp-gal-head"; h.textContent = title;
    const s = document.createElement("div"); s.className = "lp-gal-sub"; s.textContent = sub;
    body.append(h, s);
  };
  function tabbarSection(body) {
    const tbw = window.vosTabbarWidgets;
    if (!tbw) return;
    galHead(body, "Tab Bar", "Tap one to show or hide it in the tab bar");
    const g = document.createElement("div"); g.className = "lp-gal-row lp-tb-tiles";
    body.append(g);
    const items = [["bento", "Bento"], ["desktops", "Desktops"], ["dark", "Dark Mode"], ["timer", "Timer"], ["date", "Date"]];
    tbw.get().then(st => {
      for (const [k, name] of items) {
        const row = document.createElement("button"); row.type = "button"; row.className = "lp-tb-tile";
        row.setAttribute("role", "switch"); row.setAttribute("aria-label", name + " in the tab bar");
        const ic = document.createElement("span"); ic.className = "lp-tb-ic"; ic.innerHTML = tbw.icons?.[k] || "";
        const t = document.createElement("span"); t.className = "lp-tb-name"; t.textContent = name;
        const sw = document.createElement("span"); sw.className = "lp-tb-state";
        const paint = () => { row.toggleAttribute("data-on", !!st[k]); row.setAttribute("aria-checked", String(!!st[k])); sw.textContent = st[k] ? "On" : "Off"; };
        paint();
        row.addEventListener("click", ev => {
          ev.stopPropagation();
          st[k] = !st[k]; paint();
          Promise.resolve(tbw.set(k, st[k])).catch(() => {});
        });
        row.append(ic, t, sw);
        g.appendChild(row);
        if (k === "date" && tbw.dateFmt) {                   // how it reads (Fri / Fri 20 / Fri 20 Nov): its gear
          const gear = document.createElement("span"); gear.className = "lp-tb-gear"; gear.setAttribute("role", "button"); gear.title = "How the date reads";
          gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
          gear.addEventListener("click", ev => {
            ev.stopPropagation();
            document.querySelector(".lp-tb-fmt")?.remove();
            const m = document.createElement("div"); m.className = "lp-menu lp-tb-fmt";
            const head = document.createElement("div"); head.className = "lp-menu-head"; head.textContent = "Date"; m.appendChild(head);
            for (const f of ["d", "dd", "ddm"]) {
              const b = document.createElement("button"); b.type = "button"; b.className = "lp-menu-item" + (tbw.dateFmt() === f ? " lp-menu-on" : ""); b.textContent = tbw.dateText(f);
              b.addEventListener("click", e => {
                e.stopPropagation(); tbw.setDateFmt(f); m.remove();
                if (!st.date) { st.date = true; paint(); Promise.resolve(tbw.set("date", true)).catch(() => {}); }   // choosing one shows it
              });
              m.appendChild(b);
            }
            m.addEventListener("pointerdown", e => e.stopPropagation());
            (row.closest(".lp-ios") || document.body).appendChild(m);
            const r = gear.getBoundingClientRect(), host = m.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
            m.style.position = "absolute"; m.style.left = Math.round(r.left - host.left) + "px"; m.style.top = Math.round(r.bottom - host.top + 6) + "px";
            setTimeout(() => addEventListener("pointerdown", function off(e2) { if (!m.contains(e2.target)) { m.remove(); removeEventListener("pointerdown", off, true); } }, true));
          });
          row.appendChild(gear);
        }
      }
    }).catch(() => {});
  }
  /* ---- the widget gallery (Widgets, in editing mode) ---- */
  function widgetGallery() {
    if (!lp) return;
    const body = sheetBox("lp-gallery", "Widgets");
    tabbarSection(body);
    galHead(body, "Desktop", "Tap one to add it to the Launchpad");
    requestAnimationFrame(() => body.querySelectorAll(".lp-gal-row").forEach(r => { r.scrollLeft = 0; }));   // each row from its first
    let section = "";
    for (const k of Object.keys(WG)) {
      if (WG[k].name !== section) {
        section = WG[k].name;
        const l = document.createElement("div"); l.className = "lp-gal-group"; l.textContent = section;
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
          const el = lp && [...lp.grid.querySelectorAll(".lp-widget")].find(e => e.__w?.id === id);
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

  // the "OS · Timer" toolbar button: its ring shows by the clock, and the timer opens / closes
  window.vosClockPop = btn => (clkPop ? closeClkPop() : openClkPop(btn));   // the tab bar Date: the calendar too
  window.vosTimer = { paint: () => paintMini(), hide() { if (tmState() === "idle") { tm = { ...tm, mini: false }; saveTm(); paintMini(); setTimeout(paintMini, 700); } }, toggle() {
    if (!tm.mini) { tm = { ...tm, mini: true }; saveTm(); }
    paintMini(); ensureTick();
    setTimeout(() => (tmPop ? closeTmPop() : openTmPop()), 0);
  } };
  window.vosLaunchpad = { open, close, toggle: () => (lp && !lp.desktop ? close() : (lp && close(true, true), open())), bookmarks: () => folderPicker(),
                          icons: { set: setIcon, get: ownIcon, picker: (url, name) => iconPicker(url, name) },
                          get isOpen() { return !!lp && !lp.desktop; } };

  /* ---------------- the desktop: the Launchpad on the wallpaper ---------------- */
  function syncDesk() {
    const b = document.getElementById("browser"), stack = document.getElementById("webpage-stack");
    const want = !!b && !!stack && (b.hasAttribute("data-ft-home") ||
                 (b.hasAttribute("data-ft-desktop") && !b.hasAttribute("data-ft-wins")));   // windows open, or an empty desktop: only the wallpaper
    if (want && !lp && parked?.layer.parentElement === stack) {   // back at once: nothing to build, no icon to load
      lp = parked; parked = null;
      lp.layer.style.removeProperty("visibility");
      if (lp.stale) { lp.stale = false; render(); }
      ensureTick(); try { onTick(); } catch (e) {}
    }
    else if (want && !lp) { parked?.layer.remove(); parked = null; open({ desktop: true }); }
    else if (!want && lp?.desktop && !drag && !b.hasAttribute("data-vos-swipe")) {   // windows open: put aside, as it is (after a swipe has slid it out)
      close();                                                     // (its plain state: no menu, folder or search)
      const p = lp; lp = null;
      p.layer.style.setProperty("visibility", "hidden", "important");
      parked = p; ensureTick();
    }
    else if (want && lp?.desktop && lp.layer.parentElement !== stack) { close(true, true); open({ desktop: true }); }   // the page area was rebuilt
  }
  (function watchDesk() {
    const b = document.getElementById("browser");
    if (!b) return setTimeout(watchDesk, 50);
    new MutationObserver(syncDesk).observe(b, { attributes: true, attributeFilter: ["data-ft-desktop", "data-ft-home", "data-ft-wins", "data-vos-swipe", "data-vos-empty"] });
    (window.vosBeat || (f => setInterval(() => { if (!document.hidden) f(); }, 2500)))(syncDesk);
    syncDesk();
  })();
  /* the wallpaper is the background image of the theme in use: Vivaldi's own
     "Select Image..." of that theme's Background (the same picker and storage) */
  /* Vivaldi's settings: asked the way it answers - a promise (this Vivaldi), or a callback (if it ever wants one) -
     never both in one call (Vivaldi turns that down, and the answer would be empty) */
  const pref = path => new Promise(res => {
    const norm = v => v && typeof v === "object" && "value" in v ? v.value : v;
    let done = false; const fin = v => { if (!done) { done = true; res(norm(v)); } };
    try {
      const r = vivaldi.prefs.get(path);
      if (r && typeof r.then === "function") { r.then(fin, () => fin(undefined)); setTimeout(() => fin(undefined), 4000); return; }
      if (r !== undefined) return fin(r);
    } catch (e) {}
    try { vivaldi.prefs.get(path, v => { void chrome.runtime.lastError; fin(v); }); setTimeout(() => fin(undefined), 4000); } catch (e) { fin(undefined); }
  });
  const prefPut = (path, value) => new Promise(res => {
    let done = false; const fin = ok => { if (!done) { done = true; res(ok); } };
    try {
      const r = vivaldi.prefs.set({ path, value });
      if (r && typeof r.then === "function") { r.then(() => fin(true), () => fin(false)); setTimeout(() => fin(true), 4000); return; }
      return fin(true);
    } catch (e) {}
    try { vivaldi.prefs.set({ path, value }, () => fin(!chrome.runtime.lastError)); setTimeout(() => fin(true), 4000); } catch (e) { fin(false); }
  });
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
  /* THE WALLPAPER, per appearance: Light mode, Dark mode, or one for both. Each mode is a Vivaldi theme
     (Vivaldi switches them with the system's appearance); the wallpaper is that theme's background image. */
  const darkTheme = t => { const c = /^#?([0-9a-f]{6})$/i.exec(t?.colorBg || ""); if (!c) return false; const n = parseInt(c[1], 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.5; };
  async function modeThemes() {
    const en = await pref("vivaldi.theme.schedule.enabled"), os = (await pref("vivaldi.theme.schedule.o_s")) || {};
    const cur = await themeInUse();
    const all = [...((await pref("vivaldi.themes.system")) || []), ...((await pref("vivaldi.themes.user")) || [])];
    const has = id => all.some(t => t?.id === id), curT = all.find(t => t?.id === cur);
    let pair = null; try { pair = JSON.parse((await vstore.get("vosModeThemes")) || "null"); } catch (e) {}
    if (os.light && os.dark && os.light !== os.dark) vstore.set("vosModeThemes", JSON.stringify(pair = { light: os.light, dark: os.dark }));   // the real pair (Dark Mode may point both at one)
    const light = pair?.light && has(pair.light) ? pair.light : os.light && has(os.light) ? os.light : curT && !darkTheme(curT) ? cur : has("Vivaldi1") ? "Vivaldi1" : cur;
    const dark = pair?.dark && has(pair.dark) ? pair.dark : os.dark && has(os.dark) ? os.dark : curT && darkTheme(curT) ? cur : has("Vivaldi2") ? "Vivaldi2" : cur;
    return { light, dark, en, os, sys: en === "system" || en === 1 };
  }
  async function themeBg(id, fields) {               // that theme's background (both lists: the one it is in)
    for (const path of ["vivaldi.themes.user", "vivaldi.themes.system"]) {
      const list = await pref(path);
      const i = Array.isArray(list) ? list.findIndex(t => t?.id === id) : -1;
      if (i < 0) continue;
      if (!fields) return list[i];
      list[i] = { ...list[i], ...fields }; await vivaldi.prefs.set({ path, value: list });
    }
    return null;
  }
  /* A macOS SUBMENU: an item with a chevron opens its list beside the menu - on hover (a moment's pause) or a click -
     on the right, or on the left where there is no room; hovering another item of the menu closes it */
  function nestedItem(m, label, items, done) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lp-menu-item lp-menu-nest"; menuLabel(b, label);
    b.insertAdjacentHTML("beforeend", '<svg class="lp-menu-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    let sub = null, t = 0, watch = null;
    const close = () => { clearTimeout(t); watch?.disconnect(); watch = null; sub?.remove(); sub = null; b.removeAttribute("data-open"); };
    if (!m.__vosOwnContains) {                       // a click in a submenu counts as one in the menu (it sits beside it, not in it)
      const own = Node.prototype.contains;
      m.__vosOwnContains = true;
      m.contains = n => own.call(m, n) || [...(m.__vosSides || [])].some(x => x.isConnected && own.call(x, n));
    }
    const open = () => {
      clearTimeout(t);
      if (sub) return;
      (m.__vosSides || []).forEach(x => x.__close?.());
      sub = document.createElement("div"); sub.className = [...m.classList].filter(c => c !== "lp-menu-side").join(" ") + " lp-menu-side";   // the same kind of menu (its look) sub.__close = close;
      (m.__vosSides ||= new Set()).add(sub);
      for (const item of items) {
        if (item === "-") { const sp = document.createElement("div"); sp.className = "lp-menu-sep"; sub.appendChild(sp); continue; }
        const [l, fn, on] = item;
        const it = document.createElement("button"); it.type = "button"; it.className = "lp-menu-item" + (on ? " lp-menu-on" : ""); menuLabel(it, l);
        it.addEventListener("click", e => { e.stopPropagation(); close(); done(); fn(); });
        sub.appendChild(it);
      }
      sub.addEventListener("pointerdown", e => e.stopPropagation());
      sub.addEventListener("click", e => e.stopPropagation());
      sub.addEventListener("mouseenter", () => clearTimeout(t));
      // beside the menu, as a menu of its own (its own blur, the same look) - in the same place in the page as the menu
      m.parentElement.insertBefore(sub, m.nextSibling); b.setAttribute("data-open", "");
      const mr = m.getBoundingClientRect(), br = b.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight;
      const host = sub.offsetParent?.getBoundingClientRect?.() || { left: 0, top: 0 };   // (a menu inside a sheet is placed in it)
      const x = mr.right + w - 4 > innerWidth - 8 ? mr.left - w + 4 : mr.right - 4;
      const y = Math.max(8, Math.min(br.top - 5, innerHeight - 8 - h));
      const pos = getComputedStyle(m).position === "fixed" ? "fixed" : "absolute";
      const ox = pos === "fixed" ? 0 : host.left, oy = pos === "fixed" ? 0 : host.top;
      for (const [k, v] of [["position", pos], ["left", Math.round(x - ox) + "px"], ["top", Math.round(y - oy) + "px"], ["z-index", String((Number(getComputedStyle(m).zIndex) || 5) + 1)]]) sub.style.setProperty(k, v, "important");
      watch = new MutationObserver(() => { if (!m.isConnected) close(); });   // the menu gone: its submenu too
      watch.observe(m.parentElement, { childList: true });
      sub.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 110, easing: "ease-out" });
    };
    b.addEventListener("mouseenter", () => { clearTimeout(t); t = setTimeout(open, sub ? 0 : 140); });
    b.addEventListener("click", ev => { ev.stopPropagation(); open(); });
    m.addEventListener("mouseover", ev => {                          // another item of this menu: the submenu goes
      const it = ev.target.closest?.(".lp-menu-item");
      if (sub && it && it !== b && it.parentElement === m) { clearTimeout(t); t = setTimeout(close, 160); }
      if (sub && ev.target === b) clearTimeout(t);
    });
    m.appendChild(b);
    return b;
  }
  /* THE WALLPAPER is Vivaldi's own (its theme's picture): it shows from the first moment Vivaldi opens, in every window.
     Dim (25% black) and Blur (strong) are baked into a copy of the picture, stored by Vivaldi and set on the light and
     dark themes; the picture itself is kept, and comes back when both are off. The change fades. */
  const WALL_FX_KEY = "vosWallFx2", WALL_BASE_KEY = "vosWallBase";
  let wallFx = { dim: false, blur: false }, wallBusy = Promise.resolve();
  const loadImg = src => new Promise(r => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
  function drawWall(img, fx, max = 3200) {
    const k = Math.min(1, max / Math.max(1, img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    if (fx.blur) {                                  // strong: its edges drawn past the frame, so they stay full
      const r = Math.round(Math.max(w, h) / 40);
      x.filter = `blur(${r}px)`; x.drawImage(img, -2 * r, -2 * r, w + 4 * r, h + 4 * r); x.filter = "none";
    } else x.drawImage(img, 0, 0, w, h);
    if (fx.dim) { x.fillStyle = "rgba(0, 0, 0, 0.25)"; x.fillRect(0, 0, w, h); }
    return c;
  }
  // the picture itself, kept here (Vivaldi forgets a picture as soon as no theme shows it - while Dim or Blur is on,
  // the themes show the copy): the picture comes back from this when both are off
  const picDb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("vosWallpaper", 1); r.onupgradeneeded = () => r.result.createObjectStore("pics"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const run = (mode, f) => open().then(db => new Promise(res => { try { const tx = db.transaction("pics", mode), q = f(tx.objectStore("pics")); tx.oncomplete = () => res(mode === "readonly" ? (q?.result instanceof Blob ? q.result : null) : true); tx.onerror = () => res(null); } catch (e) { res(null); } })).catch(() => null);
    return { get: k => run("readonly", st => st.get(k)), set: (k, v) => run("readwrite", st => st.put(v, k)) };
  })();
  const toBlob = (c, type = "image/jpeg", q = 0.92) => new Promise(r => { try { c.toBlob(r, type, q); } catch (e) { r(null); } });
  async function picOf(rec) {                       // the picture's own bytes: kept here, else read now (and kept)
    let blob = await picDb.get(rec.base);
    wlog("kept here", blob ? blob.size : "no");
    if (blob) return blob;
    try { const r = await fetch(rec.base); if (r.ok) blob = await r.blob(); } catch (e) {}
    if (!blob || !blob.size) {
      const img = await loadImg(rec.base);
      if (img) blob = await toBlob(drawWall(img, {}, 8000), "image/png");
      else if (rec.made && rec.fx === "d") {        // the picture already forgotten: Dim is 25% black, so it comes back from the dimmed copy
        const m = await loadImg(rec.made);
        if (m) {
          const c = drawWall(m, {}, 8000), x = c.getContext("2d"), d = x.getImageData(0, 0, c.width, c.height), px = d.data;
          for (let i = 0; i < px.length; i += 4) { px[i] = Math.min(255, px[i] / 0.75); px[i + 1] = Math.min(255, px[i + 1] / 0.75); px[i + 2] = Math.min(255, px[i + 2] / 0.75); }
          x.putImageData(d, 0, 0);
          blob = await toBlob(c, "image/jpeg", 0.95);
        }
      }
    }
    if (blob && blob.size) { await picDb.set(rec.base, blob); return blob; }
    return null;
  }
  const storeBlob = async blob => {                 // a picture kept by Vivaldi: its address (never as a theme's own: Vivaldi would delete the picture it replaces)
    if (!blob || !vivaldi?.utilities?.storeImage) return null;
    const data = await blob.arrayBuffer();
    return await new Promise(r => { try { vivaldi.utilities.storeImage({ data, mimeType: blob.type || "image/jpeg" }, u => { void chrome.runtime.lastError; r(u || null); }); } catch (e) { r(null); } });
  };
  async function storeWall(blob, fx) {              // the picture with its effects, kept by Vivaldi: its address
    const u = URL.createObjectURL(blob), img = await loadImg(u);
    URL.revokeObjectURL(u);
    return img ? storeBlob(await toBlob(drawWall(img, fx))) : null;
  }
  function wallFade() {                             // the wallpaper seen now, on a layer that fades once the new one is drawn
    const b = document.getElementById("browser"), stack = document.getElementById("webpage-stack");
    if (!b || !stack || document.hidden) return Object.assign(async () => {}, { cancel() {} });
    const cs = getComputedStyle(b), was = cs.getPropertyValue("--browserBackgroundImage"), old = document.createElement("div");
    old.className = "vos-wall-old";
    for (const [k, v] of [["background-color", "--browserBackgroundColor"], ["background-image", "--browserBackgroundImage"], ["background-size", "--browserBackgroundSize"],
                          ["background-position", "--browserBackgroundPosition"], ["background-repeat", "--browserBackgroundRepeat"]]) old.style.setProperty(k, cs.getPropertyValue(v), "important");
    // on the Launchpad: inside it, under its icons (nothing under the Launchpad is ever shown); else just over the wallpaper
    const lpL = [...stack.querySelectorAll(":scope > .lp-layer.lp-desktop:not(.vos-lp-ghost)")].find(x => x.offsetWidth && getComputedStyle(x).visibility !== "hidden");
    if (lpL) { old.classList.add("vos-wall-old-in"); lpL.insertBefore(old, lpL.firstChild); } else stack.appendChild(old);
    const fin = async () => {
      for (let i = 0; i < 50 && getComputedStyle(b).getPropertyValue("--browserBackgroundImage") === was; i++) await new Promise(r => setTimeout(r, 40));
      const u = /url\(["']?([^"')]+)/.exec(getComputedStyle(b).getPropertyValue("--browserBackgroundImage"))?.[1];
      if (u) { const im = new Image(); im.src = u; try { await im.decode(); } catch (e) {} }   // drawn before the old one goes: no empty moment
      await old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }).finished.catch(() => {});
      old.remove();
    };
    fin.cancel = () => old.remove();
    return fin;
  }
  const wallLog = [], wlog = (...a) => { wallLog.push(a.map(x => typeof x === "string" ? x.slice(-48) : x).join(" ")); if (wallLog.length > 30) wallLog.shift(); };
  function applyWall(fade) { return (wallBusy = wallBusy.then(() => applyWallNow(fade)).catch(e => { wlog("error", String(e)); console.warn("Bento OS: wallpaper", e); })); }
  async function applyWallNow(fade) {
    const t = await modeThemes(), ids = [...new Set([t.light, t.dark].filter(Boolean))];
    const b = document.getElementById("browser"), was = b ? getComputedStyle(b).getPropertyValue("--browserBackgroundImage") : "";
    const done = fade ? wallFade() : null;           // (the wallpaper seen now, ready to fade)
    let bases = {}; try { bases = JSON.parse((await vstore.get(WALL_BASE_KEY)) || "{}") || {}; } catch (e) {}
    const want = [], fxs = (wallFx.dim ? "d" : "") + (wallFx.blur ? "b" : ""), madeNow = new Map();
    for (const id of ids) {
      const th = await themeBg(id);
      if (!th) continue;
      const cur = th.backgroundImage || "";
      let rec = bases[id];
      if (!rec || (cur && cur !== rec.made && cur !== rec.base)) rec = { base: cur, made: "", fx: "" };   // a picture chosen since: that one is the picture now
      bases[id] = rec;
      if (!rec.base) continue;
      if (fxs) {
        if (rec.made && rec.fx === fxs && (await loadImg(rec.made))) { await picOf(rec); if (cur !== rec.made) want.push([id, rec.made]); continue; }   // (Vivaldi clears unused copies now and then; the picture itself kept here meanwhile)
        const blob = await picOf(rec);
        if (!blob) continue;
        const key = rec.base + "|" + fxs;
        const u = madeNow.get(key) || await storeWall(blob, wallFx);   // (light and dark with one picture: one copy)
        if (!u) continue;
        madeNow.set(key, u); rec.made = u; rec.fx = fxs;
        if (cur !== u) want.push([id, u]);
      } else {
        wlog("off", id, "cur", cur, "base", rec.base);
        if (cur === rec.base && (await loadImg(rec.base))) continue;
        if (await loadImg(rec.base)) { want.push([id, rec.base]); continue; }
        const blob = await picOf(rec);           // the picture forgotten by Vivaldi: kept again (from its bytes kept here)
        wlog("picture bytes", blob ? blob.size : "none");
        if (!blob) continue;
        const key = rec.base + "|";
        const u = madeNow.get(key) || await storeBlob(blob);
        if (!u) continue;
        madeNow.set(key, u); await picDb.set(u, blob);
        rec.base = u; rec.made = ""; rec.fx = "";
        want.push([id, u]);
      }
    }
    vstore.set(WALL_BASE_KEY, JSON.stringify(bases));
    for (const [id, to] of want) await themeBg(id, { backgroundImage: to });
    if (!done) return;
    if (!want.length && (b ? getComputedStyle(b).getPropertyValue("--browserBackgroundImage") : "") === was) { done.cancel(); return; }   // nothing changed: no fade
    await done();
  }
  function wallToggle(k) { wallFx = { ...wallFx, [k]: !wallFx[k] }; vstore.set(WALL_FX_KEY, wallFx); applyWall(true); }
  window.vosWallpaper = { apply: applyWall, toggle: wallToggle, state: () => ({ fx: wallFx, log: wallLog.slice(-12) }) };
  try { chrome.storage.local.get(null, all => { void chrome.runtime.lastError; const old = Object.keys(all || {}).filter(k => /^vosWall(:|Fx$|Fx:)/.test(k)); if (old.length) chrome.storage.local.remove(old); }); } catch (e) {}   // (1.0.153's wallpapers per window: gone)
  vstore.get(WALL_FX_KEY).then(fx => {
    if (fx && typeof fx === "object") wallFx = { dim: !!fx.dim, blur: !!fx.blur };
    if (document.getElementById("browser")) setTimeout(() => applyWall(true), 600);   // at start: the wallpaper as it should be (a cleared copy made again)
  });
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch[WALL_FX_KEY]) { const v = ch[WALL_FX_KEY].newValue; wallFx = { dim: !!v?.dim, blur: !!v?.blur }; } }); } catch (e) {}
  const wallpaperItems = () => [["Light Mode…", () => changeWallpaper("light")], ["Dark Mode…", () => changeWallpaper("dark")],
                                ["Both Modes…", () => changeWallpaper("both")], "-",
                                ["Dim Wallpaper", () => wallToggle("dim"), wallFx.dim], ["Blur Wallpaper", () => wallToggle("blur"), wallFx.blur],
                                ["Theme Settings…", wallpaperSettings]];
  function wallpaperMenu(x, y) {                    // which mode's wallpaper (in the Launchpad, or over the desktop)
    const host = lp?.layer;
    if (host) closeMenu();
    const m = document.createElement("div");
    m.className = "lp-menu" + (host ? "" : " vos-vars vos-desk-menu");
    const head = document.createElement("div"); head.className = "lp-menu-head"; head.textContent = "Wallpaper"; m.appendChild(head);
    const add = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lp-menu-item"; menuLabel(b, label);
      b.addEventListener("click", ev => { ev.stopPropagation(); closeMenu(); fn(); });
      m.appendChild(b);
    };
    for (const item of wallpaperItems()) {
      if (item === "-") { const sep = document.createElement("div"); sep.className = "lp-menu-sep"; m.appendChild(sep); continue; }
      add(item[0], item[1]);
      if (item[2]) m.lastElementChild.classList.add("lp-menu-on");
    }
    m.addEventListener("click", ev => ev.stopPropagation());
    m.addEventListener("pointerdown", ev => ev.stopPropagation());
    if (host) { host.appendChild(m); lp.menu = m; host.setAttribute("data-raised", ""); }
    else {                                          // over the desktop: closes on a click elsewhere or Esc
      m.style.position = "fixed";
      (document.getElementById("browser") || document.body).appendChild(m);
      const off = ev => { if (ev.type === "keydown" && ev.key !== "Escape") return; if (ev.type !== "keydown" && m.contains(ev.target)) return; m.remove(); removeEventListener("pointerdown", off, true); removeEventListener("keydown", off, true); };
      setTimeout(() => { addEventListener("pointerdown", off, true); addEventListener("keydown", off, true); });
      m.addEventListener("click", () => setTimeout(() => off({ type: "pointerdown", target: document.body }), 0));
    }
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
  }
  /* DARK MODE: Vivaldi's dark theme or its light theme (the two the wallpapers belong to), chosen here -
     it then stays (no longer following the system's appearance) */
  async function isDarkNow() {
    try { const t = await modeThemes(), cur = await themeInUse(); if (t.light !== t.dark) { if (cur === t.dark) return true; if (cur === t.light) return false; } } catch (e) {}   // which of your two themes is in use
    const b = document.getElementById("browser");                  // (else what is shown: Vivaldi marks its window light or dark)
    if (b?.classList.contains("theme-dark")) return true;
    if (b?.classList.contains("theme-light")) return false;
    const cur = await themeInUse();
    const all = [...((await pref("vivaldi.themes.system")) || []), ...((await pref("vivaldi.themes.user")) || [])];
    return darkTheme(all.find(t => t?.id === cur));
  }
  /* DARK MODE, inside Vivaldi: its dark theme (or its light one) - and the websites too: they are asked for
     their own dark look, and the rest get Vivaldi's forced dark theme. Off: light again, the websites light too. */
  async function setDark(on) {
    const t = await modeThemes();
    const target = on ? t.dark : t.light;
    if (!target) return;
    // Vivaldi's own Appearance does it: its theme schedule "by the system" (Settings > Themes) stays on, with your light
    // and dark theme. The same as the system's appearance: Vivaldi simply follows the system (the websites automatic too);
    // the other look: held - both of the schedule's places point at it - until the system itself changes, then it
    // follows the system again (followOs)
    let sysDark = on; try { sysDark = await osDark(); } catch (e) {}
    const follow = on === sysDark, put = prefPut;
    if (t.en !== "system" && t.en !== 1) { if (!(await put("vivaldi.theme.schedule.enabled", "system"))) await put("vivaldi.theme.schedule.enabled", 1); }
    const pairOs = follow ? { ...(t.os || {}), light: t.light, dark: t.dark } : { ...(t.os || {}), light: target, dark: target };
    await put("vivaldi.theme.schedule.o_s", pairOs);
    await put("vivaldi.themes.current", target);                     // (Vivaldi's own choice when no schedule decides)
    for (let i = 0; i < 3; i++) {                                    // it took? (else again - the other way of writing it)
      await new Promise(r => setTimeout(r, 120));
      if ((await themeInUse()) === target) break;
      await put("vivaldi.theme.schedule.enabled", i % 2 ? 1 : "system"); await put("vivaldi.theme.schedule.o_s", { light: target, dark: target });
    }
    vstore.set("vosDarkDiag", JSON.stringify({ on, follow, target, inUse: await themeInUse(), schedule: await pref("vivaldi.theme.schedule.enabled"),
      os: await pref("vivaldi.theme.schedule.o_s"), system: await pref("vivaldi.system.desktop_theme_color"), cls: document.getElementById("browser")?.className.match(/theme-(dark|light)/)?.[0], t: Date.now() }));   // (a record, to see what Vivaldi did)
    const wantBg = String((await themeBg(target))?.colorBg || "").trim().toLowerCase();
    try {                                            // websites: their own dark (or light) look - nothing forced on them
      if (await pref("vivaldi.appearance.force_dark_mode_theme")) await put("vivaldi.appearance.force_dark_mode_theme", false);
      await put("vivaldi.PreferredColorScheme", follow ? 0 : on ? 2 : 1);   // 0 automatic (the system's), 1 light, 2 dark
      vstore.set("vosSchemeWas", null);
      darkWeb = false; darkPagesAll();              // (a dark style of an earlier version: taken out)
    } catch (e) { console.warn("Bento OS: websites' dark mode", e); }
    setTimeout(() => window.dispatchEvent(new Event("vos-appearance")), 300);
    return wantBg;                                  // (the dissolve waits for this colour)
  }
  /* the switch, smoothly: Vivaldi's colours glide to the new look; the pages stay in sight and change in place
     (a page's own dark look, or our dark style easing in) - nothing hidden, nothing reloaded */
  /* a website with no dark look of its own: a dark style put into the page (its colours turned, pictures
     kept as they are) - added and taken out live, the page is never reloaded */
  let darkWeb = false;
  const DARK_CSS = "html:root:root{filter:invert(.92) hue-rotate(180deg);background:#fff!important;animation:vos-dark-in .4s ease}@keyframes vos-dark-in{from{filter:invert(0) hue-rotate(0deg)}}img,video,picture,canvas,iframe,embed,object,svg image,[style*='background-image']{filter:invert(1) hue-rotate(180deg)!important}";
  const DARK_ON = `(() => { if (document.getElementById("vos-dark")) return "kept";
    const lum = c => { const m = /rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?/.exec(c || ""); if (!m || (m[4] != null && +m[4] < 0.1)) return null; return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; };
    const l = lum(getComputedStyle(document.body || document.documentElement).backgroundColor) ?? lum(getComputedStyle(document.documentElement).backgroundColor) ?? 1;
    if (l < 0.45) return "dark already";
    const s = document.createElement("style"); s.id = "vos-dark"; s.textContent = ${JSON.stringify(DARK_CSS)};
    (document.head || document.documentElement).appendChild(s); return "made dark"; })()`;
  const DARK_OFF = `(() => { document.getElementById("vos-dark")?.remove(); return "light"; })()`;
  function darkPage(wv) {
    if (typeof wv?.executeScript !== "function") return;
    if (!wv.__vosDarkHook) { wv.__vosDarkHook = true; wv.addEventListener("contentload", () => { if (darkWeb) setTimeout(() => darkPage(wv), 200); }); }
    try { wv.executeScript({ code: darkWeb ? DARK_ON : DARK_OFF }, () => { void chrome.runtime.lastError; clearTimeout(darkPage.t); darkPage.t = setTimeout(() => window.dispatchEvent(new Event("vos-appearance")), 150); }); } catch (e) {}   // (the grabbers read the page's colour again)
  }
  const darkPagesAll = () => document.querySelectorAll("#webpage-stack webview").forEach(darkPage);
  setTimeout(() => { if (document.getElementById("browser")) darkPagesAll(); }, 2500);   // no forced dark on websites any more: an earlier one's style comes out
  (window.vosBeat || (f => setInterval(f, 2500)))(() => {      // new pages (a new window, a new tab) while it is on
    if (!darkWeb) return;
    document.querySelectorAll("#webpage-stack webview").forEach(wv => { if (!wv.__vosDarkHook) darkPage(wv); });
  });
  let dissolving = false;
  async function dissolve(fn) {
    if (dissolving && Date.now() - dissolving < 6000) return;        // (one still running - never stuck: after 6s a click works again)
    dissolving = Date.now();
    const b = document.getElementById("browser"), wait = ms => new Promise(r => setTimeout(r, ms));
    const bg = () => (b ? getComputedStyle(b).getPropertyValue("--colorBg").trim().toLowerCase() : "");
    try {
      b?.setAttribute("data-vos-theming", "");      // Vivaldi's colours glide; the pages stay in sight and change in place
      const want = await fn();
      let same = 0, last = "";
      for (let i = 0; i < 60 && same < 5; i++) {     // the new theme in place: its colour, the same for 200ms
        await wait(40);
        const now = bg();
        same = now === last && (!want || now === want || i > 25) ? same + 1 : 0; last = now;
      }
      await wait(420);
    } finally { b?.removeAttribute("data-vos-theming"); dissolving = false; }
  }
  /* FOLLOW THE SYSTEM: when macOS / Windows changes between light and dark, Vivaldi follows - with the same
     smooth switch (the mod switches it, so the pages fade instead of jumping; nothing is reloaded) */
  /* the system's own appearance (macOS / Windows): Vivaldi's reading of it - never the window's "prefers-color-scheme",
     which follows the websites' setting (light or dark chosen here) once it is no longer automatic */
  const osDark = async () => {
    const c = await pref("vivaldi.system.desktop_theme_color");
    if (c === "dark" || c === 1) return true;
    if (c === "light" || c === 0) return false;
    const auto = (await pref("vivaldi.PreferredColorScheme")) === 0;
    return auto ? matchMedia("(prefers-color-scheme: dark)").matches : !!lastOs;
  };
  let lastOs = null;
  async function followOs() {
    const d = await osDark();
    if (lastOs === null) { lastOs = d; return; }
    if (d === lastOs) return;
    lastOs = d;
    // the system changed: Vivaldi follows it again (your held look ends) - with the smooth switch when the look changes
    if ((await isDarkNow()) !== d) window.vosAppearance.set(d);
    else setDark(d).catch(() => {});                 // already that look: now it simply follows the system
  }
  setTimeout(followOs, 1200);
  try { vivaldi.prefs.onChanged.addListener(p => { if (/desktop_theme_color/.test(String(p?.path ?? p ?? ""))) setTimeout(followOs, 30); }); } catch (e) {}
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(followOs, 60)); } catch (e) {}
  window.vosAppearance = { isDark: isDarkNow, set: on => dissolve(() => setDark(on)), async toggle() { const d = await isDarkNow(); await dissolve(() => setDark(!d)); } };
  async function changeWallpaper(mode = "both") {
    if (lp && !lp.desktop) close(true, true); else close();
    try {
      const t = await modeThemes();
      if (mode !== "both" && !t.sys && t.light !== t.dark) {       // a wallpaper per mode: Vivaldi follows the system's appearance (once)
        await vivaldi.prefs.set({ path: "vivaldi.theme.schedule.o_s", value: { ...t.os, light: t.light, dark: t.dark } });
        await vivaldi.prefs.set({ path: "vivaldi.theme.schedule.enabled", value: typeof t.en === "number" ? 1 : "system" });
      }
      const themeId = mode === "dark" ? t.dark : mode === "light" ? t.light : await themeInUse();
      const win = await new Promise(r => chrome.windows.getCurrent(w => { void chrome.runtime.lastError; r(w); }));
      if (!themeId || !vivaldi?.utilities?.selectLocalImage) throw new Error("no picker");
      const title = mode === "dark" ? "Wallpaper for Dark Mode" : mode === "light" ? "Wallpaper for Light Mode" : "Wallpaper for Light and Dark Mode";
      const ok = await vivaldi.utilities.selectLocalImage({ windowId: win?.id, title, themeId });
      if (!ok) return;
      await themeBg(themeId, { backgroundSource: "" });             // a picked image wins over a daily / preset source
      if (mode === "both") {                                        // the same image in the other mode too
        const src = await themeBg(themeId);
        for (const other of [t.light, t.dark]) if (other && other !== themeId && src?.backgroundImage)
          await themeBg(other, { backgroundImage: src.backgroundImage, backgroundPosition: src.backgroundPosition, backgroundSource: "" });
      }
      if (wallFx.dim || wallFx.blur) applyWall(true);              // Dim / Blur on: onto the new picture too
    } catch (e) {                                    // no picker here: Vivaldi's Themes settings instead
      console.warn("Bento OS: wallpaper", e);
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
  /* ---------------- updates: a newer Bento OS on GitHub ----------------
     Vivaldi does not let its interface run downloaded code, so an update is one
     line pasted into Terminal / PowerShell / Command Prompt: it downloads the
     newest release and installs it (the same line also puts the mod back after
     a Vivaldi update). This only checks, tells, and copies that line. */
  const UPD_KEY = "vosUpdateSkip";
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
  const relUrl = () => `https://github.com/${window.vosRepo}/releases/latest/download/`;
  const MANUAL_LINE = "(for /f \"delims=\" %Z in ('dir /b /o:d \"%USERPROFILE%\\Downloads\\VivaldiOS*Manual*.zip\"') do tar -xf \"%USERPROFILE%\\Downloads\\%Z\" -C \"%USERPROFILE%\\Documents\") & (for /d %D in (\"%LOCALAPPDATA%\\Vivaldi\\Application\\*.*.*.*\") do (copy /y \"%USERPROFILE%\\Documents\\VivaldiOS\\custom-vivaldi-os*.*\" \"%D\\resources\\vivaldi\\\" >nul & (if not exist \"%D\\resources\\vivaldi\\window.html.orig\" copy \"%D\\resources\\vivaldi\\window.html\" \"%D\\resources\\vivaldi\\window.html.orig\" >nul) & (findstr /v /l /x /c:\"</body>\" /c:\"</html>\" \"%D\\resources\\vivaldi\\window.html.orig\" & echo   ^<script src=\"custom-vivaldi-os.js\"^>^</script^>& echo ^</body^>& echo ^</html^>) > \"%D\\resources\\vivaldi\\window.html\" & echo Bento OS installed in %D)) & start \"\" \"%LOCALAPPDATA%\\Vivaldi\\Application\\vivaldi.exe\"";
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
  /* the latest release's version: where GitHub's "latest release" link points
     (…/tag/v1.2.3) - tiny and always current; GitHub's release API is the fallback.
     "" when GitHub can't be reached */
  async function latestTag() {
    let tag = "";
    try {
      const r = await fetch(`https://github.com/${window.vosRepo}/releases/latest`, { method: "HEAD", cache: "no-store" });
      tag = (/\/tag\/v?([\d.]+)/.exec(r.url) || [])[1] || "";
    } catch (e) {}
    if (!tag) {
      try {
        const r = await fetch(`https://api.github.com/repos/${window.vosRepo}/releases/latest`, { cache: "no-store" });
        if (r.ok) tag = String((await r.json()).tag_name || "").replace(/^v/, "");
      } catch (e) {}
    }
    return tag;
  }
  async function checkUpdate(manual) {
    if (!window.vosRepo || !window.vosVersion) return;
    if (manual && tagFor && newer(tagFor, window.vosVersion)) { updateNotice(tagFor, null, null, true); return; }   // known: Update Now at once (inside the click)
    try {
      lastCheck = Date.now();
      const tag = await latestTag();
      if (!tag) { if (manual) updateNotice(null, "Couldn't reach GitHub", "Try again later."); return; }
      if (tag && newer(tag, window.vosVersion)) {
        updTag(tag);                                                  // the tag at the left of the tab bar stays
        if (!manual && (await vstore.get(UPD_KEY)) === tag) return;   // "Later" for this version
        updateNotice(tag);
      } else if (manual) updateNotice(null, "Bento OS is up to date", "Version " + window.vosVersion);
    } catch (e) { if (manual) updateNotice(null, "Couldn't reach GitHub", "Try again later."); }
  }
  /* Mac: the Vivaldi OS Updater app (set up by the installer) takes vivaldios://update:
     it asks, then runs the update line in Terminal. The link carries nothing else. */
  function macUpdate(b, msg) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
      const t = tabs?.[0];
      const go = () => void chrome.runtime.lastError;
      if (t) chrome.tabs.update(t.id, { url: "vivaldios://update" }, go);
      else chrome.tabs.create({ url: "vivaldios://update", active: true }, go);
      msg.textContent = "If Vivaldi asks, choose Open Vivaldi OS Updater (tick Always allow). Then press Update. If nothing opens, use Terminal below.";
    });
  }
  /* RELEASE SIGNATURE: Update Now installs only a release signed with Bento OS's release key
     (an SSH signature, "ssh-keygen -Y sign", made on the publishing Mac) - a file swapped on
     GitHub, or a hijacked account, cannot get an update in */
  const SIGN_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIJJewhzxQTTIQOK45iTV0OoL3VTClELYcOCLU9GvmG3a", SIGN_NS = "vivaldi-os-release";
  async function signedOk(data, armored) {
    try {
      const b64 = (s => Uint8Array.from(atob(s), c => c.charCodeAt(0)));
      const rd = buf => { let o = 0; return { u32() { if (o + 4 > buf.length) throw 0; const v = new DataView(buf.buffer, buf.byteOffset + o, 4).getUint32(0); o += 4; return v; },
        str() { const n = this.u32(); if (o + n > buf.length) throw 0; const v = buf.subarray(o, o + n); o += n; return v; }, at: () => o, skip(n) { o += n; } }; };
      const txt = a => new TextDecoder().decode(a), te = s => new TextEncoder().encode(s);
      const blob = b64(String(armored).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
      if (txt(blob.subarray(0, 6)) !== "SSHSIG") return false;
      const r = rd(blob); r.skip(6);
      if (r.u32() !== 1) return false;
      const pub = r.str(), ns = r.str(), reserved = r.str(), hash = r.str(), sig = r.str();
      const want = b64(SIGN_KEY);
      if (pub.length !== want.length || pub.some((x, i) => x !== want[i])) return false;   // our key, nobody else's
      if (txt(ns) !== SIGN_NS || !/^sha(256|512)$/.test(txt(hash))) return false;
      const rs = rd(sig); if (txt(rs.str()) !== "ssh-ed25519") return false;
      const raw = rs.str();
      const rp = rd(pub); rp.str(); const key32 = rp.str();
      const digest = new Uint8Array(await crypto.subtle.digest(txt(hash) === "sha512" ? "SHA-512" : "SHA-256", data));
      const pack = a => { const out = new Uint8Array(4 + a.length); new DataView(out.buffer).setUint32(0, a.length); out.set(a, 4); return out; };
      const parts = [te("SSHSIG"), pack(ns), pack(reserved), pack(hash), pack(digest)];
      const signed = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
      parts.reduce((o, a) => (signed.set(a, o), o + a.length), 0);
      const k = await crypto.subtle.importKey("raw", key32, { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "Ed25519" }, k, raw, signed);
    } catch (e) { return false; }
  }
  /* Windows: the one-file installer, checked against its signature, then saved and opened (SmartScreen may ask once) */
  async function winUpdate(b, msg) {
    b.textContent = "Downloading…"; b.disabled = true;
    const fail = text => { b.textContent = "Update Now"; b.disabled = false; msg.textContent = text; };
    let data, sig;
    try {
      const [r1, r2] = await Promise.all([fetch(relUrl() + "VivaldiOS-Windows.cmd", { cache: "no-store", credentials: "omit" }), fetch(relUrl() + "VivaldiOS-Windows.cmd.sig", { cache: "no-store", credentials: "omit" })]);
      if (!r1.ok || !r2.ok) return fail("The download didn't work. Try again later.");
      data = new Uint8Array(await r1.arrayBuffer()); sig = await r2.text();
    } catch (e) { return fail("The download didn't work. Try again later."); }
    if (!(await signedOk(data, sig))) return fail("Not installed: this update is not signed by Bento OS.");
    const url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    chrome.downloads.download({ url, filename: "VivaldiOS-Update.cmd", conflictAction: "overwrite", saveAs: false }, id => {
      if (chrome.runtime.lastError || !id) { URL.revokeObjectURL(url); return fail("The download didn't start. Use Copy for PowerShell instead."); }
      const on = d => {
        if (d.id !== id || !d.state) return;
        if (d.state.current === "complete") {
          chrome.downloads.onChanged.removeListener(on); URL.revokeObjectURL(url);
          b.textContent = "Opening…";
          try { chrome.downloads.open(id); msg.textContent = "The installer is starting: Vivaldi will close and come back with your tabs."; }
          catch (e) { chrome.downloads.show?.(id); msg.textContent = "Double-click VivaldiOS-Update.cmd (shown in its folder) to update."; }
        } else if (d.state.current === "interrupted") { chrome.downloads.onChanged.removeListener(on); URL.revokeObjectURL(url); fail("The download was stopped. Use Copy for PowerShell instead."); }
      };
      chrome.downloads.onChanged.addListener(on);
    });
  }
  try { Object.defineProperty(window, "__vosSignedOk", { configurable: true, value: signedOk }); } catch (e) {}
  let updEl = null;
  function updateNotice(tag, title, sub, install) {
    updEl?.remove();
    const n = document.createElement("div");
    n.className = "vos-upd vos-vars";
    const head = document.createElement("div"); head.className = "vos-upd-title";
    head.textContent = title || `Bento OS ${tag} is available`;
    const p = document.createElement("div"); p.className = "vos-upd-sub";
    p.textContent = sub || (isMac
      ? `You have ${window.vosVersion}. Update Now asks once more, then runs the update in Terminal. Vivaldi restarts with your tabs.`
      : `You have ${window.vosVersion}. Update Now downloads the installer and opens it (if Windows asks: More info → Run anyway). Vivaldi restarts with your tabs.`);
    n.append(head, p);
    const row = document.createElement("div"); row.className = "vos-upd-btns";
    const btn = (label, fn, cls) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "vos-upd-btn" + (cls ? " " + cls : ""); b.textContent = label;
      b.addEventListener("click", ev => { ev.stopPropagation(); fn(b); });
      row.appendChild(b); return b;
    };
    const close = () => { n.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, -8px)" }], { duration: 180, easing: "ease-in", fill: "forwards" }).finished.catch(() => {}).then(() => n.remove()) && setTimeout(() => n.remove(), 2500); if (updEl === n) updEl = null; };
    if (tag) {
      btn("Later", () => { vstore.set(UPD_KEY, tag); close(); });
      const auto = isMac || chrome.downloads?.download;
      if (auto) btn("Update Now", b => (isMac ? macUpdate(b, p) : winUpdate(b, p)), "vos-upd-main");
      // copying the line: a row of its own, apart from Update Now
      const copyRow = document.createElement("div"); copyRow.className = "vos-upd-copy";
      const cap = document.createElement("span"); cap.className = "vos-upd-copy-cap";
      cap.textContent = auto ? "Update manually: copy the line for" : "Copy the update line for:";
      copyRow.appendChild(cap);
      for (const [where, line] of updateLines()) {
        const label = where;
        const b = document.createElement("button"); b.type = "button";
        b.className = "vos-upd-btn vos-upd-copybtn" + (auto ? "" : " vos-upd-main");
        b.textContent = label;
        copyRow.appendChild(b);
        b.addEventListener("click", async ev => {
          ev.stopPropagation();
          try { await navigator.clipboard.writeText(line); } catch (e) {
            const ta = document.createElement("textarea"); ta.value = line; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
          }
          b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = label), 1800);
        });
      }
      n.__copy = copyRow;
      if (auto) {                                                   // the update lines: behind a small button at the top right
        copyRow.hidden = true;
        const man = document.createElement("button"); man.type = "button"; man.className = "vos-upd-manual"; man.title = "Update manually";
        man.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M7.5 10l2.5 2.2-2.5 2.2M12.5 15h4"/></svg>';
        man.addEventListener("click", ev => { ev.stopPropagation(); copyRow.hidden = !copyRow.hidden; man.toggleAttribute("data-on", !copyRow.hidden); });
        n.appendChild(man);
      }
    } else btn("OK", close, "vos-upd-main");
    n.appendChild(row);
    if (n.__copy) n.appendChild(n.__copy);                          // copying: the last row, apart from Update Now
    n.addEventListener("pointerdown", ev => ev.stopPropagation());
    // from the "New Update" button: go straight on (Windows: download and run; Mac: copy the line)
    if (install && tag) n.querySelector(".vos-upd-main")?.click();     // still inside your click: the clipboard allows it
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
    add("Add Website…", () => sheetOnly(siteGallery));
    add("Add Widget…", () => sheetOnly(widgetGallery));
    add("Bookmarks…", () => sheetOnly(folderPicker));
    sep();
    nestedItem(m, "Wallpaper", wallpaperItems(), () => closeDesk());
    add("Dark Mode", () => window.vosAppearance.toggle());
    isDarkNow().then(d => { const b = [...m.querySelectorAll(".lp-menu-item")].find(e => /^Dark Mode$/.test(e.textContent.trim())); b?.classList.toggle("lp-menu-on", d); });
    sep();
    add("Update" + (window.vosVersion ? "  v" + window.vosVersion : ""), () => checkUpdate(true));
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

  /* YOUR WEBSITES THROUGH AN UPDATE: a list of the open websites is kept (refreshed as
     you browse); the first start of a new version reopens any of them that are not
     open (Vivaldi's own session may be lost when it is closed for the install) */
  const TABS_KEY = "vosOpenTabs", RAN_KEY = "vosRanVersion";
  let tabsTimer = 0, restoring = true;                  // no saving until the start check is done
  const siteTab = t => /^https?:/i.test(t.url || t.pendingUrl || "");
  function saveTabs() {
    clearTimeout(tabsTimer);
    tabsTimer = setTimeout(() => {
      if (restoring) return;
      chrome.tabs.query({}, tabs => {
        if (chrome.runtime.lastError || !tabs) return;
        const list = tabs.filter(t => siteTab(t) && !t.incognito).sort((a, b) => a.windowId - b.windowId || a.index - b.index)
          .map(t => ({ u: t.url || t.pendingUrl, p: !!t.pinned, a: !!t.active }));
        if (list.length) vstore.set(TABS_KEY, { t: Date.now(), list });   // never overwrite with nothing
      });
    }, 1500);
  }
  for (const ev of ["onCreated", "onRemoved", "onMoved", "onAttached"]) chrome.tabs?.[ev]?.addListener(saveTabs);
  chrome.tabs?.onUpdated?.addListener((id, info) => { if (info.url || info.pinned != null) saveTabs(); });   // only a new address, not every title / icon
  setTimeout(async () => {
    try {
      const ran = await vstore.get(RAN_KEY), saved = await vstore.get(TABS_KEY);
      const updated = window.vosVersion && ran && ran !== window.vosVersion;
      if (updated && saved?.list?.length && Date.now() - saved.t < 3 * 864e5) {
        const open = await new Promise(r => chrome.tabs.query({}, t => r(t || [])));
        const have = new Set(open.filter(siteTab).map(t => t.url || t.pendingUrl));
        const missing = saved.list.filter(x => !have.has(x.u));
        for (const x of missing) await new Promise(r => chrome.tabs.create({ url: x.u, active: false, pinned: x.p }, () => { void chrome.runtime.lastError; r(); }));
        if (missing.length) LOG_UPD(`reopened ${missing.length} website(s) after the update to ${window.vosVersion}`);
      }
      if (window.vosVersion) vstore.set(RAN_KEY, window.vosVersion);
    } catch (e) {}
    restoring = false; saveTabs();
  }, 6000);
  const LOG_UPD = (...a) => console.log("%c[vivaldi-os]", "color:#8e8e93", ...a);

  /* "New Update": a tag at the left end of the tab bar while a newer release exists */
  let tagFor = null, tagEl = null;
  function updTag(tag) {
    tagFor = tag;
    const { bar, after: spot } = tagSpot();
    if (!bar) return;
    if (!tagEl) {
      tagEl = document.createElement("button");
      tagEl.type = "button"; tagEl.className = "vos-upd-tag";
      tagEl.addEventListener("pointerdown", ev => ev.stopPropagation());
      tagEl.addEventListener("click", async ev => {                // checks GitHub now, then installs the newest
        ev.stopPropagation();
        if (tagEl.dataset.busy) return;
        // a newer version is known: Update Now at once, still inside your click (opening the updater needs the click)
        if (tagFor && newer(tagFor, window.vosVersion)) { updateNotice(tagFor, null, null, true); return; }
        tagEl.dataset.busy = "1"; tagEl.textContent = "Checking…";
        const t = await latestTag();
        delete tagEl.dataset.busy;
        if (t && newer(t, window.vosVersion)) { updTag(t); updateNotice(t, null, null, true); }
        else if (t) {                                                // nothing newer after all: up to date, no button
          tagFor = null; tagEl.remove();
          updateNotice(null, "Bento OS is up to date", "Version " + window.vosVersion);
        } else { updTag(tagFor); updateNotice(null, "Couldn't reach GitHub", "Try again later."); }
      });
    }
    tagEl.textContent = "New Update";
    tagEl.title = `Install Bento OS ${tag} (you have ${window.vosVersion})`;
    lookLikeField();
    const after = spot;
    if (after ? after.nextSibling !== tagEl : bar.firstChild !== tagEl) bar.insertBefore(tagEl, after ? after.nextSibling : bar.firstChild);
  }
  /* where the New Update button goes: after the icons on the left of the tab bar (Workspaces,
     Bento, ... whatever order the toolbar editor gave them), before the space that follows */
  function tagSpot() {
    const bento = document.querySelector("#browser .bento-toggle");
    const bar = bento?.closest(".toolbar-tabbar-before") || document.querySelector("#browser .toolbar-tabbar-before");
    if (!bar) return { bar: null, after: null };
    const kids = [...bar.children].filter(c => c !== tagEl);
    const gap = kids.findIndex(c => /spacer/i.test(c.className) || c.matches?.(".UrlBar-AddressField, .toolbar-spacer, .toolbar-spacer-flexible"));
    const icons = (gap >= 0 ? kids.slice(0, gap) : kids).filter(c => c.matches?.(".button-toolbar, .bento-toggle, .toolbar-group"));
    return { bar, after: icons[icons.length - 1] || null };
  }
  /* the button looks exactly like the address field beside it: its own colours, border,
     roundness, height and type, read from it (so it follows every theme) */
  function lookLikeField() {
    const f = document.querySelector("#browser .UrlBar-AddressField");
    if (!f || !tagEl) return;
    const cs = getComputedStyle(f);
    for (const k of ["background-color", "color", "border-top-width", "border-top-style", "border-top-color", "border-radius", "height", "font-size", "font-weight"]) {
      const v = k.startsWith("border-top-") ? cs.getPropertyValue(k) : cs.getPropertyValue(k);
      const prop = k.startsWith("border-top-") ? "border-" + k.slice(11) : k;
      if (tagEl.style.getPropertyValue(prop) !== v) tagEl.style.setProperty(prop, v, "important");
    }
  }
  (window.vosBeat || (f => setInterval(() => { if (!document.hidden) f(); }, 2500)))(() => {                                // a re-drawn tab bar (or a late Bento button) gets it back in place
    if (tagEl?.isConnected) lookLikeField();
    if (!tagFor) return;
    const { after } = tagSpot();
    if (!tagEl?.isConnected || (after ? after.nextSibling !== tagEl : tagEl.previousSibling)) updTag(tagFor);
  });
  setTimeout(() => checkUpdate(false), 20000);
  // every 30 minutes, only while Vivaldi is in use; coming back after longer checks once
  let lastCheck = 0;
  const due = () => !document.hidden && Date.now() - lastCheck >= 30 * 60 * 1000;
  setInterval(() => { if (due()) checkUpdate(false); }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (due()) checkUpdate(false); });

  vstore.get(TM_KEY).then(v => { if (v && typeof v === "object") { tm = { ...tm, ...v }; ensureTick(); } });              // the seed file may load after this one
})();
