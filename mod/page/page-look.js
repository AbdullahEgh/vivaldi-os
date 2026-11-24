/* Bento OS - one tab's own look (light / dark), page side. Runs at the start of every page, in the page's own world.
   Without this tab's flag it does nothing but hand back the browser's own answers. With it, the page's "which look do
   you prefer?" question (matchMedia prefers-color-scheme) answers this tab's look, and when the look changes the page
   is told at once - the same signal a site gets when the Mac itself turns light or dark - so it redraws without a reload. */
(function () {
  if (window.__vosLookSet) return;
  var KEY = "__vosLook", real = window.matchMedia, W = window;
  var look = null; try { look = sessionStorage.getItem(KEY); } catch (e) {}
  if (look !== "light" && look !== "dark") look = null;
  var RE = /\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi, lists = [];
  var answer = function (q) {
    if (!look) return real.call(W, q).matches;
    return real.call(W, q.replace(RE, function (m, s) { return s.toLowerCase() === look ? "(min-width: 0px)" : "(max-width: 0px)"; })).matches;
  };
  function wrap(q) {
    var base = real.call(W, q), fns = [], on = null, was = answer(q);
    var mq = Object.create(MediaQueryList.prototype);
    var fire = function () {
      var now = answer(q); if (now === was) return; was = now;
      var ev; try { ev = new MediaQueryListEvent("change", { matches: now, media: q }); } catch (e) { ev = { type: "change", matches: now, media: q }; }
      fns.slice().forEach(function (f) { try { typeof f === "function" ? f.call(mq, ev) : f.handleEvent(ev); } catch (e) { setTimeout(function () { throw e; }); } });
      if (typeof on === "function") try { on.call(mq, ev); } catch (e) { setTimeout(function () { throw e; }); }
    };
    base.addEventListener("change", function () { if (!look) fire(); else was = answer(q); });
    Object.defineProperties(mq, {
      matches: { get: function () { return answer(q); } },
      media: { get: function () { return base.media; } },
      onchange: { get: function () { return on; }, set: function (f) { on = f; } },
      addEventListener: { value: function (t, f) { if (t === "change" && f && fns.indexOf(f) < 0) fns.push(f); } },
      removeEventListener: { value: function (t, f) { var i = fns.indexOf(f); if (t === "change" && i >= 0) fns.splice(i, 1); } },
      addListener: { value: function (f) { if (f && fns.indexOf(f) < 0) fns.push(f); } },
      removeListener: { value: function (f) { var i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); } },
      dispatchEvent: { value: function () { return true; } }
    });
    lists.push(fire);
    return mq;
  }
  window.matchMedia = function matchMedia(q) { q = String(q); return /prefers-color-scheme/i.test(q) ? wrap(q) : real.call(W, q); };
  window.__vosLookSet = function (t, quiet) {                 // (called by Bento OS for this tab only)
    look = t === "light" || t === "dark" ? t : null;
    try { look ? sessionStorage.setItem(KEY, look) : sessionStorage.removeItem(KEY); } catch (e) {}
    var go = function () { lists.forEach(function (f) { f(); }); };
    var D = document;                                         // the old look dissolves into the new one (the browser's own cross-fade)
    if (!quiet && D.startViewTransition && D.visibilityState === "visible" && D.body) {
      try {
        var css = new CSSStyleSheet();
        css.replaceSync("::view-transition-old(root),::view-transition-new(root){animation-duration:.45s !important;animation-timing-function:ease !important}");
        D.adoptedStyleSheets = D.adoptedStyleSheets.concat([css]);
        var vt = D.startViewTransition(function () { go(); return new Promise(function (r) { setTimeout(function () { judge(); r(); }, 260); }); });   // (the site redraws, its rules switch; a made-up dark on or off with it)
        var done = function () { D.adoptedStyleSheets = D.adoptedStyleSheets.filter(function (x) { return x !== css; }); };
        vt.finished.then(done, done);
        return look || "off";
      } catch (e) {}
    }
    go(); soon(400);
    return look || "off";
  };

  /* 1.0.288: A SITE WITH NO DARK DESIGN OF ITS OWN gets one made for it. When this page should be dark (Vivaldi dark, or
     this window switched to dark) and is still drawn light once it has loaded, it is turned dark - its pictures, videos,
     maps, canvases and coloured logos turned back, so they keep their real colours. A site that has its own dark design is
     never touched, and one that turns dark by itself later loses the made-up one again. Light is never made up. */
  var gen = null, genT = 0, genObs = null, M = "img,video,canvas,picture,iframe,embed,object,svg image,[data-vos-img]";
  var want = function () { return answer("(prefers-color-scheme: dark)"); };
  var lumOf = function (c) { var m = (String(c).match(/[\d.]+/g) || []).map(Number); return m.length < 3 || (m.length > 3 && m[3] < 0.5) ? null : 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  function pageLum() {
    var D = document; if (!D.body) return null;
    for (var e = D.elementFromPoint(innerWidth / 2, innerHeight / 2); e; e = e.parentElement) { var L = lumOf(getComputedStyle(e).backgroundColor); if (L !== null) return L; }
    var b = lumOf(getComputedStyle(D.body).backgroundColor); if (b !== null) return b;
    var h = lumOf(getComputedStyle(D.documentElement).backgroundColor); return h === null ? 255 : h;
  }
  var tint = function (v) { return v && v !== "none" && v.indexOf("url(") < 0 && !/rgba?\([^)]*,\s*0\)$/.test(v) ? v : null; };
  function coloured(svg) {                                       // a logo with colours of its own (2+), not a one-colour icon
    var cols = {}, n = 0, txt = getComputedStyle(svg).color, parts = svg.querySelectorAll("path,circle,rect,polygon,ellipse,g,use,line,polyline");
    for (var k = 0; k < parts.length && k < 60; k++) { var cs = getComputedStyle(parts[k]); [tint(cs.fill), tint(cs.stroke)].forEach(function (c) { if (c && c !== txt && c !== "rgb(0, 0, 0)" && c !== "rgb(255, 255, 255)" && !cols[c]) { cols[c] = 1; n++; } }); }
    return n >= 2;
  }
  function mark() {                                              // pictures drawn as a background, and coloured logos: turned back too
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length && i < 6000; i++) { var el = all[i]; if (el.__vosSeen) continue; el.__vosSeen = 1;
      if (el.tagName === "svg" || el.tagName === "SVG") { if (coloured(el)) el.setAttribute("data-vos-img", ""); continue; }
      var bg = getComputedStyle(el).backgroundImage; if (bg && bg.indexOf("url(") >= 0) el.setAttribute("data-vos-img", ""); }
  }
  function genOn() {
    if (gen) return;
    var D = document, root = getComputedStyle(D.documentElement).backgroundColor, body = D.body ? getComputedStyle(D.body).backgroundColor : "";
    var base = lumOf(root) !== null ? "" : "html{background-color:" + (lumOf(body) !== null ? body : "#fff") + " !important}";   // (the page's own white, darkened with it)
    gen = new CSSStyleSheet();
    gen.replaceSync(base + "html{filter:invert(1) hue-rotate(180deg) contrast(0.92) !important}" +
      ":is(" + M + "):not(:is(" + M + ") *){filter:invert(1) hue-rotate(180deg) !important} :is(" + M + ") :is(" + M + "){filter:none !important}");
    D.adoptedStyleSheets = D.adoptedStyleSheets.concat([gen]);
    mark();
    var t = 0; genObs = new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = 0; if (gen) mark(); }, 500); });
    genObs.observe(D.documentElement, { childList: true, subtree: true });
  }
  function genOff() {
    if (!gen) return; var g = gen; gen = null;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (x) { return x !== g; });
    if (genObs) { genObs.disconnect(); genObs = null; }
  }
  function judge() {
    clearTimeout(genT); genT = 0;
    if (!/html/i.test(document.contentType || "")) return;
    if (!want()) return genOff();
    var L = pageLum(); if (L === null) return;
    if (gen) { if (L < 110) genOff(); return; }                  // (it turned dark by itself)
    if (L > 160) genOn();
  }
  function soon(ms) { clearTimeout(genT); genT = setTimeout(judge, ms || 600); }
  real.call(W, "(prefers-color-scheme: dark)").addEventListener("change", function () { soon(500); });
  document.addEventListener("DOMContentLoaded", function () {
    soon(700);
    var t = 0, watch = new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = 0; judge(); }, 400); });   // (a site that changes its own look later)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] });
    if (document.body) watch.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  });
  addEventListener("load", function () { soon(700); setTimeout(judge, 2500); });
})();

