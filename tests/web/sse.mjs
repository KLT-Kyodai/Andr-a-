// Fabrique les réponses en flux (SSE) de l'API Anthropic pour les tests.

/**
 * @param blocks  blocs de la réponse : { text: "…" } (découpé en morceaux par « | »)
 *                ou { tool: "nom", input: {…}, id?: "…" }
 * @param stop    stop_reason final
 */
export function sseMessage(blocks, stop = "end_turn") {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  ];
  blocks.forEach((block, index) => {
    if (block.text !== undefined) {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const piece of block.text.split("|")) {
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
      }
    } else {
      events.push({
        type: "content_block_start", index,
        content_block: { type: "tool_use", id: block.id ?? `toolu_${index}`, name: block.tool, input: {} },
      });
      events.push({
        type: "content_block_delta", index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  events.push({ type: "message_stop" });
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/** Faux `fetch` : renvoie les réponses données, dans l'ordre, et note les requêtes reçues. */
export function fakeFetch(responses) {
  const queue = [...responses];
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next?.status) {
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
    }
    return new Response(next, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch, requests };
}
