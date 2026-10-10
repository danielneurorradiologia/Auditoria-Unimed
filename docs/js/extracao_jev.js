// Extração "Jev primeiro": regras determinísticas leem códigos, números e a lista
// de materiais; o Jev responde, com probabilidade, tudo que é classificação.
// Respostas com baixa confiança viram "incertezas" para o Claude resolver.

import { LOCAIS, lerPedido, medidasPorLocal, tipoDoLaudo } from "./parser.js";
import { perguntarJev } from "./ia.js";

export const LIMIARES = { choice: 0.7, noulSim: 0.7, noulNao: 0.3 };

const NAO_INFORMADO = "O texto não fala sobre isso.";
const tri = (sim, nao) => ({ sim, nao, nao_informado: NAO_INFORMADO });

const PERGUNTAS_PACIENTE = {
  pac_sexo: {
    type: "choice",
    instructions: "Qual o sexo do paciente?",
    criteria: {
      F: "Sexo feminino (ex.: 'a paciente', 'feminina', 'submetida', 'hipertensa').",
      M: "Sexo masculino (ex.: 'o paciente', 'masculino', 'submetido').",
      nao_informado: "Não é possível saber o sexo pelo texto.",
    },
  },
  pac_hipertensao: {
    type: "choice",
    instructions: "O paciente tem hipertensão arterial?",
    criteria: tri("O texto diz que o paciente é hipertenso ou tem hipertensão arterial.", "O texto diz que o paciente não tem hipertensão."),
  },
  pac_tabagismo: {
    type: "choice",
    instructions: "O paciente é tabagista?",
    criteria: tri("O texto diz que o paciente fuma ou é tabagista.", "O texto diz que o paciente não fuma."),
  },
  pac_hsa_previa: {
    type: "choice",
    instructions: "O paciente já teve hemorragia subaracnoide (sangramento de aneurisma) antes?",
    criteria: tri("O texto relata hemorragia subaracnoide prévia.", "O texto diz que nunca houve hemorragia subaracnoide."),
  },
  antiagregacao: {
    type: "choice",
    instructions: "O pedido menciona antiagregação plaquetária (AAS, clopidogrel, ticagrelor, prasugrel)?",
    criteria: tri("O texto menciona uso ou preparo com antiagregantes plaquetários.", "O texto diz que o paciente não pode ou não vai usar antiagregantes."),
  },
  laudo_anexado: {
    type: "choice",
    instructions: "O documento contém o LAUDO do exame de imagem escrito pelo radiologista?",
    criteria: {
      sim: "Há um laudo do radiologista no documento, com técnica, achados ou impressão diagnóstica.",
      nao: "O exame é apenas citado pelo médico solicitante; não há laudo do radiologista no documento.",
    },
  },
};

const TECNICAS = {
  molas_simples: "O pedido propõe embolizar o aneurisma com molas (espirais, coils).",
  remodelamento_balao: "O pedido propõe usar balão de remodelamento durante a embolização (embolização assistida por balão).",
  stent_assistido: "O pedido propõe implantar um único stent para assistir a embolização com molas.",
  stent_y: "O pedido propõe técnica com dois stents em Y.",
  stent_x: "O pedido propõe técnica com dois stents em X.",
  diversor_fluxo: "O pedido propõe tratar com diversor de fluxo.",
  dispositivo_intrassacular: "O pedido propõe um dispositivo intrassacular de malha (tipo WEB), que é diferente de molas. Molas não contam como dispositivo intrassacular.",
  oclusao_desconstrutiva: "O pedido propõe técnica desconstrutiva, com oclusão do vaso de origem.",
  microcirurgia: "O pedido propõe cirurgia aberta (microcirurgia ou clipagem).",
};

const TECNICAS_CRITICAS = new Set([
  "remodelamento_balao", "stent_assistido", "stent_y", "stent_x", "diversor_fluxo", "dispositivo_intrassacular",
]);

export const CATEGORIAS_OPME = {
  introdutor: "Introdutor (bainha curta) de acesso arterial femoral ou radial.",
  bainha_longa: "Bainha longa de suporte (guiding sheath, cerca de 80–90 cm).",
  cateter_guia: "Cateter-guia (guiding catheter).",
  cateter_diagnostico: "Cateter diagnóstico (vertebral, Simmons, headhunter, Berenstein).",
  cateter_acesso_distal: "Cateter de acesso distal ou intermediário.",
  guia: "Fio-guia de 0,035 ou 0,038 polegada (hidrofílico, teflonado, de troca).",
  microcateter: "Microcateter sem balão (para molas ou para entregar stent).",
  microcateter_balao: "Microcateter balão ou balão de remodelamento.",
  microguia: "Microguia de 0,014 polegada ou menor.",
  mola: "Molas, espirais ou coils de embolização.",
  stent_intracraniano: "Stent intracraniano.",
  diversor_fluxo: "Diversor de fluxo.",
  dispositivo_intrassacular: "Dispositivo intrassacular.",
  torneira: "Torneira (stopcock) ou manifold.",
  conector_y: "Conector em Y ou válvula hemostática.",
  monitorizacao_neurofisiologica: "Monitorização neurofisiológica intraoperatória.",
  outro: "Qualquer outro material.",
};

