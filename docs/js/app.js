// Interface: configuração, upload, exemplos, execução da análise e calculadora de custos.

import { avaliarRegras, classificar, criteriosAplicaveis } from "./regras.js";
import { MODELOS_CLAUDE, PRECOS, estimarAnalise } from "./custos.js";
import { renderParecer, esc } from "./parecer.js";

// Servidor publicado (Cloudflare Worker). Quem abre o site só precisa da senha.
const SERVIDOR_PADRAO = "https://auditoria-opme.danielneurorradiologia.workers.dev";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";

const $ = (sel) => document.querySelector(sel);

// ── Preferências locais (só neste navegador) ─────────────────────────────────
const local = {
  ler(chave, padrao) {
    try {
      const v = localStorage.getItem(`auditoria.${chave}`);
      return v === null ? padrao : JSON.parse(v);
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try {
      localStorage.setItem(`auditoria.${chave}`, JSON.stringify(valor));
    } catch {
      /* armazenamento indisponível: segue sem persistir */
    }
  },
};

const estado = { protocolo: null, pdf: null, ultimoResultado: null };
const cambio = () => Number($("#cambio").value) || 5.5;
const brl = (usd) => `R$ ${(usd * cambio()).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Protocolos ───────────────────────────────────────────────────────────────
async function carregarProtocolos() {
  const indice = await (await fetch("protocolos/index.json")).json();
  $("#protocolo").innerHTML = indice
    .map((p) => `<option value="${esc(p.arquivo)}">${esc(p.nome)} (${esc(p.status)})</option>`)
    .join("");
  await selecionarProtocolo(indice[0].arquivo);
}

async function selecionarProtocolo(arquivo) {
  estado.protocolo = window.jsyaml.load(await (await fetch(`protocolos/${arquivo}`)).text());
  $("#protocolo-info").textContent =
    `Versão ${estado.protocolo.versao} · ${estado.protocolo.criterios.length} critérios clínicos · ${estado.protocolo.documentacao.length} checagens de documentação`;
}

// ── Configuração ─────────────────────────────────────────────────────────────
function iniciarConfig() {
  const doLink = new URLSearchParams(location.search).get("servidor");
  if (doLink) local.gravar("servidor", doLink);
  $("#servidor").value = local.ler("servidor", SERVIDOR_PADRAO);
  $("#senha").value = local.ler("senha", "");
  $("#modelo-claude").innerHTML = MODELOS_CLAUDE.map((m) => `<option value="${m}">${esc(PRECOS[m].nome)}</option>`).join("");
  $("#modelo-claude").value = local.ler("modeloClaude", "claude-opus-5-5");
  $("#cambio").value = local.ler("cambio", 5.5);

  for (const [id, chave] of [["#servidor", "servidor"], ["#senha", "senha"], ["#modelo-claude", "modeloClaude"]]) {
    $(id).addEventListener("change", () => {
      local.gravar(chave, $(id).value.trim());
      atualizarAvisoConfig();
      renderCalculadora();
    });
  }
  $("#cambio").addEventListener("change", () => {
    local.gravar("cambio", Number($("#cambio").value));
    renderCalculadora();
  });
  $("#testar").addEventListener("click", testar);
  atualizarAvisoConfig();
}

const configurado = () => Boolean($("#servidor").value.trim() && $("#senha").value.trim());
function atualizarAvisoConfig() {
  $("#aviso-config").hidden = configurado();
}

async function conexaoAtual() {
  const { criarConexao } = await import("./ia.js");
  return criarConexao({ proxyUrl: $("#servidor").value.trim(), senha: $("#senha").value.trim() });
}

async function testar() {
  const s = $("#status-conexao");
  s.className = "status-conexao";
  s.textContent = "Testando…";
  try {
    const { testarConexao } = await import("./ia.js");
    const r = await testarConexao(await conexaoAtual());
    s.classList.add(r.jev && r.claude ? "ok" : "falha");
    s.textContent = `Conectado. Jev: ${r.jev ? "ok" : "sem chave"} · Claude: ${r.claude ? "ok" : "sem chave"}`;
  } catch (e) {
    s.classList.add("falha");
    s.textContent = e.message;
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────
function iniciarUpload() {
  const zona = $("#zona-upload");
  const input = $("#arquivo");
  zona.addEventListener("click", () => input.click());
  zona.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && input.click());
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("arrastando");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("arrastando"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("arrastando");
    if (e.dataTransfer.files[0]) receberArquivo(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => input.files[0] && receberArquivo(input.files[0]));
  document.querySelectorAll("[data-exemplo]").forEach((b) =>
    b.addEventListener("click", async () => {
      const nome = b.dataset.exemplo;
      const blob = await (await fetch(`exemplos/${nome}`)).blob();
      await receberArquivo(new File([blob], nome, { type: "application/pdf" }));
      if (configurado()) analisar();
    }),
  );
}

async function lerTextoPdf(bytes) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const { extrairTextoPdf } = await import("./texto.js");
  return extrairTextoPdf(pdfjs, bytes);
}

function paraBase64(bytes) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

async function receberArquivo(arquivo) {
  $("#erro").hidden = true;
  $("#resultado").innerHTML = "";
  $("#progresso").innerHTML = "";
  $("#acoes-resultado").hidden = true;
  $("#arquivo-info").textContent = `Lendo ${arquivo.name}…`;
  if (arquivo.type !== "application/pdf") return mostrarErro("Envie um arquivo PDF.");
  if (arquivo.size > 30 * 1024 * 1024) return mostrarErro("PDF acima de 30 MB (limite da API: 32 MB).");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  try {
    const pdf = await lerTextoPdf(bytes.slice());
    estado.pdf = { nome: arquivo.name, base64: paraBase64(bytes), ...pdf };
    const escaneado = pdf.texto.replace(/\s/g, "").length < 100 * pdf.paginas;
    $("#arquivo-info").textContent =
      `${arquivo.name} · ${pdf.paginas} página(s) · ${escaneado ? "escaneado (sem texto): o Claude vai transcrever" : `${pdf.texto.length} caracteres de texto`}`;
    $("#analisar").disabled = false;
  } catch (e) {
    mostrarErro(`Não foi possível ler o PDF: ${e.message}`);
  }
}

// ── Execução ─────────────────────────────────────────────────────────────────
function progresso(texto) {
  const li = document.createElement("li");
  li.textContent = texto;
  $("#progresso").append(li);
}

function mostrarErro(msg) {
  $("#erro").textContent = msg;
  $("#erro").hidden = false;
}

async function analisar() {
  if (!estado.pdf) return;
  if (!configurado()) {
    mostrarErro("Configure o servidor e a senha de acesso na aba Configurações.");
    return;
  }
  $("#erro").hidden = true;
  $("#progresso").innerHTML = "";
  $("#resultado").innerHTML = "";
  $("#acoes-resultado").hidden = true;
  $("#analisar").disabled = true;
  const inicio = performance.now();
  try {
    const { analisarPedido } = await import("./pipeline.js");
    const r = await analisarPedido({
      conexao: await conexaoAtual(),
      protocolo: estado.protocolo,
      texto: estado.pdf.texto,
      paginas: estado.pdf.paginas,
      pdfBase64: estado.pdf.base64,
      nomeArquivo: estado.pdf.nome,
      modeloClaude: $("#modelo-claude").value,
      aoProgredir: progresso,
    });
    const segundos = (performance.now() - inicio) / 1000;
    progresso(`Concluído em ${segundos.toFixed(1)} s.`);
    mostrarResultado({ ...r, segundos });
    registrarCusto(r);
  } catch (e) {
    mostrarErro(e.message ?? String(e));
  } finally {
    $("#analisar").disabled = false;
  }
}

function mostrarResultado({ caso, regras, julgamento, decisao, custos, avisos, trilha, anonimizacao, segundos, simulado = false }) {
  estado.ultimoResultado = {
    protocolo: { id: estado.protocolo.id, versao: estado.protocolo.versao },
    data: new Date().toISOString(),
    decisao: { codigo: decisao.codigo, titulo: decisao.titulo, pendencias: decisao.pendencias },
    caso,
    regras,
    criterios: julgamento.criterios,
    custos,
    trilha,
  };
  $("#resultado").innerHTML = renderParecer({
    protocolo: estado.protocolo, caso, regras, julgamento, decisao, custos, avisos, cambio: cambio(),
    simulado, trilha, anonimizacao, segundos,
  });
  $("#acoes-resultado").hidden = false;
  $("#resultado").scrollIntoView({ behavior: "smooth" });
}

async function rodarSimulado() {
  $("#erro").hidden = true;
  $("#progresso").innerHTML = "";
  progresso("Simulação: regras reais + julgamento SIMULADO (sem IA, sem custo).");
  const ex = await (await fetch("exemplos/caso_sintetico_aneurisma_y.json")).json();
  const regras = avaliarRegras(ex.caso, estado.protocolo);
  const criterios = criteriosAplicaveis(estado.protocolo, regras.fatos).map((c) =>
    c.aplicavel
      ? { ...c, ...ex.julgamento_simulado[c.id], decisor: "simulado" }
      : { ...c, resultado: "nao_aplicavel", justificativa: "Não se aplica." },
  );
  const decisao = classificar({ documentacao: regras.documentacao, criterios, opme: regras.opme });
  mostrarResultado({
    caso: ex.caso, regras, julgamento: { criterios, observacoes: [] }, decisao, custos: [], avisos: [], simulado: true,
  });
}

// ── Custos ───────────────────────────────────────────────────────────────────
function registrarCusto(r) {
  const log = local.ler("custos", []);
  log.push({
    data: new Date().toISOString(),
    usd: r.custos.reduce((s, c) => s + c.usd, 0),
    claude: r.trilha.usoClaude.length > 0,
    escaneado: r.trilha.escaneado,
  });
  local.gravar("custos", log.slice(-500));
  renderCalculadora();
}

function renderCalculadora() {
  const pct = (id) => Math.min(100, Math.max(0, Number($(id).value) || 0)) / 100;
  const volume = Number($("#calc-volume").value) || 0;
  const base = {
    paginas: Number($("#calc-paginas").value) || 1,
    escaneados: pct("#calc-escaneados"),
    duvidaExtracao: pct("#calc-duvida-ext"),
    duvidaCriterios: pct("#calc-duvida-crit"),
  };
  const usdFmt = (v) => `US$ ${v.toFixed(v < 0.01 ? 4 : 3)}`;
  $("#calc-tabela").innerHTML = MODELOS_CLAUDE.map((modeloClaude) => {
    const e = estimarAnalise({ ...base, modeloClaude });
    const destaque = modeloClaude === $("#modelo-claude").value ? " (selecionado)" : "";
    return `<tr>
      <td><strong>${esc(PRECOS[modeloClaude].nome)}${destaque}</strong><br><small>${e.etapas
        .filter((x) => x.usd > 0)
        .map((x) => `${esc(x.etapa)}: ${usdFmt(x.usd)}`)
        .join("<br>")}</small></td>
      <td class="num">${usdFmt(e.total)}<br><small>${brl(e.total)}</small></td>
      <td class="num">US$ ${(e.total * volume).toFixed(2)}<br><small>${brl(e.total * volume)}</small></td>
    </tr>`;
  }).join("");
  const soJev = estimarAnalise({ paginas: base.paginas });
  $("#calc-so-jev").textContent = `${usdFmt(soJev.total)} (${brl(soJev.total)}); ${volume} análises = ${brl(soJev.total * volume)} por mês`;

  const log = local.ler("custos", []);
  const media = (xs) => xs.reduce((s, x) => s + x.usd, 0) / (xs.length || 1);
  const soJevReal = log.filter((x) => !x.claude);
  $("#custos-reais").innerHTML = log.length
    ? `${log.length} análise(s): custo médio ${usdFmt(media(log))}. ` +
      `Só Jev: ${soJevReal.length} análise(s), média ${usdFmt(media(soJevReal))}. ` +
      `Com Claude: ${log.length - soJevReal.length}, média ${usdFmt(media(log.filter((x) => x.claude)))}.`
    : "Nenhuma análise real ainda. O custo medido de cada análise aparece aqui.";
}

function iniciarCalculadora() {
  for (const id of ["#calc-volume", "#calc-paginas", "#calc-escaneados", "#calc-duvida-ext", "#calc-duvida-crit"]) {
    $(id).addEventListener("input", renderCalculadora);
  }
  renderCalculadora();
}

// ── Abas e ações ─────────────────────────────────────────────────────────────
function iniciarAbas() {
  const abas = document.querySelectorAll("[role=tab]");
  const mostrar = (alvo) => {
    abas.forEach((a) => a.setAttribute("aria-selected", String(a.dataset.alvo === alvo)));
    document.querySelectorAll("[role=tabpanel]").forEach((p) => (p.hidden = p.id !== alvo));
    local.gravar("aba", alvo);
  };
  abas.forEach((a) => a.addEventListener("click", () => mostrar(a.dataset.alvo)));
  mostrar(configurado() || local.ler("aba", null) ? local.ler("aba", "painel-analise") : "painel-config");
}

function baixarJSON() {
  const blob = new Blob([JSON.stringify(estado.ultimoResultado, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "parecer-auditoria.json" });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function iniciar() {
  iniciarConfig();
  iniciarAbas();
  iniciarUpload();
  iniciarCalculadora();
  $("#analisar").addEventListener("click", analisar);
  $("#exemplo-simulado").addEventListener("click", rodarSimulado);
  $("#imprimir").addEventListener("click", () => window.print());
  $("#baixar").addEventListener("click", baixarJSON);
  $("#protocolo").addEventListener("change", (e) => selecionarProtocolo(e.target.value));
  try {
    await carregarProtocolos();
  } catch (e) {
    mostrarErro(`Não foi possível carregar os protocolos: ${e.message}`);
  }
}

iniciar();
