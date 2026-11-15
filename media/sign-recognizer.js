/* Sensorielle — reconnaissance de signes LSQ, 100% locale au navigateur.
   Ajoute le 2026-11-15 (demande de David) pour remplacer l'ancienne piste
   MediaPipe (abandonnee - classifiait des formes de main generiques, pas
   de vrais mots LSQ). Nouvelle approche : aucun modele de vision par
   ordinateur telecharge, aucun reseau requis apres le chargement de la
   page. On suit la trajectoire + la forme de la main en mouvement (couleur
   de peau + mouvement image par image, normalise par rapport au visage
   detecte par la meme technique) puis on compare la sequence enregistree
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

  function rgbToSkin(r, g, b) {
    // Conversion YCrCb (BT.601) + seuils classiques peau. Pas de
    // dependance externe, juste de l'arithmetique.
    var y = 0.299 * r + 0.587 * g + 0.114 * b;
    var cr = (r - y) * 0.713 + 128;
    var cb = (b - y) * 0.564 + 128;
    return cr >= 135 && cr <= 180 && cb >= 85 && cb <= 135;
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
  function largestBlob(mask, w, h, minArea) {
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
    return {
      area: area[best],
      cx: sumX[best] / area[best],
      cy: sumY[best] / area[best],
      aspect: h_ > 0 ? w_ / h_ : 0,
    };
  }

  // ---- Extracteur d'etat, un objet par enregistrement en cours ---------
  function createExtractor() {
    var faceRef = null; // {cx, cy, h} lisse (EMA)
    var prevGray = null;
    var rows = [];

    function pushFrame(imgData, w, h) {
      var masks = buildMasks(imgData, prevGray, w, h);
      prevGray = masks.gray;

      // Visage = plus gros blob de peau peu mobile (dans le haut de
      // l'image, ou le visage se trouve typiquement face camera).
      var stillSkin = new Uint8Array(w * h);
      for (var i = 0; i < w * h; i++) {
        stillSkin[i] = masks.skin[i] && !masks.motion[i] ? 1 : 0;
      }
      var faceBlob = largestBlob(stillSkin, w, h, 20);
      if (faceBlob) {
        var fh = Math.max(6, Math.sqrt(faceBlob.area) * 1.6);
        if (!faceRef) {
          faceRef = { cx: faceBlob.cx, cy: faceBlob.cy, h: fh };
        } else {
          faceRef.cx = 0.8 * faceRef.cx + 0.2 * faceBlob.cx;
          faceRef.cy = 0.8 * faceRef.cy + 0.2 * faceBlob.cy;
          faceRef.h = 0.8 * faceRef.h + 0.2 * fh;
        }
      }
      if (!faceRef) return null; // pas encore de reference -> on attend

      // Zone visage/cou a exclure, meme geometrie que la version Python.
      var fx = faceRef.cx, fy = faceRef.cy, fhh = faceRef.h;
      var bx0 = Math.max(0, Math.round(fx - 0.8 * fhh));
      var bx1 = Math.min(w, Math.round(fx + 0.8 * fhh));
      var by0 = Math.max(0, Math.round(fy - 0.9 * fhh));
      var by1 = Math.min(h, Math.round(fy + 1.5 * fhh));

      var movingHand = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) {
        var inBand = y >= by0 && y < by1;
        for (var x = 0; x < w; x++) {
          var idx = y * w + x;
          if (!masks.skin[idx] || !masks.motion[idx]) continue;
          if (inBand && x >= bx0 && x < bx1) continue; // visage/cou exclu
          movingHand[idx] = 1;
        }
      }
      movingHand = dilate(movingHand, w, h, 1);
      var hand = largestBlob(movingHand, w, h, 10);
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

    return { pushFrame: pushFrame, finish: finish };
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
  };
})(window);
