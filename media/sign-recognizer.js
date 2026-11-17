/* Sensorielle — reconnaissance de signes LSQ, 100% locale au navigateur.

   2026-11-16, changement de strategie (demande explicite de David, apres
   que les corrections precedentes -- normalisation visage, forme de main
   via extent/solidity, trois tentatives de suivi a deux mains -- aient
   toutes ete mesurees honnetement et plafonnent autour de 20% de bonne
   reponse en conditions reelles) : abandon du suivi par couleur de peau +
   mouvement (voir plus bas, buildMasks/largestBlob -- toujours present et
   utilise pour le nuage de points visuel en direct, mais plus pour la
   reconnaissance elle-meme). A la place : un vrai modele de detection des
   points-clefs de la main (21 points par main + etat de courbure par
   doigt), execute entierement dans le navigateur via TensorFlow.js
   (libraire "Human", MIT, voir media/human.esm.js) -- cette fois AVEC un
   modele telecharge (~7.5 Mo au premier chargement, mis en cache par le
   navigateur ensuite), contrairement a l'approche precedente qui s'en
   passait volontairement. Toujours 100% local : le modele tourne sur
   l'appareil, aucune image ni donnee n'est envoyee nulle part.
   Raison du changement : le suivi par couleur de peau ne pouvait
   fondamentalement pas distinguer la FORME de la main (doigts pointes,
   repliés, ecartes) au-dela de deux ratios d'aire grossiers -- un vrai
   modele de points-clefs donne la position de chaque doigt et son etat
   (tendu/plie), une information bien plus proche de ce qui distingue
   vraiment deux signes LSQ.

   Les signatures de reference (sign-signatures.json) sont, comme avant,
   construites en rejouant les 325 videos du dictionnaire a travers CE
   MEME CODE JS execute dans un vrai navigateur (voir build_hand_signatures
   dans le depot de travail) -- principe inchange : reference et requete
   en direct sortent du meme algorithme, jamais de deux implementations a
   maintenir en parallele. Seule difference avec avant : l'extraction se
   fait maintenant via un vrai navigateur (Playwright + Chromium, rendu
   WebGL) plutot que Node.js seul, puisque le modele a besoin d'un vrai
   contexte GPU/navigateur pour s'executer -- l'ancienne extraction en
   Node pur (pixels bruts, aucun GPU necessaire) n'est plus possible avec
   cette approche.

   Resultats mesures : voir le commentaire au-dessus de createExtractor et
   le rapport fait a David -- chiffres reels sur le pipeline complet
   (camera simulee + tout le code ci-dessous), jamais le chiffre hors-ligne
   optimiste de l'ancienne approche.

   --- Historique (pour memoire, approche abandonnee ci-dessus) ---
   Version precedente (2026-11-15, remplacant elle-meme une premiere piste
   MediaPipe abandonnee -- classifiait des formes de main generiques, pas
   de vrais mots LSQ) : aucun modele de vision par ordinateur telecharge,
   aucun reseau requis apres le chargement de la page. On suivait la
   trajectoire + la forme de la main en mouvement (couleur de peau +
   mouvement image par image, normalise par rapport a un repere visage de
   position/taille fixe affiche a l'ecran -- voir FACE_CX_FRAC etc. plus
   bas) puis on comparait la sequence enregistree aux 325 vraies videos du
   dictionnaire via une distance DTW (Dynamic Time Warping) multi-canaux.
   Ce principe de comparaison DTW reste identique aujourd'hui -- seule la
   maniere de decrire chaque image (les "canaux") a change.

   Resume de ce qui avait ete corrige sur l'approche couleur-de-peau avant
   son abandon (pour memoire, plus la cause directe d'aucun probleme
   aujourd'hui) : ajout de deux canaux de forme grossiers (extent,
   solidity) faute de vraie detection de forme ; correction d'un reglage
   de reference visage faux par un facteur ~2 qui faussait toute la
   normalisation ; passage d'une extraction de reference Python/OpenCV
   separee a une extraction par le meme code JS. Chaque correction a
   mesurablement aide (76.9%->84.6%->88.3% en test hors-ligne synthetique)
   mais ce test hors-ligne (paires d'images de la MEME video + deformation
   synthetique, jamais une vraie prise independante) s'est avere tres
   optimiste : teste honnetement sur le vrai pipeline (camera simulee,
   25 mots), le resultat reel plafonnait autour de 20%, d'ou le
   changement de strategie documente plus haut.
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

  // (2026-11-16 : convexHull/polygonArea/largestBlob -- le suivi de main
  // par blob couleur+mouvement, avec ses canaux "extent"/"solidity" comme
  // proxys grossiers de forme -- ont ete retires d'ici. Ils ne servaient
  // plus qu'a la reconnaissance, remplacee plus bas par un vrai modele de
  // points-clefs ; voir le commentaire d'en-tete du fichier. buildMasks/
  // dilate/rgbToSkin restent utilises par detectMotionPoints ci-dessous,
  // qui est seulement le nuage de points affiche en direct a l'ecran,
  // sans lien avec la reconnaissance.)

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

  // ---- Detection de main par points-clefs (2026-11-16) -----------------
  // Remplace l'ancien suivi par blob couleur+mouvement (voir commentaire
  // d'en-tete). "Human" (media/human.esm.js, MIT, tensorflow.js) est
  // charge une seule fois (import() dynamique -- fonctionne meme dans ce
  // script classique, pas de type="module" requis) puis reutilise pour
  // tous les enregistrements. modelBasePath pointe vers les 2 fichiers de
  // poids locaux (handtrack = detecteur de main, handlandmark-lite = 21
  // points-clefs + etat de courbure par doigt) -- jamais de reseau apres
  // le premier chargement/mise en cache par le navigateur.
  var HUMAN_MODULE_URL = "/media/human.esm.js";
  var HAND_MODEL_BASE = "/media/hand-model/";
  var humanInstance = null;
  var humanLoadPromise = null;

  function loadHuman() {
    if (humanInstance) return Promise.resolve(humanInstance);
    if (humanLoadPromise) return humanLoadPromise;
    humanLoadPromise = import(HUMAN_MODULE_URL).then(function (mod) {
      var Human = mod.default;
      // "webgl" est le bon choix pour un vrai telephone (vraie acceleration
      // GPU). global.__SENSORIELLE_TEST_BACKEND (jamais defini en
      // production) permet aux scripts de test de forcer "cpu" -- mesure
      // directe dans ce bac a sable sans vrai GPU (voir rapport a David) :
      // "webgl" y est en fait un GPU LOGICIEL (SwiftShader) anormalement
      // lent pour ce modele (~3s/image), alors que "cpu" (pur JS) y est
      // bien plus rapide (<15ms/image une fois stabilise) -- un artefact
      // de ce bac a sable precis, PAS une mesure du telephone de David.
      var human = new Human({
        backend: global.__SENSORIELLE_TEST_BACKEND || "webgl",
        modelBasePath: HAND_MODEL_BASE,
        cacheModels: true,
        validateModels: false,
        warmup: "full",
        debug: false,
        face: { enabled: false },
        body: { enabled: false },
        object: { enabled: false },
        segmentation: { enabled: false },
        gesture: { enabled: false },
        hand: {
          enabled: true,
          rotation: true,
          maxDetected: 2,
          // 0.3 (pas 0.4) : mesure directe sur les 325 videos de reference
          // -- a 0.4, 23 mots n'avaient AUCUNE image avec une main detectee
          // nulle part dans toute la video (donc aucune signature du tout,
          // pire que juste "peu fiable" -- ces mots ne pourraient plus
          // jamais etre reconnus). A 0.3, verifie que ca ne fait
          // qu'AJOUTER des images-limite aux mots qui avaient deja une
          // signature (jamais en retirer : voir le raisonnement dans le
          // rapport a David), donc aucun risque de regression pour les
          // mots qui marchaient deja a 0.4.
          minConfidence: 0.3,
          iouThreshold: 0.2,
          landmarks: true,
          detector: { modelPath: "handtrack.json" },
          skeleton: { modelPath: "handlandmark-lite.json" },
        },
      });
      // human.warmup() paye le cout ponctuel de compilation des shaders
      // WebGL (plusieurs secondes possible, surtout sans vrai GPU) a ce
      // moment-ci (chargement de la page / premier appel a loadHuman),
      // plutot que de le laisser arriver sans prevenir sur la toute
      // premiere image analysee pendant un enregistrement -- sinon cette
      // premiere image seule peut engloutir tout le temps d'enregistrement
      // (voir le commentaire sur sampleLoop, index.html).
      return human.load().then(function () { return human.warmup(); }).then(function () { humanInstance = human; return human; });
    });
    return humanLoadPromise;
  }

  // Precharge le modele dès que ce script est pret (avant meme un premier
  // clic sur Demarrer) pour que le premier enregistrement de l'utilisateur
  // n'attende pas ~1s de chargement/compilation GPU. Best-effort : une
  // erreur ici (ex. WebGL indisponible) sera simplement re-tentee par le
  // vrai appel dans pushFrame, qui gere son propre echec (voir catch plus
  // bas, lastSignal "erreur:...").
  loadHuman().catch(function () {});

  // 2026-11-16 : mesure directe (voir rapport a David) -- human.warmup()
  // compile les shaders WebGL pour la taille d'image qu'IL utilise en
  // interne (~8s la toute premiere fois dans ce sandbox sans vrai GPU),
  // mais TensorFlow.js recompile un jeu de shaders SEPARE pour chaque
  // NOUVELLE taille de canvas rencontree -- donc le premier vrai appel a
  // detect() sur le canvas de travail reel (WORK_W x WORK_H, qui depend
  // de la forme video de la camera) repayait ENCORE ~2s de compilation,
  // silencieusement, pendant le premier enregistrement de l'utilisateur
  // (vu en test : un seul "tick" en 6 secondes). warmupFor(w, h) lance ce
  // cout une seule fois, des que la taille reelle de travail est connue
  // (voir sizeWorkCanvas, index.html) et donc largement avant le premier
  // clic sur Demarrer -- jamais pendant un enregistrement.
  function warmupFor(w, h) {
    return loadHuman().then(function (human) {
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, w, h);
      return human.detect(cv);
    }).catch(function () {});
  }

  var CURL_NUM = { none: 0, half: 0.5, full: 1 };
  var DIR_VEC = {
    verticalUp: [0, -1], verticalDown: [0, 1],
    horizontalLeft: [-1, 0], horizontalRight: [1, 0],
    diagonalUpRight: [0.7071, -0.7071], diagonalUpLeft: [-0.7071, -0.7071],
    diagonalDownRight: [0.7071, 0.7071], diagonalDownLeft: [-0.7071, 0.7071],
  };
  var FINGERS5 = ["thumb", "index", "middle", "ring", "pinky"];

  // Construit les caracteristiques d'UNE main detectee, normalisees par
  // rapport au meme repere visage fixe qu'avant (fx,fy,fhh -- voir
  // fixedFaceRef) pour rester comparable entre une signature extraite
  // hors-ligne et une camera de telephone a une toute autre resolution/
  // distance. "openness"/"curlAvg" (moyenne sur les 5 doigts, pas le
  // pouce seul) et "dirX"/"dirY" (direction de la paume, 8 directions ->
  // vecteur unite) sont la vraie nouveaute par rapport a l'ancien
  // extent/solidity : une estimation directe de la FORME de la main,
  // doigt par doigt, plutot qu'un proxy d'aire du rectangle englobant.
  function handFeatures(h, fx, fy, fhh) {
    var box = h.box; // [x,y,w,h] en pixels, repere de l'image fournie
    var cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2;
    var curlSum = 0, openCount = 0, nFingers = 0;
    if (h.landmarks) {
      for (var i = 0; i < FINGERS5.length; i++) {
        var lm = h.landmarks[FINGERS5[i]];
        if (!lm) continue;
        nFingers++;
        var cv = CURL_NUM[lm.curl];
        curlSum += (cv === undefined ? 0.5 : cv);
        if (lm.curl === "none") openCount++;
      }
    }
    var dir = (h.landmarks && h.landmarks.palm && DIR_VEC[h.landmarks.palm.direction]) || [0, 0];
    return {
      present: 1,
      ncx: (cx - fx) / fhh,
      ncy: (cy - fy) / fhh,
      narea: (box[2] * box[3]) / (fhh * fhh),
      aspect: box[3] > 0 ? box[2] / box[3] : 0,
      openness: nFingers ? openCount / nFingers : 0.5,
      curlAvg: nFingers ? curlSum / nFingers : 0.5,
      dirX: dir[0],
      dirY: dir[1],
      rawCx: cx,
      rawCy: cy,
    };
  }

  // Valeurs "neutres" utilisees seulement si AUCUNE main n'a encore ete
  // vue dans tout l'enregistrement en cours (sinon on reconduit la
  // derniere valeur connue -- voir carryForward). Le canal "present"
  // reste la seule chose qui compte vraiment ici : il sera toujours 0
  // quand on utilise ces valeurs.
  function neutralFeatures() {
    return { present: 0, ncx: 0, ncy: 0, narea: 0, aspect: 1, openness: 0.5, curlAvg: 0.5, dirX: 0, dirY: 0, rawCx: 0, rawCy: 0 };
  }

  // Quand une main (typiquement la secondaire) n'est pas detectee CETTE
  // image precise mais l'a ete un peu avant dans le meme enregistrement,
  // on reconduit sa derniere position/forme connue plutot que de la
  // remettre a zero -- ca evite un saut artificiel dans la distance DTW
  // a chaque clignotement d'une detection par ailleurs instable d'une
  // image a l'autre (le modele peut rater une main une image sur deux
  // sans que la main ait reellement bouge). "present" reste 0 : c'est le
  // signal honnete que cette image precise n'a rien vu, le reste n'est
  // qu'une estimation de continuite.
  function carryForward(current, last) {
    if (current) return current;
    var base = last || neutralFeatures();
    return {
      present: 0, ncx: base.ncx, ncy: base.ncy, narea: base.narea, aspect: base.aspect,
      openness: base.openness, curlAvg: base.curlAvg, dirX: base.dirX, dirY: base.dirY,
      rawCx: base.rawCx, rawCy: base.rawCy,
    };
  }

  // ---- Extracteur d'etat, un objet par enregistrement en cours ---------
  // pushFrame est maintenant ASYNCHRONE (le modele tourne sur le GPU via
  // WebGL, pas un simple calcul de pixels synchrone comme avant) -- voir
  // index.html, la boucle d'echantillonnage attend chaque appel avant de
  // programmer le suivant plutot que d'utiliser un setInterval fixe, pour
  // ne jamais empiler deux inferences en vol si une image est plus lente
  // que les autres a traiter.
  function createExtractor() {
    var rows = [];
    var lastSignal = "aucun"; // pour diagnostic (voir getLastSignal)
    var lastA = null, lastB = null; // derniere main A/B connue (voir carryForward)
    var lastInterDist = 0;
    var scratchCanvas = null, scratchCtx = null;

    function pushFrame(imgData, w, h) {
      return loadHuman().then(function (human) {
        if (!scratchCanvas) {
          scratchCanvas = document.createElement("canvas");
          scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: false });
        }
        if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
          scratchCanvas.width = w;
          scratchCanvas.height = h;
        }
        // Accepte un vrai ImageData (camera live) ou un objet "fake"
        // {data:...} (utilise par les scripts d'extraction hors-ligne) --
        // on passe toujours par un vrai ImageData pour rester independant
        // de la source.
        var realImgData = (typeof ImageData !== "undefined" && imgData instanceof ImageData)
          ? imgData
          : new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        scratchCtx.putImageData(realImgData, 0, 0);

        return human.detect(scratchCanvas).then(function (result) {
          var hands = (result && result.hand) ? result.hand.slice() : [];
          // Ordre gauche->droite a l'ecran (pas un identifiant de suivi
          // interne au modele, dont la stabilite d'une image a l'autre
          // n'a pas ete verifiee) -- main A = la plus a gauche. Simple,
          // mais suffisant tant que les deux mains ne se croisent pas
          // completement pendant le signe.
          hands.sort(function (p, q) {
            return (p.box[0] + p.box[2] / 2) - (q.box[0] + q.box[2] / 2);
          });

          var face = fixedFaceRef(w, h);
          var fx = face.cx, fy = face.cy, fhh = face.h;

          var fA = hands[0] ? handFeatures(hands[0], fx, fy, fhh) : null;
          var fB = hands[1] ? handFeatures(hands[1], fx, fy, fhh) : null;

          if (!fA) {
            // Rien d'exploitable cette image -- meme semantique qu'avant
            // (voir l'ancien "if (!hand) return null;") : ce cycle ne
            // compte pas comme un signal, mais on garde quand meme la
            // derniere position de la main secondaire en memoire pour la
            // prochaine image ou la main A reapparaitra.
            lastSignal = fB ? "main secondaire seule" : "aucun";
            return null;
          }
          lastSignal = fB ? "deux mains" : "une main";

          if (fB) lastB = fB;
          var useB = carryForward(fB, lastB);

          var interDist = 0;
          if (fA && fB) {
            var dx = (fA.rawCx - fB.rawCx) / fhh, dy = (fA.rawCy - fB.rawCy) / fhh;
            interDist = Math.sqrt(dx * dx + dy * dy);
            lastInterDist = interDist;
          } else {
            interDist = lastInterDist;
          }
          lastA = fA;

          var row = [
            fA.present, fA.ncx, fA.ncy, fA.narea, fA.aspect, fA.openness, fA.curlAvg, fA.dirX, fA.dirY,
            useB.present, useB.ncx, useB.ncy, useB.narea, useB.aspect, useB.openness, useB.curlAvg, useB.dirX, useB.dirY,
            interDist,
          ];
          rows.push(row);
          return row;
        });
      }).catch(function (e) {
        lastSignal = "erreur:" + (e && e.message ? e.message : String(e));
        return null;
      });
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
    loadHuman: loadHuman,
    warmupFor: warmupFor,
    FACE_CX_FRAC: FACE_CX_FRAC,
    FACE_CY_FRAC: FACE_CY_FRAC,
    FACE_H_FRAC: FACE_H_FRAC,
  };
})(window);
