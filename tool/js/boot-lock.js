/* PIN lock screen (desktop app only). Runs before the page is drawn: with a PIN set, nothing of the app is shown or loaded until it is entered. */
(function () {
  var T = {
    nl: { appTitle: "App", setupTitle: "Kies een pincode", setupText: "4 tot 8 cijfers. Je hebt hem nodig om de app te openen.", repTitle: "Herhaal je pincode", repText: "Typ dezelfde pincode nog een keer.", back: "Terug", pinLabel: "Pincode",
      askTitle: "Wil je de app beveiligen met een pincode?", askText: "Met een pincode kan niemand anders de app op deze computer openen. Je kunt dit later altijd aanpassen bij Instellingen.", askYes: "Pincode instellen", askNo: "Nee, zonder pincode",
      loginTitle: "Voer je pincode in", loginText: "Valkyrys app is vergrendeld.", forgot: "Pincode vergeten?", forgotText: "Sluit de app, open de map %APPDATA%\\Valkyrys app en verwijder het bestand pin.json. Daarna start de app zonder pincode. Je facturen blijven bewaard.",
      eFormat: "Gebruik 4 tot 8 cijfers.", eMismatch: "De twee pincodes zijn niet hetzelfde.", eWrong: "Onjuiste pincode.", eLeft: "Onjuiste pincode. Nog {0} pogingen voordat je even moet wachten.", eLeft1: "Onjuiste pincode. Nog 1 poging voordat je even moet wachten.",
      eWait: "Te veel pogingen. Probeer het over {0} seconden opnieuw.", eGeneric: "Dat is niet gelukt. Probeer het opnieuw.", del: "Laatste cijfer wissen", go: "Bevestigen", show: "Pincode tonen", hide: "Pincode verbergen" },
    en: { appTitle: "App", setupTitle: "Choose a PIN", setupText: "4 to 8 digits. You need it to open the app.", repTitle: "Repeat your PIN", repText: "Type the same PIN once more.", back: "Back", pinLabel: "PIN",
      askTitle: "Do you want to protect the app with a PIN?", askText: "With a PIN, nobody else can open the app on this computer. You can always change this later in Settings.", askYes: "Set up a PIN", askNo: "No, without a PIN",
      loginTitle: "Enter your PIN", loginText: "Valkyrys app is locked.", forgot: "Forgot your PIN?", forgotText: "Close the app, open the folder %APPDATA%\\Valkyrys app and delete the file pin.json. The app then starts without a PIN. Your invoices are kept.",
      eFormat: "Use 4 to 8 digits.", eMismatch: "The two PINs are not the same.", eWrong: "Wrong PIN.", eLeft: "Wrong PIN. {0} tries left before you have to wait a moment.", eLeft1: "Wrong PIN. 1 try left before you have to wait a moment.",
      eWait: "Too many tries. Try again in {0} seconds.", eGeneric: "That did not work. Please try again.", del: "Delete last digit", go: "Confirm", show: "Show PIN", hide: "Hide PIN" },
    pl: { appTitle: "App", setupTitle: "Wybierz kod PIN", setupText: "Od 4 do 8 cyfr. Będzie potrzebny do otwarcia aplikacji.", repTitle: "Powtórz kod PIN", repText: "Wpisz ten sam kod PIN jeszcze raz.", back: "Wstecz", pinLabel: "Kod PIN",
      askTitle: "Czy chcesz zabezpieczyć aplikację kodem PIN?", askText: "Z kodem PIN nikt inny nie otworzy aplikacji na tym komputerze. Zawsze możesz to później zmienić w Ustawieniach.", askYes: "Ustaw kod PIN", askNo: "Nie, bez kodu PIN",
      loginTitle: "Wpisz kod PIN", loginText: "Valkyrys app jest zablokowana.", forgot: "Nie pamiętasz kodu PIN?", forgotText: "Zamknij aplikację, otwórz folder %APPDATA%\\Valkyrys app i usuń plik pin.json. Aplikacja uruchomi się wtedy bez kodu PIN. Twoje faktury zostaną zachowane.",
      eFormat: "Użyj od 4 do 8 cyfr.", eMismatch: "Oba kody PIN nie są takie same.", eWrong: "Nieprawidłowy kod PIN.", eLeft: "Nieprawidłowy kod PIN. Pozostało prób: {0}, potem trzeba chwilę poczekać.", eLeft1: "Nieprawidłowy kod PIN. Pozostała 1 próba, potem trzeba chwilę poczekać.",
      eWait: "Zbyt wiele prób. Spróbuj ponownie za {0} s.", eGeneric: "Nie udało się. Spróbuj ponownie.", del: "Usuń ostatnią cyfrę", go: "Potwierdź", show: "Pokaż PIN", hide: "Ukryj PIN" }
  };
  function lang() { var l = window.ValkLockLang; if (!l) { try { l = localStorage.getItem("valkyrys-lang"); } catch (e) {} } return T[l] ? l : "nl"; }
  function t(k) { var s = T[lang()][k]; for (var i = 1; i < arguments.length; i++) s = s.replace("{" + (i - 1) + "}", arguments[i]); return s; }
  window.ValkLockText = t;
  // ---- first start: choose the language before anything else. Remembered in localStorage (valkyrys-lang + valkyrys-lang-chosen);
  // the app picks up window.ValkLangPicked after unlocking and saves it in settings/prefs (lang, langChosen), where it wins over what is there.
  var LANG_KEYS = ["nl", "en", "pl"], LANG_NAMES = { nl: "Nederlands", en: "English", pl: "Polski" };
  var LANG_TITLE = '<span lang="nl">Kies je taal</span><i> · </i><span lang="en">Choose your language</span><i> · </i><span lang="pl">Wybierz język</span>';
  function langChosen() { try { return !!(localStorage.getItem("valkyrys-lang-chosen") || T[localStorage.getItem("valkyrys-lang")]); } catch (e) { return false; } }
  function langGuess() { var l = window.ValkLockLang; try { l = l || localStorage.getItem("valkyrys-lang"); } catch (e) {} if (T[l]) return l; var n = String(navigator.language || "").toLowerCase().slice(0, 2); return n === "pl" ? "pl" : n === "nl" ? "nl" : "en"; }
  /** the three language buttons: arrow keys move, Enter/Space/click chooses; done(lang) is called once */
  function langButtons(done) {
    var box = document.createElement("div"), sel = langGuess(), over = false; box.className = "lk-langs"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Kies je taal · Choose your language · Wybierz język");
    box.innerHTML = LANG_KEYS.map(function (k) { return '<button type="button" data-lang="' + k + '" lang="' + k + '"><b>' + LANG_NAMES[k] + "</b><small>" + k.toUpperCase() + "</small></button>"; }).join("");
    var bs = box.querySelectorAll("button");
    function mark(k) { sel = k; for (var i = 0; i < bs.length; i++) { var on = bs[i].dataset.lang === k; bs[i].classList.toggle("primary", on); bs[i].setAttribute("aria-pressed", String(on)); } }
    function pick(k) { if (over) return; over = true; window.ValkLockLang = window.ValkLangPicked = k; document.documentElement.lang = k; try { localStorage.setItem("valkyrys-lang", k); localStorage.setItem("valkyrys-lang-chosen", "1"); } catch (e) {} done(k); }
    box.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) pick(b.dataset.lang); });
    box.addEventListener("focusin", function (e) { if (e.target.dataset.lang) mark(e.target.dataset.lang); });
    box.addEventListener("keydown", function (e) {
      var i = LANG_KEYS.indexOf(sel);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") i = (i + 1) % 3; else if (e.key === "ArrowUp" || e.key === "ArrowLeft") i = (i + 2) % 3;
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return pick(sel); } else return;
      e.preventDefault(); mark(LANG_KEYS[i]); box.querySelector('[data-lang="' + sel + '"]').focus();
    });
    mark(sel); box.focusSel = function () { box.querySelector('[data-lang="' + sel + '"]').focus(); };
    return box;
  }
  window.ValkLangChosen = langChosen;
  /** the same step on its own screen (first start without the lock screen, e.g. a plain browser); resolves with the language */
  window.ValkLangStep = function () {
    return new Promise(function (res) {
      var scr = document.createElement("div"); scr.id = "langScreen"; scr.setAttribute("role", "dialog"); scr.setAttribute("aria-modal", "true"); scr.setAttribute("aria-labelledby", "lgTitle");
      scr.innerHTML = '<div class="lk-main"><div class="lk-card"><header class="band"><img src="img/logo-white.png" alt="Valkyrys"><span>App</span></header><div class="lk-body"><h2 id="lgTitle" class="lk-ttl">' + LANG_TITLE + "</h2></div></div></div>";
      var box = langButtons(function (k) { scr.remove(); document.body.inert = false; res(k); });
      scr.querySelector(".lk-body").appendChild(box); document.documentElement.appendChild(scr); document.body.inert = true; box.focusSel();
    });
  };
  var L = window.valkyrysLock, st = L && L.state;
  var mode = !st ? null : st.has && !st.unlocked ? "login" : !st.has && !st.skipped ? "setup" : null;
  if (!mode) { window.__valkUnlock = Promise.resolve(); return; }
  var finish; window.__valkUnlock = new Promise(function (r) { finish = r; });

  var root = document.createElement("div"); root.id = "lockScreen"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-labelledby", "lkTitle");
  // One hidden field (#lkIn) holds the digits; the dots show how many are typed. With a known PIN length (st.len) the PIN is
  // checked as soon as the last digit is in, so no Enter is needed. Setup: "ask" (a PIN or not: never forced) -> "pick" (4-8 digits, then ✓/Enter) -> "rep" (checked when the length matches).
  // A fresh install (no PIN decision yet) whose language was never chosen starts with "lang" (the three languages), then "ask".
  var setup = mode === "setup", step = setup ? (langChosen() ? "ask" : "lang") : "login", first = "", busy = false, timer = null;
  var LK_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="e-on"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="e-off"><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19"/><path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a10.6 10.6 0 0 0 5.4-1.6"/><path d="M14.1 14.2a3 3 0 0 1-4.3-4.3"/><path d="M2 2l20 20"/></svg>';
  var show = false; // the eye beside the dots: digits instead of dots
  var keys = ""; for (var d = 1; d <= 9; d++) keys += '<button type="button" tabindex="-1" data-d="' + d + '">' + d + "</button>";
  keys += '<button type="button" tabindex="-1" data-act="del" class="lk-fn" aria-label="' + t("del") + '">⌫</button><button type="button" tabindex="-1" data-d="0">0</button><button type="button" tabindex="-1" data-act="go" class="primary" aria-label="' + t("go") + '">✓</button>';
  root.innerHTML = '<div class="lk-main"><form class="lk-card" id="lkForm" autocomplete="off" novalidate>' +
    '<header class="band"><img src="img/logo-white.png" alt="Valkyrys"><span>' + t("appTitle") + "</span></header>" +
    '<div class="lk-body"><h2 id="lkTitle"></h2><p class="small lk-sub" id="lkSub"></p>' +
    '<input id="lkIn" class="lk-in" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" spellcheck="false" aria-labelledby="lkTitle" aria-describedby="lkErr">' +
    (setup ? '<div class="lk-ask"><button type="button" class="primary" id="lkAskYes">' + t("askYes") + '</button><button type="button" id="lkAskNo">' + t("askNo") + "</button></div>" : "") +
    '<div class="lk-dotrow"><div class="lk-dots" id="lkDots" aria-hidden="true"></div><button type="button" class="ghost lk-eye" id="lkEye" aria-pressed="false">' + LK_EYE + '</button></div><p class="lk-err" id="lkErr" role="alert"></p><div class="lk-pad">' + keys + "</div>" +
    '<div class="lk-actions">' + (setup ? '<button type="button" class="ghost" id="lkBack">' + t("back") + "</button>" : '<button type="button" class="ghost" id="lkForgotBtn" aria-expanded="false">' + t("forgot") + '</button><p class="small" id="lkForgot" hidden>' + t("forgotText") + "</p>") + "</div></div></form></div>";
  document.documentElement.appendChild(root);
  document.body.inert = true;
  var $ = function (id) { return document.getElementById(id); }, form = $("lkForm"), inp = $("lkIn"), dots = $("lkDots"), err = $("lkErr"), goBtn = root.querySelector('[data-act="go"]'), pad = root.querySelectorAll(".lk-pad button");
  var langBox = step === "lang" ? langButtons(function () { // texts made before the choice follow it, then the PIN question
    $("lkAskYes").textContent = t("askYes"); $("lkAskNo").textContent = t("askNo"); $("lkBack").textContent = t("back");
    root.querySelector('[data-act="del"]').setAttribute("aria-label", t("del")); goBtn.setAttribute("aria-label", t("go"));
    setStep("ask"); $("lkAskYes").focus();
  }) : null;
  if (langBox) dots.parentNode.parentNode.insertBefore(langBox, dots.parentNode); // before the row with the dots and the eye
  function need() { return step === "login" ? (st.len || 0) : step === "rep" ? first.length : 0; } // 0 = length not known: up to 8, confirm with ✓
  function draw() {
    var n = need(), v = inp.value.length, h = "";
    for (var i = 0; i < (n || 8); i++) h += show && i < v ? '<i class="on dig">' + inp.value.charAt(i) + "</i>" : '<i class="' + (i < v ? "on" : "") + (!n && i >= 4 ? " opt" : "") + '"></i>';
    var eye = $("lkEye"); eye.setAttribute("aria-pressed", String(show)); eye.setAttribute("aria-label", t(show ? "hide" : "show")); eye.title = t(show ? "hide" : "show");
    dots.innerHTML = h; dots.classList.remove("bad");
    goBtn.classList.toggle("lk-hide", !!n); goBtn.disabled = inp.disabled || v < 4;
  }
  function setStep(s) {
    step = s; inp.value = ""; say(""); root.classList.toggle("lk-asking", s === "ask"); root.classList.toggle("lk-langstep", s === "lang"); $("lkTitle").classList.toggle("lk-ttl", s === "lang");
    if (s === "lang") { $("lkTitle").innerHTML = LANG_TITLE; $("lkSub").textContent = ""; return draw(); }
    $("lkTitle").textContent = t(s === "ask" ? "askTitle" : s === "login" ? "loginTitle" : s === "pick" ? "setupTitle" : "repTitle");
    $("lkSub").textContent = t(s === "ask" ? "askText" : s === "login" ? "loginText" : s === "pick" ? "setupText" : "repText");
    draw();
  }
  function unlock() { clearInterval(timer); root.remove(); document.body.inert = false; finish(); }
  function say(msg) { err.textContent = msg || ""; }
  function focusIn() { if (step === "lang") return langBox.focusSel(); if (step !== "ask" && !inp.disabled && document.activeElement !== inp) inp.focus(); }
  function enable(on) { inp.disabled = !on; for (var i = 0; i < pad.length; i++) pad[i].disabled = !on; draw(); }
  function lockout(ms) { // too many wrong tries: count down, then allow typing again
    clearInterval(timer); var end = Date.now() + ms;
    function tick() { var s = Math.ceil((end - Date.now()) / 1000); if (s <= 0) { clearInterval(timer); enable(true); say(""); inp.focus(); return; } say(t("eWait", s)); }
    enable(false); tick(); timer = setInterval(tick, 500);
  }
  function wrong(msg) {
    say(msg); inp.value = ""; draw(); dots.classList.add("bad");
    dots.classList.remove("lk-shake"); void dots.offsetWidth; dots.classList.add("lk-shake"); focusIn();
  }
  function done() { busy = false; inp.readOnly = false; }
  function check() {
    var pin = inp.value;
    if (!/^\d{4,8}$/.test(pin)) { done(); return wrong(t("eFormat")); }
    if (step === "pick") { done(); first = pin; say(""); setStep("rep"); return focusIn(); }
    if (step === "rep" && pin !== first) { done(); first = ""; setStep("pick"); return wrong(t("eMismatch")); }
    (setup ? L.setup(first) : L.verify(pin)).then(function (r) {
      done();
      if (r && r.ok) return unlock();
      if (setup) { first = ""; setStep("pick"); return wrong(t(r && r.error === "format" ? "eFormat" : "eGeneric")); }
      if (r && r.wait) { wrong(""); return lockout(r.wait); }
      if (r && r.left != null && r.left <= 2) return wrong(r.left === 1 ? t("eLeft1") : t("eLeft", r.left)); // warn only when the wait is near
      wrong(t("eWrong"));
    }, function () { done(); if (setup) { first = ""; setStep("pick"); } wrong(t("eGeneric")); });
  }
  function submit(delay) { // short delay so the last dot is seen filled
    if (busy || inp.disabled) return;
    busy = true; inp.readOnly = true; setTimeout(check, delay || 0);
  }
  function changed() {
    var max = need() || 8; inp.value = inp.value.replace(/\D/g, "").slice(0, max);
    if (inp.value) say(""); draw();
    if (need() && inp.value.length === need()) submit(120);
  }
  function key(d) { if (busy || inp.disabled) return; if (inp.value.length < (need() || 8)) { inp.value += d; changed(); } }
  function back() {
    if (busy || inp.disabled) return;
    if (!inp.value && step === "rep") { first = ""; setStep("pick"); return; } // ⌫ on an empty second step: choose again
    inp.value = inp.value.slice(0, -1); draw();
  }
  function flash(sel) { var b = root.querySelector(".lk-pad " + sel); if (!b) return; b.classList.add("hit"); setTimeout(function () { b.classList.remove("hit"); }, 120); }
  inp.addEventListener("input", function () { if (busy) return; changed(); });
  $("lkEye").addEventListener("click", function () { show = !show; draw(); focusIn(); }); // see the digits typed (or dots again)
  root.addEventListener("keydown", function (e) { // physical keyboard and numpad, wherever the focus is on this screen
    if (e.ctrlKey || e.altKey || e.metaKey || step === "ask" || step === "lang") return; // the question and the languages: their buttons work as usual
    var dg = /^[0-9]$/.test(e.key) ? e.key : (/^Numpad([0-9])$/.exec(e.code || "") || [])[1]; // numpad digits also with Num Lock off
    if (dg) { e.preventDefault(); flash('[data-d="' + dg + '"]'); key(dg); focusIn(); }
    else if (e.key === "Backspace") { e.preventDefault(); flash('[data-act="del"]'); back(); focusIn(); }
    else if (e.key === "Enter" && !(e.target.closest && e.target.closest(".lk-actions"))) { e.preventDefault(); if (!need() && inp.value) { flash('[data-act="go"]'); submit(); } } // known length: it is checked by itself
  });
  root.querySelector(".lk-pad").addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the focus in the field
  root.querySelector(".lk-pad").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.d) key(b.dataset.d); else if (b.dataset.act === "del") back(); else if (b.dataset.act === "go") submit();
    focusIn();
  });
  root.addEventListener("click", function (e) { if (!e.target.closest("button, a, p")) focusIn(); });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  window.addEventListener("focus", function () { if (root.isConnected) focusIn(); });
  if (setup) {
    $("lkAskYes").addEventListener("click", function () { setStep("pick"); inp.focus(); });
    $("lkAskNo").addEventListener("click", function () { L.skip().then(unlock, unlock); }); // remembered (pin.json "skipped"); a PIN can be set later in Settings
    $("lkBack").addEventListener("click", function () { first = ""; setStep("ask"); $("lkAskYes").focus(); });
  } else $("lkForgotBtn").addEventListener("click", function () { var f = $("lkForgot"); f.hidden = !f.hidden; this.setAttribute("aria-expanded", String(!f.hidden)); });
  setStep(step); if (step === "lang") langBox.focusSel(); else if (setup) $("lkAskYes").focus(); else inp.focus();
  if (!setup && st.wait > 0) lockout(st.wait);
})();
