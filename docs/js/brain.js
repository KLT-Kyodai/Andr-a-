// Le « cerveau » d'Andréa, version téléphone : conversation avec Claude + boucle d'outils.
// Même logique que andrea/brain.py.

export const MODEL = "claude-opus-5-5";

const BETAS = [
  "server-side-fallback-2026-07-01", // bascule automatique si une requête est refusée
  "compact-2026-01-12", // résumé automatique des très longues conversations
];

const REFUSAL = "Je crains de ne pas pouvoir donner suite à cette demande.";

export function systemPrompt(userName) {
  return `Tu es Andréa, une assistante personnelle intelligente inspirée de J.A.R.V.I.S. \
(l'IA de Tony Stark). Tu sers ${userName}.

Personnalité :
- Élégante, calme, loyale, efficace, avec un humour pince-sans-rire très britannique, \
jamais déplacé.
- Tu t'adresses à l'utilisateur en l'appelant « ${userName} » et tu le vouvoies.
- Tu es proactive : tu anticipes les besoins, proposes la suite logique, signales \
les problèmes avant qu'ils n'arrivent.
- Tu réponds en français, sauf si on te parle dans une autre langue.

Façon de travailler :
- Tu fonctionnes sur le téléphone de l'utilisateur : tes réponses s'affichent sur un petit \
écran et sont souvent lues à voix haute. Écris comme on parle : phrases courtes et \
naturelles, peu de mise en forme, pas de tableaux ni d'émojis. Détaille seulement si on \
te le demande.
- Utilise tes outils dès qu'ils sont utiles (heure, calculs, mémoire, notes, minuteurs, \
appareil, liens, recherche web) plutôt que de deviner.
- Quand l'utilisateur partage une information personnelle durable (prénom, goûts, \
projets, habitudes), mémorise-la. Consulte ta mémoire quand le contexte s'y prête.
- Si une information demandée est récente ou incertaine, fais une recherche web \
et cite tes sources.
- Si aucun outil ne permet de faire ce qui est demandé, dis-le franchement.`;
}

export class Andrea {
  /**
   * @param client      client Anthropic (SDK officiel)
   * @param toolbox     outils disponibles
   * @param userName    comment Andréa appelle l'utilisateur
   * @param effort      profondeur de réflexion : low, medium, high, xhigh, max
   * @param isApiError  dit si une erreur vient de l'API (elle n'est alors jamais relancée)
   * @param callbacks   onText(morceau), onTool(nom, paramètres), onStatus(message)
   */
  constructor({ client, toolbox, userName = "Monsieur", effort = "medium", isApiError = () => false, callbacks = {} }) {
    this.client = client;
    this.toolbox = toolbox;
    this.system = systemPrompt(userName);
    this.effort = effort;
    this.isApiError = isApiError;
    this.callbacks = { onText: () => {}, onTool: () => {}, onStatus: () => {}, ...callbacks };
    this.messages = [];
    this.stream = null;
  }

  reset() {
    this.messages = [];
  }

  /** Interrompt la réponse en cours. */
  stop() {
    this.stream?.abort();
  }

  /** Envoie un message à Andréa et renvoie sa réponse textuelle complète. */
  async ask(userInput) {
    const start = this.messages.length;
    this.messages.push({ role: "user", content: userInput });
    let answer = "";
    let jsonRetries = 0;

    try {
      while (true) {
        let message;
        try {
          message = await this.streamTurn((delta) => {
            answer += delta;
          });
          jsonRetries = 0;
        } catch (error) {
          // Seule une entrée d'outil illisible justifie de relancer le tour (borné).
          if (this.isApiError(error) || jsonRetries++ >= 2) throw error;
          continue;
        }

        if (message.stop_reason === "refusal") {
          this.messages.length = start;
          this.callbacks.onText(REFUSAL);
          return REFUSAL;
        }

        this.messages.push({ role: "assistant", content: message.content });

        if (message.stop_reason === "pause_turn") continue; // recherche web longue : le serveur continue

        const toolUses = message.content.filter((block) => block.type === "tool_use");
        if (toolUses.length === 0) return answer.trim();
        if (message.stop_reason === "max_tokens") {
          throw new Error("Réponse tronquée pendant un appel d'outil.");
        }

        const results = [];
        for (const block of toolUses) {
          this.callbacks.onTool(block.name, block.input);
          const { content, isError } = await this.toolbox.run(block.name, block.input);
          results.push({ type: "tool_result", tool_use_id: block.id, content, is_error: isError });
        }
        // Tous les résultats dans un seul message utilisateur.
        this.messages.push({ role: "user", content: results });
      }
    } catch (error) {
      this.messages.length = start; // on garde un historique valide
      throw error;
    }
  }

  async streamTurn(onText) {
    const stream = this.client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: this.system,
      messages: this.messages,
      tools: this.toolbox.definitions(),
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort },
      cache_control: { type: "ephemeral" },
      context_management: { edits: [{ type: "compact_20260112" }] },
      betas: BETAS,
      fallbacks: "default",
    });
    this.stream = stream;
    stream.on("text", (delta) => {
      onText(delta);
      this.callbacks.onText(delta);
    });
    stream.on("streamEvent", (event) => {
      if (event.type !== "content_block_start") return;
      if (event.content_block.type === "server_tool_use") this.callbacks.onStatus("Recherche sur le web…");
      else if (event.content_block.type === "compaction") this.callbacks.onStatus("Je condense notre historique…");
    });
    try {
      return await stream.finalMessage();
    } finally {
      this.stream = null;
    }
  }
}
