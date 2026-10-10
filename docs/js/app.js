// Interface: configuração, upload, execução do motor e calculadora de custos.

import { avaliarRegras, classificar, criteriosAplicaveis } from "./regras.js";
import { PERFIS, PREMISSAS, estimarAnalise } from "./custos.js";
import { renderParecer, esc } from "./parecer.js";

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

// ── Protocolos ───────────────────────────────────────────────────────────────
async function carregarProtocolos() {
  const indice = await (await fetch("protocolos/index.json")).json();
  $("#protocolo").innerHTML = indice
    .map((p) => `<option value="${esc(p.arquivo)}">${esc(p.nome)} (${esc(p.status)})</option>`)
    .join("");
  await selecionarProtocolo(indice[0].arquivo);
}

async function selecionarProtocolo(arquivo) {
  const texto = await (await fetch(`protocolos/${arquivo}`)).text();
  estado.protocolo = window.jsyaml.load(texto);
  $("#protocolo-info").textContent =
    `Versão ${estado.protocolo.versao} · ${estado.protocolo.criterios.length} critérios · ${estado.protocolo.documentacao.length} itens de documentação`;
}

// ── Configuração ─────────────────────────────────────────────────────────────
function iniciarConfig() {
  $("#perfil").innerHTML = Object.entries(PERFIS)
    .map(([id, p]) => `<option value="${id}">${esc(p.nome)}</option>`)
    .join("");
  $("#perfil").value = local.ler("perfil", "qualidade");
  $("#chave-claude").value = local.ler("chaveClaude", "");
  $("#chave-jev").value = local.ler("chaveJev", "");
  $("#cambio").value = local.ler("cambio", 5.5);

  $("#perfil").addEventListener("change", () => {
    local.gravar("perfil", $("#perfil").value);
    atualizarEstimativaPedido();
  });
  $("#chave-claude").addEventListener("change", () => local.gravar("chaveClaude", $("#chave-claude").value.trim()));
  $("#chave-jev").addEventListener("change", () => local.gravar("chaveJev", $("#chave-jev").value.trim()));
  $("#cambio").addEventListener("change", () => {
    local.gravar("cambio", Number($("#cambio").value));
    renderCalculadora();
  });
  $("#esquecer-chaves").addEventListener("click", () => {
    $("#chave-claude").value = $("#chave-jev").value = "";
    local.gravar("chaveClaude", "");
    local.gravar("chaveJev", "");
  });
}

const cambio = () => Number($("#cambio").value) || 5.5;

// ── Upload ───────────────────────────────────────────────────────────────────
function iniciarUpload() {
  const zona = $("#zona-upload");
  const input = $("#arquivo");
  zona.addEventListener("click", () => input.click());
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
}

async function receberArquivo(arquivo) {
  if (arquivo.type !== "application/pdf") return mostrarErro("Envie um arquivo PDF.");
  if (arquivo.size > 30 * 1024 * 1024) return mostrarErro("PDF acima de 30 MB (limite da API: 32 MB).");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const paginas = Math.max(1, (binario.match(/\/Type\s*\/Page(?!s)/g) ?? []).length);
  estado.pdf = { nome: arquivo.name, base64: btoa(binario), paginas };
  $("#arquivo-info").textContent = `${arquivo.name} · ${paginas} página(s) · ${(arquivo.size / 1024 / 1024).toFixed(1)} MB`;
  $("#analisar").disabled = false;
  atualizarEstimativaPedido();
}

function atualizarEstimativaPedido() {
  if (!estado.pdf) return;
  const e = estimarAnalise($("#perfil").value, estado.pdf.paginas);
  $("#estimativa-pedido").textContent =
    `Custo estimado: US$ ${e.total.toFixed(3)} (≈ R$ ${(e.total * cambio()).toFixed(2).replace(".", ",")})`;
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
  const chaveClaude = $("#chave-claude").value.trim();
  if (!chaveClaude) return mostrarErro("Informe a chave da API Claude em Configurações.");
  $("#erro").hidden = true;
  $("#progresso").innerHTML = "";
  $("#resultado").innerHTML = "";
  $("#analisar").disabled = true;

  const perfil = PERFIS[$("#perfil").value];
  try {
    // Módulos de IA carregados só aqui: o modo exemplo funciona mesmo sem acesso ao CDN.
    const { criarClienteClaude } = await import("./ia.js");
    const { extrairCaso } = await import("./extracao.js");
    const { avaliarCriterios } = await import("./julgamento.js");
    const cliente = criarClienteClaude(chaveClaude);

    progresso(`1/4 Lendo o PDF e extraindo dados (${perfil.extracao})…`);
    const extracao = await extrairCaso(cliente, {
      modelo: perfil.extracao,
      pdfBase64: estado.pdf.base64,
      nomeArquivo: estado.pdf.nome,
    });
    const caso = extracao.dados;

    progresso("2/4 Aplicando regras determinísticas (documentação, kit-padrão, PHASES)…");
    const regras = avaliarRegras(caso, estado.protocolo);

    progresso("3/4 Julgando critérios clínicos…");
    const julgamento = await avaliarCriterios({
      caso,
      fatos: regras.fatos,
      protocolo: estado.protocolo,
      perfil,
      clienteClaude: cliente,
      chaveJev: $("#chave-jev").value.trim(),
      aoProgredir: progresso,
    });

    progresso("4/4 Classificando e montando o parecer…");
    const custos = [{ etapa: "Extração", ...extracao.custo }, ...julgamento.custos];
    mostrarResultado({ caso, regras, julgamento, custos, avisos: julgamento.avisos });
    registrarCusto(custos);
  } catch (e) {
    mostrarErro(e.message ?? String(e));
  } finally {
    $("#analisar").disabled = false;
  }
}