function perguntasDeLocal(id) {
  const nome = LOCAIS[id].nome;
  return {
    [`loc_${id}`]: {
      type: "noul",
      instructions: `O texto descreve um aneurisma na ${nome}.`,
      criteria: { true: "Existe aneurisma nesse local.", false: "Esse local é citado sem aneurisma, ou o aneurisma está em outro local." },
    },
    [`morf_${id}`]: {
      type: "choice",
      instructions: `Como é a forma do aneurisma da ${nome}?`,
      criteria: {
        regular: "Descrito como regular ou de contorno liso.",
        irregular_lobulado: "Descrito como irregular, lobulado, bi/tri/multilobulado ou com daughter sac.",
        nao_informado: "A forma não é descrita.",
      },
    },
    [`sint_${id}`]: {
      type: "choice",
      instructions: `O aneurisma da ${nome} causa sintomas?`,
      criteria: tri(
        "O texto atribui sintomas a este aneurisma (paralisia do III nervo, efeito de massa, compressão).",
        "O texto diz que é assintomático ou achado incidental.",
      ),
    },
    [`cresc_${id}`]: {
      type: "choice",
      instructions: `Houve crescimento do aneurisma da ${nome} em exames seriados?`,
      criteria: tri("O texto relata crescimento documentado em exames seriados.", "O texto relata estabilidade em exames seriados."),
    },
    [`trat_${id}`]: {
      type: "choice",
      instructions: `O aneurisma da ${nome} será tratado neste procedimento?`,
      criteria: {
        sim: "O pedido diz que este aneurisma será tratado agora.",
        nao: "O pedido diz que este aneurisma não será tratado agora.",
        nao_informado: "Não fica claro se este aneurisma será tratado neste procedimento.",
      },
    },
  };
}

// ── Leitura das respostas ────────────────────────────────────────────────────

function lerChoice(r) {
  if (!r || r.type !== "choice") return { valor: null, confianca: 0, incerto: true };
  return { valor: r.choice, confianca: r.confidence, incerto: r.confidence < LIMIARES.choice };
}

function lerNoul(r) {
  if (!r || r.type !== "noul") return { valor: null, confianca: 0, incerto: true };
  const p = r.noul;
  return { valor: p >= 0.5, confianca: p >= 0.5 ? p : 1 - p, incerto: p > LIMIARES.noulNao && p < LIMIARES.noulSim };
}

// Linhas de cabeçalho de formulário ("7 - Número da Carteira 8 - Nome", "ANEXO DE SOLICITAÇÃO…").
const LINHA_DE_FORMULARIO = /\b\d{1,2}\s*-\s*[A-ZÀ-Ý][a-zà-ÿ]|ANEXO DE SOLICITA|DOCUMENTO FICT|Folha \d|Dados d[oa] /;

function paragrafoClinico(textoClinico) {
  const linhas = textoClinico.split("\n");
  const inicio = linhas.findIndex((l) => /justificativa/i.test(l));
  return linhas
    .slice(inicio + 1)
    .filter((l) => l.split(/\s+/).length >= 6 && !LINHA_DE_FORMULARIO.test(l))
    .join(" ")
    .slice(0, 900);
}

/**
 * Extrai o caso usando regras + Jev.
 * Devolve { caso, incertezas, origem, custos, contagem, texto } — `incertezas` lista
 * os grupos de campos que precisam do Claude.
 */
