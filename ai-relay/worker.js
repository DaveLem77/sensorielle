// Serveur relais (Cloudflare Worker) entre le site Sensorielle et l'API
// Claude d'Anthropic. Rôle : recevoir une phrase + la liste des mots qui
// ont un signe disponible, et renvoyer une reformulation de cette phrase
// qui n'utilise QUE ces mots-là (ou le plus proche possible), pour les
// cas où le mot exact dit à voix haute n'a pas de signe.
//
// La clé API Anthropic ne vit QUE dans les secrets de ce Worker (jamais
// dans le code du site, jamais visible par qui que ce soit d'autre) —
// voir ai-relay/DEPLOIEMENT.txt pour l'installation complète.

const ALLOWED_ORIGIN = "https://sensorielle.ca";

const SYSTEM_PROMPT = `Tu aides à traduire une phrase française vers la langue des signes québécoise (LSQ), mais le vocabulaire de signes disponible est limité à une liste fixe.
On te donne une phrase et la liste EXACTE des mots qui ont un signe disponible.
Réponds UNIQUEMENT avec un tableau JSON de mots (ex: ["manger","banane"]), dans un ordre logique pour les signer, en utilisant SEULEMENT des mots qui apparaissent exactement, orthographe identique, dans la liste fournie.
Reformule/paraphrase la phrase avec ces mots pour garder le sens le mieux possible.
Si un mot ou une idée de la phrase n'a vraiment aucun équivalent raisonnable dans la liste, omets-le simplement plutôt que d'inventer un mot hors liste.
Si rien dans la liste ne convient à la phrase, réponds avec un tableau vide [].
Ne réponds jamais avec autre chose qu'un tableau JSON valide — aucune explication, aucun texte autour.`;

function corsHeaders(extra) {
  return Object.assign(
    {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
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

    const userPrompt =
      'Phrase : "' + sentence.trim() + '"\n\n' +
      "Mots disponibles (utilise exactement ces mots-ci, rien d'autre) :\n" +
      vocabulary.join(", ");

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
          max_tokens: 200,
          system: SYSTEM_PROMPT,
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

    const text = (data.content && data.content[0] && data.content[0].text) || "[]";
    let words;
    try {
      const match = text.match(/\[[\s\S]*\]/);
      words = JSON.parse(match ? match[0] : text);
    } catch (e) {
      words = [];
    }
    if (!Array.isArray(words)) words = [];

    const vocabSet = new Set(vocabulary);
    words = words.filter((w) => typeof w === "string" && vocabSet.has(w)).slice(0, 30);

    return json({ words: words });
  },
};
