/* ==========================================================================
   Vivaldi OS __VERSION__ — all in one file (built by "Build Release.command")
   For PCs where no installer can run: this one script, loaded by Vivaldi's
   window.html, brings the whole mod:
     1. the CSS mods (no "CSS modifications" setting or folder needed)
     2. the whole look: settings (tab bar, address bar, panels, toolbars...)
        and the themes with the wallpaper - again whenever they change
        (custom-vivaldi-os-wallpaper.jpg, next to this file)
     3. the JS mods (after this part)
   ========================================================================== */
(() => {
  "use strict";
  const VERSION = "__VERSION__";
  const CSS = __CSS__;
  const CFG = __SETTINGS__;

  /* 1. the CSS */
  const style = document.createElement("style");
  style.id = "vivaldi-os-css";
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  /* 2. the settings: the whole look of the package, applied again whenever
        the package brings different settings (a new version) */
  const DONE_KEY = "vivaldiOs.settingsApplied";
  const STAMP = String(JSON.stringify(CFG).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  if (typeof vivaldi === "undefined" || !vivaldi.prefs) return;
  /* Vivaldi's window has no localStorage: the "already applied" mark lives in chrome.storage */
  const markGet = () => new Promise(r => { try { chrome.storage.local.get(DONE_KEY, o => { void chrome.runtime.lastError; r(o ? o[DONE_KEY] : undefined); }); } catch (e) { r(undefined); } });
  const markSet = v => { try { chrome.storage.local.set({ [DONE_KEY]: v }, () => void chrome.runtime.lastError); } catch (e) {} };

  const prefGet = async path => {
    try { const v = await vivaldi.prefs.get(path); return v && typeof v === "object" && "value" in v ? v.value : v; }
    catch (_) { return undefined; }
  };
  const prefSet = (path, value) => { try { vivaldi.prefs.set({ path, value }); } catch (e) { console.warn("Vivaldi OS:", path, e); } };

  async function applySettings() {
    let defs = {};
    try { defs = await (await fetch("prefs_definitions.json")).json(); } catch (_) {}
    const defOf = path => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), defs);
    const leaves = [];
    const walk = (path, v) => {
      if (v && typeof v === "object" && !Array.isArray(v) && !defOf(path)?.type) {
        for (const k of Object.keys(v)) walk(path + "." + k, v[k]);
      } else leaves.push([path, v]);
    };
    for (const group of [CFG.set || {}, CFG.setOnce || {}])
      for (const [k, v] of Object.entries(group)) walk(k.replace(/^account_values\./, ""), v);
    for (const [path, v] of leaves) {
      const def = defOf(path);
      if (!def || !def.type) continue;                       // not a setting in this Vivaldi version
      let value = v;
      if (def.type === "enum" && typeof v === "number" && def.enum_values) {
        value = Object.keys(def.enum_values).find(n => def.enum_values[n] === v) ?? v;
      }
      if (path.startsWith("vivaldi.themes.")) continue;      // set with the themes below
      prefSet(path, value);
    }

    /* the themes, exactly as in the package; the wallpaper is stored for each
       theme that uses it (custom-vivaldi-os-wallpaper.jpg, next to this file) */
    const wall = CFG.wallpaper ? "chrome://vivaldi-data/local-image/" + CFG.wallpaper.id : "";
    const usesWall = t => wall && t.backgroundImage === wall;
    const clean = list => (list || []).map(t => (usesWall(t) ? { ...t, backgroundImage: "" } : t));
    if (CFG.systemThemes?.length) prefSet("vivaldi.themes.system", clean(CFG.systemThemes));
    if (CFG.userThemes?.length) prefSet("vivaldi.themes.user", clean(CFG.userThemes));
    const current = CFG.set?.["vivaldi.themes.current"];
    if (current) prefSet("vivaldi.themes.current", current);
    try {
      const r = await fetch("custom-vivaldi-os-wallpaper.jpg");
      if (r.ok) {
        const data = await r.arrayBuffer();
        for (const t of [...(CFG.systemThemes || []), ...(CFG.userThemes || [])])
          if (usesWall(t)) await vivaldi.utilities.storeImage({ themeId: t.id, mimeType: "image/jpeg", data });
      }
    } catch (e) { console.warn("Vivaldi OS: wallpaper", e); }
    markSet(STAMP);
  }
  markGet().then(done => {                          // only when this package's settings are new here
    if (done !== STAMP) setTimeout(() => applySettings().catch(e => console.warn("Vivaldi OS: settings", e)), 2500);
  });
})();
;
