// Conexões com as IAs.
// • No site: tudo passa pelo servidor intermediário (Cloudflare Worker), que guarda
//   as chaves. O navegador só conhece a URL do servidor e a senha de acesso.
// • Nos testes em Node: chamadas diretas com as chaves do arquivo .env.

import Anthropic from "@anthropic-ai/sdk"; // navegador: import map → CDN; Node: node_modules
import { custoDeUso } from "./custos.js";

const JEV_URL_DIRETA = "https://api.typesafe.ai/v1/systemone";
const MODELOS_COM_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function criarConexao({ proxyUrl, senha, chaveClaude, chaveJev, workspaceClaude }) {
  if (proxyUrl) {
    const base = proxyUrl.replace(/\/+$/, "");
    return {
      modo: "proxy",
      claude: new Anthropic({
        apiKey: "guardada-no-servidor",
        baseURL: `${base}/claude`,
        dangerouslyAllowBrowser: true,
        defaultHeaders: { "x-acesso": senha },
      }),
      jev: { url: `${base}/jev`, headers: { "x-acesso": senha } },
      saude: { url: `${base}/saude`, headers: { "x-acesso": senha } },
    };
  }
  return {
    modo: "direto",
    claude: chaveClaude
      ? new Anthropic({
          apiKey: chaveClaude,
          dangerouslyAllowBrowser: true,
          defaultHeaders: workspaceClaude ? { "anthropic-workspace-id": workspaceClaude } : {},
        })
      : null,
    jev: chaveJev ? { url: JEV_URL_DIRETA, headers: { Authorization: `Bearer ${chaveJev}` } } : null,
  };
}

/** Verifica servidor e senha. Devolve { ok, jev, claude } ou lança erro legível. */
export async function testarConexao(conexao) {
  if (conexao.modo !== "proxy") return { ok: Boolean(conexao.jev), jev: Boolean(conexao.jev), claude: Boolean(conexao.claude) };
  let r;
  try {
    r = await fetch(conexao.saude.url, { headers: conexao.saude.headers });
  } catch {
    throw new Error("Servidor intermediário inacessível. Confira a URL.");
  }
  if (r.status === 401 || r.status === 403) throw new Error("Senha de acesso incorreta.");
  if (!r.ok) throw new Error(`Servidor respondeu HTTP ${r.status}.`);
  return r.json();
}

// ── Jev ──────────────────────────────────────────────────────────────────────

/** Uma requisição ao Jev: `estado` (texto) + perguntas tipadas (noul / choice / score). */
export async function perguntarJev(conexao, estado, perguntas, modelo = "jev-latest") {
  if (!conexao.jev) throw new Error("Jev não configurado.");
  let r;
  try {
    r = await fetch(conexao.jev.url, {
      method: "POST",
      headers: { ...conexao.jev.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, state: estado, questions: perguntas }),
    });
  } catch {
    throw new Error("Jev inacessível (rede ou servidor intermediário).");
  }
  if (r.status === 401 || r.status === 403) throw new Error("Senha de acesso incorreta.");
  if (!r.ok) throw new Error(`Jev respondeu HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { respostas: d.answers ?? {}, custo: custoDeUso("jev-latest", d.usage), modelo: d.model };
}

// ── Claude ───────────────────────────────────────────────────────────────────

function verificarParada(resposta) {
  if (resposta.stop_reason === "refusal") {
    throw new Error(`A IA recusou a análise (${resposta.stop_details?.category ?? "sem categoria"}).`);
  }
  if (resposta.stop_reason === "max_tokens") {
    throw new Error("Resposta da IA truncada (limite de tokens).");
  }
}

async function criarMensagem(conexao, params) {
  if (!conexao.claude) throw new Error("Claude não configurado.");
  try {
    return MODELOS_COM_FALLBACK.has(params.model)
      ? await conexao.claude.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await conexao.claude.messages.create(params);
  } catch (e) {
    throw traduzirErro(e);
  }
}

const textoDa = (resposta) => resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
const modeloCobrado = (resposta, pedido) =>
  /^claude-(opus|sonnet|haiku)-5-5$/.test(resposta.model ?? "") ? resposta.model : pedido;

/** Saída JSON garantida por schema (structured outputs). */
export async function claudeJSON(conexao, { modelo, sistema, conteudo, schema, esforco, maxTokens = 16000 }) {
  const resposta = await criarMensagem(conexao, {
    model: modelo,
    max_tokens: maxTokens,
    system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: conteudo }],
    output_config: { effort: esforco, format: { type: "json_schema", schema } },
  });
  verificarParada(resposta);
  return { dados: JSON.parse(textoDa(resposta)), custo: custoDeUso(modeloCobrado(resposta, modelo), resposta.usage) };
}

/** Saída em texto livre (usada na transcrição de PDF escaneado). */
export async function claudeTexto(conexao, { modelo, sistema, conteudo, esforco, maxTokens = 16000 }) {
  const resposta = await criarMensagem(conexao, {
    model: modelo,
    max_tokens: maxTokens,
    system: sistema,
    messages: [{ role: "user", content: conteudo }],
    output_config: { effort: esforco },
  });
  verificarParada(resposta);
  return { texto: textoDa(resposta), custo: custoDeUso(modeloCobrado(resposta, modelo), resposta.usage) };
}

function traduzirErro(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error("Chave da API Claude inválida (no servidor ou no .env).");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("A chave Claude não tem permissão para este modelo, ou a senha de acesso está errada.");
  if (e instanceof Anthropic.RateLimitError) return new Error("Limite de uso da API Claude atingido. Aguarde e tente de novo.");
  if (e instanceof Anthropic.BadRequestError) return new Error(`Requisição recusada pela API Claude: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("Falha de conexão com a API Claude.");
  if (e instanceof Anthropic.APIError) return new Error(`Erro da API Claude (${e.status}): ${e.message}`);
  return e;
}
