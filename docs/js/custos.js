// Preços e estimativa de custo por análise (modelo "Jev primeiro, Claude de reserva").
// Fontes (out/2026): tabela oficial da API Anthropic; TypeSafe Jev (US$ 0,04 / 1M tokens
// de entrada, saída gratuita). Premissas calibradas com as análises reais dos PDFs de demonstração.

export const PRECOS = {
  // US$ por 1 milhão de tokens. Gravação de cache = 1,25 × entrada.
  "claude-opus-5-5": { nome: "Claude Opus 5.5", entrada: 4.0, saida: 20.0, cacheLeitura: 0.2 },
  "claude-sonnet-5-5": { nome: "Claude Sonnet 5.5", entrada: 2.0, saida: 10.0, cacheLeitura: 0.2 },
  "claude-haiku-5-5": { nome: "Claude Haiku 5.5", entrada: 0.1, saida: 0.5, cacheLeitura: 0.01 },
  "jev-latest": { nome: "TypeSafe Jev", entrada: 0.04, saida: 0, cacheLeitura: 0.04 },
};

export const MODELOS_CLAUDE = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Custo real de uma chamada a partir do `usage` devolvido pela API. */
export function custoDeUso(modelo, uso) {
  const p = PRECOS[modelo] ?? PRECOS["claude-opus-5-5"];
  const t = {
    entrada: uso?.input_tokens ?? 0,
    saida: uso?.output_tokens ?? 0,
    cacheGravacao: uso?.cache_creation_input_tokens ?? 0,
    cacheLeitura: uso?.cache_read_input_tokens ?? 0,
  };
  const usd =
    (t.entrada * p.entrada + t.cacheGravacao * p.entrada * 1.25 + t.cacheLeitura * p.cacheLeitura + t.saida * p.saida) /
    1e6;
  return { modelo, tokens: t, usd };
}

// Tokens por etapa (medidos nos testes reais; ajustar com o custo real registrado pelo app).
export const PREMISSAS = {
  jevPorAnalise: 15000, // extração + critérios (medido: 12–20 mil)
  ocrEntradaPorPagina: 2600, // Claude transcrevendo PDF escaneado
  ocrSaidaPorPagina: 800,
  extracaoEntrada: 6000, // Claude completando campos em que o Jev ficou em dúvida
  extracaoSaida: 4500,
  criteriosEntrada: 3500, // Claude revisando critérios com confiança < 80%
  criteriosSaida: 900,
};

const usd = (modelo, entrada, saida) => (entrada * PRECOS[modelo].entrada + saida * PRECOS[modelo].saida) / 1e6;

/**
 * Custo esperado por análise.
 * fracoes: parcela dos pedidos escaneados, com dúvida na extração e com dúvida nos critérios.
 */
export function estimarAnalise({ paginas = 5, modeloClaude = "claude-opus-5-5", escaneados = 0, duvidaExtracao = 0, duvidaCriterios = 0 } = {}, P = PREMISSAS) {
  const etapas = [
    { etapa: "Jev (extração + critérios)", usd: usd("jev-latest", P.jevPorAnalise, 0) },
    {
      etapa: `Transcrição de escaneados — ${PRECOS[modeloClaude].nome}`,
      usd: escaneados * usd(modeloClaude, P.ocrEntradaPorPagina * paginas, P.ocrSaidaPorPagina * paginas),
    },
    { etapa: `Dúvidas na extração — ${PRECOS[modeloClaude].nome}`, usd: duvidaExtracao * usd(modeloClaude, P.extracaoEntrada, P.extracaoSaida) },
    { etapa: `Dúvidas nos critérios — ${PRECOS[modeloClaude].nome}`, usd: duvidaCriterios * usd(modeloClaude, P.criteriosEntrada, P.criteriosSaida) },
    { etapa: "Regras, anonimização e parecer", usd: 0 },
  ];
  return { etapas, total: etapas.reduce((s, e) => s + e.usd, 0) };
}