/* Bento OS - Windows only: Mac-style scroll bars on websites. The page's own bars are hidden and take no room; a thin
   rounded bar shows only while a page (or a box in it) is scrolling, then fades. */
(function () {
  var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  if (!/^win/i.test(plat) || window.__vosBars) return;
  window.__vosBars = 1;
  var D = document;
  try {
    var css = new CSSStyleSheet();
    css.replaceSync("*{scrollbar-width:none !important} ::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important}");
    D.adoptedStyleSheets = D.adoptedStyleSheets.concat([css]);
  } catch (e) {}
  var host = null, bars = null, hideT = 0;
  function make() {
    if (host && host.isConnected) return;
    host = D.createElement("vos-scroll-bars");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict";
    var sr = host.attachShadow({ mode: "closed" });
    sr.innerHTML = "<style>i{position:fixed;display:block;border-radius:4px;background:rgba(0,0,0,.45);box-shadow:0 0 0 1px rgba(255,255,255,.35);opacity:0;transition:opacity .35s ease}i.on{opacity:1;transition:opacity .1s ease}</style><i></i><i></i>";
    bars = sr.querySelectorAll("i");
    (D.documentElement || D).appendChild(host);
  }
  function show(el) {
    var root = el === D || el === D.documentElement || el === D.body || el === D.scrollingElement;
    var se = root ? (D.scrollingElement || D.documentElement) : el;
    if (!se) return;
    var r = root ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : se.getBoundingClientRect();
    var ch = root ? innerHeight : se.clientHeight, cw = root ? innerWidth : se.clientWidth;
    make();
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;   // (this tab's own look, when one is set)
    [0, 1].forEach(function (k) {
      var b = bars[k], vert = k === 0, size = vert ? se.scrollHeight : se.scrollWidth, view = vert ? ch : cw;
      if (size <= view + 1) { b.className = ""; return; }
      var track = (vert ? r.height : r.width) - 6, len = Math.max(28, track * view / size);
      var pos = (track - len) * ((vert ? se.scrollTop : se.scrollLeft) / (size - view));
      b.style.background = dark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.45)";
      b.style.boxShadow = dark ? "0 0 0 1px rgba(0,0,0,.35)" : "0 0 0 1px rgba(255,255,255,.35)";
      if (vert) b.style.cssText += ";width:7px;height:" + len + "px;left:" + (r.left + r.width - 9) + "px;top:" + (r.top + 3 + pos) + "px";
      else b.style.cssText += ";height:7px;width:" + len + "px;top:" + (r.top + r.height - 9) + "px;left:" + (r.left + 3 + pos) + "px";
      b.className = "on";
    });
    clearTimeout(hideT);
    hideT = setTimeout(function () { bars[0].className = ""; bars[1].className = ""; }, 900);
  }
  addEventListener("scroll", function (e) { show(e.target); }, { capture: true, passive: true });
})();
