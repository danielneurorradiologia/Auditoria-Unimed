// Leitura dos PDFs fictícios com pdf.js (mesmo código do site) + anonimização + parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { extrairTextoPdf } from "../docs/js/texto.js";
import { anonimizar } from "../docs/js/anonimizar.js";
import { lerPedido, medidasPorLocal, tipoDoLaudo, normalizarLinhas } from "../docs/js/parser.js";

const ler = async (nome) =>
  extrairTextoPdf(pdfjs, new Uint8Array(readFileSync(new URL(`../docs/exemplos/${nome}`, import.meta.url))));

const PII = /Maria Exemplo|Silva|João|Souza|Laudista|98888|exemplo\.com|CRM 00000/;

test("pedido completo: anonimização, códigos, medidas e itens", async () => {
  const pdf = await ler("demo_pedido_completo_molas.pdf");
  const anon = anonimizar(pdf.texto, "demo_pedido_completo_molas.pdf");
  assert.doesNotMatch(anon.texto, PII);
  const p = lerPedido(anon.texto);
  assert.equal(p.idade, 61);
  assert.deepEqual(p.cids, ["I67.1"]);
  assert.deepEqual(p.tussProcedimento, ["99990001"]);
  assert.deepEqual(p.acessos, ["femoral"]);
  assert.equal(p.itens.length, 11);
  assert.ok(p.itens.every((i) => i.codigo_tuss && i.registro_anvisa && i.marcas.length === 3));
  assert.equal(p.itens.find((i) => i.n === 9).quantidade, 6);
  assert.equal(tipoDoLaudo(p.textoClinico), "angiografia_digital");
  const { porLocal } = medidasPorLocal(p.frases, ["acom"]);
  assert.deepEqual(porLocal.acom, { tamanho_mm: 8.2, colo_mm: 3.1, lado: "linha_media" });
});

test("pedido incompleto: 23 itens, item grudado fora da numeração e linhas quebradas", async () => {
  const pdf = await ler("demo_pedido_incompleto_stent.pdf");
  const p = lerPedido(anonimizar(pdf.texto, "x.pdf").texto);
  assert.equal(p.itens.length, 23);
  assert.equal(p.itens[0].fora_da_numeracao, true);
  assert.ok(p.itens.every((i) => i.quantidade <= 10), "nenhuma quantidade absurda (ex.: '0.88 de lumen')");
  assert.match(p.itens.find((i) => i.n === 3).descricao, /triaxial, 6F$/);
  assert.deepEqual([...p.candidatos.keys()], ["acom", "aci_oftalmica"]);
  assert.deepEqual(p.acessos, ["femoral", "radial"]);
});

test("PDF escaneado não tem camada de texto", async () => {
  const pdf = await ler("demo_pedido_completo_escaneado.pdf");
  assert.equal(pdf.texto.replace(/\s/g, "").length, 0);
});

test("normalização: '1)' isolado e itens grudados na mesma linha", () => {
  const l = normalizarLinhas("abaixo:01 Stent X\r\n1)\r\n01 Introdutor 6F 2) 02 Molas 3) 01 Balão");
  assert.deepEqual(l, ["abaixo:01 Stent X", "1) 01 Introdutor 6F", "2) 02 Molas", "3) 01 Balão"]);
});

test("anonimização: telefone, e-mail, CPF, CRM e nome no cabeçalho e no nome do arquivo", () => {
  const texto = "Folha 1\nÍris Moreira Tavares de Lima\nOtávio Prado 91 988887777 a@b.com\nCPF 123.456.789-00 CRM-PA 12345\nPaciente com aneurisma da comunicante anterior medindo 8 mm, com colo largo e lobulação evidente na angiografia.";
  const a = anonimizar(texto, "PEDIDO_Íris_Moreira_Tavares_de_Lima_Stent_em_X_15.03.2024.pdf");
  assert.doesNotMatch(a.texto, /Íris|Tavares|Otávio|Prado|988887777|a@b\.com|123\.456|12345/);
  assert.match(a.texto, /comunicante anterior medindo 8 mm/);
  assert.equal(a.nomeArquivo, "PEDIDO de Stent em X");
});
