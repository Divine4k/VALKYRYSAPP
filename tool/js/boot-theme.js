/* Theme engine. Runs before the page is drawn. The black band with the Valkyrys logo and its yellow line are never themed. */
window.ValkTheme = (function () {
  var KEY = "valkyrys-theme";
  var IDS = ["auto", "light", "dark", "dim", "midnight", "paper", "forest", "contrast", "custom"];
  var SEM = {
    light: { ok: "#1D7A4B", okBg: "#E6F3EC", warn: "#8F5200", warnBg: "#FFF2D6", err: "#B3261E", errBg: "#FBE6E5", focus: "#1F5FD1", band: "#111111" },
    dark: { ok: "#67C892", okBg: "#12291C", warn: "#F2B347", warnBg: "#2E230E", err: "#F28B82", errBg: "#351816", focus: "#7AA7FF", band: "#000000" }
  };
  var BASE = {
    light: { bg: "#F1F2F4", surface: "#FFFFFF", ink: "#111214", muted: "#656972", accent: "#FEBD17" },
    dark: { bg: "#0D0E0F", surface: "#17181A", ink: "#F3F3F4", muted: "#9A9DA4", accent: "#FEBD17" }
  };
  var PRESETS = {
    dim: { scheme: "dark", bg: "#262624", surface: "#30302E", sunken: "#2B2A28", ink: "#FAF9F5", text: "#E5E3DC", muted: "#B0ADA3", line: "#45443F", accent: "#D97757", accentInk: "#141413" }, // warm, softer dark (like claude.ai)
    midnight: { scheme: "dark", bg: "#0A0F1E", surface: "#121A30", sunken: "#0E1527", ink: "#EEF2FF", text: "#CBD3EA", muted: "#93A0C2", line: "#25314F", accent: "#6C9CFF", accentInk: "#0A0F1E" },
    paper: { scheme: "light", bg: "#F3EEE3", surface: "#FFFCF6", sunken: "#F9F5EC", ink: "#1E1A14", text: "#3B3429", muted: "#6F6556", line: "#E2D8C6", accent: "#C4531B", accentInk: "#FFFFFF" },
    forest: { scheme: "dark", bg: "#0C1410", surface: "#131E18", sunken: "#101A14", ink: "#E8F3EC", text: "#C5D8CC", muted: "#8DA698", line: "#223329", accent: "#4FD18B", accentInk: "#08130D" },
    contrast: { scheme: "dark", bg: "#000000", surface: "#0B0B0B", sunken: "#141414", ink: "#FFFFFF", text: "#FFFFFF", muted: "#D0D0D0", line: "#8A8A8A", accent: "#FFD500", accentInk: "#000000" }
  };
  var VARS = { bg: "--bg", surface: "--surface", sunken: "--sunken", ink: "--ink", text: "--text", muted: "--muted", line: "--line", accent: "--accent", accentInk: "--accent-ink", focus: "--focus", ok: "--ok", okBg: "--ok-bg", warn: "--warn", warnBg: "--warn-bg", err: "--err", errBg: "--err-bg", band: "--band" };

  function hex(h) { var m = /^#?([0-9a-f]{6})$/i.exec(String(h == null ? "" : h).trim()); return m ? "#" + m[1].toUpperCase() : null; }
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(c) { return "#" + c.map(function (v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? "0" + s : s; }).join("").toUpperCase(); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return toHex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
  function lum(h) { var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  /** your own theme: four colours in, the rest (soft text, lines, state colours) worked out so it stays readable */
  function derive(c) {
    var bg = c.bg, surface = c.surface, ink = c.ink, accent = c.accent;
    var scheme = lum(ink) > lum(bg) ? "dark" : "light", sem = SEM[scheme];
    var muted = ink;
    for (var t = 0.4; t <= 1.0001; t += 0.05) { var m = mix(bg, ink, t); if (contrast(m, bg) >= 4.5 && contrast(m, surface) >= 4.5) { muted = m; break; } }
    var focus = contrast(sem.focus, bg) >= 3 ? sem.focus : ink;
    return { scheme: scheme, bg: bg, surface: surface, sunken: mix(surface, ink, 0.03), ink: ink, text: mix(ink, surface, 0.12), muted: muted, line: mix(surface, ink, 0.13),
      accent: accent, accentInk: contrast("#111111", accent) >= contrast("#FFFFFF", accent) ? "#111111" : "#FFFFFF", focus: focus };
  }
  /** every colour of a theme, or null for the ones the stylesheet handles itself (automatic, light, dark) */
  function tokens(id, custom) {
    var t = id === "custom" ? derive(custom || BASE.light) : PRESETS[id];
    if (!t) return null;
    var sem = SEM[t.scheme], out = { scheme: t.scheme };
    Object.keys(VARS).forEach(function (k) { out[k] = t[k] != null ? t[k] : sem[k]; });
    return out;
  }
  function systemScheme() { try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { return "light"; } }
  /** the few colours shown in a theme's preview */
  function swatch(id, custom) {
    if (id === "light" || id === "dark") return BASE[id];
    if (id === "auto") return BASE[systemScheme()];
    var t = tokens(id, custom);
    return { bg: t.bg, surface: t.surface, ink: t.ink, muted: t.muted, accent: t.accent };
  }
  function sanitize(s) {
    if (!s || typeof s !== "object" || IDS.indexOf(s.id) < 0) return null;
    var custom = null;
    if (s.custom && typeof s.custom === "object") {
      var c = { bg: hex(s.custom.bg), surface: hex(s.custom.surface), ink: hex(s.custom.ink), accent: hex(s.custom.accent) };
      if (c.bg && c.surface && c.ink && c.accent) custom = c;
    }
    return { id: s.id === "custom" && !custom ? "auto" : s.id, custom: custom };
  }
  function load() { try { return sanitize(JSON.parse(localStorage.getItem(KEY) || "null")) || { id: "auto", custom: null }; } catch (e) { return { id: "auto", custom: null }; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function apply(s) {
    var root = document.documentElement;
    Object.keys(VARS).forEach(function (k) { root.style.removeProperty(VARS[k]); });
    root.style.removeProperty("color-scheme");
    var t = tokens(s.id, s.custom);
    if (t) {
      root.setAttribute("data-theme", t.scheme);
      Object.keys(VARS).forEach(function (k) { root.style.setProperty(VARS[k], t[k]); });
      root.style.setProperty("color-scheme", t.scheme);
    } else if (s.id === "light" || s.id === "dark") root.setAttribute("data-theme", s.id);
    else root.removeAttribute("data-theme");
  }
  /** warnings for a custom theme: text that is hard to read, an accent that disappears */
  function info(c) {
    var text = Math.min(contrast(c.ink, c.bg), contrast(c.ink, c.surface)), accent = Math.min(contrast(c.accent, c.bg), contrast(c.accent, c.surface));
    return { text: text, accent: accent, lowText: text < 4.5, lowAccent: accent < 1.4 };
  }
  var state = load(); apply(state);
  return { IDS: IDS, BASE: BASE, load: load, save: save, apply: apply, sanitize: sanitize, tokens: tokens, swatch: swatch, info: info, contrast: contrast, hex: hex };
})();
