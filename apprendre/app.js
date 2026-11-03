// =============================================================================
// Apprendre la LSQ — moteur de lecons (vanilla JS, pas de framework)
// Donnees : window.APPRENDRE_VOCAB_UNITS / window.APPRENDRE_GRAMMAR_UNITS
// (voir curriculum-data.js, genere a partir des vraies donnees Sensorielle)
// =============================================================================

(function () {
  "use strict";

  var VOCAB = window.APPRENDRE_VOCAB_UNITS || [];
  var GRAMMAR = window.APPRENDRE_GRAMMAR_UNITS || [];
  var STORE_KEY = "sensorielle_apprendre_v1";
  var VIDEO_BASE = ".."; // /media/signs/xxx.mp4 is absolute from site root

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

  // ------------------------------------------------------------------ son fx
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var actx = null;
  function getCtx() {
    if (!actx && AudioCtx) actx = new AudioCtx();
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, start, dur, type, gainPeak) {
    var ctx = getCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    var t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.18, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  var Sound = {
    correct: function () { tone(523.25, 0, 0.14, "sine", 0.2); tone(783.99, 0.1, 0.22, "sine", 0.18); },
    incorrect: function () { tone(220, 0, 0.18, "sawtooth", 0.11); tone(164.8, 0.09, 0.22, "sawtooth", 0.1); },
    click: function () { tone(660, 0, 0.05, "sine", 0.06); },
    lessonComplete: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, i * 0.1, 0.3, "sine", 0.16); });
    },
    heartLost: function () { tone(180, 0, 0.12, "triangle", 0.12); tone(120, 0.08, 0.16, "triangle", 0.1); },
    unitDone: function () {
      [392, 523.25, 659.25, 880, 1046.5].forEach(function (f, i) { tone(f, i * 0.09, 0.35, "sine", 0.15); });
    }
  };

  // --------------------------------------------------------------- stockage
  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    var s = null;
    if (raw) { try { s = JSON.parse(raw); } catch (e) {} }
    if (!s) s = {};
    if (typeof s.xp !== "number") s.xp = 0;
    if (!s.streak) s.streak = { count: 0, last: null };
    if (!s.progress) s.progress = {}; // unitId -> {done:true, stars:0-3, best:0-1}
    if (!s.badges) s.badges = {};
    return s;
  }
  var state = loadState();
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function addXP(n) {
    state.xp += n;
    saveState();
    var elXp = $("#stat-xp");
    if (elXp) elXp.textContent = state.xp;
  }
  function registerActivity() {
    var t = todayStr();
    if (state.streak.last === t) return;
    var last = state.streak.last;
    var isYesterday = false;
    if (last) {
      var d1 = new Date(last.replace(/-/g, "/"));
      var d2 = new Date(t.replace(/-/g, "/"));
      isYesterday = Math.round((d2 - d1) / 86400000) === 1;
    }
    state.streak.count = isYesterday ? state.streak.count + 1 : 1;
    state.streak.last = t;
    saveState();
    var elS = $("#stat-streak");
    if (elS) elS.textContent = state.streak.count;
  }
  function unitProgress(id) { return state.progress[id] || { done: false, stars: 0, best: 0 }; }
  function setUnitProgress(id, stars, accuracy) {
    var cur = unitProgress(id);
    state.progress[id] = {
      done: true,
      stars: Math.max(cur.stars, stars),
      best: Math.max(cur.best, accuracy)
    };
    saveState();
  }
  function isUnlocked(list, idx) {
    if (idx === 0) return true;
    return unitProgress(list[idx - 1].id).done;
  }

  // ------------------------------------------------------------ ecran accueil
  var currentWorld = "vocab";

  function renderHome() {
    var home = $("#home");
    home.innerHTML = "";

    var hero = el("div", "hero");
    hero.innerHTML =
      '<h1>Apprendre la LSQ</h1>' +
      '<p>Vocabulaire et grammaire de la langue des signes québécoise, en petites leçons. ' +
      'Ta progression est sauvegardée sur cet appareil.</p>' +
      '<div class="hands">🤟</div>';
    home.appendChild(hero);

    var tabs = el("div", "world-tabs");
    var tabVocab = el("button", "world-tab" + (currentWorld === "vocab" ? " active" : ""),
      '📖 Vocabulaire<span class="n">' + VOCAB.length + ' leçons</span>');
    var tabGram = el("button", "world-tab" + (currentWorld === "grammar" ? " active" : ""),
      '🧩 Grammaire<span class="n">' + GRAMMAR.length + ' leçons</span>');
    tabVocab.onclick = function () { currentWorld = "vocab"; Sound.click(); renderHome(); };
    tabGram.onclick = function () { currentWorld = "grammar"; Sound.click(); renderHome(); };
    tabs.appendChild(tabVocab); tabs.appendChild(tabGram);
    home.appendChild(tabs);

    var head = el("div", "section-head");
    var list = currentWorld === "vocab" ? VOCAB : GRAMMAR;
    var doneCount = list.filter(function (u) { return unitProgress(u.id).done; }).length;
    head.innerHTML =
      "<h2>" + (currentWorld === "vocab" ? "Palier 1 — Vocabulaire fondamental" : "Palier 2 — Comprendre la grammaire") + "</h2>" +
      '<span class="count">' + doneCount + " / " + list.length + " terminées</span>";
    home.appendChild(head);

    if (currentWorld === "grammar" && GRAMMAR.length) {
      var note = el("div", "section-head");
      note.style.marginTop = "-10px";
      note.innerHTML = '<span class="count" style="font-weight:600">🎓 Ce palier couvre tout le guide de grammaire LSQ — phonologie, verbes, regard, négation, classificateurs, ordre des mots, espace de signation, prise de rôle et aspect.</span>';
      home.appendChild(note);
    }

    var path = el("div", "path");
    list.forEach(function (unit, i) {
      var row = el("div", "path-row");
      if (i > 0) row.appendChild(el("div", "path-connector"));
      var wrap = el("div", "node-wrap" + (i % 3 === 1 ? " offset-r" : i % 3 === 2 ? " offset-l" : ""));
      var unlocked = isUnlocked(list, i);
      var prog = unitProgress(unit.id);
      var node = el("button", "node " + (prog.done ? "done" : unlocked ? "available" : "locked"));
      node.innerHTML = prog.done
        ? unit.icone + '<span class="stars">' + "★".repeat(prog.stars) + "☆".repeat(3 - prog.stars) + "</span>"
        : unlocked ? unit.icone : '<span class="lock">🔒</span>';
      if (unlocked) {
        node.onclick = function () { Sound.click(); startLesson(currentWorld, unit); };
      } else {
        node.disabled = true;
      }
      wrap.appendChild(node);
      wrap.appendChild(el("div", "label", unit.titre));
      row.appendChild(wrap);
      path.appendChild(row);
    });
    home.appendChild(path);

    $("#stat-xp").textContent = state.xp;
    $("#stat-streak").textContent = state.streak.count;
  }

  // ------------------------------------------------------------- generation
  function buildVocabExercises(unit) {
    var words = unit.mots;
    var ex = [];
    words.forEach(function (w, i) {
      ex.push({ kind: "v2w", word: w });
      if (i % 3 === 2 && words.length > 3) ex.push({ kind: "w2v", word: w });
    });
    // quelques vrai/faux
    var tfCount = Math.min(3, Math.max(1, Math.floor(words.length / 5)));
    for (var t = 0; t < tfCount; t++) {
      var w = pick(words);
      var isTrue = Math.random() < 0.5;
      var shown = isTrue ? w : pick(words.filter(function (x) { return x.mot !== w.mot; })) || w;
      ex.push({ kind: "tf", word: w, shown: shown, truth: shown.mot === w.mot });
    }
    if (words.length >= 4) {
      ex.push({ kind: "match", words: sample(words, Math.min(4, words.length)) });
    }
    return shuffle(ex).slice(0, Math.min(ex.length, 22));
  }

  function buildGrammarExercises(unit) {
    var ex = [];
    unit.cartes.forEach(function (c) { ex.push({ kind: "card", card: c }); });
    unit.quiz.forEach(function (q) { ex.push({ kind: "quiz", q: q }); });
    return ex;
  }

  // ------------------------------------------------------------- etat lecon
  var lesson = null; // {world, unit, exos, idx, correct, scored, hearts, failed}

  function startLesson(world, unit) {
    var exos = world === "vocab" ? buildVocabExercises(unit) : buildGrammarExercises(unit);
    lesson = { world: world, unit: unit, exos: exos, idx: 0, correct: 0, scored: 0, hearts: 5, failed: false };
    $("#lesson-overlay").classList.add("open");
    renderHearts();
    renderStep();
  }

  function closeLesson() {
    $("#lesson-overlay").classList.remove("open");
    lesson = null;
    renderHome();
  }
  $("#lesson-close").onclick = function () {
    Sound.click();
    if (confirm("Quitter la leçon ? Ta progression sur cette leçon sera perdue.")) closeLesson();
  };

  function renderHearts() {
    var box = $("#lesson-hearts");
    box.innerHTML = "";
    for (var i = 0; i < 5; i++) {
      var h = el("span", "h" + (i < lesson.hearts ? "" : " lost"), "❤️");
      box.appendChild(h);
    }
  }

  function updateProgressBar() {
    var pct = Math.round((lesson.idx / lesson.exos.length) * 100);
    $("#progress-fill").style.width = pct + "%";
  }

  function loseHeart() {
    lesson.hearts--;
    Sound.heartLost();
    var hearts = $("#lesson-hearts .h");
    renderHearts();
    var box = $("#lesson-hearts");
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.transform = "translateX(0)";
    if (lesson.hearts <= 0) {
      lesson.failed = true;
    }
  }

  function renderStep() {
    updateProgressBar();
    var body = $("#lesson-body");
    body.innerHTML = "";
    if (lesson.idx >= lesson.exos.length || lesson.failed) {
      renderSummary();
      return;
    }
    var step = lesson.exos[lesson.idx];
    var wrap = el("div", "ex-wrap");
    body.appendChild(wrap);

    if (step.kind === "card") renderCard(wrap, step);
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
      (correct ? "✅ Bravo !" : "❌ Pas tout à fait") );
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
  function makeVideoStage(word) {
    var stage = el("div", "video-stage");
    var v = el("video");
    v.src = videoUrl(word.video); v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    stage.appendChild(v);
    var replay = el("button", "replay", "↻");
    replay.onclick = function (e) { e.stopPropagation(); v.currentTime = 0; v.play(); };
    stage.appendChild(replay);
    return stage;
  }

  function renderV2W(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Regarde le signe"));
    wrap.appendChild(el("div", "ex-prompt", "Quel est ce mot ?"));
    wrap.appendChild(makeVideoStage(step.word));
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
        scoreAnswer(wrap, ok, ok ? null : "La bonne réponse était « " + step.word.mot + " ».");
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
        scoreAnswer(wrap, ok, ok ? null : "La bonne vidéo était celle de « " + step.word.mot + " ».");
      };
      choices.appendChild(btn);
    });
    wrap.appendChild(choices);
  }

  function renderTF(wrap, step) {
    wrap.appendChild(el("div", "ex-kicker", "Vrai ou faux"));
    wrap.appendChild(el("div", "ex-prompt", "Ce signe veut dire « " + step.shown.mot + " » ?"));
    wrap.appendChild(makeVideoStage(step.word));
    var row = el("div", "vf-row");
    var vrai = el("button", "vf-btn vrai", "✔ Vrai");
    var faux = el("button", "vf-btn faux", "✖ Faux");
    function answer(userSaysTrue) {
      document.querySelectorAll(".vf-btn").forEach(function (b) { b.disabled = true; });
      var ok = userSaysTrue === step.truth;
      (userSaysTrue ? vrai : faux).classList.add(ok ? "correct" : "incorrect");
      scoreAnswer(wrap, ok, ok ? null : (step.truth ? "C'était vrai : ce signe veut bien dire « " + step.shown.mot + " »." : "C'était faux : ce signe veut dire « " + step.word.mot + " »."));
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
    var videoTiles = shuffle(words.map(function (w) { return { mot: w.mot, tile: "video" }; }));
    var wordTiles = shuffle(words.map(function (w) { return { mot: w.mot, tile: "word" }; }));
    var selectedVideo = null;
    var matchedCount = 0;
    var mistakes = 0;

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
    screen.innerHTML =
      '<div class="card-ic">' + (lesson.unit.icone || "🧩") + "</div>" +
      "<h3>" + step.card.titre + "</h3>" +
      '<div class="card-body">' + step.card.corps + "</div>";
    wrap.appendChild(screen);
    var bar = el("div", "bottom-bar");
    var btn = el("button", "btn-primary", "Suivant");
    btn.onclick = function () { Sound.click(); advance(); };
    bar.appendChild(btn);
    wrap.parentElement.appendChild(bar);
  }

  function renderQuiz(wrap, step) {
    var q = step.q;
    wrap.appendChild(el("div", "card-ic", lesson.unit.icone || "🧩"));
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
      var vrai = el("button", "vf-btn vrai", "✔ Vrai");
      var faux = el("button", "vf-btn faux", "✖ Faux");
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
      addXP(50);
      if (stars === 3 && prevStars < 3) addXP(100);
      Sound.unitDone();
      launchConfetti();
      wrap.innerHTML =
        '<div class="big-ic">🎉</div>' +
        "<h2>Leçon terminée !</h2>" +
        '<p class="sub">' + lesson.unit.titre + "</p>" +
        '<div class="summary-stats">' +
        '<div class="summary-stat"><div class="v">' + Math.round(accuracy * 100) + "%</div><div class=\"l\">Précision</div></div>" +
        '<div class="summary-stat"><div class="v">' + "★".repeat(stars) + "☆".repeat(3 - stars) + '</div><div class="l">Étoiles</div></div>' +
        '<div class="summary-stat"><div class="v">+' + (50 + lesson.correct * 10 + (stars === 3 && prevStars < 3 ? 100 : 0)) + "</div><div class=\"l\">XP gagné</div></div>" +
        "</div>";
    } else {
      Sound.incorrect();
      wrap.innerHTML =
        '<div class="big-ic">💔</div>' +
        "<h2>Plus de cœurs !</h2>" +
        '<p class="sub">Pas de souci, on recommence — c’est comme ça qu’on apprend une langue.</p>';
    }
    var actions = el("div", "bottom-bar");
    var btn = el("button", "btn-primary go", success ? "Continuer" : "Réessayer");
    btn.onclick = function () {
      Sound.click();
      if (success) { closeLesson(); }
      else { startLesson(lesson.world, lesson.unit); }
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
  renderHome();
})();
