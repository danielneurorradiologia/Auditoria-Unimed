// Motor de regras determinístico: tudo que pode ser verificado sem IA.
// Funções puras (sem rede, sem DOM) — testadas em tests/regras.test.mjs.

const VASCULARES = new Set(["angio_tc", "angio_rm", "angiografia_digital"]);
const SEM_MARCA = new Set(["torneira", "conector_y", "outro"]);

const NOMES_CATEGORIA = {
  introdutor: "Introdutor",
  bainha_longa: "Bainha longa",
  cateter_guia: "Cateter-guia",
  cateter_diagnostico: "Cateter diagnóstico",
  cateter_acesso_distal: "Cateter de acesso distal",
  guia: "Fio-guia",
  microcateter: "Microcateter",
  microcateter_balao: "Microcateter balão",
  microguia: "Microguia",
  mola: "Molas (coils)",
  stent_intracraniano: "Stent intracraniano",
  diversor_fluxo: "Diversor de fluxo",
  dispositivo_intrassacular: "Dispositivo intrassacular",
  torneira: "Torneira",
  conector_y: "Conector em Y",
  monitorizacao_neurofisiologica: "Monitorização neurofisiológica",
  outro: "Outros",
};

export function nomeCategoria(cat) {
  return NOMES_CATEGORIA[cat] ?? cat;
}

/** Aneurismas que serão tratados neste procedimento. */
export function aneurismasAlvo(caso) {
  const lista = caso.aneurismas ?? [];
  const marcados = lista.filter((a) => a.sera_tratado === "sim");
  if (marcados.length) return marcados;
  return lista.length === 1 ? lista : [];
}

// ── Documentação ─────────────────────────────────────────────────────────────

const VERIFICACOES = {
  cid_informado(caso) {
    const cids = (caso.diagnosticos ?? []).map((d) => d.cid).filter(Boolean);
    return cids.length
      ? { ok: true, detalhe: `CID: ${cids.join(", ")}` }
      : { ok: false, detalhe: "Nenhum CID informado no pedido." };
  },

  tuss_procedimento_informado(caso, protocolo) {
    const codigos = (caso.procedimentos ?? []).map((p) => p.tuss).filter(Boolean);
    if (!codigos.length) return { ok: false, detalhe: "Nenhum código TUSS de procedimento informado." };
    const validos = protocolo.tuss_procedimentos ?? [];
    if (validos.length && !codigos.some((c) => validos.includes(c))) {
      return { ok: false, detalhe: `TUSS ${codigos.join(", ")} não consta no protocolo.` };
    }
    return { ok: true, detalhe: `TUSS: ${codigos.join(", ")}` };
  },

  laudo_vascular_anexado(caso) {
    const exames = caso.exames ?? [];
    if (exames.some((e) => VASCULARES.has(e.tipo) && e.laudo_anexado)) {
      return { ok: true, detalhe: "Laudo de exame vascular anexado." };
    }
    const citados = exames.filter((e) => VASCULARES.has(e.tipo));
    return {
      ok: false,
      detalhe: citados.length
        ? "Exame vascular apenas citado no texto; laudo não anexado."
        : "Nenhum exame vascular descrito.",
    };
  },

  medidas_aneurisma(caso) {
    const alvos = aneurismasAlvo(caso);
    if (!alvos.length) return { ok: false, detalhe: "Não há aneurisma-alvo definido para conferir as medidas." };
    const sem = alvos.filter((a) => a.tamanho_mm == null || a.colo_mm == null);
    return sem.length
      ? { ok: false, detalhe: `Faltam tamanho e/ou colo em ${sem.length} de ${alvos.length} aneurisma(s).` }
      : { ok: true, detalhe: "Tamanho e colo informados." };
  },

  fatores_risco_informados(caso) {
    const p = caso.paciente ?? {};
    const faltam = [];
    if (p.idade == null) faltam.push("idade");
    if (!p.hipertensao || p.hipertensao === "nao_informado") faltam.push("hipertensão");
    if (!p.hsa_previa || p.hsa_previa === "nao_informado") faltam.push("HSA prévia");
    return faltam.length
      ? { ok: false, detalhe: `Não informado: ${faltam.join(", ")}.` }
      : { ok: true, detalhe: "Idade, hipertensão e HSA prévia informados." };
  },

  alvo_definido(caso) {
    const n = (caso.aneurismas ?? []).length;
    if (!n) return { ok: false, detalhe: "Nenhum aneurisma descrito." };
    return aneurismasAlvo(caso).length
      ? { ok: true, detalhe: `${aneurismasAlvo(caso).length} aneurisma(s) a tratar.` }
      : { ok: false, detalhe: `${n} aneurismas descritos sem indicar qual(is) será(ão) tratado(s) neste procedimento.` };
  },

  opme_codigo_tuss(caso) {
    return itensSem(caso, (i) => !i.codigo_tuss, "sem código TUSS");
  },

  opme_registro_anvisa(caso) {
    return itensSem(caso, (i) => !i.registro_anvisa, "sem registro ANVISA");
  },

  opme_tres_marcas(caso) {
    return itensSem(
      caso,
      (i) => !SEM_MARCA.has(i.categoria) && (i.marcas ?? []).length < 3,
      "com menos de 3 marcas indicadas",
    );
  },
};

