/* Sidebar width, before the page is drawn: html.side-min = collapsed by the person (localStorage valkyrys-side, also settings/prefs.side);
   html.rail = drawn as the icon rail (collapsed, or forced between 560 and 899px; below 560px it is the bottom bar). */
window.ValkSide = (function () {
  var de = document.documentElement, wide = window.matchMedia("(min-width: 900px)"), mid = window.matchMedia("(min-width: 560px)"), min = false;
  try { min = localStorage.getItem("valkyrys-side") === "min"; } catch (e) {}
  function sync() { de.classList.toggle("side-min", min); de.classList.toggle("rail", mid.matches && (min || !wide.matches)); if (typeof window.ValkSideChanged === "function") window.ValkSideChanged(); }
  [wide, mid].forEach(function (m) { if (m.addEventListener) m.addEventListener("change", sync); });
  sync();
  return {
    collapsed: function () { return min; },
    forced: function () { return !wide.matches; },
    rail: function () { return de.classList.contains("rail"); },
    set: function (v) { v = !!v; if (v === min) return false; min = v; try { localStorage.setItem("valkyrys-side", v ? "min" : "full"); } catch (e) {} sync(); return true; }
  };
})();
