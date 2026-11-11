// An eye button in every password / PIN field: shows what was typed, a second click hides it again. Hidden again when its dialog closes.
"use strict";
const EYE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="e-on"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="e-off"><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19"/><path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a10.6 10.6 0 0 0 5.4-1.6"/><path d="M14.1 14.2a3 3 0 0 1-4.3-4.3"/><path d="M2 2l20 20"/></svg>';
function renderEyes() {
  document.querySelectorAll("input[data-eye]").forEach((inp) => { const b = inp.parentNode.querySelector(".pweye"), on = inp.type === "text"; b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", tr(on ? "pwHide" : "pwShow")); b.title = tr(on ? "pwHide" : "pwShow"); });
}
function addEyes(root) {
  (root || document).querySelectorAll('input[type="password"]:not([data-eye]):not(.lk-in)').forEach((inp) => {
    inp.dataset.eye = "1";
    const wrap = document.createElement("span"); wrap.className = "pwwrap"; inp.before(wrap); wrap.appendChild(inp);
    const b = document.createElement("button"); b.type = "button"; b.className = "ghost pweye"; b.innerHTML = EYE_SVG; wrap.appendChild(b);
    b.addEventListener("click", (e) => { e.preventDefault(); inp.type = inp.type === "password" ? "text" : "password"; renderEyes(); inp.focus(); });
    const dlg = inp.closest("dialog"); if (dlg) dlg.addEventListener("close", () => { inp.type = "password"; renderEyes(); });
  });
  renderEyes();
}
addEyes();