function itensSem(caso, falta, rotulo) {
  const itens = caso.opme ?? [];
  if (!itens.length) return { ok: false, detalhe: "Nenhum item de OPME listado." };
  const n = itens.filter(falta).length;
  return n ? { ok: false, detalhe: `${n} de ${itens.length} itens ${rotulo}.` } : { ok: true, detalhe: "Completo." };
}

export function verificarDocumentacao(caso, protocolo) {
  return (protocolo.documentacao ?? []).map((d) => {
    const fn = VERIFICACOES[d.verificacao];
    const r = fn ? fn(caso, protocolo) : { ok: false, detalhe: `Verificação desconhecida: ${d.verificacao}` };
    return { ...d, ...r };
  });
}

// ── Fatos calculados (contas que a IA não deve fazer) ────────────────────────

const RISCO_PHASES_5A = [0.4, 0.4, 0.4, 0.7, 0.9, 1.3, 1.7, 2.4, 3.2, 4.3, 5.3, 7.2];

/** Escore PHASES (Greving 2014). Assume população não finlandesa/não japonesa. */
export function calcularPhases(paciente, aneurisma) {
  const p = paciente ?? {};
  const faltam = [];
  if (p.idade == null) faltam.push("idade");
  if (!p.hipertensao || p.hipertensao === "nao_informado") faltam.push("hipertensão");
  if (!p.hsa_previa || p.hsa_previa === "nao_informado") faltam.push("HSA prévia");
  if (aneurisma.tamanho_mm == null) faltam.push("tamanho");
  if (!aneurisma.localizacao || aneurisma.localizacao === "outra") faltam.push("localização");
  if (faltam.length) return { calculavel: false, faltam };

  const t = aneurisma.tamanho_mm;
  const pontos = {
    populacao: 0,
    hipertensao: p.hipertensao === "sim" ? 1 : 0,
    idade: p.idade >= 70 ? 1 : 0,
    tamanho: t < 7 ? 0 : t < 10 ? 3 : t < 20 ? 6 : 10,
    hsa_previa: p.hsa_previa === "sim" ? 1 : 0,
    local: aneurisma.localizacao.startsWith("aci_") ? 0 : aneurisma.localizacao === "acm" ? 2 : 4,
  };
  const total = Object.values(pontos).reduce((a, b) => a + b, 0);
  const risco5anos = total >= 12 ? 17.8 : RISCO_PHASES_5A[total];
  return { calculavel: true, total, pontos, risco5anos, premissa: "população não finlandesa/não japonesa" };
}

