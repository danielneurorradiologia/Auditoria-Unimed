// Fluxo completo de uma análise (sem DOM — roda no navegador e nos testes em Node).
//
//   texto do PDF ──(escaneado?)──► Claude transcreve
//        │
//        ▼
//   anonimização ─► regras + Jev extraem ─(incertezas?)─► Claude completa só esses campos
//        │
//        ▼
//   regras determinísticas ─► Jev julga critérios ─(confiança < 80%?)─► Claude revisa
//        │
//        ▼
//   classificação + parecer

import { anonimizar } from "./anonimizar.js";
import { extrairComJev } from "./extracao_jev.js";
import { extrairCasoClaude, mesclarGrupos, transcreverPdf } from "./extracao.js";
import { avaliarCriterios } from "./julgamento.js";
import { avaliarRegras, classificar } from "./regras.js";

export const MIN_CARACTERES_POR_PAGINA = 100;

export async function analisarPedido({
  conexao, protocolo, texto, paginas = 1, pdfBase64, nomeArquivo = "pedido.pdf", modeloClaude, aoProgredir = () => {},
}) {
  const custos = [];
  const avisos = [];
  const usoClaude = [];
  let textoBruto = texto ?? "";

  const escaneado = textoBruto.replace(/\s/g, "").length < MIN_CARACTERES_POR_PAGINA * paginas;
  if (escaneado) {
    if (!conexao.claude || !pdfBase64) throw new Error("PDF escaneado (sem texto) e Claude indisponível para transcrever.");
    aoProgredir("PDF escaneado, sem camada de texto: Claude transcrevendo o documento…");
    const t = await transcreverPdf(conexao, { modelo: modeloClaude, pdfBase64 });
    custos.push({ etapa: "Transcrição do PDF escaneado (Claude)", ...t.custo });
    usoClaude.push("transcrição do PDF escaneado");
    textoBruto = t.texto;
  }

  aoProgredir("Anonimizando o texto no navegador…");
  const anon = anonimizar(textoBruto, nomeArquivo);

  aoProgredir("Jev + regras extraindo os dados do pedido…");
  const ext = await extrairComJev(conexao, { textoAnonimo: anon.texto, nomeArquivo: anon.nomeArquivo });
  custos.push(...ext.custos);
  let caso = ext.caso;

  if (ext.incertezas.length) {
    if (!conexao.claude) {
      avisos.push(`Jev com baixa confiança em: ${ext.incertezas.join(", ")}. Claude indisponível — revisar manualmente.`);
    } else {
      aoProgredir(`Claude completando o que o Jev não resolveu (${ext.incertezas.join(", ")})…`);
      try {
        const cl = await extrairCasoClaude(conexao, { modelo: modeloClaude, texto: anon.texto, nomeArquivo: anon.nomeArquivo });
        custos.push({ etapa: "Extração (Claude, reserva)", ...cl.custo });
        caso = mesclarGrupos(caso, cl.dados, ext.incertezas);
        usoClaude.push(`extração: ${ext.incertezas.join(", ")}`);
      } catch (e) {
        avisos.push(`Claude indisponível na extração (${e.message}). Mantidas as respostas do Jev.`);
      }
    }
  }

  aoProgredir("Aplicando regras: documentação, kit-padrão, PHASES…");
  const regras = avaliarRegras(caso, protocolo);

  const julgamento = await avaliarCriterios({ caso, fatos: regras.fatos, protocolo, conexao, modeloClaude, aoProgredir });
  custos.push(...julgamento.custos);
  avisos.push(...julgamento.avisos);
  const criteriosClaude = julgamento.criterios.filter((c) => c.decisor === "claude").length;
  if (criteriosClaude) usoClaude.push(`${criteriosClaude} critério(s) clínico(s)`);

  const decisao = classificar({ documentacao: regras.documentacao, criterios: julgamento.criterios, opme: regras.opme });

  return {
    caso,
    regras,
    julgamento,
    decisao,
    custos,
    avisos,
    trilha: {
      escaneado,
      perguntasJev: ext.contagem.perguntasJev + julgamento.criterios.filter((c) => c.aplicavel).length,
      criteriosJev: julgamento.criterios.filter((c) => c.decisor === "jev").length,
      camposRegra: ext.contagem.camposRegra,
      incertezasExtracao: ext.incertezas,
      duvidas: ext.duvidas,
      usoClaude,
    },
    anonimizacao: { texto: anon.texto, nomeArquivo: anon.nomeArquivo, contagem: anon.contagem },
  };
}
