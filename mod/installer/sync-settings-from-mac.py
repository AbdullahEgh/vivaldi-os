#!/usr/bin/env python3
"""Copies the Vivaldi experience of THIS Mac into the package, so every
installer turns a fresh Vivaldi into the same thing:
  mod/settings/vivaldi-os-settings.json   the settings (below)
  mod/settings/wallpaper.*                 the current theme's wallpaper
  mod/js/launchpad-seed.js                 the Launchpad apps (the Bookmark Bar
                                           folder), added once where missing
Settings: themes, tab bar and toolbars, address bar, panels and web panels,
start page and its widgets, status bar, clock, workspaces, keyboard shortcuts
and mouse gestures, command chains, tab behaviour, sessions, popups, notes /
reading list options, double-click action, default search engine.
Never copied: account / sync data, passwords, history, usage counters,
window sizes, the CSS folder path. Run by "Build Release.command".

PERSONAL DATA stays out of the mod: the Launchpad bookmarks, web panels,
workspace names, command chains, start page widgets (they point at your
bookmarks) and this Mac's fingerprint go to <root>/personal/, which is never
part of a release. The mod gets a neutral starter set of Launchpad apps, so a
fresh install looks the same with nothing of yours in it.
Usage: sync-settings-from-mac.py <mod folder> [<Vivaldi user data folder>]"""
import json, os, shutil, sys

mod = sys.argv[1]
user_data = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/Library/Application Support/Vivaldi")
prefs = json.load(open(os.path.join(user_data, "Default", "Preferences")))
cfg_path = os.path.join(mod, "settings", "vivaldi-os-settings.json")
cfg = json.load(open(cfg_path))

# what counts as "the look": whole groups, from the profile and the synced (account) part
LOCAL = ["actions", "address_bar.position", "address_bar.visible", "auto_hide", "bookmarks.bar.visible",
         "chained_commands", "clock", "dashboard", "features", "keyboard", "panel_editor", "panels",
         "startpage", "status_bar", "system.desktop_theme_color", "system.mac", "system.search_engine",
         "tabs", "theme", "themes.current", "toolbars", "webpages", "workspaces"]
ACCOUNT = ["address_bar", "appearance", "bookmarks.bar", "mouse_wheel", "notes", "page", "panels",
           "popups", "quick_commands.keep_value", "reading_list", "sessions", "settings", "startpage",
           "tabs", "theme", "workspaces"]
TOP = ["default_search_provider"]                  # the search engine (Vivaldi's built-in ids)

def get(o, path):
    for k in path.split("."):
        if not isinstance(o, dict) or k not in o: return None
        o = o[k]
    return o

out = {}
for root, keys in (("vivaldi", LOCAL), ("account_values.vivaldi", ACCOUNT), ("", TOP)):
    for k in keys:
        path = root + "." + k if root else k
        v = get(prefs, path)
        if v is not None: out[path] = v

# the themes: all of them, as they are on this Mac
themes = get(prefs, "vivaldi.themes") or {}
system = themes.get("system") or cfg.get("systemThemes") or []
user = themes.get("user") or []

# the wallpaper the current theme uses (a local image of this Mac) goes into the package
mapping = get(json.load(open(os.path.join(user_data, "Default", "file_mapping.json"))), "mappings") or {}
cur = next((t for t in system + user if t.get("id") == themes.get("current")), None)
img = (cur or {}).get("backgroundImage", "")
if img.startswith("chrome://vivaldi-data/local-image/"):
    wid = img.rsplit("/", 1)[1]
    src = (mapping.get(wid) or {}).get("local_path")
    if src and os.path.exists(src):
        ext = os.path.splitext(src)[1] or ".jpg"
        dst = os.path.join(mod, "settings", "wallpaper" + ext)
        if os.path.realpath(src) != os.path.realpath(dst): shutil.copyfile(src, dst)
        cfg["wallpaper"] = {"id": wid, "file": "wallpaper" + ext}

# a theme whose picture is no plain Vivaldi picture of this Mac (Bento OS's dimmed / blurred copy is a thumbnail, and
# it lives only here): in the package it shows the packaged wallpaper - a fresh install is never left without one
if cfg.get("wallpaper") and os.path.exists(os.path.join(mod, "settings", cfg["wallpaper"].get("file", "wallpaper.jpg"))):
    canon = "chrome://vivaldi-data/local-image/" + cfg["wallpaper"]["id"]
    for t in system + user:
        bi = t.get("backgroundImage") or ""
        if bi.startswith("chrome://vivaldi-data/thumbnail/") or (bi.startswith("chrome://vivaldi-data/local-image/") and bi != canon and bi.rsplit("/", 1)[1] not in mapping):
            t["backgroundImage"] = canon

# the tab bar is kept exactly as you set it (Home only if you put it there)

