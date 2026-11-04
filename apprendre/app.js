// =============================================================================
// Apprendre la LSQ — moteur de lecons (vanilla JS, pas de framework)
// Donnees : window.APPRENDRE_VOCAB_UNITS / window.APPRENDRE_GRAMMAR_UNITS
// (voir curriculum-data.js, genere a partir des vraies donnees Sensorielle)
// =============================================================================

(function () {
  "use strict";

  var VOCAB = window.APPRENDRE_VOCAB_UNITS || [];
  var GRAMMAR = window.APPRENDRE_GRAMMAR_UNITS || [];
  var STORE_KEY = "sensorielle_apprendre_v2";
  var VIDEO_BASE = ".."; // /media/signs/xxx.mp4 est absolu depuis la racine du site

  // --------------------------------------------------------------- utilitaires
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function videoUrl(path) { return VIDEO_BASE + path; }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  // --------------------------------------------------------------- icones SVG
  function svg(inner, vb) {
    return '<svg class="icon" viewBox="' + (vb || "0 0 24 24") + '" xmlns="http://www.w3.org/2000/svg">' + inner + "</svg>";
  }
  var ICON = {
    flame: svg('<path d="M12 2c1.2 3.1-2.6 4.3-2.6 8a2.6 2.6 0 0 0 5.2 0c0-.9-.4-1.7-.9-2.5 2 1.1 3.8 3.8 3.8 6.8a6 6 0 0 1-12 0c0-5.3 3.2-7.6 6.5-12.3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
    bolt: svg('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/>'),
    heart: svg('<path d="M12 20.5s-7-4.3-9.4-8.8C.9 8.1 2.7 4.8 6.1 4.8c1.9 0 3.3 1 4.2 2.4.9-1.4 2.3-2.4 4.2-2.4 3.4 0 5.2 3.3 3.5 6.9C19 16.2 12 20.5 12 20.5z" fill="currentColor"/>'),
    heartOutline: svg('<path d="M12 20.5s-7-4.3-9.4-8.8C.9 8.1 2.7 4.8 6.1 4.8c1.9 0 3.3 1 4.2 2.4.9-1.4 2.3-2.4 4.2-2.4 3.4 0 5.2 3.3 3.5 6.9C19 16.2 12 20.5 12 20.5z" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    check: svg('<path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
    cross: svg('<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
    star: svg('<path d="M12 2.5l2.8 6 6.6.7-5 4.4 1.5 6.5L12 16.6l-5.9 3.5 1.5-6.5-5-4.4 6.6-.7z" fill="currentColor"/>'),
    starOutline: svg('<path d="M12 2.5l2.8 6 6.6.7-5 4.4 1.5 6.5L12 16.6l-5.9 3.5 1.5-6.5-5-4.4 6.6-.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
    replay: svg('<path d="M3.5 11a8.5 8.5 0 1 1 2.5 6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M3 5.2V11h5.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>'),
    chevron: svg('<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>'),
    compass: svg('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 9l-2 6-4-2 2-6z" fill="currentColor"/>'),
    book: svg('<path d="M4 5.5A2 2 0 0 1 6 4h6v15H6a2 2 0 0 0-2 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 5.5A2 2 0 0 0 18 4h-6v15h6a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
    cap: svg('<path d="M12 4 2 9l10 5 10-5z" fill="currentColor"/><path d="M6 11.5V17c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>')
  };

  // ------------------------------------------------------------------ son fx
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var actx = null;
  function getCtx() {
    if (!actx && AudioCtx) actx = new AudioCtx();
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, start, dur, type, gainPeak, detune) {
    var ctx = getCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    var t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.18, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function sweep(f0, f1, start, dur, type, gainPeak) {
    var ctx = getCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    var t0 = ctx.currentTime + start;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  function noiseBurst(start, dur, gainPeak, filterFreq, filterType) {
    var ctx = getCtx();
    if (!ctx) return;
    var bufSize = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = filterType || "bandpass";
    filt.frequency.value = filterFreq || 2000;
    var gain = ctx.createGain();
    var t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.15, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  var Sound = {
    // Deux notes claires, chaudes (sinus), qui montent -- propre, pas criard.
    correct: function () {
      tone(659.25, 0, 0.16, "sine", 0.13);
      tone(987.77, 0.06, 0.24, "sine", 0.12);
    },
    // Un seul "thud" bas et court -- net, pas agressif.
    incorrect: function () {
      tone(164.81, 0, 0.16, "sine", 0.14);
      tone(130.81, 0.03, 0.14, "sine", 0.08);
    },
    click: function () { tone(740, 0, 0.035, "sine", 0.035); },
    // Petite cadence a 4 notes, propre.
    lessonComplete: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, i * 0.1, 0.22, "sine", 0.12); });
    },
    heartLost: function () {
      tone(196, 0, 0.17, "sine", 0.13);
      tone(146.83, 0.04, 0.16, "sine", 0.08);
    },
    // Cadence un peu plus longue pour la fin de lecon.
    unitDone: function () {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) { tone(f, i * 0.09, 0.3, "sine", 0.13); });
    }
  };

  // --------------------------------------------------------------- compte (Supabase)
  var SUPABASE_URL = "https://frinlluqjbwgctkzqoea.supabase.co";
  var SUPABASE_KEY = "sb_publishable_HQ1zoBcHrmetRRIopwKxgA_t4DAaNJZ";
  var sb = null;
  try {
    if (window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
  } catch (e) {}
  var currentUser = null;
  var gateMode = "signin"; // ou "signup"
  var remoteLoaded = false;
  var remoteSaveTimer = null;

  // --------------------------------------------------------------- stockage
  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    var s = null;
    if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
    if (!s) s = {};
    if (typeof s.xp !== "number") s.xp = 0;
    if (!s.streak) s.streak = { count: 0, last: null };
    if (!s.progress) s.progress = {};
    return s;
  }
  var state = loadState();
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    scheduleRemoteSave();
  }

  // ------------------------------------------------------- sync compte distant
  function scheduleRemoteSave() {
    if (!sb || !currentUser) return;
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(saveRemoteProgress, 1200);
  }
  function saveRemoteProgress() {
    if (!sb || !currentUser) return;
    sb.from("apprendre_progress").upsert({
      user_id: currentUser.id,
      xp: state.xp,
      streak: state.streak,
      progress: state.progress,
      updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res && res.error) { /* table pas encore créée ou réseau absent : on reste en local */ }
    }).catch(function () {});
  }
  function loadRemoteProgress(cb) {
    if (!sb || !currentUser) { cb && cb(); return; }
    sb.from("apprendre_progress").select("xp,streak,progress").eq("user_id", currentUser.id).maybeSingle()
      .then(function (res) {
        if (res && res.data) {
          var r = res.data;
          state.xp = Math.max(state.xp, typeof r.xp === "number" ? r.xp : 0);
          if (r.streak && typeof r.streak === "object") {
            var localLast = state.streak.last, remoteLast = r.streak.last;
            if (!localLast || (remoteLast && remoteLast >= localLast)) state.streak = r.streak;
          }
          if (r.progress && typeof r.progress === "object") {
            var merged = state.progress || {};
            Object.keys(r.progress).forEach(function (id) {
              var remoteP = r.progress[id] || {}, localP = merged[id];
              merged[id] = {
                done: !!(localP && localP.done) || !!remoteP.done,
                stars: Math.max((localP && localP.stars) || 0, remoteP.stars || 0),
                best: Math.max((localP && localP.best) || 0, remoteP.best || 0)
              };
            });
            state.progress = merged;
          }
          try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
        }
        remoteLoaded = true;
        cb && cb();
      })
      .catch(function () { remoteLoaded = true; cb && cb(); });
  }

  // ------------------------------------------------------------- ecran compte
  function initials(email) { return (email || "?").trim().charAt(0).toUpperCase(); }
  function renderAccountChip() {
    var chip = $("#account-chip");
    if (!chip) return;
    if (!currentUser) { chip.hidden = true; return; }
    chip.hidden = false;
    if ($("#account-avatar-btn")) $("#account-avatar-btn").textContent = initials(currentUser.email);
    if ($("#account-email")) $("#account-email").textContent = currentUser.email || "";
  }
  // Branchement des boutons compte/gate -- protege par try/catch : si une page
  // mise en cache cote navigateur/CDN melange un vieux index.html avec ce
  // nouveau app.js (ou vice versa), un element manquant ne doit jamais faire
  // planter tout le script et laisser un ecran blanc.
  try {
    if ($("#account-avatar-btn")) {
      $("#account-avatar-btn").onclick = function (e) {
        e.stopPropagation();
        if ($("#account-menu")) $("#account-menu").hidden = !$("#account-menu").hidden;
      };
    }
    document.addEventListener("click", function (e) {
      var menu = $("#account-menu");
      if (!menu || menu.hidden) return;
      if (!menu.contains(e.target) && e.target.id !== "account-avatar-btn") menu.hidden = true;
    });
    if ($("#account-signout")) {
      $("#account-signout").onclick = function () {
        Sound.click();
        if (sb) { try { sb.auth.signOut(); } catch (e) {} }
        currentUser = null;
        if ($("#account-menu")) $("#account-menu").hidden = true;
        showGate();
      };
    }
  } catch (e) { if (window.console) console.error("Apprendre: branchement du compte impossible", e); }

  function setGateMsg(text, ok) {
    var msg = $("#gate-msg");
    if (!msg) return;
    if (!text) { msg.hidden = true; msg.textContent = ""; return; }
    msg.hidden = false;
    msg.textContent = text;
    msg.className = "gate-msg " + (ok ? "ok" : "err");
  }
  function renderGateMode() {
    if ($("#gate-title")) $("#gate-title").textContent = gateMode === "signup" ? "Crée ton compte" : "Content de te revoir";
    if ($("#gate-submit")) $("#gate-submit").textContent = gateMode === "signup" ? "Créer mon compte" : "Continuer";
    if ($("#gate-toggle")) $("#gate-toggle").textContent = gateMode === "signup" ? "Déjà un compte ? Connecte-toi" : "Pas de compte ? Crée-en un gratuitement";
    setGateMsg(null);
  }
  try {
    if ($("#gate-toggle")) {
      $("#gate-toggle").onclick = function () {
        Sound.click();
        gateMode = gateMode === "signup" ? "signin" : "signup";
        renderGateMode();
      };
    }
    if ($("#gate-form")) {
      $("#gate-form").addEventListener("submit", function (e) {
        e.preventDefault();
        if (!sb) { setGateMsg("Le service de compte est indisponible pour l'instant. Réessaie plus tard.", false); return; }
        var email = $("#gate-email").value.trim();
        var password = $("#gate-password").value;
        if (!email || password.length < 6) { setGateMsg("Entre un courriel valide et un mot de passe d'au moins 6 caractères.", false); return; }
        $("#gate-submit").disabled = true;
        setGateMsg(null);
        var action = gateMode === "signup"
          ? sb.auth.signUp({ email: email, password: password })
          : sb.auth.signInWithPassword({ email: email, password: password });
        action.then(function (res) {
          $("#gate-submit").disabled = false;
          if (res.error) { setGateMsg(res.error.message, false); return; }
          if (gateMode === "signup" && res.data && res.data.user && !res.data.session) {
            setGateMsg("Compte créé. Vérifie ta boîte courriel pour confirmer, puis connecte-toi.", true);
            gateMode = "signin"; renderGateMode();
            return;
          }
          // sb.auth.onAuthStateChange prend le relais pour afficher l'app
        }).catch(function () {
          $("#gate-submit").disabled = false;
          setGateMsg("Une erreur est survenue. Réessaie.", false);
        });
      });
    }
    if ($("#gate-google")) {
      $("#gate-google").onclick = function () {
        Sound.click();
        if (!sb) { setGateMsg("Le service de compte est indisponible pour l'instant. Réessaie plus tard.", false); return; }
        try { sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } }); } catch (e) {}
      };
    }
  } catch (e) { if (window.console) console.error("Apprendre: branchement du formulaire de connexion impossible", e); }

  function toggleHidden(id, hidden) { var n = document.getElementById(id); if (n) n.hidden = hidden; }
  function showGate() {
    toggleHidden("auth-gate", false);
    toggleHidden("home", true);
    toggleHidden("chip-streak", true);
    toggleHidden("chip-xp", true);
    try { renderAccountChip(); } catch (e) {}
    try { renderGateMode(); } catch (e) {}
  }
  function showApp() {
    toggleHidden("auth-gate", true);
    toggleHidden("home", false);
    toggleHidden("chip-streak", false);
    toggleHidden("chip-xp", false);
    try { renderAccountChip(); } catch (e) {}
    renderHome();
  }
  function handleSession(session) {
    try {
      currentUser = session && session.user ? session.user : null;
      if (currentUser) {
        if (!remoteLoaded) loadRemoteProgress(function () { showApp(); });
        else showApp();
      } else {
        remoteLoaded = false;
        showGate();
      }
    } catch (e) {
      if (window.console) console.error("Apprendre: erreur lors de l'affichage apres connexion", e);
      showGate();
    }
  }
  function initAuth() {
    if (!sb) { showGate(); return; }
    try {
      sb.auth.onAuthStateChange(function (_event, session) { handleSession(session); });
    } catch (e) { showGate(); }
  }

  function renderStatChips() {
    $("#chip-streak").innerHTML = ICON.flame + "<span>" + state.streak.count + "</span>";
    $("#chip-xp").innerHTML = ICON.bolt + "<span>" + state.xp + "</span>";
  }
  function addXP(n) { state.xp += n; saveState(); renderStatChips(); }
  function registerActivity() {
    var t = todayStr();
    if (state.streak.last === t) return;
    var last = state.streak.last, isYesterday = false;
    if (last) {
      var d1 = new Date(last.replace(/-/g, "/"));
      var d2 = new Date(t.replace(/-/g, "/"));
      isYesterday = Math.round((d2 - d1) / 86400000) === 1;
    }
    state.streak.count = isYesterday ? state.streak.count + 1 : 1;
    state.streak.last = t;
    saveState();
    renderStatChips();
  }
  function unitProgress(id) { return state.progress[id] || { done: false, stars: 0, best: 0 }; }
  function setUnitProgress(id, stars, accuracy) {
    var cur = unitProgress(id);
    state.progress[id] = { done: true, stars: Math.max(cur.stars, stars), best: Math.max(cur.best, accuracy) };
    saveState();
  }
  function isUnlocked(list, idx) { return idx === 0 || unitProgress(list[idx - 1].id).done; }

  // ------------------------------------------------------------ ecran accueil
  var currentWorld = "vocab";

  function renderHome() {
    var home = $("#home");
    home.innerHTML = "";

    var hero = el("div", "hero");
    hero.innerHTML =
      '<div class="eyebrow">Sensorielle · Formation</div>' +
      "<h1>Apprendre la LSQ</h1>" +
      '<p>Un parcours structuré en deux paliers : le vocabulaire de ta banque de signes, puis la grammaire complète. ' +
      "Ta progression est sauvegardée sur cet appareil.</p>";
    home.appendChild(hero);

    var tabs = el("div", "world-tabs");
    var tabVocab = el("button", "world-tab" + (currentWorld === "vocab" ? " active" : ""),
      "Palier 1 — Vocabulaire" + '<span class="n">' + VOCAB.length + " leçons</span>");
    var tabGram = el("button", "world-tab" + (currentWorld === "grammar" ? " active" : ""),
      "Palier 2 — Grammaire" + '<span class="n">' + GRAMMAR.length + " leçons</span>");
    tabVocab.onclick = function () { currentWorld = "vocab"; Sound.click(); renderHome(); };
    tabGram.onclick = function () { currentWorld = "grammar"; Sound.click(); renderHome(); };
    tabs.appendChild(tabVocab); tabs.appendChild(tabGram);
    home.appendChild(tabs);

    var list = currentWorld === "vocab" ? VOCAB : GRAMMAR;
    var doneCount = list.filter(function (u) { return unitProgress(u.id).done; }).length;
    var head = el("div", "section-head");
    head.innerHTML =
      "<h2>" + (currentWorld === "vocab" ? "Vocabulaire fondamental" : "Comprendre la grammaire") + "</h2>" +
      '<span class="count">' + doneCount + " / " + list.length + " terminées</span>";
    home.appendChild(head);

    var note = el("div", "palier-note",
      currentWorld === "vocab"
        ? "Les 325 signes de ta banque vidéo, regroupés par thème. Chaque leçon commence par une présentation des mots avant les exercices."
        : "Les 12 sections de ton guide de grammaire LSQ, transformées en leçons jouables — de la phonologie jusqu'à l'aspect verbal.");
    home.appendChild(note);

    var listEl = el("div", "lesson-list");
    list.forEach(function (unit, i) {
      var unlocked = isUnlocked(list, i);
      var prog = unitProgress(unit.id);
      var status = prog.done ? "done" : unlocked ? "available" : "locked";
      var row = el("button", "lesson-row " + status);
      row.disabled = !unlocked;

      var badge = el("div", "row-badge");
      badge.innerHTML = status === "locked" ? ICON.lock : status === "done" ? ICON.check : pad2(i + 1);
      row.appendChild(badge);

      var main = el("div", "row-main");
      var sub = currentWorld === "vocab"
        ? unit.mots.length + " mots"
        : "Section " + pad2(i + 1) + " / " + list.length + " du guide";
      main.innerHTML = '<div class="row-title">' + unit.titre + '</div><div class="row-sub">' + sub + "</div>";
      row.appendChild(main);

      var end = el("div", "row-end");
      if (status === "done") {
        var starsHtml = "";
        for (var s = 0; s < 3; s++) starsHtml += s < prog.stars ? ICON.star : ICON.starOutline.replace('class="icon"', 'class="icon off"');
        end.innerHTML = '<span class="stars">' + starsHtml + "</span>";
      } else if (status === "available") {
        end.innerHTML = ICON.chevron;
      }
      row.appendChild(end);

      if (unlocked) row.onclick = function () { Sound.click(); startLesson(currentWorld, unit); };
      listEl.appendChild(row);
    });
    home.appendChild(listEl);

    renderStatChips();
  }

  // ------------------------------------------------------------- generation
  function buildVocabExercises(unit) {
    var words = unit.mots;
    var ex = [];
    // Phase 1 : presentation de chaque mot avant tout exercice (on apprend avant d'etre teste)
    words.forEach(function (w) { ex.push({ kind: "teach", word: w }); });

    // Phase 2 : exercices sur les mots deja presentes
    var quiz = [];
    words.forEach(function (w, i) {
      quiz.push({ kind: "v2w", word: w });
      if (i % 3 === 2 && words.length > 3) quiz.push({ kind: "w2v", word: w });
    });
    var tfCount = Math.min(3, Math.max(1, Math.floor(words.length / 5)));
    for (var t = 0; t < tfCount; t++) {
      var w = pick(words);
      var isTrue = Math.random() < 0.5;
      var shown = isTrue ? w : (pick(words.filter(function (x) { return x.mot !== w.mot; })) || w);
      quiz.push({ kind: "tf", word: w, shown: shown, truth: shown.mot === w.mot });
    }
    if (words.length >= 4) quiz.push({ kind: "match", words: sample(words, Math.min(4, words.length)) });
    quiz = shuffle(quiz).slice(0, Math.min(quiz.length, 20));

    return ex.concat(quiz);
  }

  function buildGrammarExercises(unit) {
    var ex = [];
    unit.cartes.forEach(function (c) { ex.push({ kind: "card", card: c }); });
    unit.quiz.forEach(function (q) { ex.push({ kind: "quiz", q: q }); });
    return ex;
  }

  // ------------------------------------------------------------- etat lecon
  var lesson = null;

  function startLesson(world, unit) {
    var exos = world === "vocab" ? buildVocabExercises(unit) : buildGrammarExercises(unit);
    lesson = { world: world, unit: unit, exos: exos, idx: 0, correct: 0, scored: 0, hearts: 5, failed: false };
    $("#lesson-overlay").classList.add("open");
    $("#lesson-close").innerHTML = ICON.close;
    renderHearts();
    renderStep();
  }
  function closeLesson() { $("#lesson-overlay").classList.remove("open"); lesson = null; renderHome(); }
  $("#lesson-close").onclick = function () {
    Sound.click();
    if (confirm("Quitter la leçon ? Ta progression sur cette leçon sera perdue.")) closeLesson();
  };

  function renderHearts() {
    var box = $("#lesson-hearts");
    box.innerHTML = "";
    for (var i = 0; i < 5; i++) {
      box.insertAdjacentHTML("beforeend", i < lesson.hearts ? ICON.heart : ICON.heartOutline.replace('class="icon"', 'class="icon lost"'));
    }
  }
  function updateProgressBar() {
    var pct = Math.round((lesson.idx / lesson.exos.length) * 100);
    $("#progress-fill").style.width = pct + "%";
  }
  function loseHeart() {
    lesson.hearts--;
    Sound.heartLost();
    renderHearts();
    if (lesson.hearts <= 0) lesson.failed = true;
  }

  function renderStep() {
    updateProgressBar();
    var body = $("#lesson-body");
    body.innerHTML = "";
    if (lesson.idx >= lesson.exos.length || lesson.failed) { renderSummary(); return; }
    var step = lesson.exos[lesson.idx];
    var wrap = el("div", "ex-wrap");
    body.appendChild(wrap);
    if (step.kind === "teach") renderTeach(wrap, step);
    else if (step.kind === "card") renderCard(wrap, step);
    else if (step.kind === "v2w") renderV2W(wrap, step);
    else if (step.kind === "w2v") renderW2V(wrap, step);
    else if (step.kind === "tf") renderTF(wrap, step);
    else if (step.kind === "match") renderMatch(wrap, step);
    else if (step.kind === "quiz") renderQuiz(wrap, step);
  }
  function advance() { lesson.idx++; renderStep(); }

  function showFeedback(wrap, correct, explanation, onNext) {
    var bar = el("div", "bottom-bar feedback-" + (correct ? "correct" : "incorrect"));
    var row = el("div", "feedback-row " + (correct ? "correct" : "incorrect"),
      (correct ? ICON.check + "Bravo !" : ICON.cross + "Pas tout à fait"));
    bar.appendChild(row);
    if (explanation) bar.appendChild(el("div", "feedback-sub", explanation));
    var btn = el("button", "btn-primary " + (correct ? "go" : "stop"), "Continuer");
    btn.onclick = function () { Sound.click(); onNext(); };
    bar.appendChild(btn);
    wrap.parentElement.appendChild(bar);
  }
  function scoreAnswer(wrap, isCorrect, explanation) {
    lesson.scored++;
    if (isCorrect) { lesson.correct++; addXP(10); Sound.correct(); }
    else { Sound.incorrect(); loseHeart(); }
    showFeedback(wrap, isCorrect, explanation, advance);
  }

  // ---------------------------------------------------------- types d'exos
  function makeVideoStage(word, teaching) {
    var stage = el("div", "video-stage");
    if (teaching) stage.appendChild(el("div", "teach-badge", "Nouveau"));
    var v = el("video");
    v.src = videoUrl(word.video); v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    stage.appendChild(v);
    var replay = el("button", "replay", ICON.replay);
    replay.onclick = function (e) { e.stopPropagation(); v.currentTime = 0; v.play(); };
    stage.appendChild(replay);
    return stage;
  }

  function renderTeach(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Nouveau signe"));
    wrap.appendChild(el("div", "ex-prompt", "Regarde et mémorise"));
    wrap.appendChild(makeVideoStage(step.word, true));
    var card = el("div", "word-card");
    card.style.marginTop = "4px";
    card.innerHTML = '<div class="mot">' + step.word.mot + "</div>";
    wrap.appendChild(card);
    var bar = el("div", "bottom-bar");
    var btn = el("button", "btn-primary", "Continuer");
    btn.onclick = function () { Sound.click(); advance(); };
    bar.appendChild(btn);
    wrap.parentElement.appendChild(bar);
  }

  function renderV2W(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Regarde le signe"));
    wrap.appendChild(el("div", "ex-prompt", "Quel est ce mot ?"));
    wrap.appendChild(makeVideoStage(step.word, false));
    var pool = VOCAB.flatMap(function (u) { return u.mots; });
    var distract = sample(pool.filter(function (w) { return w.mot !== step.word.mot; }), 3);
    var opts = shuffle([step.word].concat(distract));
    var choices = el("div", "choices");
    opts.forEach(function (o) {
      var btn = el("button", "choice-btn", "<span>" + o.mot + "</span>");
      btn.onclick = function () {
        document.querySelectorAll(".choice-btn").forEach(function (b) { b.disabled = true; });
        var ok = o.mot === step.word.mot;
        btn.classList.add(ok ? "correct" : "incorrect");
        if (!ok) {
          document.querySelectorAll(".choice-btn").forEach(function (b) {
            if (b.textContent.trim() === step.word.mot) b.classList.add("correct");
          });
        }
        scoreAnswer(wrap, ok, ok ? null : "La bonne réponse était « " + step.word.mot + " ».");
      };
      choices.appendChild(btn);
    });
    wrap.appendChild(choices);
  }

  function renderW2V(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Trouve la bonne vidéo"));
    var card = el("div", "word-card");
    card.innerHTML = '<div class="mot">' + step.word.mot + "</div>";
    wrap.appendChild(card);
    var pool = VOCAB.flatMap(function (u) { return u.mots; });
    var distract = sample(pool.filter(function (w) { return w.mot !== step.word.mot; }), 3);
    var opts = shuffle([step.word].concat(distract));
    var choices = el("div", "choices grid2");
    opts.forEach(function (o) {
      var btn = el("button", "choice-btn video-choice");
      var v = el("video");
      v.src = videoUrl(o.video); v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      btn.appendChild(v);
      btn.onclick = function () {
        document.querySelectorAll(".choice-btn").forEach(function (b) { b.disabled = true; });
        var ok = o.mot === step.word.mot;
        btn.classList.add(ok ? "correct" : "incorrect");
        scoreAnswer(wrap, ok, ok ? null : "La bonne vidéo était celle de « " + step.word.mot + " ».");
      };
      choices.appendChild(btn);
    });
    wrap.appendChild(choices);
  }

  function renderTF(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Vrai ou faux"));
    wrap.appendChild(el("div", "ex-prompt", "Ce signe veut dire « " + step.shown.mot + " » ?"));
    wrap.appendChild(makeVideoStage(step.word, false));
    var row = el("div", "vf-row");
    var vrai = el("button", "vf-btn vrai", ICON.check + "Vrai");
    var faux = el("button", "vf-btn faux", ICON.cross + "Faux");
    function answer(userSaysTrue) {
      document.querySelectorAll(".vf-btn").forEach(function (b) { b.disabled = true; });
      var ok = userSaysTrue === step.truth;
      (userSaysTrue ? vrai : faux).classList.add(ok ? "correct" : "incorrect");
      scoreAnswer(wrap, ok, ok ? null : (step.truth ? "C'était vrai : ce signe veut bien dire « " + step.shown.mot + " »." : "C'était faux : ce signe veut dire « " + step.word.mot + " »."));
    }
    vrai.onclick = function () { answer(true); };
    faux.onclick = function () { answer(false); };
    row.appendChild(vrai); row.appendChild(faux);
    wrap.appendChild(row);
  }

  function renderMatch(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Association"));
    wrap.appendChild(el("div", "ex-prompt", "Associe chaque signe à son mot"));
    var words = step.words;
    var grid = el("div", "match-grid");
    var videoTiles = shuffle(words.map(function (w) { return { mot: w.mot }; }));
    var wordTiles = shuffle(words.map(function (w) { return { mot: w.mot }; }));
    var selectedVideo = null, matchedCount = 0, mistakes = 0;

    videoTiles.forEach(function (vt) {
      var w = words.filter(function (x) { return x.mot === vt.mot; })[0];
      var tile = el("div", "match-tile video-tile");
      var v = el("video");
      v.src = videoUrl(w.video); v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      tile.appendChild(v);
      tile.dataset.mot = vt.mot;
      tile.onclick = function () {
        if (tile.classList.contains("matched")) return;
        document.querySelectorAll(".match-tile.video-tile").forEach(function (t) { t.classList.remove("sel"); });
        tile.classList.add("sel");
        selectedVideo = tile;
      };
      grid.appendChild(tile);
    });
    wordTiles.forEach(function (wt) {
      var tile = el("div", "match-tile", wt.mot);
      tile.dataset.mot = wt.mot;
      tile.onclick = function () {
        if (tile.classList.contains("matched") || !selectedVideo) return;
        if (selectedVideo.dataset.mot === wt.mot) {
          selectedVideo.classList.remove("sel"); selectedVideo.classList.add("matched");
          tile.classList.add("matched");
          matchedCount++;
          Sound.correct();
          selectedVideo = null;
          if (matchedCount === words.length) {
            setTimeout(function () { scoreAnswer(wrap, mistakes === 0, mistakes === 0 ? null : "Presque — " + mistakes + " erreur(s) dans l'association."); }, 350);
          }
        } else {
          mistakes++;
          Sound.incorrect();
          tile.classList.add("wrong-flash");
          setTimeout(function () { tile.classList.remove("wrong-flash"); }, 350);
        }
      };
      grid.appendChild(tile);
    });
    wrap.appendChild(grid);
  }

  function renderCard(wrap, step) {
    var screen = el("div", "card-screen");
    var icHtml = '<div class="card-ic">' + ICON.compass + "</div>";
    screen.innerHTML = icHtml + "<h3>" + step.card.titre + "</h3>" + '<div class="card-body">' + step.card.corps + "</div>";
    wrap.appendChild(screen);
    var bar = el("div", "bottom-bar");
    var btn = el("button", "btn-primary", "Suivant");
    btn.onclick = function () { Sound.click(); advance(); };
    bar.appendChild(btn);
    wrap.parentElement.appendChild(bar);
  }

  function renderQuiz(wrap, step) {
    var q = step.q;
    var icWrap = el("div", "card-ic", ICON.book);
    icWrap.style.marginBottom = "14px";
    wrap.appendChild(icWrap);
    wrap.appendChild(el("div", "ex-kicker", "Question"));
    wrap.appendChild(el("div", "ex-prompt", q.q));
    if (q.type === "mcq") {
      var choices = el("div", "choices");
      var opts = q.options.map(function (o, i) { return { text: o, i: i }; });
      shuffle(opts).forEach(function (o) {
        var btn = el("button", "choice-btn", "<span>" + o.text + "</span>");
        btn.onclick = function () {
          document.querySelectorAll(".choice-btn").forEach(function (b) { b.disabled = true; });
          var ok = o.i === q.reponse;
          btn.classList.add(ok ? "correct" : "incorrect");
          if (!ok) {
            document.querySelectorAll(".choice-btn").forEach(function (b) {
              if (b.textContent.trim() === q.options[q.reponse]) b.classList.add("correct");
            });
          }
          scoreAnswer(wrap, ok, q.explication);
        };
        choices.appendChild(btn);
      });
      wrap.appendChild(choices);
    } else {
      var row = el("div", "vf-row");
      var vrai = el("button", "vf-btn vrai", ICON.check + "Vrai");
      var faux = el("button", "vf-btn faux", ICON.cross + "Faux");
      function answer(userSaysTrue) {
        document.querySelectorAll(".vf-btn").forEach(function (b) { b.disabled = true; });
        var ok = userSaysTrue === q.reponse;
        (userSaysTrue ? vrai : faux).classList.add(ok ? "correct" : "incorrect");
        scoreAnswer(wrap, ok, q.explication);
      }
      vrai.onclick = function () { answer(true); };
      faux.onclick = function () { answer(false); };
      row.appendChild(vrai); row.appendChild(faux);
      wrap.appendChild(row);
    }
  }

  // ------------------------------------------------------------------- fin
  function renderSummary() {
    var body = $("#lesson-body");
    body.innerHTML = "";
    var wrap = el("div", "summary-wrap");
    var accuracy = lesson.scored ? lesson.correct / lesson.scored : 1;
    var success = !lesson.failed;

    if (success) {
      registerActivity();
      var stars = accuracy >= 0.9 ? 3 : accuracy >= 0.75 ? 2 : accuracy >= 0.5 ? 1 : 0;
      var prevStars = unitProgress(lesson.unit.id).stars;
      setUnitProgress(lesson.unit.id, stars, accuracy);
      var bonus = 50 + (stars === 3 && prevStars < 3 ? 100 : 0);
      addXP(bonus);
      Sound.unitDone();
      launchConfetti();
      var starsHtml = "";
      for (var s = 0; s < 3; s++) starsHtml += s < stars ? ICON.star : ICON.starOutline.replace('class="icon"', 'class="icon off"');
      wrap.innerHTML =
        '<div class="big-ic">' + ICON.check + "</div>" +
        "<h2>Leçon terminée !</h2>" +
        '<p class="sub">' + lesson.unit.titre + "</p>" +
        '<div class="summary-stats">' +
        '<div class="summary-stat"><div class="v">' + Math.round(accuracy * 100) + "%</div><div class=\"l\">Précision</div></div>" +
        '<div class="summary-stat"><div class="v">' + starsHtml + '</div><div class="l">Étoiles</div></div>' +
        '<div class="summary-stat"><div class="v">' + ICON.bolt + "+" + (lesson.correct * 10 + bonus) + "</div><div class=\"l\">XP gagné</div></div>" +
        "</div>";
    } else {
      Sound.incorrect();
      wrap.innerHTML =
        '<div class="big-ic fail">' + ICON.heartOutline + "</div>" +
        "<h2>Plus de cœurs !</h2>" +
        '<p class="sub">Pas de souci, on recommence — c’est comme ça qu’on apprend une langue.</p>';
    }
    var actions = el("div", "bottom-bar");
    var btn = el("button", "btn-primary go", success ? "Continuer" : "Réessayer");
    btn.onclick = function () {
      Sound.click();
      if (success) closeLesson();
      else startLesson(lesson.world, lesson.unit);
    };
    actions.appendChild(btn);
    body.appendChild(wrap);
    body.appendChild(actions);
  }

  // -------------------------------------------------------------- confetti
  function launchConfetti() {
    var colors = ["#7C4DFF", "#E853D7", "#FF8058", "#F5B82E", "#2BB673"];
    for (var i = 0; i < 46; i++) {
      var p = el("div", "confetti-piece");
      var size = 6 + Math.random() * 6;
      p.style.width = size + "px";
      p.style.height = (size * 1.4) + "px";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.left = Math.random() * 100 + "vw";
      var dur = 1.6 + Math.random() * 1.2;
      p.style.transition = "transform " + dur + "s cubic-bezier(.2,.6,.3,1), opacity " + dur + "s linear";
      document.body.appendChild(p);
      (function (piece, duration) {
        requestAnimationFrame(function () {
          piece.style.transform = "translateY(" + (window.innerHeight + 60) + "px) rotate(" + (Math.random() * 540 - 270) + "deg)";
          piece.style.opacity = "0.15";
        });
        setTimeout(function () { piece.remove(); }, duration * 1000 + 80);
      })(p, dur);
    }
  }

  // ---------------------------------------------------------------- lancer
  try {
    initAuth();
  } catch (e) {
    // Dernier filet : si meme initAuth() plante, on ne laisse jamais un ecran
    // blanc -- on affiche au moins l'ecran de connexion statique.
    if (window.console) console.error("Apprendre: echec du demarrage, affichage de secours", e);
    var gate = document.getElementById("auth-gate");
    var home = document.getElementById("home");
    if (gate) gate.hidden = false;
    if (home) home.hidden = true;
  }
})();
