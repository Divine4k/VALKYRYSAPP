/* The window keeps the language, theme, sidebar width and animations in its own storage, and that storage belongs to the app's address.
   When it is empty although settings were saved before (the app had to start on another port because its usual one was taken, or the window's
   data was cleared), it is filled here from the saved settings (/api/prefs), before anything is drawn: the language is not asked again and no
   other theme flashes by. Runs once per storage (valkyrys-seeded). */
(function () {
  try {
    if (localStorage.getItem("valkyrys-seeded")) return;
    localStorage.setItem("valkyrys-seeded", "1");
    if (localStorage.getItem("valkyrys-lang") !== null || localStorage.getItem("valkyrys-theme") !== null) return; // this storage is in use already
    var x = new XMLHttpRequest(); x.open("GET", "api/prefs", false); x.send();
    if (x.status !== 200) return;
    var p = JSON.parse(x.responseText) || {};
    if (p.lang === "nl" || p.lang === "en" || p.lang === "pl") { localStorage.setItem("valkyrys-lang", p.lang); if (p.langChosen) localStorage.setItem("valkyrys-lang-chosen", "1"); }
    if (p.side === "min" || p.side === "full") localStorage.setItem("valkyrys-side", p.side);
    if (p.motion === "on" || p.motion === "off") localStorage.setItem("valkyrys-motion", p.motion);
    if (p.theme && typeof p.theme === "object" && p.theme.id) localStorage.setItem("valkyrys-theme", JSON.stringify({ id: p.theme.id, custom: p.theme.custom || null }));
  } catch (e) {}
})();
