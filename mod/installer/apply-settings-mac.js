// Applies settings/vivaldi-os-settings.json to a Vivaldi profile (macOS, JXA).
// Usage: osascript -l JavaScript apply-settings-mac.js <packageDir> <userDataDir>
// Vivaldi must be closed (it rewrites Preferences when it quits).
ObjC.import("Foundation");

function run(argv) {
  const [pkg, userData, personal] = argv;
  const fm = $.NSFileManager.defaultManager;
  const exists = p => fm.fileExistsAtPath(p);
  const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js;
  const write = (p, s) => { if (!$(s).writeToFileAtomicallyEncodingError(p, true, 4, null)) throw new Error("cannot write " + p); };
  const readJson = p => (exists(p) ? JSON.parse(read(p)) : {});
  const backupOnce = p => { if (exists(p) && !exists(p + ".vivaldi-os.bak")) fm.copyItemAtPathToPathError(p, p + ".vivaldi-os.bak", null); };
  const setPath = (o, path, v) => {
    const k = path.split(".");
    for (const p of k.slice(0, -1)) { if (typeof o[p] !== "object" || o[p] === null || Array.isArray(o[p])) o[p] = {}; o = o[p]; }
    o[k[k.length - 1]] = v;
  };
  const delPath = (o, path) => {
    const k = path.split(".");
    for (const p of k.slice(0, -1)) { o = o?.[p]; if (!o) return; }
    delete o[k[k.length - 1]];
  };

  const cfg = JSON.parse(read(pkg + "/settings/vivaldi-os-settings.json"));
  // your own settings (web panels, workspaces, ...) over the mod's, when personal/ is there
  if (personal && exists(personal + "/personal-settings.json")) Object.assign(cfg.set, JSON.parse(read(personal + "/personal-settings.json")).set || {});
  const profile = userData + "/Default";
  if (!exists(profile + "/Preferences")) throw new Error("No Vivaldi profile at " + profile + " - start Vivaldi once first.");

  // 1. wallpaper: copied next to the profile (iCloud may evict files from the package)
  const wpDir = userData + "/VivaldiOS";
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(wpDir, true, $(), null);
  const wp = wpDir + "/" + cfg.wallpaper.file;
  if (exists(wp)) fm.removeItemAtPathError(wp, null);
  if (!fm.copyItemAtPathToPathError(pkg + "/settings/" + cfg.wallpaper.file, wp, null)) throw new Error("cannot copy the wallpaper");
  const mapPath = profile + "/file_mapping.json";
  backupOnce(mapPath);
  const map = readJson(mapPath);
  map.mappings = map.mappings || {};
  map.mappings[cfg.wallpaper.id] = { local_path: wp };
  write(mapPath, JSON.stringify(map));

  // 2. Preferences: themes, tab bar, CSS folder
  const prefPath = profile + "/Preferences";
  backupOnce(prefPath);
  const prefs = readJson(prefPath);
  prefs.vivaldi = prefs.vivaldi || {};
  prefs.vivaldi.themes = prefs.vivaldi.themes || {};
  const sys = prefs.vivaldi.themes.system;
  if (!Array.isArray(sys) || !sys.length) {
    prefs.vivaldi.themes.system = cfg.systemThemes;
  } else {
    for (const id of cfg.themeIds) {
      const t = cfg.systemThemes.find(x => x.id === id);
      const i = sys.findIndex(x => x.id === id);
      if (i >= 0) sys[i] = t; else sys.push(t);
    }
  }
  for (const [k, v] of Object.entries(cfg.set)) setPath(prefs, k, v);
  // the tab bar items are only a starting point: set on the first install,
  // then your own arrangement (Clock, extra buttons...) is never touched again
  const onceMark = wpDir + "/set-once.done";
  if (!exists(onceMark)) {
    for (const [k, v] of Object.entries(cfg.setOnce || {})) setPath(prefs, k, v);
    write(onceMark, "tab bar items were set on " + new Date().toISOString() + "\n");
  }
  // later additions to the default setup (e.g. the Clock): each one once per machine,
  // so an older install gets it too, and removing it afterwards sticks
  const updMark = wpDir + "/updates-once.done";
  const done = exists(updMark) ? read(updMark).split("\n").filter(Boolean) : [];
  const getPath = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
  for (const u of cfg.updatesOnce || []) {
    if (done.includes(u.id)) continue;
    for (const [k, v] of Object.entries(u.set || {})) setPath(prefs, k, v);
    for (const ins of u.insert || []) {
      let bar = getPath(prefs, ins.toolbar);
      if (!Array.isArray(bar)) continue;          // toolbar not customised yet: Vivaldi's default applies
      if (bar.includes(ins.item)) continue;
      const i = bar.indexOf(ins.before);
      if (i >= 0) bar.splice(i, 0, ins.item); else bar.push(ins.item);
    }
    done.push(u.id);
  }
  write(updMark, done.join("\n") + "\n");
  for (const k of cfg.reset) delPath(prefs, k);
  // the CSS mods: copied next to the profile too, so the package folder can be moved or deleted
  const cssDir = wpDir + "/css";
  if (exists(cssDir)) fm.removeItemAtPathError(cssDir, null);
  if (!fm.copyItemAtPathToPathError(pkg + "/css", cssDir, null)) throw new Error("cannot copy the CSS mods");
  setPath(prefs, "vivaldi.appearance.css_ui_mods_directory", cssDir);
  write(prefPath, JSON.stringify(prefs));

  // 3. Local State: vivaldi://experiments → Allow for using CSS modifications
  const lsPath = userData + "/Local State";
  backupOnce(lsPath);
  const ls = readJson(lsPath);
  ls.browser = ls.browser || {};
  const labs = ls.browser.enabled_labs_experiments || [];
  if (!labs.includes("vivaldi-css-mods@1")) labs.push("vivaldi-css-mods@1");
  ls.browser.enabled_labs_experiments = labs;
  write(lsPath, JSON.stringify(ls));

  return "settings applied (themes, wallpaper, tab bar, CSS folder, CSS experiment)";
}
