/* Bento OS - one tab's own look (light / dark), page side. Runs at the start of every page, in the page's own world.
   Without this tab's flag it does nothing but hand back the browser's own answers. With it, the page's "which look do
   you prefer?" question (matchMedia prefers-color-scheme) answers this tab's look, and when the look changes the page
   is told at once - the same signal a site gets when the Mac itself turns light or dark - so it redraws without a reload. */
(function () {
  if (window.__vosLookSet) return;
  var KEY = "__vosLook", real = window.matchMedia, W = window, late = document.readyState !== "loading";   // (1.0.303: late - loaded into a page already running)
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
  var mqs = {};                                               // 1.0.340: one per query - asked again (a site's every render, a scroll): the same one
  window.matchMedia = function matchMedia(q) { q = String(q); return /prefers-color-scheme/i.test(q) ? (mqs[q] || (mqs[q] = wrap(q))) : real.call(W, q); };
  var paint = function () {                                     // (how the page is drawn now: its colours and theme marks)
    try { var D = document, h = D.documentElement, bd = D.body, c = getComputedStyle(h), cb = bd ? getComputedStyle(bd) : c;
      return c.backgroundColor + c.color + cb.backgroundColor + cb.color + h.className + (bd ? bd.className : "") + (h.getAttribute("data-theme") || "") + D.adoptedStyleSheets.length; } catch (e) { return ""; }
  };
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
        var vt = D.startViewTransition(function () {                 // 1.0.345: no frames run inside a view transition's update (rAF waited for ever,
          var look0 = paint(); go();                                  // the fade was dropped): plain timers - on as soon as the page has redrawn, at most 260ms
          return new Promise(function (r) { var t0 = Date.now(), tick = function () {
            if (paint() !== look0 || Date.now() - t0 >= 260) { judge(); setTimeout(r, 20); } else setTimeout(tick, 25); }; setTimeout(tick, 25); }); });   // (the site redraws, its rules switch; a made-up dark on or off with it)
        var done = function () { D.adoptedStyleSheets = D.adoptedStyleSheets.filter(function (x) { return x !== css; }); };
        vt.finished.then(done, done);
        return (look || "off") + (late ? "|late" : "");
      } catch (e) {}
    }
    go(); soon(400);
    return (look || "off") + (late ? "|late" : "");
  };

  /* 1.0.289: A SITE WITH NO DARK DESIGN OF ITS OWN gets one written for it - from its own style rules, not by turning its
     colours over. When this page should be dark (Vivaldi dark, or this window switched to dark) and is still drawn light
     once loaded: each of its rules is read and a dark twin written after it - light surfaces become deep ones (their hue
     kept), dark text becomes light, borders soften, links and brand colours keep their colour (lighter where they were
     dark). Pictures, videos and icons are never touched. Its own colour variables are re-written the same way, and colours
     written on the elements themselves too. A site with a dark design of its own is never touched; one that turns dark by
     itself later loses the written one again. Light is never written. */
  var nfetch = W.fetch && W.fetch.bind(W);                       // 1.0.340: the browser's own fetch (taken before the site's scripts can wrap it)
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
  /* 1.0.291: A PICTURE FRAME stays as the site made it - a light box mostly filled by a picture (a shop's product card, its
     photo on white) keeps its own colours inside, so its labels and badges read as one piece with it on the dark page.
     1.0.292: kept out with one scope boundary (cheap for the browser), and found only as pictures arrive, when it is idle */
  var outside = function (sel) { return sel.replace(/(^|,)(\s*)(html|:root)(?=$|[\s.#\[:>+~,])/gi, "$1$2:scope"); };   // (inside the boundary the page's root is :scope)
  var kept = [], idle = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
  function frameOf(im) {
    var ir = im.getBoundingClientRect(); if (ir.width < 60 || ir.height < 60) return null;
    for (var e = im.parentElement, up = 0; e && up < 5 && e !== document.body; e = e.parentElement, up++) {
      var cs = getComputedStyle(e), c = rgbOf(cs.backgroundColor);
      if (!c || c[3] < 0.5) continue;                            // (the first box with a colour of its own)
      var r = e.getBoundingClientRect(), A = r.width * r.height;
      if (!A || A > innerWidth * innerHeight * 0.6) return null;
      return hsl(c[0], c[1], c[2])[2] > 0.85 && (ir.width * ir.height) / A > 0.3 ? e : null;   // (still light with the dark on: a frame)
    }
    return null;
  }
  var fq = [], fT = 0;
  function frames(list) {                                        // (the pictures given, or every one not looked at yet)
    if (!gen) return;
    (list || document.querySelectorAll("img,picture,video")).forEach(function (im) { if (!im.__vosF) fq.push(im); });
    if (fT) return;
    fT = idle(function () {
      fT = 0; var n = 0;
      while (fq.length && n++ < 120) {
        var im = fq.shift(); if (!im.isConnected || im.__vosF) continue; im.__vosF = 1;
        if (im.closest("[data-vos-keep]")) continue;
        var e = frameOf(im); if (e && !e.hasAttribute("data-vos-keep")) { e.setAttribute("data-vos-keep", ""); kept.push(e); }
      }
      if (fq.length) frames([]);
    });
  }
  function sheet(sh, out) {
    if (!sh || sh === gen || sh.disabled) return;
    var list = null; try { list = sh.cssRules; } catch (e) {}
    if (list) return rules(list, out);
    var href = sh.href; if (!href) return;
    if (far[href] === undefined) {                              // another site's style sheet: read again, once
      far[href] = null;
      (nfetch || fetch)(href, { credentials: "omit" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
        if (!t) { far[href] = false; unread++; return; }
        var s2 = new CSSStyleSheet(); try { s2.replaceSync(t); far[href] = s2; } catch (e) { far[href] = false; unread++; }
        later();
      }).catch(function () { far[href] = false; unread++; later(); });
      return;
    }
    if (far[href]) rules(far[href].cssRules, out);
  }
  var sig = "";
  function build() {                                             // the dark twin of the page's style sheets (only when they change)
    if (!gen) return;
    var D = document, list = [].slice.call(D.styleSheets).concat((D.adoptedStyleSheets || []).filter(function (x) { return x !== gen; }));
    var now = list.map(function (x) { var n = 0; try { n = x.cssRules.length; } catch (e) { n = far[x.href] ? -far[x.href].cssRules.length : 0; } return (x.href || "") + n; }).join("|") + "#" + unread;
    if (now === sig) return; sig = now;                          // (nothing new: nothing to do)
    vuse = {}; vuseBg = {}; var out = [];
    var all = function (o) { list.forEach(function (x) { sheet(x, o); }); };
    scan = true; all([]); scan = false;
    all(out);
    var base = ":root{color-scheme:dark}html{background-color:#141517;color:#e4e4e6}[data-vos-keep]{color:#16191d}";
    try { gen.replaceSync(base + "@scope (:root) to ([data-vos-keep]){" + out.join("\n") + "}"); } catch (e) { try { gen.replaceSync(base); } catch (e2) {} }
    if (unread) sweep();
  }
  function inlineOne(el) {                                       // colours written on one element itself
    var st = el.style; if (!st || el.__vosInl === st.cssText || el.closest("[data-vos-keep]")) return;
    var done = [];
    for (var j = 0; j < st.length; j++) {
      var p = st[j], k = KIND(p); if (!k || k === "img" && !/gradient/i.test(st.getPropertyValue(p))) continue;
      var v = st.getPropertyValue(p), m = k === "img" ? mapG(v) : mapC(v, k);
      if (m) done.push([p, v, st.getPropertyPriority(p), m]);
    }
    done.forEach(function (x) { st.setProperty(x[0], x[3], x[2]); inl.push([el, x[0], x[1], x[2]]); });
    el.__vosInl = st.cssText;
  }
  function inline(root) { var els = (root || document).querySelectorAll("[style]"); for (var i = 0; i < els.length && i < 3000; i++) inlineOne(els[i]); if (root && root.hasAttribute && root.hasAttribute("style")) inlineOne(root); }
  function sweep(sel) {                                          // (a style sheet that could not be read: what it drew, element by element)
    var all = document.querySelectorAll(sel || "body *"), todo = [], n = 0;   // 1.0.340: every colour read first, then all written (one style pass)
    for (var i = 0; i < all.length && n < 5000; i++) {
      var el = all[i]; if (el.__vosSw || el.closest("[data-vos-keep]")) continue; el.__vosSw = 1; n++;
      if (/^(IMG|VIDEO|CANVAS|PICTURE|SVG|IFRAME|EMBED|OBJECT)$/i.test(el.tagName)) continue;
      var cs = getComputedStyle(el), b = mapC(cs.backgroundColor, "bg"), f = mapC(cs.color, "fg");
      if (b || f) todo.push([el, b, f]);
    }
    todo.forEach(function (x) { var el = x[0];
      if (x[1]) { swept.push([el, "background-color", el.style.getPropertyValue("background-color"), el.style.getPropertyPriority("background-color")]); el.style.setProperty("background-color", x[1], "important"); }
      if (x[2]) { swept.push([el, "color", el.style.getPropertyValue("color"), el.style.getPropertyPriority("color")]); el.style.setProperty("color", x[2], "important"); } });
  }
  var lT = 0;
  function later() { if (lT) return; lT = setTimeout(function () { lT = 0; idle(function () { if (gen) { build(); inline(); sweep("input,textarea,select,button"); frames(); leftLight(); } }); }, 400); }
  function genOn() {
    if (gen) return;
    gen = new CSSStyleSheet(); sig = "";
    document.adoptedStyleSheets = document.adoptedStyleSheets.concat([gen]);
    build(); inline(); sweep("input,textarea,select,button"); frames(); leftLight();
    var pend = [], pT = 0;                                       // (while it scrolls: only what changed, once the browser is idle)
    genObs = new MutationObserver(function (ms) {
      var sheets = false;
      for (var i = 0; i < ms.length; i++) { var m = ms[i];
        if (m.type === "attributes") { if (m.target.__vosInl !== m.target.style.cssText) pend.push(m.target); continue; }
        if (m.type === "characterData") { if (m.target.parentNode && m.target.parentNode.nodeName === "STYLE") sheets = true; continue; }   // (1.0.340: only a style's text)
        if (m.target && m.target.tagName === "STYLE") { sheets = true; continue; }
        for (var j = 0; j < m.addedNodes.length; j++) { var a = m.addedNodes[j]; if (a.nodeType !== 1) continue;
          if (/^(STYLE|LINK)$/.test(a.tagName)) sheets = true; else pend.push(a); }
        for (var k = 0; k < m.removedNodes.length; k++) if (/^(STYLE|LINK)$/.test(m.removedNodes[k].tagName || "")) sheets = true;
      }
      if (sheets) later();
      if (pend.length && !pT) pT = idle(function () {
        pT = 0; var list = pend.splice(0, pend.length), imgs = [];
        list.forEach(function (n) { if (!n.isConnected) return; inline(n); if (/^(IMG|PICTURE|VIDEO)$/.test(n.tagName)) imgs.push(n); else if (n.querySelectorAll) [].push.apply(imgs, n.querySelectorAll("img,picture,video")); });
        if (imgs.length) frames(imgs);
      });
    });
    genObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });
    [800, 2500, 6000].forEach(function (ms) { setTimeout(later, ms); });   // (its style sheets still arriving)
  }
  document.addEventListener("load", function (e) {                 // (1.0.340: once for the page - they did nothing while no dark is written)
    var t = e.target; if (!gen || !t) return;
    if (t.tagName === "LINK") later(); else if (t.tagName === "IMG") { t.__vosF = 0; frames([t]); }   // (a picture arrived: a frame?)
  }, true);
  addEventListener("load", function () { if (gen) later(); });
  function genOff() {
    if (!gen) return; var g = gen; gen = null; sig = "";
    if (genObs) { genObs.disconnect(); genObs = null; }
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (x) { return x !== g; });
    kept.forEach(function (e) { e.removeAttribute("data-vos-keep"); }); kept = [];
    [].slice.call(document.querySelectorAll("img,picture,video")).forEach(function (im) { im.__vosF = 0; });
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
  /* 1.0.312: THE SITE'S OWN DARK MODE FIRST. Many sites have a dark design they switch on themselves (a class or an attribute
     on the page: Bootstrap's data-bs-theme, Tailwind's .dark, data-theme, .dark-mode...), not from the "which look?" question.
     Its style rules say so: that switch is turned on, and if the page is then dark, it is the site's own dark design that
     shows - only a site with none gets one written for it */
  var SWITCHES = [[/\[data-bs-theme=["']?dark/i, "attr", "data-bs-theme"], [/\[data-theme=["']?dark/i, "attr", "data-theme"], [/\[data-color-mode=["']?dark/i, "attr", "data-color-mode"],
    [/\[data-mode=["']?dark/i, "attr", "data-mode"], [/\[data-color-scheme=["']?dark/i, "attr", "data-color-scheme"], [/(^|[\s,(])(html|:root)?\.dark(?![\w-])/i, "class", "dark"],
    [/\.dark-mode(?![\w-])/i, "class", "dark-mode"], [/\.theme-dark(?![\w-])/i, "class", "theme-dark"], [/\.dark-theme(?![\w-])/i, "class", "dark-theme"]];
  var siteSw = null, swTried = false;
  /* 1.0.341: A SITE WITH ITS OWN DARK THEME (a web app's own setting - Asana's theme--darkMode, a "follow the system" mode
     written for the browser's dark question): it is the site's choice - never forced. Counted in its style rules: dark
     theme selectors of its own (not a framework's generic switch above) and its own rules for the dark question */
  var THEMEISH = /(theme|mode|scheme|appearance|skin)[\w-]*(dark|night)|(dark|night)[\w-]*(theme|mode|scheme|appearance|skin)/i;
  var ownSig = "", ownVal = false;
  function ownDark() {
    var D = document, wait = false;
    var sig = [].map.call(D.styleSheets, function (x) { var n = 0; try { n = x.cssRules.length; } catch (e) {
      if (x.href && far[x.href] === undefined) sheet(x, []);           // (another site's sheet: read once, then judged again)
      if (x.href && far[x.href] === null) wait = true;
      n = far[x.href] ? far[x.href].cssRules.length : 0; } return n; }).join(",");
    if (wait) { soon(700); return true; }                            // (not all read yet: nothing forced meanwhile)
    if (sig === ownSig) return ownVal; ownSig = sig;
    var themed = 0, media = 0, n = 0;
    var walk = function (list, inDark) { for (var i = 0; i < list.length && n < 60000; i++) { var r = list[i]; n++;
      var dk = inDark || !!(r.media && /prefers-color-scheme\s*:\s*dark/i.test(r.media.mediaText || ""));
      var sel = r.selectorText;
      if (sel) { if (dk) media++;
        else if (THEMEISH.test(sel)) { var fw = false; for (var k = 0; k < SWITCHES.length; k++) if (SWITCHES[k][0].test(sel)) { fw = true; break; } if (!fw) themed++; } }
      if (r.cssRules) walk(r.cssRules, dk); } };
    for (var i = 0; i < D.styleSheets.length; i++) { var sh = D.styleSheets[i], l = null; try { l = sh.cssRules; } catch (e) { l = far[sh.href] && far[sh.href].cssRules; } if (l) walk(l, false); }
    return (ownVal = themed >= 12 || media >= 12);
  }
  function findSwitch() {
    var found = null, n = 0;
    var look = function (list) { for (var i = 0; i < list.length && !found && n < 30000; i++) { var r = list[i]; n++;
      var sel = r.selectorText; if (sel) for (var k = 0; k < SWITCHES.length; k++) if (SWITCHES[k][0].test(sel)) { found = SWITCHES[k]; break; }
      if (!found && r.cssRules) look(r.cssRules); } };
    for (var i = 0; i < document.styleSheets.length && !found; i++) { var sh = document.styleSheets[i], l = null; try { l = sh.cssRules; } catch (e) { l = far[sh.href] && far[sh.href].cssRules; } if (l) look(l); }
    return found;
  }
  function swOn(sw) {
    var els = [document.documentElement, document.body].filter(Boolean), was = [];
    els.forEach(function (e) { if (sw[1] === "attr") { was.push([e, e.getAttribute(sw[2])]); e.setAttribute(sw[2], "dark"); } else { was.push([e, e.classList.contains(sw[2])]); e.classList.add(sw[2]); } });
    siteSw = { sw: sw, was: was };
  }
  function swOff() {
    if (!siteSw) return; var sw = siteSw.sw;
    siteSw.was.forEach(function (x) { if (sw[1] === "attr") { if (x[1] == null) x[0].removeAttribute(sw[2]); else x[0].setAttribute(sw[2], x[1]); } else if (!x[1]) x[0].classList.remove(sw[2]); });
    siteSw = null;
  }
  function lightShare() {                                        // 1.0.316: how much of what is in sight is still light (a 4 x 4 look over it)
    var D = document; if (!D.body) return 0; var light = 0, seen = 0;
    if (gen) gen.disabled = false;
    for (var i = 1; i <= 4; i++) for (var j = 1; j <= 4; j++) {
      var e = D.elementFromPoint(innerWidth * i / 5, innerHeight * j / 5), L = null;
      for (; e && L === null; e = e.parentElement) L = lumOf(getComputedStyle(e).backgroundColor);
      if (L === null) L = lumOf(getComputedStyle(D.documentElement).backgroundColor);
      if (L === null) continue; seen++; if (L > 160) light++;
    }
    return seen ? light / seen : 0;
  }
  var swScrollT = 0, leftT = 0;
  function leftLight() {                                          // 1.0.318: after writing its dark: what still shows light (colours the page sets
    if (!gen || leftT) return;                                    // outside its style rules - old bgcolor / font colours, a script's) - made dark there
    leftT = setTimeout(function () { leftT = 0; if (gen && want() && lightShare() > 0.12) sweep("body, body *"); }, 500);
  }
  addEventListener("scroll", function () { if (gen) leftLight(); }, { passive: true, capture: true });
  addEventListener("scroll", function () {                         // (scrolled on to a part its own dark design does not cover: written dark for it too)
    if (!siteSw || gen || swScrollT) return;
    swScrollT = setTimeout(function () { swScrollT = 0; if (siteSw && !gen && want() && lightShare() > 0.2) genOn(); }, 900);
  }, { passive: true, capture: true });
  function judge() {
    clearTimeout(genT); genT = 0;
    if (!/html/i.test(document.contentType || "")) return;
    if (W !== W.top && (innerWidth < 200 || innerHeight < 120)) return;   // 1.0.340: a tiny frame (an ad, a tracker): nothing to judge
    if (!want()) { swOff(); swTried = false; return genOff(); }
    if (siteSw && gen) return;
    if (siteSw) return;                                            // (the site's own dark design is on - with written dark for what it leaves light)
    if (ownDark()) { if (gen) genOff(); return; }                    // 1.0.341: its own dark theme - its own setting decides
    if (swept.length || inl.length) { if (gen) return; }
    var L = pageLum(); if (L === null) return;
    if (gen) { if (L < 110) genOff(); return; }                  // (it turned dark by itself)
    if (L <= 160 && lightShare() < 0.35) return;                  // 1.0.318: light or not - the whole of what is in sight, not one point in its middle
    if (!swTried) {                                                // its own dark switch, if it has one
      swTried = true; var sw = findSwitch();
      if (sw) { swOn(sw); setTimeout(function () {
        var L2 = pageLum(); if (L2 === null || L2 >= 110) { swOff(); if (want()) genOn(); return; }   // (its switch did nothing: written dark instead)
        if (want() && lightShare() > 0.2) genOn();               // 1.0.316: its own dark design, and written dark for the parts it leaves light
      }, 350); return; }
    }
    genOn();
  }
  function soon(ms) { clearTimeout(genT); genT = setTimeout(judge, ms || 600); }
  real.call(W, "(prefers-color-scheme: dark)").addEventListener("change", function () { soon(500); });
  var ready = function () {
    soon(500);
    var t = 0; genWatch = new MutationObserver(function () {   // (a site that changes its own look later - while dark is written, only a theme-like change is measured)
      if (t) return;
      if (gen && !/dark|night|theme|mode/i.test((document.documentElement.className || "") + " " + ((document.body && document.body.className) || "") + " " + (document.documentElement.getAttribute("data-theme") || ""))) return;
      t = setTimeout(function () { t = 0; judge(); }, 800); });
    genWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-color-mode"] });
    if (document.body) genWatch.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();   // (1.0.303: loaded into a page already open: at once)
  if (document.readyState === "complete") setTimeout(judge, 2500); else addEventListener("load", function () { soon(500); setTimeout(judge, 2500); });
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
  var host = null, bars = null, hideT = 0, darkQ = null;
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
    var dark = (darkQ || (darkQ = matchMedia("(prefers-color-scheme: dark)"))).matches;   // (this tab's own look, when one is set - 1.0.340: asked once)
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