export async function extrairComJev(conexao, { textoAnonimo, nomeArquivo }) {
  const p = lerPedido(textoAnonimo);
  const listaMateriais = p.itens.map((i) => `${i.quantidade}× ${i.descricao}`).join("\n");
  const estadoClinico = `${p.textoClinico}\n\nMateriais solicitados:\n${listaMateriais || "(nenhum identificado)"}`;
  const candidatos = [...p.candidatos.keys()];

  const perguntasClinicas = { ...PERGUNTAS_PACIENTE };
  for (const [id, texto] of Object.entries(TECNICAS)) perguntasClinicas[`tec_${id}`] = { type: "noul", instructions: texto };
  for (const id of candidatos) Object.assign(perguntasClinicas, perguntasDeLocal(id));
  if (p.acessos.length >= 2) {
    perguntasClinicas.duplo_acesso_justificado = {
      type: "noul",
      instructions: "O pedido explica por que serão usados dois acessos arteriais (femoral e radial) no mesmo procedimento.",
    };
  }

  const perguntasOpme = Object.fromEntries(
    p.itens.map((i, k) => [`cat_${k}`, { type: "choice", instructions: `Qual é a categoria do material "${i.descricao}"?`, criteria: CATEGORIAS_OPME }]),
  );

  const perguntasCoerencia = {
    inc_tecnica_contraditoria: {
      type: "noul",
      instructions: "O título do arquivo e o texto, ou dois trechos do texto, descrevem a técnica de stent de formas diferentes (por exemplo, 'em X' num lugar e 'em Y' em outro).",
    },
    inc_tecnica_sem_alvo: {
      type: "noul",
      instructions: "O pedido propõe técnicas diferentes (por exemplo, reconstrutiva e desconstrutiva) para mais de um aneurisma sem dizer qual técnica será usada em cada aneurisma.",
    },
  };

  const chamadas = [
    perguntarJev(conexao, estadoClinico, perguntasClinicas),
    p.itens.length
      ? perguntarJev(conexao, "Materiais (OPME) de um pedido de neurorradiologia intervencionista.", perguntasOpme)
      : Promise.resolve({ respostas: {}, custo: null }),
    perguntarJev(conexao, `Título do arquivo: ${nomeArquivo}\n\n${estadoClinico}`, perguntasCoerencia),
  ];
  const [clin, opme, coer] = await Promise.all(chamadas);
  const R = { ...clin.respostas, ...opme.respostas, ...coer.respostas };
  const custos = [clin, opme, coer].filter((c) => c.custo).map((c) => ({ etapa: "Extração (Jev)", ...c.custo }));
  const nPerguntas = Object.keys(perguntasClinicas).length + Object.keys(perguntasOpme).length + Object.keys(perguntasCoerencia).length;

  const incertezas = new Set();
  const origem = {};
  let respostasJev = 0;
  // Política de dúvida: o Claude só é chamado quando a dúvida do Jev é num campo
  // crítico E a resposta provável não é a conservadora. Se a dúvida só pode deixar a
  // decisão mais rigorosa (pendência/glosa), mantém-se a resposta e o auditor é avisado.
  const duvidas = [];
  const usar = (chave, leitura, grupo, { critico = true, conservador } = {}) => {
    respostasJev++;
    if (leitura.incerto) {
      const escalar = critico && leitura.valor !== conservador;
      if (escalar) incertezas.add(grupo);
      duvidas.push({ chave, valor: leitura.valor, confianca: Number(leitura.confianca.toFixed(2)), escalado: escalar });
    }
    origem[chave] = { por: "jev", confianca: leitura.confianca };
    return leitura.valor;
  };

  // Paciente
  const sexo = usar("paciente.sexo", lerChoice(R.pac_sexo), "paciente", { critico: false });
  const paciente = {
    idade: p.idade,
    sexo: sexo ?? "nao_informado",
    hipertensao: usar("paciente.hipertensao", lerChoice(R.pac_hipertensao), "paciente", { conservador: "nao_informado" }) ?? "nao_informado",
    tabagismo: usar("paciente.tabagismo", lerChoice(R.pac_tabagismo), "paciente", { critico: false }) ?? "nao_informado",
    hsa_previa: usar("paciente.hsa_previa", lerChoice(R.pac_hsa_previa), "paciente", { conservador: "nao_informado" }) ?? "nao_informado",
  };
  origem["paciente.idade"] = { por: "regra" };

  // Técnicas
  // Só as técnicas que mudam o kit-padrão ou os critérios são críticas; "não" é a resposta conservadora.
  const tecnicas = Object.keys(TECNICAS).filter((id) =>
    usar(`tecnicas.${id}`, lerNoul(R[`tec_${id}`]), "tecnicas", { critico: TECNICAS_CRITICAS.has(id), conservador: false }),
  );

  // Aneurismas
  const confirmados = candidatos.filter((id) => usar(`aneurismas.${id}`, lerNoul(R[`loc_${id}`]), "aneurismas"));
  const { porLocal, ambiguo } = medidasPorLocal(p.frases, confirmados);
  if (ambiguo) incertezas.add("aneurismas");
  const aneurismas = confirmados.map((id) => ({
    localizacao: id,
    lado: porLocal[id].lado,
    tamanho_mm: porLocal[id].tamanho_mm,
    colo_mm: porLocal[id].colo_mm,
    morfologia: usar(`aneurismas.${id}.morfologia`, lerChoice(R[`morf_${id}`]), "aneurismas", { critico: false }) ?? "nao_informado",
    sintomatico: usar(`aneurismas.${id}.sintomatico`, lerChoice(R[`sint_${id}`]), "aneurismas", { critico: false }) ?? "nao_informado",
    crescimento_documentado:
      usar(`aneurismas.${id}.crescimento`, lerChoice(R[`cresc_${id}`]), "aneurismas", { critico: false }) ?? "nao_informado",
    sera_tratado:
      usar(`aneurismas.${id}.sera_tratado`, lerChoice(R[`trat_${id}`]), "aneurismas", { conservador: "nao_informado" }) ?? "nao_informado",
  }));
  if (/aneurism/i.test(p.textoClinico) && !candidatos.length) incertezas.add("aneurismas");

  // Exames
  const laudo = usar("exames.laudo_anexado", lerChoice(R.laudo_anexado), "exames", { conservador: "nao" });
  const tipoLaudo = tipoDoLaudo(p.textoClinico);
  const exames = p.exames.map((e) => ({ ...e, laudo_anexado: laudo === "sim" && (!tipoLaudo || e.tipo === tipoLaudo) }));

  // OPME
  if (!p.itens.length && /material|opme|stent|mola|microcateter|introdutor/i.test(textoAnonimo)) incertezas.add("opme");
  const itensOpme = p.itens.map((i, k) => ({
    n: i.n,
    descricao: i.descricao,
    categoria: usar(`opme.${k}.categoria`, lerChoice(R[`cat_${k}`]), "opme") ?? "outro",
    quantidade: i.quantidade,
    codigo_tuss: i.codigo_tuss,
    registro_anvisa: i.registro_anvisa,
    marcas: i.marcas,
  }));

  // Coerência
  const inconsistencias = [];
  if (usar("coerencia.tecnica_contraditoria", lerNoul(R.inc_tecnica_contraditoria), "coerencia", { critico: false })) {
    inconsistencias.push("A técnica de stent aparece descrita de formas diferentes (título/texto).");
  }
  if (usar("coerencia.tecnica_sem_alvo", lerNoul(R.inc_tecnica_sem_alvo), "coerencia", { critico: false })) {
    inconsistencias.push("Técnicas diferentes propostas sem indicar em qual aneurisma cada uma será usada.");
  }
  const fora = p.itens.find((i) => i.fora_da_numeracao);
  if (fora) inconsistencias.push(`Item "${fora.descricao}" aparece fora da numeração da lista.`);

  const duplo =
    p.acessos.length >= 2
      ? usar("justificativa_duplo_acesso", lerNoul(R.duplo_acesso_justificado), "tecnicas", { conservador: false })
      : false;
  const justificativa = paragrafoClinico(p.textoClinico);
  const nomeLocal = (id) => LOCAIS[id].nome;

  const caso = {
    resumo_clinico: justificativa || "(sem texto clínico identificado)",
    paciente,
    diagnosticos: aneurismas.length
      ? aneurismas.map((a, k) => ({ descricao: `Aneurisma da ${nomeLocal(a.localizacao)}`, cid: p.cids[k] ?? p.cids[0] ?? null }))
      : p.cids.map((cid) => ({ descricao: "Diagnóstico informado por CID", cid })),
    procedimentos: [{ descricao: "Tratamento de aneurisma intracraniano", tuss: p.tussProcedimento[0] ?? null }],
    aneurismas,
    exames,
    tecnicas,
    justificativa_tecnica: justificativa,
    acessos: p.acessos,
    justificativa_duplo_acesso: duplo ? "Justificativa presente no texto (Jev)." : null,
    antiagregacao_mencionada: usar("antiagregacao", lerChoice(R.antiagregacao), "tecnicas", { critico: false }) ?? "nao_informado",
    opme: itensOpme,
    inconsistencias_textuais: inconsistencias,
    data_solicitacao: p.dataSolicitacao,
  };

  const camposRegra = 6 + p.itens.length * 4 + p.exames.length * 2 + aneurismas.length * 3;

  return {
    caso,
    incertezas: [...incertezas],
    origem,
    custos,
    contagem: { perguntasJev: nPerguntas, respostasJev, camposRegra },
    duvidas,
    leitura: p,
  };
}
