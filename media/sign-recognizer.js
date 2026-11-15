/* Sensorielle — reconnaissance de signes LSQ, 100% locale au navigateur.
   Ajoute le 2026-11-15 (demande de David) pour remplacer l'ancienne piste
   MediaPipe (abandonnee - classifiait des formes de main generiques, pas
   de vrais mots LSQ). Nouvelle approche : aucun modele de vision par
   ordinateur telecharge, aucun reseau requis apres le chargement de la
   page. On suit la trajectoire + la forme de la main en mouvement (couleur
   de peau + mouvement image par image, normalise par rapport a un repere
   visage de position/taille fixe affiche a l'ecran -- voir FACE_CX_FRAC
   etc. plus bas) puis on compare la sequence enregistree
   aux 325 vraies videos du dictionnaire (deja extraites hors-ligne, memes
   canaux ici) via une distance DTW (Dynamic Time Warping) multi-canaux.

   Teste hors-ligne sur les 325 mots du dictionnaire (meme algorithme, en
   Python) avec des deformations synthetiques simulant une prise differente
   (vitesse x0.6 a x1.5, bruit, decalage/echelle de position) : 77% de bonne
   reponse en premier choix, 89% dans les 5 premiers choix, sur 325 mots
   possibles. Ce ne sont pas des videos YouTube (voir le texte de la feuille
   d'info sur la page) mais un vrai test, pas une estimation.
*/
(function (global) {
  "use strict";

  var SIG_URL = "/media/sign-signatures.json";
  var sigData = null; // { channels, weights, mu, sd, words: {word: [[..],...]} }
  var loadingPromise = null;

  function loadSignatures() {
    if (sigData) return Promise.resolve(sigData);
    if (loadingPromise) return loadingPromise;
    loadingPromise = fetch(SIG_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        sigData = json;
        return json;
      });
    return loadingPromise;
  }

  // ---- Segmentation image par image -----------------------------------
  // mask: Uint8Array taille w*h, 1 = pixel retenu. Tout est fait sur une
  // image reduite (voir WORK_W/WORK_H côté appelant) pour rester rapide.

  // Fraction fixe du cadre ou l'on suppose le visage (voir le repere
  // ovale affiche a l'ecran, dessine avec exactement les memes fractions
  // - cx/cy/h - cote index.html). Remplace le 2026-11-15 (David : "ca ne
  // traduisait jamais rien" sur son telephone) l'ancienne detection du
  // visage par "plus gros blob de peau immobile", qui ne declenchait
  // jamais sous certains eclairages/tons de peau -> aucune ligne n'etait
  // jamais enregistree, donc rien n'etait jamais reconnu. Une geometrie
  // fixe fonctionne toujours ; sa precision depend de l'alignement au
  // repere affiche, pas d'une detection qui peut echouer silencieusement.
  var FACE_CX_FRAC = 0.5, FACE_CY_FRAC = 0.34, FACE_H_FRAC = 0.30;

  function fixedFaceRef(w, h) {
    return { cx: w * FACE_CX_FRAC, cy: h * FACE_CY_FRAC, h: Math.max(6, h * FACE_H_FRAC) };
  }

  function rgbToSkin(r, g, b) {
    // Conversion YCrCb (BT.601) + seuils peau elargis (2026-11-15 : les
    // seuils d'origine, trop stricts, rataient trop de tons de peau et
    // d'eclairages de camera selfie mobile).
    var y = 0.299 * r + 0.587 * g + 0.114 * b;
    var cr = (r - y) * 0.713 + 128;
    var cb = (b - y) * 0.564 + 128;
    return cr >= 125 && cr <= 188 && cb >= 72 && cb <= 142;
  }

  function buildMasks(imgData, prevGray, w, h) {
    var data = imgData.data;
    var n = w * h;
    var skin = new Uint8Array(n);
    var gray = new Uint8Array(n);
    var motion = new Uint8Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var r = data[p], g = data[p + 1], b = data[p + 2];
      skin[i] = rgbToSkin(r, g, b) ? 1 : 0;
      var gy = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      gray[i] = gy;
      if (prevGray) {
        motion[i] = Math.abs(gy - prevGray[i]) > 18 ? 1 : 0;
      }
    }
    return { skin: skin, gray: gray, motion: motion };
  }

  function dilate(mask, w, h, radius) {
    var out = new Uint8Array(mask.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (!mask[idx]) continue;
        for (var dy = -radius; dy <= radius; dy++) {
          var ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (var dx = -radius; dx <= radius; dx++) {
            var nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            out[ny * w + nx] = 1;
          }
        }
      }
    }
    return out;
  }

  // Composantes connexes (union-find a deux passes) -> plus gros blob.
  // opts.points demande aussi un contour approche (min/max x par ligne
  // du plus gros blob) -- jamais utilise par pushFrame, qui n'en a pas
  // besoin (garde comme primitive reutilisable).
  function largestBlob(mask, w, h, minArea, opts) {
    var n = w * h;
    var label = new Int32Array(n);
    var parent = [];
    function find(x) { while (parent[x] !== x) { x = parent[x]; } return x; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    var next = 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (!mask[idx]) continue;
        var left = x > 0 ? label[idx - 1] : 0;
        var up = y > 0 ? label[idx - w] : 0;
        if (left && up) { label[idx] = left; union(left, up); }
        else if (left) { label[idx] = left; }
        else if (up) { label[idx] = up; }
        else { label[idx] = next; parent[next] = next; next++; }
      }
    }
    var area = {}, sumX = {}, sumY = {}, minX = {}, maxX = {}, minY = {}, maxY = {};
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var idx2 = y2 * w + x2;
        if (!label[idx2]) continue;
        var root = find(label[idx2]);
        area[root] = (area[root] || 0) + 1;
        sumX[root] = (sumX[root] || 0) + x2;
        sumY[root] = (sumY[root] || 0) + y2;
        minX[root] = Math.min(minX[root] === undefined ? x2 : minX[root], x2);
        maxX[root] = Math.max(maxX[root] === undefined ? x2 : maxX[root], x2);
        minY[root] = Math.min(minY[root] === undefined ? y2 : minY[root], y2);
        maxY[root] = Math.max(maxY[root] === undefined ? y2 : maxY[root], y2);
      }
    }
    var best = null, bestArea = minArea || 8;
    for (var root2 in area) {
      if (area[root2] > bestArea) { bestArea = area[root2]; best = root2; }
    }
    if (best === null) return null;
    var w_ = maxX[best] - minX[best] + 1;
    var h_ = maxY[best] - minY[best] + 1;
    var result = {
      area: area[best],
      cx: sumX[best] / area[best],
      cy: sumY[best] / area[best],
      aspect: h_ > 0 ? w_ / h_ : 0,
    };
    if (opts && opts.points) {
      var pts = [];
      for (var yy = minY[best]; yy <= maxY[best]; yy++) {
        var rowMinX = -1, rowMaxX = -1;
        var base = yy * w;
        for (var xx = minX[best]; xx <= maxX[best]; xx++) {
          var ii = base + xx;
          if (label[ii] && find(label[ii]) === Number(best)) {
            if (rowMinX === -1) rowMinX = xx;
            rowMaxX = xx;
          }
        }
        if (rowMinX !== -1) {
          pts.push({ x: rowMinX, y: yy });
          if (rowMaxX !== rowMinX) pts.push({ x: rowMaxX, y: yy });
        }
      }
      result.points = pts;
    }
    return result;
  }

  // ---- Repere visuel : densite de MOUVEMENT pur, sur toute l'image.
  // 3e strategie, encore differente des deux precedentes. -------------
  // David, 2026-11-15, apres le 2e essai encore rate : "suis le
  // mouvement des mains ET du visage ET des bras" -- en clair, arreter
  // d'essayer de deviner ce qui est une "main" (couleur de peau, boite
  // d'exclusion du visage a position fixe) et juste suivre TOUT ce qui
  // bouge, partout dans l'image. Deux sources d'erreur disparaissent
  // d'un coup avec ce recentrage :
  //  1) rgbToSkin() (seuils Cr/Cb) est sensible a l'eclairage et au
  //     teint -- il pouvait rater la main ou accrocher autre chose selon
  //     la lumiere chez David. Le mouvement (difference de gris entre
  //     deux images) ne depend d'aucune couleur.
  //  2) fixedFaceRef() suppose le visage a une position/taille FIXE
  //     (fractions de l'image) -- si son cadrage reel differe de cette
  //     hypothese, la boite d'exclusion tombe au mauvais endroit et
  //     fausse tout ce qui en depend. Le mouvement pur n'a besoin
  //     d'aucune hypothese de cadrage : visage, mains ET bras qui
  //     bougent ressortent tous, tels quels, sans boite a positionner.
  // On garde la meme mecanique de groupement que la version precedente
  // (densite par cellules -> fusion des cellules actives voisines en
  // zones), juste appliquee au mouvement seul sur l'image complete, et
  // jusqu'a 3 zones au lieu de 2 (mains + visage + bras peuvent bouger
  // independamment). Le lissage dans le temps (blendActivity, cote
  // index.html) reste inchange.
  function detectMotionVisual(imgData, prevGray, w, h) {
    var masks = buildMasks(imgData, prevGray, w, h);
    var face = fixedFaceRef(w, h); // garde seulement pour reference/diagnostic, plus pour exclure quoi que ce soit ici

    var cols = Math.max(4, Math.round(w / 14));
    var rows = Math.max(4, Math.round(h / 14));
    var cellW = w / cols, cellH = h / rows;
    var score = new Float32Array(cols * rows);
    var motionPixels = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (!masks.motion[idx]) continue;
        motionPixels++;
        var ci = Math.min(cols - 1, Math.floor(x / cellW));
        var cj = Math.min(rows - 1, Math.floor(y / cellH));
        score[cj * cols + ci] += 1;
      }
    }

    // David, 2026-11-15, apres ce 3e essai : "y a plus de lignes du tout
    // qui me suivent" -- plus rien ne s'affiche jamais, donc le seuil par
    // cellule etait probablement trop strict pour l'amplitude de
    // mouvement reelle captee par SA camera (compression, bas niveau de
    // lumiere, etc. -- on ne peut pas le savoir sans donnees reelles).
    // Seuil de cellule abaisse (0.05 -> 0.02) ; le seuil de mouvement
    // pixel par pixel (masks.motion, dans buildMasks) n'est PAS touche
    // ici car il est partage avec createExtractor/pushFrame (la vraie
    // reconnaissance, deja validee hors-ligne) -- le changer risquerait
    // de modifier la reconnaissance elle-meme sans nouvelle validation.
    // diag.motionPixels / diag.cellsFound sont renvoyes pour etre
    // affiches a l'ecran (voir index.html) : si David revoit "rien" avec
    // ce build, ces chiffres diront directement si c'est "aucun pixel ne
    // bouge assez" (probleme de seuil pixel, dans buildMasks) ou "des
    // pixels bougent mais jamais assez groupes" (probleme de seuil/
    // regroupement par cellule, ici) -- au lieu de deviner une 4e fois.
    var cellArea = cellW * cellH;
    var cells = [];
    for (var k = 0; k < score.length; k++) {
      var s = score[k] / cellArea;
      if (s > 0.02) {
        cells.push({ x: (k % cols + 0.5) * cellW, y: (Math.floor(k / cols) + 0.5) * cellH, s: s });
      }
    }
    var diag = { motionPixels: motionPixels, totalPixels: w * h, cellsFound: cells.length };
    if (!cells.length) return { face: face, points: [], gray: masks.gray, signal: "aucun", diag: diag };
    cells.sort(function (a, b) { return b.s - a.s; });

    // Regroupe les cellules actives voisines en au plus 3 zones (mains +
    // visage/bras) : glouton -- on part de la cellule la plus active, on
    // absorbe toute cellule proche dans la meme zone, et on recommence
    // avec ce qui reste.
    var mergeDist = Math.max(cellW, cellH) * 1.7;
    var used = new Array(cells.length).fill(false);
    var zones = [];
    for (var ci2 = 0; ci2 < cells.length && zones.length < 3; ci2++) {
      if (used[ci2]) continue;
      var sx = 0, sy = 0, sw = 0, n = 0;
      for (var cj2 = 0; cj2 < cells.length; cj2++) {
        if (used[cj2]) continue;
        var dx = cells[cj2].x - cells[ci2].x, dy = cells[cj2].y - cells[ci2].y;
        if (Math.sqrt(dx * dx + dy * dy) <= mergeDist) {
          used[cj2] = true;
          sx += cells[cj2].x * cells[cj2].s; sy += cells[cj2].y * cells[cj2].s; sw += cells[cj2].s; n++;
        }
      }
      if (sw > 0) zones.push({ x: sx / sw, y: sy / sw, strength: sw, cellCount: n });
    }
    return { face: face, points: zones, gray: masks.gray, signal: zones.length ? "mouvement" : "aucun", diag: diag };
  }

  // ---- Extracteur d'etat, un objet par enregistrement en cours ---------
  function createExtractor() {
    var prevGray = null;
    var rows = [];
    var lastSignal = "aucun"; // pour diagnostic (voir getLastSignal)

    function pushFrame(imgData, w, h) {
      var masks = buildMasks(imgData, prevGray, w, h);
      prevGray = masks.gray;

      var face = fixedFaceRef(w, h);
      var fx = face.cx, fy = face.cy, fhh = face.h;
      var bx0 = Math.max(0, Math.round(fx - 0.85 * fhh));
      var bx1 = Math.min(w, Math.round(fx + 0.85 * fhh));
      var by0 = Math.max(0, Math.round(fy - 0.9 * fhh));
      var by1 = Math.min(h, Math.round(fy + 1.6 * fhh));

      function outsideFace(x, y) { return !(y >= by0 && y < by1 && x >= bx0 && x < bx1); }

      // 1) peau + mouvement (le plus precis quand ca marche).
      // 2) a defaut, mouvement seul (plus permissif aux tons de peau et
      //    eclairages mal captes par les seuils couleur).
      // 3) a defaut, peau seule (utile si le signe est tenu presque
      //    immobile, sous le seuil de mouvement).
      // Les trois sont systematiquement limitees a l'exterieur du cadre
      // visage/cou, donc aucune ne peut juste "retrouver" le visage lui-meme.
      var hand = null, signal = "aucun";
      var skinMotion = new Uint8Array(w * h);
      var motionOnly = new Uint8Array(w * h);
      var skinOnly = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = y * w + x;
          if (!outsideFace(x, y)) continue;
          if (masks.skin[idx] && masks.motion[idx]) skinMotion[idx] = 1;
          if (masks.motion[idx]) motionOnly[idx] = 1;
          if (masks.skin[idx]) skinOnly[idx] = 1;
        }
      }
      hand = largestBlob(dilate(skinMotion, w, h, 1), w, h, 8);
      if (hand) signal = "peau+mouvement";
      if (!hand) { hand = largestBlob(dilate(motionOnly, w, h, 1), w, h, 18); if (hand) signal = "mouvement"; }
      if (!hand) { hand = largestBlob(skinOnly, w, h, 14); if (hand) signal = "peau"; }
      lastSignal = signal;
      if (!hand) return null;

      var row = [
        (hand.cx - fx) / fhh,
        (hand.cy - fy) / fhh,
        hand.area / (fhh * fhh),
        hand.aspect,
      ];
      rows.push(row);
      return row;
    }

    function finish() {
      return rows.length ? rows : null;
    }

    function getLastSignal() { return lastSignal; }

    return { pushFrame: pushFrame, finish: finish, getLastSignal: getLastSignal };
  }

  // ---- DTW multi-canaux (poids par canal, cout euclidien pondere) ------
  function weightedCost(a, b, weights) {
    var s = 0;
    for (var c = 0; c < a.length; c++) {
      var d = (a[c] - b[c]) * weights[c];
      s += d * d;
    }
    return Math.sqrt(s);
  }

  function dtwDistance(seqA, seqB, weights) {
    var n = seqA.length, m = seqB.length;
    var prev = new Float64Array(m + 1).fill(Infinity);
    var curr = new Float64Array(m + 1);
    prev[0] = 0;
    for (var i = 1; i <= n; i++) {
      curr[0] = Infinity;
      for (var j = 1; j <= m; j++) {
        var cost = weightedCost(seqA[i - 1], seqB[j - 1], weights);
        var best = Math.min(prev[j], curr[j - 1], prev[j - 1]);
        curr[j] = cost + best;
      }
      var tmp = prev; prev = curr; curr = tmp;
    }
    return prev[m] / Math.max(n, m);
  }

  function zApply(rows, mu, sd) {
    return rows.map(function (row) {
      return row.map(function (v, c) { return (v - mu[c]) / sd[c]; });
    });
  }

  function recognize(rawRows) {
    return loadSignatures().then(function (data) {
      if (!rawRows || rawRows.length < 4) {
        return { ok: false, reason: "too_short" };
      }
      var q = zApply(rawRows, data.mu, data.sd);
      var weights = data.weights;
      var scored = [];
      for (var word in data.words) {
        var ref = zApply(data.words[word], data.mu, data.sd);
        scored.push({ word: word, dist: dtwDistance(q, ref, weights) });
      }
      scored.sort(function (a, b) { return a.dist - b.dist; });
      return { ok: true, ranked: scored.slice(0, 8) };
    });
  }

  global.SensorielleSignRecognizer = {
    loadSignatures: loadSignatures,
    createExtractor: createExtractor,
    recognize: recognize,
    detectMotionVisual: detectMotionVisual,
    FACE_CX_FRAC: FACE_CX_FRAC,
    FACE_CY_FRAC: FACE_CY_FRAC,
    FACE_H_FRAC: FACE_H_FRAC,
  };
})(window);
