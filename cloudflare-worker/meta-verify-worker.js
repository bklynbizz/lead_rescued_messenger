// Cloudflare Worker: Meta Webhook Verification & Proxy
// Deployed at: meta-verify.bklynbizz.workers.dev
// Purpose: Handles Meta GET verification (n8n can't receive GET behind CF Tunnel)
//          and forwards POST messages to n8n webhook

export default {
  async fetch(request) {
    // Handle Meta's one-time GET verification challenge
    if (request.method === "GET") {
      const url = new URL(request.url);
      const challenge = url.searchParams.get("hub.challenge");
      const token = url.searchParams.get("hub.verify_token");

      if (challenge && token === "leadrescued2026") {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response("bad token", { status: 403 });
    }

    // Forward all POST messages to n8n webhook (WF2: YES Reply Handler)
    if (request.method === "POST") {
      const body = await request.text();
      const resp = await fetch(
        "https://n8n.hindsightx.com/webhook/lr-messenger-reply",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
        }
      );
      return new Response(await resp.text(), { status: resp.status });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