function mostrarResultado({ caso, regras, julgamento, custos, avisos, simulado = false }) {
  const decisao = classificar({ documentacao: regras.documentacao, criterios: julgamento.criterios, opme: regras.opme });
  estado.ultimoResultado = { protocolo: { id: estado.protocolo.id, versao: estado.protocolo.versao }, caso, regras, julgamento, decisao, custos };
  $("#resultado").innerHTML = renderParecer({
    protocolo: estado.protocolo, caso, regras, julgamento, decisao, custos, avisos, cambio: cambio(), simulado,
  });
  $("#acoes-resultado").hidden = false;
  $("#resultado").scrollIntoView({ behavior: "smooth" });
}

async function rodarExemplo() {
  $("#erro").hidden = true;
  $("#progresso").innerHTML = "";
  progresso("Exemplo sintético: regras reais + julgamento SIMULADO (sem IA, sem custo).");
  const ex = await (await fetch("exemplos/caso_sintetico_aneurisma_y.json")).json();
  const regras = avaliarRegras(ex.caso, estado.protocolo);
  const criterios = criteriosAplicaveis(estado.protocolo, regras.fatos).map((c) =>
    c.aplicavel
      ? { ...c, ...ex.julgamento_simulado[c.id], decisor: "simulado" }
      : { ...c, resultado: "nao_aplicavel", justificativa: "Não se aplica." },
  );
  mostrarResultado({
    caso: ex.caso, regras, julgamento: { criterios, observacoes: [] }, custos: [], avisos: [], simulado: true,
  });
}

// ── Registro de custos reais (sem dados de paciente) ─────────────────────────
function registrarCusto(custos) {
  const log = local.ler("custos", []);
  log.push({
    data: new Date().toISOString(),
    perfil: $("#perfil").value,
    paginas: estado.pdf.paginas,
    usd: custos.reduce((s, c) => s + c.usd, 0),
  });
  local.gravar("custos", log.slice(-500));
  renderCalculadora();
}

// ── Calculadora ──────────────────────────────────────────────────────────────
function renderCalculadora() {
  const volume = Number($("#calc-volume").value) || 0;
  const paginas = Number($("#calc-paginas").value) || 1;
  const c = cambio();
  const real = (v) => `R$ ${(v * c).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  $("#calc-tabela").innerHTML = Object.keys(PERFIS)
    .map((id) => {
      const e = estimarAnalise(id, paginas);
      return `<tr>
        <td><strong>${esc(e.perfil)}</strong><br><small>${e.etapas.filter((x) => x.usd > 0).map((x) => `${esc(x.etapa)}: US$ ${x.usd.toFixed(4)}`).join("<br>")}</small></td>
        <td class="num">US$ ${e.total.toFixed(3)}<br><small>${real(e.total)}</small></td>
        <td class="num">US$ ${(e.total * volume).toFixed(2)}<br><small>${real(e.total * volume)}</small></td>
      </tr>`;
    })
    .join("");

  const log = local.ler("custos", []);
  $("#custos-reais").innerHTML = log.length
    ? `${log.length} análise(s) real(is) neste navegador · custo médio US$ ${(log.reduce((s, x) => s + x.usd, 0) / log.length).toFixed(3)} · última US$ ${log.at(-1).usd.toFixed(3)} (${esc(log.at(-1).perfil)}, ${log.at(-1).paginas} pág.)`
    : "Nenhuma análise real ainda. O custo medido de cada análise aparece aqui.";
}

function iniciarCalculadora() {
  $("#premissas").textContent = Object.entries(PREMISSAS).map(([k, v]) => `${k}: ${v}`).join(" · ");
  for (const id of ["#calc-volume", "#calc-paginas"]) $(id).addEventListener("input", renderCalculadora);
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
  mostrar(local.ler("aba", "painel-analise"));
}

function baixarJSON() {
  const blob = new Blob([JSON.stringify(estado.ultimoResultado, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "parecer-auditoria.json" });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function iniciar() {
  iniciarAbas();
  iniciarConfig();
  iniciarUpload();
  iniciarCalculadora();
  $("#analisar").addEventListener("click", analisar);
  $("#exemplo").addEventListener("click", rodarExemplo);
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
