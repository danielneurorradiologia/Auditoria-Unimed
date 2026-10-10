// Clientes de IA: Claude (SDK oficial, direto do navegador) e TypeSafe Jev (HTTP).
// As chaves ficam só no navegador do usuário (localStorage) — protótipo pessoal.

import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
import { custoDeUso } from "./custos.js";

// Modelos com fallback do lado do servidor em caso de recusa por classificador.
const COM_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function criarClienteClaude(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/**
 * Chamada com saída JSON garantida por schema (structured outputs).
 * `conteudo` é o array de blocos da mensagem do usuário (PDF, texto...).
 */
export async function chamarClaudeJSON(cliente, { modelo, sistema, conteudo, schema, esforco, maxTokens = 16000 }) {
  const params = {
    model: modelo,
    max_tokens: maxTokens,
    system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: conteudo }],
    output_config: { effort: esforco, format: { type: "json_schema", schema } },
  };

  let resposta;
  try {
    resposta = COM_FALLBACK.has(modelo)
      ? await cliente.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await cliente.messages.create(params);
  } catch (e) {
    throw traduzirErro(e);
  }

  if (resposta.stop_reason === "refusal") {
    throw new Error(`A IA recusou a análise (${resposta.stop_details?.category ?? "sem categoria"}).`);
  }
  if (resposta.stop_reason === "max_tokens") {
    throw new Error("Resposta da IA truncada (limite de tokens). Tente de novo ou divida o documento.");
  }
  const texto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const modeloUsado = PRECO_CONHECIDO(resposta.model) ? resposta.model : modelo;
  return { dados: JSON.parse(texto), custo: custoDeUso(modeloUsado, resposta.usage) };
}

const PRECO_CONHECIDO = (m) => typeof m === "string" && /^claude-(opus|sonnet|haiku)-5-5$/.test(m);

function traduzirErro(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error("Chave da API Claude inválida.");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("A chave não tem permissão para este modelo.");
  if (e instanceof Anthropic.RateLimitError) return new Error("Limite de uso da API atingido. Aguarde e tente de novo.");
  if (e instanceof Anthropic.BadRequestError) return new Error(`Requisição recusada pela API: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("Falha de conexão com a API Claude.");
  if (e instanceof Anthropic.APIError) return new Error(`Erro da API Claude (${e.status}): ${e.message}`);
  return e;
}

// ── TypeSafe Jev ─────────────────────────────────────────────────────────────
// Formato conforme documentação pública (POST /v1/systemone: state + questions).
// EXPERIMENTAL: se a API não aceitar chamadas diretas do navegador (CORS), o
// motor cai automaticamente para o Claude.

const JEV_URL = "https://api.typesafe.ai/v1/systemone";

export async function chamarJev(apiKey, { estado, perguntas, modelo = "jev-latest" }) {
  let r;
  try {
    r = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, state: estado, questions: perguntas }),
    });
  } catch {
    throw new Error("Jev inacessível pelo navegador (rede ou CORS).");
  }
  if (!r.ok) throw new Error(`Jev respondeu HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { respostas: d.answers ?? {}, custo: custoDeUso("jev-latest", d.usage) };
}
