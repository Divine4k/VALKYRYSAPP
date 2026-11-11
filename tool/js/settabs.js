// The tabs inside Settings: Mijn gegevens, Mappen, Verbindingen, Weergave, Beveiliging, Updates. Each settings panel says its tab (data-stab).
// A tab whose panels are all hidden (no desktop app, no updates in a plain browser) is not shown. The open tab is remembered.
"use strict";
const STABS = ["me", "folders", "mail", "look", "pin", "upd"];
let stab = "me";
try { const v = localStorage.getItem("valkyrys-settab"); if (STABS.includes(v)) stab = v; } catch (e) {}
const stabPanels = (k) => [...document.querySelectorAll(`#setCol > [data-stab="${k}"]`)];
const stabShown = (k) => stabPanels(k).some((p) => !p.hidden);
function renderSetTabs() {
  const shown = STABS.filter(stabShown);
  if (shown.length && !shown.includes(stab)) stab = shown[0];
  document.querySelectorAll("#setTabs [data-stab]").forEach((b) => {
    const k = b.dataset.stab, on = k === stab;
    b.hidden = !shown.includes(k); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll("#setCol > [data-stab]").forEach((p) => p.classList.toggle("cur", p.dataset.stab === stab));
  $("#setCol").setAttribute("aria-labelledby", "stab-" + stab);
  $("#stabUpdDot").hidden = $("#updDot").hidden;
}
/** open one tab inside Settings */
function setStab(k) {
  if (!STABS.includes(k)) return;
  stab = k; try { localStorage.setItem("valkyrys-settab", k); } catch (e) {}
  renderSetTabs();
}
/** go to Settings at a given tab (from a button elsewhere in the app) */
function openSettings(k) { setTab("settings"); setStab(k); }
$("#setTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-stab]"); if (b) setStab(b.dataset.stab); });
$("#setTabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const T = STABS.filter(stabShown), cur = (e.target.closest("[data-stab]") || {}).dataset?.stab || stab, i = Math.max(0, T.indexOf(cur));
  const next = e.key === "Home" ? T[0] : e.key === "End" ? T[T.length - 1] : T[(i + (e.key === "ArrowLeft" ? -1 : 1) + T.length) % T.length];
  setStab(next); document.querySelector(`#setTabs [data-stab="${next}"]`).focus(); e.preventDefault();
});
// panels show and hide themselves (folders, PIN, updates, e-mail know only later whether they apply): keep the tabs in step
new MutationObserver(renderSetTabs).observe($("#setCol"), { subtree: true, attributes: true, attributeFilter: ["hidden"] });
new MutationObserver(renderSetTabs).observe($("#updDot"), { attributes: true, attributeFilter: ["hidden"] });
renderSetTabs();
