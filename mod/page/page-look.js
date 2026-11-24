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

  /* 1.0.289: A SITE WITH NO DARK DESIGN OF ITS OWN gets one written for it - from its own style rules, not by turning its
     colours over. When this page should be dark (Vivaldi dark, or this window switched to dark) and is still drawn light
     once loaded: each of its rules is read and a dark twin written after it - light surfaces become deep ones (their hue
     kept), dark text becomes light, borders soften, links and brand colours keep their colour (lighter where they were
     dark). Pictures, videos and icons are never touched. Its own colour variables are re-written the same way, and colours
     written on the elements themselves too. A site with a dark design of its own is never touched; one that turns dark by
     itself later loses the written one again. Light is never written. */
  var gen = null, genT = 0, genObs = null, genWatch = null, inl = [], swept = [], far = {}, probe = null, pc = {};
  var want = function () { return answer("(prefers-color-scheme: dark)"); };
  function rgbOf(c) {                                            // any CSS colour -> [r, g, b, a] (null: not a plain colour)
    if (!c || /var\(|currentcolor|inherit|initial|unset|transparent|none/i.test(c)) return null;
    if (c in pc) return pc[c];
    if (!probe) { probe = document.createElement("vos-cprobe"); probe.style.cssText = "display:none !important"; }
    if (!probe.isConnected) (document.documentElement || document).appendChild(probe);
    probe.style.color = ""; probe.style.color = c;
    var out = null;
    if (probe.style.color) {
      var v = getComputedStyle(probe).color, m = v.match(/^rgba?\(([^)]+)\)/), k;
      if (m) { k = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); out = [k[0], k[1], k[2], k.length > 3 ? k[3] : 1]; }
      else if ((m = v.match(/^color\(srgb ([^)]+)\)/))) { k = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); out = [k[0] * 255, k[1] * 255, k[2] * 255, k.length > 3 ? k[3] : 1]; }
    }
    return (pc[c] = out);
  }
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return [h, s, l];
  }
  var css = function (h, s, l, a) { return "hsla(" + h.toFixed(1) + "," + (s * 100).toFixed(1) + "%," + (l * 100).toFixed(1) + "%," + (+a).toFixed(3) + ")"; };
  function mapC(c, kind) {                                       // kind: bg (a surface) / fg (text, icons drawn in a colour) / bd (a line)
    var v = rgbOf(c); if (!v || v[3] === 0) return null;
    var x = hsl(v[0], v[1], v[2]), h = x[0], s = x[1], l = x[2];
    if (kind === "bg") { if (l > 0.75 || (l > 0.35 && s < 0.22)) return css(h, s * 0.65, 0.075 + (1 - l) * 0.3, v[3]); return null; }
    if (kind === "fg") { if (l < 0.55) return css(h, s, 0.92 - l * 0.45, v[3]); return null; }
    if (l > 0.6) return css(h, s * 0.6, 0.2 + (1 - l) * 0.3, v[3]);
    if (l < 0.3) return css(h, s, 0.42, v[3]);
    return null;
  }
  var TOK = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b(?:white|black|whitesmoke|gainsboro|lightgr[ae]y|silver|gr[ae]y)\b/gi;
  var mapG = function (v) { return /gradient\(/i.test(v) ? v.replace(TOK, function (t) { return mapC(t, "bg") || t; }) : null; };
  var KIND = function (p) {
    if (p === "background-color") return "bg";
    if (p === "color" || p === "fill" || p === "stroke" || p === "caret-color" || p === "text-decoration-color" || p === "-webkit-text-fill-color") return "fg";
    if (/^(border-(top|right|bottom|left|block|inline)(-start|-end)?-color|outline-color|column-rule-color)$/.test(p)) return "bd";
    if (p === "background-image") return "img";
    return null;
  };
  var vuse = {}, vuseBg = {}, scan = false;                         // the site's own colour variables: where each is used
  function decls(st, out) {                                      // one rule's colours, written dark (its own order kept)
    for (var i = 0; i < st.length; i++) {
      var p = st[i], v = st.getPropertyValue(p), imp = st.getPropertyPriority(p) ? " !important" : "";
      if (p.indexOf("--") === 0) {                                // a colour variable: written dark where it is defined, for what it is used for
        if (scan) continue;
        var vv = v.trim(), rgb = rgbOf(vv), u = vuse[p]; if (!u || (!rgb && !/gradient\(/i.test(vv))) continue;
        if (u === "fg" && rgb && hsl(rgb[0], rgb[1], rgb[2])[2] > 0.75 && vuseBg[p]) u = "bg";   // (used for both: the white is a surface)
        var mv = /gradient\(/i.test(vv) ? mapG(vv) : mapC(vv, u); if (mv) out.push(p + ":" + mv + imp); continue; }
      var k = KIND(p); if (!k) continue;
      if (/var\(/.test(v)) { if (!scan) continue; var mm = v.match(/var\(\s*(--[\w-]+)/g); if (mm) mm.forEach(function (x) { var n = x.replace(/var\(\s*/, ""); if (!vuse[n]) vuse[n] = k === "img" ? "bg" : k; if (k === "bg" || k === "img") vuseBg[n] = 1; }); continue; }
      if (scan) continue;
      var m = k === "img" ? mapG(v) : mapC(v.trim(), k);
      if (m) out.push(p + ":" + m + imp);
    }
  }
  function rules(list, out) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      try {
        if (r.selectorText !== undefined && r.style) { var d = []; decls(r.style, d); if (d.length) out.push(outside(r.selectorText) + "{" + d.join(";") + "}"); if (r.cssRules && r.cssRules.length) { var n = []; rules(r.cssRules, n); if (n.length) out.push(r.selectorText + "{" + n.join("") + "}"); } }
        else if (r.media && r.cssRules) { var mo = []; rules(r.cssRules, mo); if (mo.length) out.push("@media " + r.media.mediaText + "{" + mo.join("") + "}"); }
        else if (r.conditionText !== undefined && r.cssRules) { var so = []; rules(r.cssRules, so); if (so.length) out.push("@supports " + r.conditionText + "{" + so.join("") + "}"); }
        else if (r.styleSheet) sheet(r.styleSheet, out);
        else if (r.cssRules && !r.name) rules(r.cssRules, out);      // (a layer's rules)
      } catch (e) {}
    }
  }
  var unread = 0;
  /* 1.0.291: A PICTURE FRAME stays as the site made it. A light box mostly filled by a picture (a shop's product card - its
     photos have white backgrounds -, a photo with its caption) is not made dark, nor anything in it: its labels, prices
     and badges keep their own colours, so the card reads as one piece on the dark page. */
  var outside = function (sel) {
    if (/::|:(before|after|first-line|first-letter|placeholder|selection|marker|backdrop|-webkit-)/i.test(sel) || /(^|,)\s*(html|:root|body)\s*(,|$)/i.test(sel)) return sel;
    return ":is(" + sel + "):not([data-vos-keep],[data-vos-keep] *)";
  };
  var kept = [];
  function frames() {                                            // find the frames: measured as the site draws them (the written dark off)
    if (!gen) return;
    var imgs = document.querySelectorAll("img,picture,video");
    gen.disabled = true;
    var found = [];
    for (var i = 0; i < imgs.length && i < 400; i++) {
      var im = imgs[i], ir = im.getBoundingClientRect(); if (ir.width < 60 || ir.height < 60) continue;
      if (im.closest("[data-vos-keep]")) continue;
      for (var e = im.parentElement, up = 0; e && up < 5 && e !== document.body; e = e.parentElement, up++) {
        var r = e.getBoundingClientRect(), A = r.width * r.height; if (!A) continue;
        if (A > innerWidth * innerHeight * 0.6) break;             // (not a whole section of the page)
        var cs = getComputedStyle(e), c = rgbOf(cs.backgroundColor);
        if (!c || c[3] < 0.5) continue;
        if (hsl(c[0], c[1], c[2])[2] > 0.85 && (ir.width * ir.height) / A > 0.3) { found.push([e, cs.color]); break; }
        break;                                                     // (a coloured box first: not a frame)
      }
    }
    gen.disabled = false;
    found.forEach(function (f) { var e = f[0]; if (e.hasAttribute("data-vos-keep")) return;
      e.setAttribute("data-vos-keep", ""); kept.push([e, e.style.getPropertyValue("color"), e.style.getPropertyPriority("color")]);
      e.style.setProperty("color", f[1], "important"); });        // (its text in the site's own colour, not the dark page's)
  }
  function sheet(sh, out) {
    if (!sh || sh === gen || sh.disabled) return;
    var list = null; try { list = sh.cssRules; } catch (e) {}
    if (list) return rules(list, out);
    var href = sh.href; if (!href) return;
    if (far[href] === undefined) {                              // another site's style sheet: read again, once
      far[href] = null;
      fetch(href, { credentials: "omit" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
        if (!t) { far[href] = false; unread++; return; }
        var s2 = new CSSStyleSheet(); try { s2.replaceSync(t); far[href] = s2; } catch (e) { far[href] = false; unread++; }
        if (gen) build();
      }).catch(function () { far[href] = false; unread++; if (gen) sweep(); });
      return;
    }
    if (far[href]) rules(far[href].cssRules, out);
  }
  function build() {                                             // the dark twin of everything the page has now
    if (!gen) return;
    vuse = {}; vuseBg = {}; var out = [], D = document;
    var all = function (o) { for (var i = 0; i < D.styleSheets.length; i++) sheet(D.styleSheets[i], o); (D.adoptedStyleSheets || []).forEach(function (s3) { if (s3 !== gen) sheet(s3, o); }); };
    scan = true; all([]); scan = false;                          // (first: what each colour variable is used for)
    all(out);
    var base = ":root{color-scheme:dark}html{background-color:#141517;color:#e4e4e6}";
    try { gen.replaceSync(base + out.join("\n")); } catch (e) { try { gen.replaceSync(base); } catch (e2) {} }
    frames();
    inline();
    sweep("input,textarea,select,button");                      // (form fields: the browser's own white, or a rule it could not see)
    if (unread) sweep();
  }
  function inline() {                                            // colours written on the elements themselves
    var els = document.querySelectorAll("[style]");
    for (var i = 0; i < els.length && i < 4000; i++) {
      var el = els[i], st = el.style; if (el.__vosInl === st.cssText || el.closest("[data-vos-keep]")) continue;
      var done = [];
      for (var j = 0; j < st.length; j++) {
        var p = st[j], k = KIND(p); if (!k || k === "img" && !/gradient/i.test(st.getPropertyValue(p))) continue;
        var v = st.getPropertyValue(p), m = k === "img" ? mapG(v) : mapC(v, k);
        if (m) done.push([p, v, st.getPropertyPriority(p), m]);
      }
      done.forEach(function (x) { st.setProperty(x[0], x[3], x[2]); inl.push([el, x[0], x[1], x[2]]); });
      el.__vosInl = st.cssText;
    }
  }
  function sweep(sel) {                                          // (a style sheet that could not be read: what it drew, element by element)
    var all = document.querySelectorAll(sel || "body *");
    for (var i = 0; i < all.length && i < 5000; i++) {
      var el = all[i]; if (el.__vosSw || el.closest("[data-vos-keep]")) continue; el.__vosSw = 1;
      if (/^(IMG|VIDEO|CANVAS|PICTURE|SVG|IFRAME|EMBED|OBJECT)$/i.test(el.tagName)) continue;
      var cs = getComputedStyle(el), b = mapC(cs.backgroundColor, "bg"), f = mapC(cs.color, "fg");
      if (b) { swept.push([el, "background-color", el.style.getPropertyValue("background-color"), el.style.getPropertyPriority("background-color")]); el.style.setProperty("background-color", b, "important"); }
      if (f) { swept.push([el, "color", el.style.getPropertyValue("color"), el.style.getPropertyPriority("color")]); el.style.setProperty("color", f, "important"); }
    }
  }
  function genOn() {
    if (gen) return;
    gen = new CSSStyleSheet();
    document.adoptedStyleSheets = document.adoptedStyleSheets.concat([gen]);
    build();
    var t = 0; genObs = new MutationObserver(function (ms) {      // (style sheets and colours the page adds or changes later)
      var re = false;
      for (var i = 0; i < ms.length && !re; i++) { var m = ms[i];
        if (m.type === "attributes") re = re || m.target.__vosInl !== m.target.style.cssText;
        else for (var j = 0; j < m.addedNodes.length; j++) { var a = m.addedNodes[j]; if (a.nodeType === 1 && (/^(STYLE|LINK)$/.test(a.tagName) || (a.querySelector && a.querySelector("style,link[rel~=stylesheet],[style]")))) { re = true; break; } }
        if (m.type === "characterData" || (m.target && m.target.tagName === "STYLE")) re = true; }
      if (re && !t) t = setTimeout(function () { t = 0; if (gen) build(); }, 300);
    });
    genObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });
    var ft = 0;
    document.addEventListener("load", function (e) {
      if (gen && e.target && e.target.tagName === "LINK") build();
      else if (gen && e.target && e.target.tagName === "IMG" && !ft) ft = setTimeout(function () { ft = 0; frames(); }, 300);   // (a picture arrived: a frame?)
    }, true);
    [700, 1800, 4000, 8000].forEach(function (ms) { setTimeout(function () { if (gen) build(); }, ms); });   // (its style sheets still arriving)
    addEventListener("load", function () { if (gen) build(); });
  }
  function genOff() {
    if (!gen) return; var g = gen; gen = null;
    if (genObs) { genObs.disconnect(); genObs = null; }
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (x) { return x !== g; });
    kept.forEach(function (x) { x[0].removeAttribute("data-vos-keep"); x[0].style.setProperty("color", x[1], x[2]); }); kept = [];
    inl.concat(swept).forEach(function (x) { try { x[0].style.setProperty(x[1], x[2], x[3]); x[0].__vosInl = null; x[0].__vosSw = 0; } catch (e) {} });
    inl = []; swept = [];
  }
  var lumOf = function (c) { var m = (String(c).match(/[\d.]+/g) || []).map(Number); return m.length < 3 || (m.length > 3 && m[3] < 0.5) ? null : 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  function pageLum() {                                           // how the site itself draws its page (without the written dark)
    var D = document; if (!D.body) return null;
    if (gen) gen.disabled = true;
    var L = null;
    for (var e = D.elementFromPoint(innerWidth / 2, innerHeight / 2); e && L === null; e = e.parentElement) L = lumOf(getComputedStyle(e).backgroundColor);
    if (L === null) L = lumOf(getComputedStyle(D.body).backgroundColor);
    if (L === null) L = lumOf(getComputedStyle(D.documentElement).backgroundColor);
    if (gen) gen.disabled = false;
    return L === null ? 255 : L;
  }
  function judge() {
    clearTimeout(genT); genT = 0;
    if (!/html/i.test(document.contentType || "")) return;
    if (!want()) return genOff();
    if (swept.length || inl.length) { if (gen) return; }
    var L = pageLum(); if (L === null) return;
    if (gen) { if (L < 110) genOff(); return; }                  // (it turned dark by itself)
    if (L > 160) genOn();
  }
  function soon(ms) { clearTimeout(genT); genT = setTimeout(judge, ms || 600); }
  real.call(W, "(prefers-color-scheme: dark)").addEventListener("change", function () { soon(500); });
  document.addEventListener("DOMContentLoaded", function () {
    soon(500);
    var t = 0; genWatch = new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = 0; judge(); }, 400); });   // (a site that changes its own look later)
    genWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-color-mode"] });
    if (document.body) genWatch.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
  });
  addEventListener("load", function () { soon(500); setTimeout(judge, 2500); });
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
