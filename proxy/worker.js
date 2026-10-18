// Servidor intermediário (Cloudflare Worker) do protótipo de auditoria.
//
// • Guarda as chaves do Jev e do Claude como "secrets" — elas nunca chegam ao navegador.
// • Exige a senha de acesso (cabeçalho x-acesso) definida por você.
// • Só aceita chamadas vindas do site (ORIGENS_PERMITIDAS) e só repassa duas rotas:
//     POST /jev                  → TypeSafe Jev  (/v1/systemone)
//     POST /claude/v1/messages   → Anthropic     (/v1/messages)
//     GET  /saude                → confere senha e chaves configuradas
//
// Secrets (wrangler secret put …):  SENHA_ACESSO, TYPESAFE_API_KEY, ANTHROPIC_API_KEY
// Variável (wrangler.toml):          ORIGENS_PERMITIDAS
// Opcional:                          ANTHROPIC_WORKSPACE_ID (só para chaves sem workspace)

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const ANTHROPIC_URL = "https://api.anthropic.com";

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

const json = (corpo, status, cabecalhos) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cabecalhos, "Content-Type": "application/json" } });

function repassar(resposta, cors) {
  const h = new Headers(cors);
  h.set("Content-Type", resposta.headers.get("Content-Type") ?? "application/json");
  for (const k of ["request-id", "retry-after", "x-typesafe-request-id"]) {
    const v = resposta.headers.get(k);
    if (v) h.set(k, v);
  }
  return new Response(resposta.body, { status: resposta.status, headers: h });
}

export default {
  async fetch(req, env) {
    const origem = req.headers.get("Origin") ?? "";
    const permitidas = (env.ORIGENS_PERMITIDAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const origemOk = origem === "" || permitidas.includes(origem);
    const cors = origem && origemOk
      ? {
          "Access-Control-Allow-Origin": origem,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "content-type, x-acesso",
          "Access-Control-Expose-Headers": "request-id, retry-after",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : {};

    if (req.method === "OPTIONS") return new Response(null, { status: origemOk ? 204 : 403, headers: cors });
    if (!origemOk) return json({ erro: "Origem não permitida." }, 403, cors);
    if (!env.SENHA_ACESSO || !iguais(req.headers.get("x-acesso") ?? "", env.SENHA_ACESSO)) {
      return json({ type: "error", error: { type: "permission_error", message: "Senha de acesso incorreta." } }, 403, cors);
    }

    const url = new URL(req.url);

    if (url.pathname === "/saude" && req.method === "GET") {
      return json({ ok: true, jev: Boolean(env.TYPESAFE_API_KEY), claude: Boolean(env.ANTHROPIC_API_KEY) }, 200, cors);
    }

    if (url.pathname === "/jev" && req.method === "POST") {
      const r = await fetch(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
        body: req.body,
      });
      return repassar(r, cors);
    }

    if (url.pathname === "/claude/v1/messages" && req.method === "POST") {
      const h = new Headers({
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
      });
      const beta = req.headers.get("anthropic-beta");
      if (beta) h.set("anthropic-beta", beta);
      // Chaves de usuário (não ligadas a um workspace) exigem o ID do workspace.
      if (env.ANTHROPIC_WORKSPACE_ID) h.set("anthropic-workspace-id", env.ANTHROPIC_WORKSPACE_ID);
      const r = await fetch(`${ANTHROPIC_URL}/v1/messages${url.search}`, { method: "POST", headers: h, body: req.body });
      return repassar(r, cors);
    }

    return json({ erro: "Rota não encontrada." }, 404, cors);
  },
};
