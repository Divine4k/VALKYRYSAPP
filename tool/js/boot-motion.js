/* Animations on or off, before the page is drawn: html.mo = on (default), html.no-motion = off (localStorage valkyrys-motion, also
   settings/prefs.motion). The motion itself is in css/motion.css; ValkMotion.play(el) restarts an entrance animation on an element. */
window.ValkMotion = (function () {
  var de = document.documentElement, on = true;
  try { on = localStorage.getItem("valkyrys-motion") !== "off"; } catch (e) {}
  function sync() { de.classList.toggle("mo", on); de.classList.toggle("no-motion", !on); }
  sync();
  return {
    on: function () { return on; },
    set: function (v) { v = !!v; if (v === on) return false; on = v; try { localStorage.setItem("valkyrys-motion", v ? "on" : "off"); } catch (e) {} sync(); return true; },
    /** play a short entrance (class cls, default "mo-in") on el; the class goes away when it has played, so nothing stays transformed */
    play: function (el, cls) {
      if (!on || !el) return; cls = cls || "mo-in";
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      el.addEventListener("animationend", function done(e) { if (e.target !== el) return; el.classList.remove(cls); el.removeEventListener("animationend", done); });
    }
  };
})();