cfg["set"] = out
cfg["systemThemes"] = system
cfg["userThemes"] = user
cfg["themeIds"] = [t["id"] for t in system]
cfg["setOnce"] = {}            # the package now carries the whole look: nothing "first time only"
cfg["updatesOnce"] = []
cfg["_synced"] = "visual settings copied from the Mac by sync-settings-from-mac.py"
# the Launchpad apps: the folder Vivaldi uses as the Bookmark Bar, as a seed
# that js/launchpad.js adds once to a fresh Vivaldi (only what is missing)
try:
    bms = json.load(open(os.path.join(user_data, "Default", "Bookmarks")))
    def find_bar(n):
        if n.get("type") == "folder" and (n.get("meta_info") or {}).get("Bookmarkbar") == "true": return n
        for c in n.get("children", []) or []:
            r = find_bar(c)
            if r: return r
        return None
    bar = None
    for r in bms.get("roots", {}).values():
        if isinstance(r, dict): bar = bar or find_bar(r)
    def seed(n):
        if n.get("type") == "url": return {"t": n.get("name", ""), "u": n.get("url", "")}
        return {"t": n.get("name", ""), "c": [seed(c) for c in n.get("children", []) or []]}
    items = [seed(c) for c in (bar or {}).get("children", []) or []]
    import hashlib
    stamp = hashlib.sha1(json.dumps(items, sort_keys=True).encode()).hexdigest()[:12]
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(mod)), "personal"), exist_ok=True)
    open(os.path.join(os.path.dirname(os.path.abspath(mod)), "personal", "launchpad-seed.js"), "w").write(
        "/* The Launchpad apps of the Mac this package was built on (Build Release).\n"
        "   js/launchpad.js adds them once to a fresh Vivaldi, only where missing. */\n"
        "window.vosLaunchpadSeed = " + json.dumps({"stamp": stamp, "title": (bar or {}).get("name", ""),
                     "speeddial": ((bar or {}).get("meta_info") or {}).get("Speeddial") == "true", "items": items}, ensure_ascii=False) + ";\n")
except Exception as e:
    print("launchpad seed: skipped (" + str(e) + ")")

# ---- personal data: out of the mod, into <root>/personal (never shipped) ----
personal = os.path.join(os.path.dirname(os.path.abspath(mod)), "personal")
os.makedirs(personal, exist_ok=True)
PERSONAL = ["vivaldi.panels.web", "vivaldi.chained_commands", "vivaldi.dashboard.widgets",
            "vivaldi.workspaces.list", "vivaldi.workspaces.link_routes"]
MINE = ("WEBPANEL_", "EXT_PANEL_")                 # web panels, and panels of your own extensions
def has_mine(v):
    if isinstance(v, str): return v.startswith(MINE)
    if isinstance(v, list): return any(has_mine(x) for x in v)
    if isinstance(v, dict): return str(v.get("id", "")).startswith(MINE) or any(has_mine(x) for x in v.values())
    return False
# The mod sets each setting by its own path, so a group that holds anything
# personal is split into its parts: the installer then never replaces the whole
# group (and never removes your web panels, workspaces, widgets...).
mine, generic = {}, {}
def split(k, v):
    if any(k == q or k.startswith(q + ".") for q in PERSONAL): mine[k] = v; return
    deep = any(q.startswith(k + ".") for q in PERSONAL)
    if isinstance(v, dict) and (deep or has_mine(v)):
        for sk, sv in v.items(): split(k + "." + sk, sv)
        return
    if has_mine(v): mine[k] = v; return                # e.g. a toolbar with your web panels: yours
    # a toolbar with Command Chain buttons: the chains are personal (not shipped), and a
    # toolbar naming a chain that does not exist breaks Vivaldi's tab bar - the public
    # toolbar leaves them out (the mod adds its own Bento chain itself), yours keeps them
    # (Bento OS's own buttons - COMMAND_vos... - stay in the public toolbar: the installers create those chains first)
    own_chain = lambda x: isinstance(x, str) and x.startswith("COMMAND_") and not x.startswith("COMMAND_vos")
    if k.startswith("vivaldi.toolbars.") and isinstance(v, list) and any(own_chain(x) for x in v):
        mine[k] = v
        generic[k] = [x for x in v if not own_chain(x)]
        return
    generic[k] = v
for k, v in out.items(): split(k, v)
out = generic
cfg["set"] = out
# Bento OS's tab bar buttons (Command Chains with fixed names): created by the installers before a toolbar names them
cfg["osChains"] = [{"category": "CATEGORY_COMMAND_CHAIN", "chain": [], "key": k, "label": l, "name": "COMMAND_" + k}
                   for k, l in [("vosbento", "OS · Bento"), ("vosmission", "OS · Desktops"), ("vostimer", "OS · Timer"),
                                ("vosdate", "OS · Date"), ("vosdark", "OS · Dark Mode")]]
json.dump({"_about": "Personal Vivaldi settings of this Mac (never in a release): applied over the mod's by the installers when this folder is next to mod/.",
           "set": mine}, open(os.path.join(personal, "personal-settings.json"), "w"), indent=2, ensure_ascii=False)
# the bookmarks seed: yours -> personal; the mod gets a neutral starter set
seed_mod = os.path.join(mod, "js", "launchpad-seed.js")
if os.path.exists(seed_mod) and "starter set" not in open(seed_mod).read():
    if os.path.exists(os.path.join(personal, "launchpad-seed.js")): os.remove(seed_mod)   # yours was just written there
    else: shutil.move(seed_mod, os.path.join(personal, "launchpad-seed.js"))
starter = [{"t": "YouTube", "u": "https://www.youtube.com/"}, {"t": "Gmail", "u": "https://mail.google.com/"},
           {"t": "Drive", "u": "https://drive.google.com/"}, {"t": "Maps", "u": "https://maps.google.com/"},
           {"t": "Wikipedia", "u": "https://www.wikipedia.org/"}, {"t": "Vivaldi", "u": "https://vivaldi.com/"}]
open(seed_mod, "w").write(
    "/* A neutral starter set of Launchpad apps (no personal data): js/launchpad.js adds\n"
    "   them once to a fresh Vivaldi, only where missing. Your own set is in personal/. */\n"
    "window.vosLaunchpadSeed = " + json.dumps({"stamp": "starter-1", "starter": True, "title": "Home", "speeddial": True, "items": starter}) + ";\n")
fp = os.path.join(mod, "settings", "built-on")
if os.path.exists(fp): shutil.move(fp, os.path.join(personal, "built-on"))

json.dump(cfg, open(cfg_path, "w"), indent=2, ensure_ascii=False)
open(cfg_path, "a").write("\n")
print("settings synced from this Mac: " + ", ".join(sorted(out)))
