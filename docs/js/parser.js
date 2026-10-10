// Leitura determinística do texto do pedido (sem IA): itens de OPME, códigos,
// idade, medidas, exames e locais candidatos. O que é ambíguo vira pergunta ao Jev.

const num = (s) => Number(String(s).replace(",", "."));

// ── Itens de OPME ────────────────────────────────────────────────────────────
const ITEM_NUMERADO = /^(\d{1,3})\s*(?:\)|\.(?=\s)|[-–](?=\s))\s*(\d{1,3})\s+(?:x\s+|un\.?\s+|unid\.?\s+)?([A-Za-zÀ-ÿ"'].*)$/i;
const ITEM_SO_QTD = /^(\d{1,3})\s+(?:x\s+|un\.?\s+|unid\.?\s+)?([A-Za-zÀ-ÿ].{3,})$/i;
const ITEM_GRUDADO = /:\s*(\d{2})\s+([A-Za-zÀ-ÿ].{3,})$/; // "...abaixo:01 Introdutor femoral"
const FIM_LISTA = /(data da solicita|assinatura|especifica[çc][ãa]o do material|^\s*2[4-8]\s*-|observa[çc][ãa]o|^\d{2}[./]\d{2}[./]\d{4}$)/i;
const SEPARADOR = /\s+(?:—|–|--|-|\|)\s+(?=(?:TUSS|ANVISA|Reg(?:istro)?|Marcas?)\b)/i;

/**
 * Linhas limpas e independentes do extrator de PDF: junta "1)" isolado com a
 * linha seguinte e separa itens que vieram grudados na mesma linha.
 */
export function normalizarLinhas(texto) {
  const brutas = texto.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const juntas = [];
  for (let i = 0; i < brutas.length; i++) {
    if (/^\d{1,3}\s*[).]$/.test(brutas[i]) && brutas[i + 1]) {
      juntas.push(`${brutas[i]} ${brutas[++i]}`);
    } else {
      juntas.push(brutas[i]);
    }
  }
  return juntas.flatMap((l) => l.split(/\s+(?=\d{1,3}\)\s*\d{1,3}\s+[A-Za-zÀ-ÿ"'])/));
}

function detalhesDoItem(texto) {
  const tuss = texto.match(/\bTUSS\s*[:nº°]*\s*(\d{8,10})\b/i)?.[1] ?? null;
  const anvisa =
    texto.match(/\b(?:ANVISA|Reg(?:istro)?\.?(?:\s*ANVISA)?)\s*[:nº°]*\s*(\d{11,13})\b/i)?.[1] ?? null;
  const marcasTexto = texto.match(/\bMarcas?\s*:\s*(.+?)(?:\s+(?:—|–|--)\s+|$)/i)?.[1] ?? "";
  const marcas = marcasTexto
    .split(/\s*[/;,]\s*|\s+e\s+/)
    .map((m) => m.trim())
    .filter(Boolean);
  const descricao = texto.split(SEPARADOR)[0];
  return { descricao: descricao.trim().replace(/[\s,;.]+$/, ""), codigo_tuss: tuss, registro_anvisa: anvisa, marcas };
}

/** Separa as linhas da lista de materiais. Devolve itens e o índice das linhas usadas. */
export function extrairItens(linhas) {
  const itens = [];
  const usadas = new Set();
  const primeira = linhas.findIndex((l) => ITEM_NUMERADO.test(l));
  if (primeira === -1) return { itens, usadas };

  // Item grudado no fim do parágrafo anterior à lista.
  const anterior = linhas[primeira - 1];
  const grudado = anterior?.match(ITEM_GRUDADO);
  if (grudado) {
    itens.push({ n: 0, quantidade: Number(grudado[1]), texto: grudado[2], fora_da_numeracao: true });
  }

  for (let i = primeira; i < linhas.length; i++) {
    const linha = linhas[i];
    if (FIM_LISTA.test(linha)) break;
    const m = linha.match(ITEM_NUMERADO);
    if (m) {
      itens.push({ n: Number(m[1]), quantidade: Number(m[2]), texto: m[3] });
      usadas.add(i);
      continue;
    }
    if (!itens.length) continue;
    // Linha longa com cara de parágrafo encerra a lista.
    if (linha.split(/\s+/).length > 22 && /[.]$/.test(linha)) break;
    const avulso = linha.match(ITEM_SO_QTD);
    if (avulso && /^0\d/.test(avulso[1])) {
      itens.push({ n: itens.length + 1, quantidade: Number(avulso[1]), texto: avulso[2] });
    } else {
      itens.at(-1).texto += ` ${linha}`; // continuação da linha anterior
    }
    usadas.add(i);
  }

  return {
    itens: itens.map((it) => ({ ...it, ...detalhesDoItem(it.texto) })),
    usadas,
  };
}

// ── Texto clínico ────────────────────────────────────────────────────────────

export function frases(texto) {
  return texto
    .replace(/-\n(?=[a-zà-ÿ])/g, "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.;!?])\s+(?=[A-ZÀ-Ý(])/)
    .map((f) => f.trim())
    .filter(Boolean);
}

export const LOCAIS = {
  acom: { nome: "artéria comunicante anterior", regex: /comunicante anterior|\bACoA\b|\bAComA?\b/i, lado: "linha_media" },
  pcom: { nome: "artéria comunicante posterior", regex: /comunicante posterior|\bAComP\b|\bPCoA\b|\bPcom\b/i },
  acm: { nome: "artéria cerebral média", regex: /cerebra(?:l|is) m[ée]dias?|\bACM\b|\bMCA\b/i },
  aca: { nome: "artéria cerebral anterior / pericalosa", regex: /cerebra(?:l|is) anteriore?s?|pericalos|\bACA\b/i },
  aci_oftalmica: { nome: "carótida interna, segmento oftálmico", regex: /oft[áa]lmic/i },
  aci_cavernosa: { nome: "carótida interna, segmento cavernoso", regex: /cavernos/i },
  aci_outros: { nome: "carótida interna (outro segmento)", regex: /car[óo]tida interna|\bACI\b/i },
  basilar: { nome: "artéria basilar", regex: /basilar/i, lado: "linha_media" },
  vertebral_pica: { nome: "artéria vertebral / PICA", regex: /vertebral|\bPICA\b|cerebelar posterior inferior/i },
  cerebral_posterior: { nome: "artéria cerebral posterior", regex: /cerebra(?:l|is) posteriore?s?|\bACP\b|\bPCA\b/i },
};

/** Locais citados em frases que falam de aneurisma (candidatos; o Jev confirma). */
export function locaisCandidatos(listaFrases) {
  const achados = new Map();
  for (const f of listaFrases) {
    if (!/aneurism|dilata[çc][ãa]o sacular|les[ãa]o sacular/i.test(f)) continue;
    for (const [id, local] of Object.entries(LOCAIS)) {
      if (!local.regex.test(f)) continue;
      if (id === "aci_outros" && (LOCAIS.aci_oftalmica.regex.test(f) || LOCAIS.aci_cavernosa.regex.test(f))) continue;
      if (!achados.has(id)) achados.set(id, []);
      achados.get(id).push(f);
    }
  }
  return achados; // id → frases
}

function ladoDaFrase(f, id) {
  if (LOCAIS[id].lado) return LOCAIS[id].lado;
  const trecho = f.slice(Math.max(0, f.search(LOCAIS[id].regex)), f.search(LOCAIS[id].regex) + 80);
  if (/esquerd/i.test(trecho)) return "esquerdo";
  if (/direit/i.test(trecho)) return "direito";
  return "nao_informado";
}

const MEDIDA = /(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\s*mm\b/gi;

/** Maior diâmetro e colo citados numa frase (ignora crescimento e dispositivos). */
export function medidasDaFrase(f) {
  const colo = f.match(/colo[^0-9.;]{0,25}(\d+(?:[.,]\d+)?)\s*mm/i);
  const dims = [];
  for (const m of f.matchAll(MEDIDA)) {
    const antes = f.slice(Math.max(0, m.index - 30), m.index);
    if (/crescimento|aumento|cresceu|varia[çc]/i.test(antes)) continue;
    if (/colo[^0-9]*$/i.test(antes)) continue;
    if (/bal[ãa]o|stent|mola|espira|microcateter/i.test(antes)) continue;
    dims.push(...[m[1], m[2], m[3]].filter(Boolean).map(num));
  }
  return { tamanho_mm: dims.length ? Math.max(...dims) : null, colo_mm: colo ? num(colo[1]) : null };
}

/** Atribui medidas aos locais. Se não der para saber de quem é a medida, marca ambiguidade. */
export function medidasPorLocal(listaFrases, idsLocais) {
  const resultado = Object.fromEntries(idsLocais.map((id) => [id, { tamanho_mm: null, colo_mm: null, lado: "nao_informado" }]));
  let ambiguo = false;
  for (const f of listaFrases) {
    const doLocal = idsLocais.filter((id) => LOCAIS[id].regex.test(f));
    for (const id of doLocal) {
      if (resultado[id].lado === "nao_informado") resultado[id].lado = ladoDaFrase(f, id);
    }
    if (!/aneurism|colo|saco|domo|les[ãa]o/i.test(f) || !/\d\s*mm/i.test(f)) continue;
    const med = medidasDaFrase(f);
    if (med.tamanho_mm == null && med.colo_mm == null) continue;
    let alvo = doLocal.length === 1 ? doLocal[0] : null;
    if (!alvo && doLocal.length === 0 && idsLocais.length === 1) alvo = idsLocais[0];
    if (!alvo) {
      ambiguo = true;
      continue;
    }
    resultado[alvo].tamanho_mm ??= med.tamanho_mm;
    resultado[alvo].colo_mm ??= med.colo_mm;
  }
  return { porLocal: resultado, ambiguo };
}

// ── Campos simples ───────────────────────────────────────────────────────────

export function extrairIdade(texto) {
  for (const m of texto.matchAll(/(?:idade\s*[:\-]?\s*)?(\d{1,3})\s*anos\b/gi)) {
    const v = Number(m[1]);
    const antes = texto.slice(Math.max(0, m.index - 20), m.index);
    if (/h[áa]\s*$|durante|por\s*$|superior a|de vida/i.test(antes)) continue;
    if (v > 0 && v < 110) return v;
  }
  return null;
}

export function extrairCids(texto) {
  const cids = new Set();
  for (const m of texto.matchAll(/\bCID(?:-?10)?\s*[:\-]?\s*([A-Z]\d{2}(?:\.\d{1,2})?)/gi)) cids.add(m[1].toUpperCase());
  for (const m of texto.matchAll(/\b([A-TV-Z]\d{2}\.\d)\b/g)) cids.add(m[1]);
  return [...cids];
}

export function extrairTussProcedimento(textoClinico) {
  return [...textoClinico.matchAll(/\bTUSS\s*[:nº°]*\s*(\d{8,10})\b/gi)].map((m) => m[1]);
}

const TIPOS_EXAME = {
  angio_rm: /angio-?\s*(?:resson[âa]ncia|RM)|angiorresson[âa]ncia|\bARM\b|\bangio-?RM\b/i,
  angio_tc: /angio-?\s*(?:tomografia|TC)|angiotomografia|\bATC\b/i,
  angiografia_digital: /angiografia (?:digital|cerebral)|arteriografia|\bDSA\b|angiografia por subtra/i,
};

export function extrairExames(listaFrases) {
  const exames = [];
  for (const [tipo, regex] of Object.entries(TIPOS_EXAME)) {
    const doTipo = listaFrases.filter((f) => regex.test(f));
    if (!doTipo.length) continue;
    const principal = doTipo.find((f) => /aneurism/i.test(f)) ?? doTipo[0];
    const data = principal.match(/\b\d{2}\/\d{2}\/\d{4}\b|\b(?:19|20)\d{2}\b/)?.[0] ?? null;
    exames.push({ tipo, data, achados: principal.slice(0, 400) });
  }
  return exames;
}

/** Tipo de exame do laudo anexado: o primeiro exame citado depois do título "LAUDO". */
export function tipoDoLaudo(textoClinico) {
  // "LAUDO" em maiúsculas (título); "laudo anexo" no meio de uma frase não conta.
  const inicio = textoClinico.search(/\bLAUDO\b|[Ii]mpress[ãa]o diagn[óo]stica/);
  if (inicio === -1) return null;
  const resto = textoClinico.slice(inicio);
  let melhor = null;
  for (const [tipo, regex] of Object.entries(TIPOS_EXAME)) {
    const pos = resto.search(regex);
    if (pos !== -1 && (melhor === null || pos < melhor.pos)) melhor = { tipo, pos };
  }
  return melhor?.tipo ?? null;
}

export function extrairAcessos(texto) {
  const acessos = [];
  if (/femor|femur|femoral/i.test(texto)) acessos.push("femoral");
  if (/radial/i.test(texto)) acessos.push("radial");
  return acessos;
}

export function extrairDataSolicitacao(texto) {
  return texto.match(/data da solicita[çc][ãa]o\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
}

/** Junta tudo que é determinístico. `linhas` = texto anonimizado dividido em linhas. */
export function lerPedido(textoAnonimo) {
  const linhas = normalizarLinhas(textoAnonimo);
  const { itens, usadas } = extrairItens(linhas);
  const textoClinico = linhas.filter((_, i) => !usadas.has(i)).join("\n");
  const listaFrases = frases(textoClinico);
  const candidatos = locaisCandidatos(listaFrases);
  return {
    linhas,
    itens,
    textoClinico,
    frases: listaFrases,
    candidatos,
    idade: extrairIdade(textoClinico),
    cids: extrairCids(textoClinico),
    tussProcedimento: extrairTussProcedimento(textoClinico),
    exames: extrairExames(listaFrases),
    acessos: extrairAcessos(textoAnonimo),
    dataSolicitacao: extrairDataSolicitacao(textoAnonimo),
  };
}
