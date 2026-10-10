// Diagnóstico: roda só regras + Jev (custo ~US$ 0,001) e mostra as respostas incertas.
import { readFileSync, readdirSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { criarConexao } from "../docs/js/ia.js";
import { extrairTextoPdf } from "../docs/js/texto.js";
import { anonimizar } from "../docs/js/anonimizar.js";
import { extrairComJev } from "../docs/js/extracao_jev.js";

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const conexao = criarConexao({ chaveJev: env.TYPESAFE_API_KEY });
const pasta = new URL("../docs/exemplos/", import.meta.url);
for (const f of readdirSync(pasta).filter((f) => f.endsWith(".pdf"))) {
  const pdf = await extrairTextoPdf(pdfjs, new Uint8Array(readFileSync(new URL(f, pasta))));
  const anon = anonimizar(pdf.texto, f);
  const r = await extrairComJev(conexao, { textoAnonimo: anon.texto, nomeArquivo: anon.nomeArquivo });
  console.log(`\n== ${f}: incertezas=${JSON.stringify(r.incertezas)} itens=${r.caso.opme.length}`);
  console.log("dúvidas:", JSON.stringify(r.duvidas));
  console.log("técnicas:", r.caso.tecnicas.join(","), "| aneurismas:", r.caso.aneurismas.map((a) => `${a.localizacao}(${a.tamanho_mm}/${a.colo_mm},${a.lado})`).join(" "));
  console.log("opme:", r.caso.opme.map((i) => `${i.n}:${i.quantidade}×${i.categoria}`).join(" "));
  const conf = Object.entries(r.origem).filter(([k]) => /tecnicas|aneurismas\.\w+$/.test(k)).map(([k, v]) => `${k.split(".").pop()}=${v.confianca?.toFixed(2)}`);
  console.log("confianças:", conf.join(" "));
}