/** Colo largo: colo ≥ 4 mm ou razão domo/colo < 2. */
export function coloLargo(aneurisma) {
  const { tamanho_mm: d, colo_mm: c } = aneurisma;
  if (c == null) return null;
  if (c >= 4) return true;
  if (d == null) return null;
  return d / c < 2;
}

export function calcularFatos(caso) {
  const opme = caso.opme ?? [];
  const tecnicas = caso.tecnicas ?? [];
  const qtd = (cat) => opme.filter((i) => i.categoria === cat).reduce((s, i) => s + (i.quantidade ?? 0), 0);
  const stents = qtd("stent_intracraniano");
  const alvos = aneurismasAlvo(caso);
  return {
    usa_stent: stents > 0 || tecnicas.some((t) => t.startsWith("stent_")),
    dois_stents: stents >= 2 || tecnicas.includes("stent_y") || tecnicas.includes("stent_x"),
    stents_solicitados: stents,
    duplo_acesso: new Set(caso.acessos ?? []).size >= 2,
    aneurismas: alvos.map((a) => ({
      localizacao: a.localizacao,
      lado: a.lado,
      tamanho_mm: a.tamanho_mm,
      colo_mm: a.colo_mm,
      colo_largo: coloLargo(a),
      phases: calcularPhases(caso.paciente, a),
    })),
  };
}

// ── OPME × kit-padrão ────────────────────────────────────────────────────────

function somar(ref, acrescimo) {
  for (const [k, v] of Object.entries(acrescimo ?? {})) ref[k] = (ref[k] ?? 0) + v;
}

export function referenciaKit(caso, protocolo, fatos) {
  const kit = protocolo.kit_padrao;
  const ref = { ...kit.base };
  for (const t of new Set(caso.tecnicas ?? [])) somar(ref, kit.por_tecnica?.[t]);
  if (fatos.duplo_acesso) somar(ref, kit.duplo_acesso);

  const alvos = aneurismasAlvo(caso);
  let molasSemMedida = alvos.length === 0;
  ref.mola = 0;
  for (const a of alvos) {
    if (a.tamanho_mm == null) {
      molasSemMedida = true;
      continue;
    }
    ref.mola += kit.molas_por_tamanho.find((f) => a.tamanho_mm <= f.ate_mm)?.max ?? 0;
  }
  return { ref, molasSemMedida };
}

const norm = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

export function avaliarOpme(caso, protocolo, fatos) {
  const { ref, molasSemMedida } = referenciaKit(caso, protocolo, fatos);
  const exigem = new Set(protocolo.kit_padrao.exigem_justificativa ?? []);
  const grupos = new Map();
  for (const item of caso.opme ?? []) {
    if (!grupos.has(item.categoria)) grupos.set(item.categoria, []);
    grupos.get(item.categoria).push(item);
  }

  const linhas = [...grupos.entries()].map(([cat, itens]) => {
    const solicitado = itens.reduce((s, i) => s + (i.quantidade ?? 0), 0);
    const referencia = ref[cat] ?? 0;
    let status, detalhe;
    if (exigem.has(cat)) {
      status = "justificar";
      detalhe = "Fora do kit-padrão: exige justificativa específica.";
    } else if (cat === "mola" && molasSemMedida) {
      status = "justificar";
      detalhe = "Sem aneurisma-alvo definido e medido não é possível calcular a referência de molas.";
    } else if (cat === "outro") {
      status = "sem_referencia";
      detalhe = "Item sem categoria no kit-padrão: análise manual.";
    } else if (referencia === 0) {
      status = "fora_do_kit";
      detalhe = "Não previsto para a(s) técnica(s) descrita(s).";
    } else if (solicitado > referencia) {
      status = "excedente";
      detalhe = `Excede a referência em ${solicitado - referencia}.`;
    } else {
      status = "ok";
      detalhe = "Dentro da referência.";
    }
    const glosa = status === "excedente" ? solicitado - referencia : status === "fora_do_kit" ? solicitado : 0;
    return { categoria: cat, nome: nomeCategoria(cat), solicitado, referencia, status, detalhe, glosa, itens };
  });

  return { linhas, referencia: ref };
}

