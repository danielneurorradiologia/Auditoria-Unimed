// Preços e estimativa de custo por análise.
// Fontes (out/2026): tabela oficial da API Anthropic; Jev — páginas de preço da TypeSafe
// e de revendedores (US$ 0,04–0,06 / 1M tokens de entrada, saída gratuita). Conferir antes de usar.

export const PRECOS = {
  // US$ por 1 milhão de tokens. Gravação de cache = 1,25 × entrada.
  "claude-opus-5-5": { nome: "Claude Opus 5.5", entrada: 4.0, saida: 20.0, cacheLeitura: 0.2 },
  "claude-sonnet-5-5": { nome: "Claude Sonnet 5.5", entrada: 2.0, saida: 10.0, cacheLeitura: 0.2 },
  "claude-haiku-5-5": { nome: "Claude Haiku 5.5", entrada: 0.1, saida: 0.5, cacheLeitura: 0.01 },
  "jev-latest": { nome: "TypeSafe Jev", entrada: 0.04, saida: 0, cacheLeitura: 0.04 },
};

/** Perfis de custo. O padrão é qualidade máxima; os demais são opção do usuário. */
export const PERFIS = {
  qualidade: {
    nome: "Qualidade máxima — Opus 5.5 em tudo",
    extracao: "claude-opus-5-5",
    decisor: "claude",
    julgamento: "claude-opus-5-5",
  },
  equilibrado: {
    nome: "Equilibrado — Sonnet 5.5 em tudo",
    extracao: "claude-sonnet-5-5",
    decisor: "claude",
    julgamento: "claude-sonnet-5-5",
  },
  hibrido: {
    nome: "Híbrido — Sonnet 5.5 + Jev (dúvidas → Opus 5.5)",
    extracao: "claude-sonnet-5-5",
    decisor: "jev",
    julgamento: "claude-opus-5-5",
  },
  economico: {
    nome: "Econômico — Haiku 5.5 + Jev (dúvidas → Sonnet 5.5)",
    extracao: "claude-haiku-5-5",
    decisor: "jev",
    julgamento: "claude-sonnet-5-5",
  },
};

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

// Premissas de tokens por análise (ajustar com o custo real medido pelo app).
export const PREMISSAS = {
  tokensPorPagina: 2500, // página escaneada: imagem + texto
  extracaoPrompt: 2500, // instruções + schema
  extracaoSaida: 4500, // JSON (~2,5k) + raciocínio (~2k)
  julgamentoEntrada: 8000, // protocolo + caso + instruções
  julgamentoSaida: 7000, // JSON (~3k) + raciocínio (~4k)
  jevEntrada: 5000, // estado do caso + 7 perguntas
  escalonamentoEntrada: 6000, // só os critérios duvidosos
  escalonamentoSaida: 4000,
  fracaoEscalonada: 0.3, // % dos casos em que o Jev fica abaixo do limiar de confiança
};

const usd = (modelo, entrada, saida) => (entrada * PRECOS[modelo].entrada + saida * PRECOS[modelo].saida) / 1e6;

/** Estimativa por análise (US$), detalhada por etapa. */
export function estimarAnalise(perfilId, paginas, premissas = PREMISSAS) {
  const perfil = PERFIS[perfilId];
  const P = premissas;
  const etapas = [];
  etapas.push({
    etapa: `Extração (${PRECOS[perfil.extracao].nome})`,
    usd: usd(perfil.extracao, P.extracaoPrompt + paginas * P.tokensPorPagina, P.extracaoSaida),
  });
  if (perfil.decisor === "claude") {
    etapas.push({
      etapa: `Julgamento dos critérios (${PRECOS[perfil.julgamento].nome})`,
      usd: usd(perfil.julgamento, P.julgamentoEntrada, P.julgamentoSaida),
    });
  } else {
    etapas.push({ etapa: "Critérios (Jev)", usd: usd("jev-latest", P.jevEntrada, 0) });
    etapas.push({
      etapa: `Escalonamento de dúvidas (${PRECOS[perfil.julgamento].nome}, ${Math.round(P.fracaoEscalonada * 100)}% dos casos)`,
      usd: P.fracaoEscalonada * usd(perfil.julgamento, P.escalonamentoEntrada, P.escalonamentoSaida),
    });
  }
  etapas.push({ etapa: "Regras determinísticas + parecer", usd: 0 });
  return { perfil: perfil.nome, etapas, total: etapas.reduce((s, e) => s + e.usd, 0) };
}
