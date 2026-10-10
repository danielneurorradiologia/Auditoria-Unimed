import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

import {
  avaliarRegras, calcularPhases, classificar, coloLargo, aneurismasAlvo, criteriosAplicaveis,
} from "../docs/js/regras.js";
import { estimarAnalise } from "../docs/js/custos.js";

const raiz = new URL("../docs/", import.meta.url);
const protocolo = yaml.load(readFileSync(new URL("protocolos/aneurisma_intracraniano_nao_roto.yaml", raiz), "utf8"));
const exemplo = JSON.parse(readFileSync(new URL("exemplos/caso_sintetico_aneurisma_y.json", raiz), "utf8"));

function julgarExemplo(caso) {
  const r = avaliarRegras(caso, protocolo);
  const criterios = criteriosAplicaveis(protocolo, r.fatos).map((c) =>
    c.aplicavel ? { ...c, ...exemplo.julgamento_simulado[c.id] } : { ...c, resultado: "nao_aplicavel" },
  );
  return { ...r, decisao: classificar({ documentacao: r.documentacao, criterios, opme: r.opme }) };
}

const linha = (r, cat) => r.opme.linhas.find((l) => l.categoria === cat);

test("caso sintético (pedido real anonimizado) cai em pendência", () => {
  const r = julgarExemplo(exemplo.caso);
  assert.equal(r.decisao.codigo, "pendencia");
  assert.ok(r.documentacao.every((d) => !d.ok), "toda a documentação obrigatória está ausente");
});

test("kit-padrão: excedentes e itens fora do kit do caso sintético", () => {
  const r = julgarExemplo(exemplo.caso);
  assert.equal(linha(r, "introdutor").solicitado, 3);
  assert.equal(linha(r, "introdutor").referencia, 2); // base + duplo acesso
  assert.equal(linha(r, "introdutor").status, "excedente");
  assert.equal(linha(r, "stent_intracraniano").solicitado, 3);
  assert.equal(linha(r, "stent_intracraniano").glosa, 1); // Y = 2 stents
  assert.equal(linha(r, "microcateter_balao").status, "fora_do_kit");
  assert.equal(linha(r, "mola").status, "justificar"); // sem alvo/medidas
  assert.equal(linha(r, "monitorizacao_neurofisiologica").status, "justificar");
  assert.equal(linha(r, "microcateter").status, "ok");
  assert.equal(linha(r, "conector_y").glosa, 2);
});

test("alertas de coerência do caso sintético", () => {
  const { alertas } = avaliarRegras(exemplo.caso, protocolo);
  const texto = alertas.join("\n");
  assert.match(texto, /duplicado.*Introdutor femoral 6F/);
  assert.match(texto, /Duplo acesso/);
  assert.match(texto, /balão/);
  assert.match(texto, /3 stents/);
});

test("PHASES: cálculo e dados faltantes", () => {
  const pac = { idade: 72, hipertensao: "sim", hsa_previa: "nao" };
  const r = calcularPhases(pac, { tamanho_mm: 8, localizacao: "acom" });
  assert.equal(r.total, 1 + 1 + 3 + 4); // HAS + idade≥70 + 7–9,9 mm + ACA/Acom
  assert.equal(r.risco5anos, 4.3);
  assert.equal(calcularPhases(pac, { tamanho_mm: 3, localizacao: "aci_oftalmica" }).total, 2);
  assert.equal(calcularPhases(pac, { tamanho_mm: 25, localizacao: "basilar" }).risco5anos, 17.8);
  const falta = calcularPhases({ idade: null, hipertensao: "nao_informado", hsa_previa: "nao" }, { tamanho_mm: null, localizacao: "acm" });
  assert.equal(falta.calculavel, false);
  assert.deepEqual(falta.faltam, ["idade", "hipertensão", "tamanho"]);
});

test("colo largo: ≥ 4 mm ou domo/colo < 2", () => {
  assert.equal(coloLargo({ tamanho_mm: 10, colo_mm: 4 }), true);
  assert.equal(coloLargo({ tamanho_mm: 5, colo_mm: 3 }), true);
  assert.equal(coloLargo({ tamanho_mm: 8, colo_mm: 3 }), false);
  assert.equal(coloLargo({ tamanho_mm: 8, colo_mm: null }), null);
});

test("caso completo e dentro do kit é autorizado", () => {
  const caso = structuredClone(exemplo.caso);
  caso.paciente = { idade: 58, sexo: "F", hipertensao: "sim", tabagismo: "nao", hsa_previa: "nao" };
  caso.diagnosticos = [{ descricao: "Aneurisma Acom", cid: "I67.1" }];
  caso.procedimentos = [{ descricao: "Embolização", tuss: "00000000" }];
  caso.aneurismas = [{ ...caso.aneurismas[0], tamanho_mm: 8, colo_mm: 3, sera_tratado: "sim" }];
  caso.exames = [{ tipo: "angiografia_digital", data: null, laudo_anexado: true, achados: "Aneurisma Acom 8 mm" }];
  caso.tecnicas = ["molas_simples"];
  caso.acessos = ["femoral"];
  caso.inconsistencias_textuais = [];
  const marcas = ["A", "B", "C"];
  caso.opme = [
    { n: 1, descricao: "Introdutor 6F", categoria: "introdutor", quantidade: 1 },
    { n: 2, descricao: "Microcateter", categoria: "microcateter", quantidade: 1 },
    { n: 3, descricao: "Molas", categoria: "mola", quantidade: 6 },
  ].map((i) => ({ ...i, codigo_tuss: "1", registro_anvisa: "1", marcas }));

  const r = avaliarRegras(caso, protocolo);
  assert.equal(aneurismasAlvo(caso).length, 1);
  assert.ok(r.documentacao.every((d) => d.ok), JSON.stringify(r.documentacao.filter((d) => !d.ok)));
  assert.equal(linha(r, "mola").referencia, 8);
  const criterios = criteriosAplicaveis(protocolo, r.fatos).map((c) =>
    c.aplicavel ? { ...c, resultado: "atende" } : { ...c, resultado: "nao_aplicavel" },
  );
  assert.equal(classificar({ documentacao: r.documentacao, criterios, opme: r.opme }).codigo, "autorizar");

  criterios.find((c) => c.id === "C2").resultado = "nao_atende";
  assert.equal(classificar({ documentacao: r.documentacao, criterios, opme: r.opme }).codigo, "especialista");
});

test("critérios condicionais: C4–C6 só se aplicam com stent", () => {
  const ids = (fatos) => criteriosAplicaveis(protocolo, fatos).filter((c) => c.aplicavel).map((c) => c.id);
  assert.deepEqual(ids({ usa_stent: false, dois_stents: false }), ["C1", "C2", "C3", "C7"]);
  assert.deepEqual(ids({ usa_stent: true, dois_stents: true }), ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]);
});

test("estimativa de custo: Jev puro e reserva Claude", () => {
  const perto = (v, esperado) => assert.ok(Math.abs(v - esperado) < 1e-6, `${v} ≠ ${esperado}`);
  perto(estimarAnalise({ paginas: 5 }).total, 0.0006); // 15 mil tokens × US$ 0,04/M
  // 30% escaneados (OCR Opus 5 pág.), 20% dúvida de extração, 30% dúvida de critérios
  const misto = estimarAnalise({ paginas: 5, escaneados: 0.3, duvidaExtracao: 0.2, duvidaCriterios: 0.3 });
  perto(misto.total, 0.0006 + 0.3 * 0.132 + 0.2 * 0.114 + 0.3 * 0.032);
});
