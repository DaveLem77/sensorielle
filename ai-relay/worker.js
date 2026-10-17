// Serveur relais (Cloudflare Worker) entre le site Sensorielle et l'API
// Claude d'Anthropic. Rôle : recevoir une phrase + la liste des mots qui
// ont un signe disponible, et renvoyer une reformulation de cette phrase
// qui n'utilise QUE ces mots-là (ou le plus proche possible), pour les
// cas où le mot exact dit à voix haute n'a pas de signe.
//
// La clé API Anthropic ne vit QUE dans les secrets de ce Worker (jamais
// dans le code du site, jamais visible par qui que ce soit d'autre) —
// voir ai-relay/DEPLOIEMENT.txt pour l'installation complète.
//
// 2026-10-13 : David a signalé que l'IA proposait parfois un mot qui
// n'existe pas dans ses vidéos (ex. "salut"), ce qui faisait échouer
// TOUTE la réponse (le filtre après-coup l'enlevait, laissant 0 mot).
// Avant, on demandait juste par texte à l'IA de respecter la liste —
// une simple consigne qu'elle pouvait mal suivre. Maintenant, on force
// l'appel à passer par un "outil" (tool use) dont le schéma JSON limite
// CHAQUE mot à un "enum" = exactement la liste fournie : l'IA ne peut
// structurellement pas produire autre chose qu'un mot de la liste. Le
// filtre après-coup reste en place en plus, par sécurité (défense en
// profondeur), mais ce n'est plus la seule barrière.

const ALLOWED_ORIGIN = "https://sensorielle.ca";
const TOOL_NAME = "choisir_signes";

// 2026-10-16 : ce même Worker sert maintenant aussi de "guichet de
// jetons" pour AssemblyAI (reconnaissance vocale en ligne, qui
// remplace le moteur buggé de Safari). Le navigateur ne reçoit
// JAMAIS la vraie clé ASSEMBLYAI_API_KEY : il demande ici un jeton
// temporaire (valide 60 secondes, juste pour se connecter), que ce
// Worker seul est capable de générer puisque lui seul connaît la
// vraie clé (gardée dans ses secrets, comme ANTHROPIC_API_KEY).
const ASSEMBLYAI_TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

const SYSTEM_PROMPT = `Tu aides à traduire une phrase française vers la langue des signes québécoise (LSQ), mais le vocabulaire de signes disponible est limité à une liste fixe.
On te donne une phrase et la liste EXACTE des mots qui ont un signe disponible. Utilise l'outil fourni pour répondre — tu ne peux de toute façon choisir que des mots qui apparaissent dans la liste, l'outil ne te laisse pas en sortir.
Choisis les mots dans un ordre logique pour les signer, et reformule/paraphrase la phrase avec ces mots pour garder le sens le mieux possible — sois créatif, cherche des synonymes et des mots reliés au sens général plutôt que d'abandonner trop vite. Exemple : pour une salutation comme "comment vas-tu aujourd'hui", s'il y a dans la liste un mot comme "comment", "content", "bien" ou "aller", utilise-les même si ce n'est pas une traduction mot à mot parfaite — transmettre l'intention générale de la phrase vaut mieux que rien du tout.
Choisis une liste vide UNIQUEMENT si vraiment AUCUN mot de la liste n'a de lien, même approximatif, avec la phrase. Un seul mot qui garde un peu de sens vaut toujours mieux qu'une liste vide.`;

function corsHeaders(extra) {
  return Object.assign(
    {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    extra || {}
  );
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

// Jeton temporaire AssemblyAI (GET /stt-token) : le site l'appelle à
// chaque fois qu'il doit (re)connecter le micro, jamais la clé elle-
// même. "expires_in_seconds" court exprès : même intercepté, ce jeton
// ne resterait valide qu'une minute et ne sert qu'à ouvrir une
// connexion, jamais à en ouvrir d'autres après coup.
async function handleSttTokenRequest(request, env) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!env.ASSEMBLYAI_API_KEY) {
    return json({ error: "ASSEMBLYAI_API_KEY non configurée sur ce Worker" }, 500);
  }

  let resp;
  try {
    resp = await fetch(ASSEMBLYAI_TOKEN_URL + "?expires_in_seconds=60", {
      method: "GET",
      headers: { Authorization: env.ASSEMBLYAI_API_KEY },
    });
  } catch (e) {
    return json({ error: "appel AssemblyAI impossible: " + e.message }, 502);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return json({ error: "AssemblyAI a répondu " + resp.status + " : " + errText.slice(0, 300) }, 502);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return json({ error: "réponse AssemblyAI illisible" }, 502);
  }

  if (!data || typeof data.token !== "string") {
    return json({ error: "AssemblyAI n'a pas renvoyé de jeton" }, 502);
  }

  return json({ token: data.token });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const path = new URL(request.url).pathname;
    if (path === "/stt-token" || path === "/stt-token/") {
      return handleSttTokenRequest(request, env);
    }

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY non configurée sur ce Worker" }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "JSON invalide" }, 400);
    }

    const sentence = typeof body.sentence === "string" ? body.sentence.slice(0, 500) : "";
    const vocabulary = Array.isArray(body.vocabulary)
      ? body.vocabulary.filter((w) => typeof w === "string").slice(0, 400)
      : [];

    if (!sentence.trim() || vocabulary.length === 0) {
      return json({ words: [] });
    }

    const userPrompt = 'Phrase : "' + sentence.trim() + '"';

    // Le schéma de l'outil contraint CHAQUE élément du tableau "words" à
    // être l'un des mots exacts de "vocabulary" (enum) — c'est Anthropic,
    // pas l'IA elle-même, qui empêche un mot hors liste d'être choisi.
    const tool = {
      name: TOOL_NAME,
      description:
        "Choisit, dans l'ordre, les mots à signer pour représenter la phrase — strictement tirés de la liste de vocabulaire fournie.",
      input_schema: {
        type: "object",
        properties: {
          words: {
            type: "array",
            description:
              "Mots à signer dans l'ordre. Liste vide si vraiment aucun mot de la liste n'a de lien avec la phrase.",
            items: { type: "string", enum: vocabulary },
            maxItems: 30,
          },
        },
        required: ["words"],
      },
    };

    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          tools: [tool],
          tool_choice: { type: "tool", name: TOOL_NAME },
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
    } catch (e) {
      return json({ error: "appel API Anthropic impossible: " + e.message }, 502);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return json({ error: "Anthropic a répondu " + resp.status + " : " + errText.slice(0, 300) }, 502);
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      return json({ error: "réponse Anthropic illisible" }, 502);
    }

    const toolUse = (data.content || []).find((b) => b && b.type === "tool_use" && b.name === TOOL_NAME);
    let words = toolUse && toolUse.input && Array.isArray(toolUse.input.words) ? toolUse.input.words : [];

    // Filtre de sécurité en plus (défense en profondeur) : même si le
    // schéma devrait déjà garantir ceci, on ne fait jamais confiance à
    // 100% à une IA — seuls des mots EXACTEMENT dans la liste fournie
    // peuvent ressortir d'ici.
    const vocabSet = new Set(vocabulary);
    words = words.filter((w) => typeof w === "string" && vocabSet.has(w)).slice(0, 30);

    return json({ words: words });
  },
};
