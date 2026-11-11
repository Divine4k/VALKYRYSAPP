// Theme picker in Settings › Weergave, the cards right in the panel (colours of the app; the engine is js/boot-theme.js).
"use strict";
// ------------------------------------------------------------ theme (the colours of the app; the black band with the logo is never themed)
const TH = window.ValkTheme;
const themeName = (id) => tr("t" + id.charAt(0).toUpperCase() + id.slice(1));
const COLOR_KEYS = [["bg", "tcBg"], ["surface", "tcSurface"], ["ink", "tcInk"], ["accent", "tcAccent"]];
const pick4 = (sw) => ({ bg: sw.bg, surface: sw.surface, ink: sw.ink, accent: sw.accent });
let themeState = TH.load(), themeTouched = false, themeTimer;
const themeSaveDb = () => { clearTimeout(themeTimer); themeTimer = setTimeout(() => { if (state.db) { try { state.db.doc("settings/theme").set({ id: themeState.id, custom: themeState.custom || null }); } catch (e) {} } }, 400); };
function setTheme(next) { themeTouched = true; themeState = next; TH.save(next); TH.apply(next); renderThemeUi(); themeSaveDb(); }
function renderThemeUi() {
  $("#themeGrid").innerHTML = TH.IDS.map((id) => {
    const sw = TH.swatch(id, themeState.custom), on = id === themeState.id;
    const prev = id === "auto" ? `<span class="tprev auto"></span>`
      : `<span class="tprev" style="background:${sw.bg}"><i style="background:${sw.surface}"><u style="background:${sw.ink}"></u><u class="m" style="background:${sw.muted}"></u><b style="background:${sw.accent}"></b></i></span>`;
    return `<button type="button" role="radio" aria-checked="${on}" class="tcard" data-theme-id="${id}"${id === "auto" ? ` title="${esc(tr("tAutoHint"))}"` : ""}>${prev}<span class="tname">${esc(themeName(id))}</span></button>`;
  }).join("");
  const box = $("#customBox"); box.hidden = themeState.id !== "custom";
  const grid = $("#cGrid");
  if (!grid.children.length) {
    grid.innerHTML = COLOR_KEYS.map(([k, label]) => `<label class="cf" for="tc-${k}"><span data-i18n="${label}"></span><span class="cin"><input type="color" id="tc-${k}" data-k="${k}"><input type="text" id="tc-${k}-hex" data-kx="${k}" maxlength="7" spellcheck="false" autocomplete="off" inputmode="text"></span></label>`).join("");
    $("#tcBase").innerHTML = `<option value="">${esc(tr("tcBasePh"))}</option>` + ["light", "dark", "dim", "midnight", "paper", "forest", "contrast"].map((id) => `<option value="${id}">${esc(themeName(id))}</option>`).join("");
  }
  grid.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  COLOR_KEYS.forEach(([k, label]) => { const h = $(`#tc-${k}-hex`); h.setAttribute("aria-label", tr("tcHex", tr(label))); });
  const bs = $("#tcBase"); [...bs.options].forEach((o) => { o.textContent = o.value ? themeName(o.value) : tr("tcBasePh"); });
  if (!box.hidden && themeState.custom) {
    const c = themeState.custom;
    COLOR_KEYS.forEach(([k]) => { const col = $(`#tc-${k}`), hx = $(`#tc-${k}-hex`); if (document.activeElement !== col) col.value = c[k].toLowerCase(); if (document.activeElement !== hx) hx.value = c[k]; });
    const w = TH.info(c), msgs = [w.lowText && tr("twText"), w.lowAccent && tr("twAccent")].filter(Boolean);
    const we = $("#themeWarn"); we.hidden = !msgs.length; we.textContent = msgs.join(" ");
  }
}

$("#themeGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-theme-id]"); if (!b) return;
  const id = b.dataset.themeId;
  setTheme({ id, custom: id === "custom" && !themeState.custom ? pick4(TH.swatch(themeState.id, null)) : themeState.custom }); // a first custom theme starts from what you see now
});
$("#themeGrid").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  const ids = TH.IDS, i = ids.indexOf(themeState.id), n = (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + ids.length) % ids.length;
  e.preventDefault(); setTheme({ id: ids[n], custom: ids[n] === "custom" && !themeState.custom ? pick4(TH.swatch(themeState.id, null)) : themeState.custom });
  const nb = $(`#themeGrid [data-theme-id="${ids[n]}"]`); if (nb) nb.focus();
});
const setCustomColor = (k, v) => { const c = TH.hex(v); if (!c || !themeState.custom) return false; setTheme({ id: "custom", custom: Object.assign({}, themeState.custom, { [k]: c }) }); return true; };
$("#cGrid").addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.k) setCustomColor(t.dataset.k, t.value);
  else if (t.dataset.kx && /^#?[0-9a-f]{6}$/i.test(t.value.trim())) setCustomColor(t.dataset.kx, t.value);
});
$("#cGrid").addEventListener("change", (e) => { const k = e.target.dataset.kx; if (k && themeState.custom) e.target.value = themeState.custom[k]; }); // an unfinished code goes back to the real colour
$("#tcBase").addEventListener("change", (e) => { const id = e.target.value; e.target.value = ""; if (id && document.activeElement) document.activeElement.blur(); if (id) setTheme({ id: "custom", custom: pick4(TH.swatch(id, null)) }); });

