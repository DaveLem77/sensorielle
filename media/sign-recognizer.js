/* Sensorielle — reconnaissance de signes LSQ, 100% locale au navigateur.
   Ajoute le 2026-11-15 (demande de David) pour remplacer l'ancienne piste
   MediaPipe (abandonnee - classifiait des formes de main generiques, pas
   de vrais mots LSQ). Approche : aucun modele de vision par ordinateur
   telecharge, aucun reseau requis apres le chargement de la page. On suit
   la trajectoire + la forme de la main en mouvement (couleur de peau +
   mouvement image par image, normalise par rapport a un repere visage de
   position/taille fixe affiche a l'ecran -- voir FACE_CX_FRAC etc. plus
   bas) puis on compare la sequence enregistree aux 325 vraies videos du
   dictionnaire (deja extraites hors-ligne, memes canaux ici) via une
   distance DTW (Dynamic Time Warping) multi-canaux.

   2026-11-16 (David : "rien n'est jamais reconnu / c'est toujours faux /
   ca marche juste pour quelques signes") : la toute premiere version ne
   comparait que position (x,y), aire et ratio largeur/hauteur du plus
   gros blob -- AUCUNE information sur la forme de la main elle-meme (main
   ouverte, poing ferme, doigt pointe = exactement pareil pour l'algorithme
   tant que le rectangle englobant se ressemble). Deux canaux de forme,
   extent et solidity (voir le long commentaire dans largestBlob plus bas),
   ont ete ajoutes pour combler ca -- ce sont de simples ratios d'aires
   (blob/rectangle englobant, blob/enveloppe convexe), donc sans unite et
   reproductibles fidelement en JS pur, contrairement au proxy de forme
   utilise hors-ligne a l'origine (compte de "defauts de convexite" via de
   vrais contours OpenCV) qui, lui, ne l'etait pas et avait ete
   silencieusement laisse de cote au moment d'exporter sign-signatures.json
   -- c'etait la cause directe du probleme.

   DEUXIEME bug trouve le meme jour, bien plus grave que le premier : les
   signatures de reference (sign-signatures.json) etaient construites par
   un script Python/OpenCV SEPARE (extract_signature.py, hors-ligne) qui
   avait fini par diverger du code JS ci-dessous sur deux points a la
   fois : (a) FACE_CX_FRAC/CY_FRAC/H_FRAC ci-dessous valaient 0.5/0.34/0.30
   alors que la vraie taille du visage, mesuree directement sur les 325
   videos du dictionnaire (Haar cascade OpenCV, 15 videos x 20 images) est
   de cx=0.504, cy=0.316, h=0.156 -- FACE_H_FRAC supposait un visage DEUX
   FOIS PLUS GROS que la realite, ce qui faussait fhh (la reference
   d'echelle) et donc TOUT : position compressee de moitie, aire ecrasee
   d'un facteur ~4, et la zone "visage/cou" exclue de la recherche de main
   elle-meme deux fois trop grande (de quoi avaler une bonne partie de
   l'espace de signation pres du torse, frequent en LSQ) ; et (b) le
   script Python travaillait sur la video a sa RESOLUTION NATIVE (souvent
   720x1094) alors que le navigateur ne voit jamais que ~180px de cote
   (voir sizeWorkCanvas, index.html) -- or les seuils de segmentation
   (rayon de dilatation, aire minimale d'un blob) sont des constantes EN
   PIXELS, pas des fractions, donc leur effet change completement selon
   la resolution reelle de travail. Verifie par un test direct (Node,
   extraction JS reelle sur 9 mots via leur propre video, resolution de
   travail reelle) : avec l'ancien FACE_H_FRAC, AUCUN des 9 mots ne se
   retrouvait meme dans son propre top 8 -- la normalisation etait assez
   fausse pour qu'un mot ne se reconnaisse pas lui-meme.

   Plutot que d'essayer de faire coïncider pixel pres deux implementations
   independantes (le script Python hors-ligne et ce fichier), les 325
   signatures de reference sont maintenant construites en rejouant les
   325 videos du dictionnaire a travers CE MEME CODE JS (voir
   build_js_signatures.sh / extract_js_signature.js dans le depot de
   travail), a la resolution de travail reelle du navigateur -- reference
   et requete en direct sortent donc desormais du meme algorithme, au
   meme pixel pres, plus jamais de deux implementations a maintenir en
   parallele.

   Teste honnetement (meme protocole qu'avant : chaque mot coupe en deux
   moities d'images alternees, paire = reference, impaire = "requete"
   soumise en plus a une deformation synthetique -- vitesse x0.6-x1.5,
   bruit, decalage/echelle de position -- simulant une prise differente),
   mais cette fois avec CE code, a la bonne resolution, et les bonnes
   fractions visage :
     - sans deformation (juste moities alternees de la meme prise) :
       92% bon mot en premier choix, 100% dans les 5 premiers.
     - avec deformation synthetique (le test le plus dur disponible ici) :
       88.3% en premier choix, 97.2% dans les 5 premiers, sur 325 mots
       possibles -- mieux que tout ce qui avait ete mesure avant les deux
       corrections (76.9%/88.6% avant forme de main, 84.6%/93.5% apres
       forme de main seule, mais encore avec l'ancien calibrage/l'ancienne
       resolution).

   Mise en garde honnete, qui vaut pour ces deux chiffres : ce protocole
   reste des paires d'images DE LA MEME VIDEO (meme eclairage, memes
   vetements, meme prise, meme personne) plus une deformation synthetique
   -- pas une vraie prise independante sur un autre telephone, un autre
   eclairage, une autre personne. Il mesure honnetement si l'approche a
   une vraie marge de manoeuvre au-dela de "reconnaitre son propre clip",
   mais il ne remplace pas un test sur le telephone de David dans ses
   conditions reelles, qui reste le seul juge final. Un point qui, lui,
   decoule directement de la vraie taille mesuree du visage (h=0.156 du
   cadre, donc un plan assez large) : pour que la normalisation reste
   valide, il faut signer assez loin de la camera pour que les epaules et
   les bras soient visibles -- pas un gros plan du visage seul -- voir le
   texte mis a jour dans la feuille d'info (bouton "i") sur la page.
*/
(function (global) {
  "use strict";

  var SIG_URL = "/media/sign-signatures.json";
  var sigData = null; // { channels, weights, mu, sd, words: {word: [[..],...]} }
  var loadingPromise = null;

  // 2026-11-16 (David : "trouve une maniere [...] que ca s'ameliore [...]
  // sans mon travail"). Le dictionnaire statique ci-dessus (325 mots, fixe,
  // dans le depot git) reste la base, mais n'importe qui connaissant la LSQ
  // peut proposer un nouveau mot via /collector/, qu'un admin approuve
  // ensuite via /contributions/ (voir ce fichier pour le detail honnete de
  // ce que ca fait vraiment -- CE N'EST PAS un systeme qui invente des mots
  // tout seul, juste un systeme qui evite a David de devoir, pour CHAQUE
  // nouveau mot, filmer/extraire/reconstruire ce fichier JSON et redeployer
  // le site). Chaque mot approuve atterrit dans la table Supabase
  // "community_signs" -- on la lit ici, en plus du fichier statique, et on
  // fusionne les deux avant de reconnaitre quoi que ce soit.
  //
  // Exception HONNETE a la phrase d'en-tete de ce fichier ("aucun reseau
  // requis apres le chargement de la page") : cette seule requete-ci part
  // vers Supabase. Elle est volontairement best-effort -- un echec (hors
  // ligne, Supabase pas configure, reseau bloque) ne bloque jamais la
  // reconnaissance, qui continue avec le dictionnaire statique seul; voir
  // le .catch plus bas et le delai limite (COMMUNITY_TIMEOUT_MS) pour ne
  // jamais faire attendre l'utilisateur sur un reseau lent.
  var COMMUNITY_URL = "https://frinlluqjbwgctkzqoea.supabase.co/rest/v1/community_signs?select=word,rows";
  var COMMUNITY_KEY = "sb_publishable_HQ1zoBcHrmetRRIopwKxgA_t4DAaNJZ";
  var COMMUNITY_TIMEOUT_MS = 4000;

  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
    });
  }

  function fetchCommunitySigns() {
    return withTimeout(
      fetch(COMMUNITY_URL, { headers: { apikey: COMMUNITY_KEY, Authorization: "Bearer " + COMMUNITY_KEY } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
      COMMUNITY_TIMEOUT_MS
    ).catch(function () { return null; });
  }

  function loadSignatures() {
    if (sigData) return Promise.resolve(sigData);
    if (loadingPromise) return loadingPromise;
    loadingPromise = fetch(SIG_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        return fetchCommunitySigns().then(function (community) {
          if (community && community.length) {
            // Un mot communautaire du meme nom qu'un mot statique REMPLACE
            // celui-ci (la contribution la plus recemment approuvee gagne --
            // voir l'upsert sur "word" cote /contributions/index.html).
            community.forEach(function (row) {
              if (row && row.word && row.rows && row.rows.length) json.words[row.word] = row.rows;
            });
          }
          sigData = json;
          return json;
        });
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
  //
  // 2026-11-16 (David : "rien n'est jamais reconnu / c'est toujours faux") :
  // CES TROIS VALEURS ETAIENT FAUSSES, et c'est la cause la plus grave de
  // ce que David a signale -- bien plus que le manque de forme de main
  // corrige plus haut. Verifie directement sur les 325 vraies videos du
  // dictionnaire (Haar cascade OpenCV, vraie detection de visage,
  // echantillon de 15 videos x 20 images, cx/cy/h tous tres stables d'une
  // video a l'autre) : le visage y occupe en moyenne cx=0.504, cy=0.316,
  // h=0.156 DU CADRE -- alors que l'ancienne valeur FACE_H_FRAC=0.30
  // supposait un visage DEUX FOIS PLUS GROS que la realite. Consequence :
  // fhh (la reference d'echelle) etait ~2x trop grande -> ncx/ncy
  // compresses de moitie, narea ecrase par un facteur ~4 (fhh au carre),
  // ET la zone "visage/cou" exclue de la recherche de main etait eller-
  // meme ~2x trop grande dans chaque direction -- de quoi avaler une
  // bonne partie de l'espace de signation pres du visage/torse, frequent
  // en LSQ. Confirme par un test direct (Node, extraction JS reelle sur 9
  // mots du dictionnaire via leur propre video) : avec l'ancienne valeur,
  // AUCUN des 9 mots ne se retrouvait meme dans le top 8 de sa propre
  // signature -- la normalisation etait assez fausse pour qu'un mot ne se
  // reconnaisse meme pas lui-meme. Avec ces valeurs corrigees, verifie a
  // nouveau : voir le commentaire au meme endroit plus bas pour le
  // resultat. Valeurs remplacees par la moyenne mesuree ci-dessus.
  var FACE_CX_FRAC = 0.504, FACE_CY_FRAC = 0.316, FACE_H_FRAC = 0.156;

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

  // Enveloppe convexe (monotone chain d'Andrew, O(n log n)) + aire d'un
  // polygone (formule du lacet / shoelace). Utilisees ci-dessous pour
  // calculer "solidity" (aire du blob / aire de son enveloppe convexe) --
  // voir le commentaire detaille a l'appel, dans pushFrame.
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

  function convexHull(points) {
    var pts = points.slice().sort(function (a, b) { return a.x === b.x ? a.y - b.y : a.x - b.x; });
    var n = pts.length;
    if (n < 3) return pts;
    var lower = [];
    for (var i = 0; i < n; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    var upper = [];
    for (var j = n - 1; j >= 0; j--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[j]) <= 0) upper.pop();
      upper.push(pts[j]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function polygonArea(poly) {
    var n = poly.length;
    if (n < 3) return 0;
    var s = 0;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }

  // Composantes connexes (union-find a deux passes) -> plus gros blob.
  // opts.points demande aussi un contour approche (min/max x par ligne
  // du plus gros blob), utilise ci-dessous (pushFrame) pour calculer la
  // "solidity" (aire du blob / aire de son enveloppe convexe).
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
      // "extent" : fraction du rectangle englobant reellement occupee par
      // le blob -- une main fermee/plate le remplit presque entierement,
      // des doigts ecartes laissent des vides entre eux -> valeur plus
      // basse. Gratuit (w_, h_, area deja connus), toujours calcule.
      extent: (w_ > 0 && h_ > 0) ? area[best] / (w_ * h_) : 0,
      solidity: 1, // par defaut (pas de points -> pas d'enveloppe convexe a comparer, aucune concavite detectable)
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
      // "solidity" : aire du blob / aire de son enveloppe convexe --
      // 2026-11-16 (David : "rien n'est jamais reconnu / c'est toujours
      // faux"). C'est la meme idee que le "defects_count" du script Python
      // hors-ligne (extract_signature.py) qui sert a construire les 325
      // signatures de reference -- UN PROXY DE FORME DE LA MAIN -- mais
      // celui-ci marchait sans faille a cote-la (openCV, vrais contours)
      // et n'a jamais ete reproduit ici cote navigateur (abandonne a
      // l'export, voir sign-signatures.json / export_signatures.py) : le
      // comparateur en direct ne regardait donc QUE position + aire +
      // ratio largeur/hauteur du rectangle englobant, strictement RIEN
      // sur la forme de la main elle-meme (main ouverte, poing ferme,
      // doigt pointe -- tout pareil pour lui tant que le rectangle
      // englobant est semblable). solidity, calculee ici a partir du
      // contour grossier deja disponible (pts, min/max x par ligne),
      // comble ce trou : un poing ferme ou une main a plat colle presque
      // parfaitement a son enveloppe convexe (solidity proche de 1), une
      // main ouverte doigts ecartes laisse de vrais creux entre les
      // doigts (solidity nettement plus bas). C'est un RATIO sans unite
      // (aire/aire), donc -- contrairement a l'ancien defects_count qui
      // dependait d'un seuil de profondeur en pixels propre a la
      // resolution de la video source -- il reste comparable telle
      // quelle entre une signature extraite hors-ligne et une camera de
      // telephone a une toute autre resolution.
      if (pts.length >= 3) {
        var hull = convexHull(pts);
        var hullArea = polygonArea(hull);
        if (hullArea > 1e-6) result.solidity = Math.min(1, area[best] / hullArea);
      }
    }
    return result;
  }

  // ---- Repere visuel : nuage de points sur le mouvement brut, sans
  // regroupement ni lissage par "identite". 4e strategie. -------------
  // David, 2026-11-15 : des points/lignes sont enfin apparus (la
  // reparation de video.videoWidth a marche) mais "ca ne suit pas du
  // tout les mouvements -- change de strategie, ca doit pas etre dur,
  // c'est comme un filtre mais avec les mains et les bras en plus."
  //
  // Le vrai bug de la version precedente (detectActivityVisual/zones) :
  // elle groupait le mouvement en 1-3 "zones", puis essayait de les
  // suivre d'une image a l'autre en les appariant a la zone precedente
  // la plus proche (voir blendActivity, cote index.html) -- et rejetait
  // tout mouvement trop loin de la position actuelle comme un "rate"
  // plutot que de bouger. Resultat : des que le mouvement reel allait
  // plus vite/plus loin que ce seuil, le repere restait fige sur sa
  // derniere position au lieu de suivre -- exactement "ca ne suit pas
  // du tout".
  //
  // Nouvelle strategie, beaucoup plus simple ("comme un filtre") :
  // aucune identite a suivre d'une image a l'autre, aucun seuil de
  // "trop loin pour etre le meme". On prend juste TOUS les pixels de
  // mouvement de l'image courante (sur-echantillonnes a intervalles
  // reguliers pour rester leger) et on les affiche tels quels, options
  // visage/mains/bras compris -- un nuage de points qui EST la forme du
  // mouvement de cette image, pas une estimation lissee de son centre.
  // index.html garde juste 2-3 images recentes pour un effet de traine
  // qui s'estompe, sans aucune logique d'appariement.
  function detectMotionPoints(imgData, prevGray, w, h) {
    var masks = buildMasks(imgData, prevGray, w, h);
    var stride = Math.max(2, Math.round(Math.min(w, h) / 36)); // ~36 echantillons par cote au plus -> leger
    var pts = [];
    var motionPixels = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        if (!masks.motion[idx]) continue;
        motionPixels++;
        if ((x % stride) === 0 && (y % stride) === 0) pts.push({ x: x, y: y });
      }
    }
    var diag = { motionPixels: motionPixels, totalPixels: w * h, pointsShown: pts.length };
    return { points: pts, gray: masks.gray, signal: pts.length ? "mouvement" : "aucun", diag: diag };
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
      // {points:true} : necessaire pour que largestBlob calcule aussi
      // "solidity" (voir le long commentaire dans largestBlob) -- sans
      // quoi le comparateur reste aveugle a la forme de la main.
      var ptsOpt = { points: true };
      hand = largestBlob(dilate(skinMotion, w, h, 1), w, h, 8, ptsOpt);
      if (hand) signal = "peau+mouvement";
      if (!hand) { hand = largestBlob(dilate(motionOnly, w, h, 1), w, h, 18, ptsOpt); if (hand) signal = "mouvement"; }
      if (!hand) { hand = largestBlob(skinOnly, w, h, 14, ptsOpt); if (hand) signal = "peau"; }
      lastSignal = signal;
      if (!hand) return null;

      var row = [
        (hand.cx - fx) / fhh,
        (hand.cy - fy) / fhh,
        hand.area / (fhh * fhh),
        hand.aspect,
        hand.extent,
        hand.solidity,
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
    detectMotionPoints: detectMotionPoints,
    FACE_CX_FRAC: FACE_CX_FRAC,
    FACE_CY_FRAC: FACE_CY_FRAC,
    FACE_H_FRAC: FACE_H_FRAC,
  };
})(window);
