// Teste de integração com as APIs REAIS (gasta alguns centavos).
// Uso: npm run test:integracao [-- caminho/do/arquivo.pdf ...]
// Lê ANTHROPIC_API_KEY e TYPESAFE_API_KEY do arquivo .env (ignorado pelo git).
// Sem argumentos, roda os PDFs fictícios de docs/exemplos/.

import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import yaml from "js-yaml";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { criarConexao } from "../docs/js/ia.js";
import { extrairTextoPdf } from "../docs/js/texto.js";
import { analisarPedido } from "../docs/js/pipeline.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const modeloClaude = env.MODELO_CLAUDE || "claude-opus-5-5";
const conexao = criarConexao({ chaveClaude: env.ANTHROPIC_API_KEY, chaveJev: env.TYPESAFE_API_KEY });
const protocolo = yaml.load(
  readFileSync(new URL("../docs/protocolos/aneurisma_intracraniano_nao_roto.yaml", import.meta.url), "utf8"),
);

const exemplos = new URL("../docs/exemplos/", import.meta.url);
const arquivos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(exemplos).filter((f) => f.endsWith(".pdf")).map((f) => new URL(f, exemplos).pathname.replace(/^\/([A-Z]:)/, "$1"));

for (const arquivo of arquivos) {
  const bytes = new Uint8Array(readFileSync(decodeURIComponent(arquivo)));
  const pdf = await extrairTextoPdf(pdfjs, bytes.slice());
  const inicio = Date.now();
  console.log(`\n══════ ${basename(arquivo)} (${pdf.paginas} pág., ${pdf.caracteres.join("/")} caracteres)`);
  try {
    const r = await analisarPedido({
      conexao,
      protocolo,
      texto: pdf.texto,
      paginas: pdf.paginas,
      pdfBase64: Buffer.from(bytes).toString("base64"),
      nomeArquivo: basename(arquivo),
      modeloClaude,
      aoProgredir: (m) => console.log(`  … ${m}`),
    });
    const total = r.custos.reduce((s, c) => s + c.usd, 0);
    console.log(`  DECISÃO: ${r.decisao.titulo}`);
    console.log(`  Trilha: ${JSON.stringify(r.trilha)}`);
    console.log(`  Custo: US$ ${total.toFixed(5)} — ${r.custos.map((c) => `${c.etapa} ${c.usd.toFixed(5)}`).join(" | ")}`);
    console.log(`  Tempo: ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
    console.log(`  Caso: idade=${r.caso.paciente.idade} sexo=${r.caso.paciente.sexo} HAS=${r.caso.paciente.hipertensao} HSA=${r.caso.paciente.hsa_previa} técnicas=${r.caso.tecnicas.join(",")}`);
    console.log(`  Aneurismas: ${JSON.stringify(r.caso.aneurismas)}`);
    console.log(`  OPME: ${r.caso.opme.map((i) => `${i.quantidade}×${i.categoria}`).join(", ")}`);
    console.log(`  Critérios: ${r.julgamento.criterios.map((c) => `${c.id}=${c.resultado}${c.decisor ? `(${c.decisor}${c.confianca != null ? ` ${(c.confianca * 100).toFixed(0)}%` : ""})` : ""}`).join(" ")}`);
    console.log(`  Pendências (${r.decisao.pendencias.length}): ${r.decisao.pendencias.slice(0, 6).join(" ‖ ")}`);
    console.log(`  Glosas: ${r.decisao.glosas.map((g) => `${g.nome} ${g.glosa}`).join(", ") || "nenhuma"}`);
    console.log(`  Alertas: ${r.regras.alertas.join(" ‖ ") || "nenhum"}`);
    if (r.avisos.length) console.log(`  Avisos: ${r.avisos.join(" ‖ ")}`);
  } catch (e) {
    console.log(`  ERRO: ${e.message}`);
  }
}