// ── Alertas de coerência ─────────────────────────────────────────────────────

export function alertasCoerencia(caso, fatos) {
  const alertas = [];
  const itens = caso.opme ?? [];
  for (let i = 0; i < itens.length; i++) {
    for (let j = i + 1; j < itens.length; j++) {
      const a = norm(itens[i].descricao), b = norm(itens[j].descricao);
      if (itens[i].categoria === itens[j].categoria && a && b && (a.includes(b) || b.includes(a))) {
        alertas.push(`Possível item duplicado: "${itens[i].descricao}" e "${itens[j].descricao}".`);
      }
    }
  }
  if (fatos.duplo_acesso && !caso.justificativa_duplo_acesso) {
    alertas.push("Duplo acesso (femoral + radial) sem justificativa.");
  }
  if (itens.some((i) => i.categoria === "microcateter_balao") && !(caso.tecnicas ?? []).includes("remodelamento_balao")) {
    alertas.push("Microcateter balão solicitado sem técnica de remodelamento com balão descrita.");
  }
  if (fatos.dois_stents && fatos.stents_solicitados > 2) {
    alertas.push(`${fatos.stents_solicitados} stents solicitados; técnica em Y/X usa 2.`);
  }
  for (const t of caso.inconsistencias_textuais ?? []) alertas.push(t);
  return alertas;
}

/** Marca quais critérios do protocolo se aplicam (campo `aplica_se` → fato booleano). */
export function criteriosAplicaveis(protocolo, fatos) {
  return protocolo.criterios.map((c) => ({ ...c, aplicavel: !c.aplica_se || Boolean(fatos[c.aplica_se]) }));
}

// ── Classificação final (sempre SUGESTÃO para o médico auditor) ──────────────

export const DECISOES = {
  autorizar: { titulo: "Autorizar", cor: "verde" },
  parcial: { titulo: "Autorizar parcialmente (com glosas)", cor: "amarelo" },
  pendencia: { titulo: "Pendência: solicitar complementação", cor: "laranja" },
  especialista: { titulo: "Encaminhar ao especialista / junta médica", cor: "vermelho" },
};

export function classificar({ documentacao, criterios, opme }) {
  const aplicaveis = criterios.filter((c) => c.resultado !== "nao_aplicavel");
  const naoAtende = aplicaveis.filter((c) => c.peso === "obrigatorio" && c.resultado === "nao_atende");
  const pendencias = [
    ...documentacao.filter((d) => !d.ok).map((d) => `${d.descricao} — ${d.detalhe}`),
    ...aplicaveis
      .filter((c) => c.resultado === "insuficiente")
      .map((c) => `${c.id}: ${c.opcoes?.insuficiente ?? c.pergunta}`),
    ...opme.linhas.filter((l) => l.status === "justificar").map((l) => `${l.nome}: ${l.detalhe}`),
  ];
  const glosas = opme.linhas.filter((l) => l.glosa > 0);

  let codigo;
  if (naoAtende.length) codigo = "especialista";
  else if (pendencias.length) codigo = "pendencia";
  else if (glosas.length) codigo = "parcial";
  else codigo = "autorizar";

  return { codigo, ...DECISOES[codigo], naoAtende, pendencias, glosas };
}

/** Executa todas as etapas determinísticas de uma vez. */
export function avaliarRegras(caso, protocolo) {
  const fatos = calcularFatos(caso);
  return {
    fatos,
    documentacao: verificarDocumentacao(caso, protocolo),
    opme: avaliarOpme(caso, protocolo, fatos),
    alertas: alertasCoerencia(caso, fatos),
  };
}
