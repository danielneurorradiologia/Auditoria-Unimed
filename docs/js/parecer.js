// Renderização do parecer (tela e impressão).

import { PRECOS } from "./custos.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ROTULO_RESULTADO = {
  atende: ["Atende", "ok"],
  nao_atende: ["Não atende", "ruim"],
  insuficiente: ["Informação insuficiente", "alerta"],
  nao_aplicavel: ["Não se aplica", "neutro"],
};
const ROTULO_OPME = {
  ok: ["Dentro da referência", "ok"],
  excedente: ["Excedente", "ruim"],
  fora_do_kit: ["Fora do kit", "ruim"],
  justificar: ["Exige justificativa", "alerta"],
  sem_referencia: ["Análise manual", "neutro"],
};

const chip = ([texto, tipo]) => `<span class="chip chip-${tipo}">${esc(texto)}</span>`;
const usd = (v) => `US$ ${v.toFixed(v < 0.01 ? 4 : 3)}`;
const brl = (v, cambio) => `R$ ${(v * cambio).toFixed(2).replace(".", ",")}`;

export function renderParecer({ protocolo, caso, regras, julgamento, decisao, custos, avisos, cambio, simulado }) {
  const total = custos.reduce((s, c) => s + c.usd, 0);
  const hoje = new Date().toLocaleString("pt-BR");
  return `
  <article class="parecer">
    <header class="parecer-cab">
      <div>
        <p class="sobretitulo">Parecer de auditoria — sugestão do sistema</p>
        <h2>${esc(protocolo.nome)}</h2>
        <p class="meta">Protocolo v${esc(protocolo.versao)} (${esc(protocolo.status)}) · ${esc(hoje)}${simulado ? " · <strong>EXEMPLO SIMULADO, sem IA</strong>" : ""}</p>
      </div>
    </header>

    <section class="decisao decisao-${decisao.cor}">
      <p class="sobretitulo">Decisão sugerida</p>
      <p class="decisao-titulo">${esc(decisao.titulo)}</p>
      <p class="decisao-nota">Sugestão automatizada. Negativas e glosas exigem análise e assinatura do médico auditor (Res. CFM 1.614/2001).</p>
    </section>

    ${avisos.length ? `<section class="avisos">${avisos.map((a) => `<p>⚠ ${esc(a)}</p>`).join("")}</section>` : ""}

    ${lista("Pendências a solicitar ao médico assistente", decisao.pendencias)}
    ${decisao.naoAtende.length ? lista("Critérios obrigatórios não atendidos", decisao.naoAtende.map((c) => `${c.id}: ${c.justificativa}`)) : ""}
    ${lista("Alertas de coerência", regras.alertas)}

    <section>
      <h3>Critérios clínicos do protocolo</h3>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Critério</th><th>Resultado</th><th>Justificativa / evidência</th></tr></thead>
        <tbody>${julgamento.criterios
          .map(
            (c) => `<tr>
              <td><strong>${esc(c.id)}</strong> <small>(${esc(c.peso)})</small><br><span class="pergunta">${esc(c.pergunta)}</span></td>
              <td>${chip(ROTULO_RESULTADO[c.resultado] ?? [c.resultado, "neutro"])}${c.confianca != null ? `<br><small>confiança ${(c.confianca * 100).toFixed(0)}%</small>` : ""}${c.decisor ? `<br><small>${esc(c.decisor)}</small>` : ""}</td>
              <td>${esc(c.justificativa)}${c.evidencia ? `<br><small class="evidencia">Evidência: ${esc(c.evidencia)}</small>` : ""}<br><small>Fonte: ${esc(protocolo.fontes?.[c.fonte] ?? c.fonte)}</small></td>
            </tr>`,
          )
          .join("")}</tbody>
      </table></div>
      ${julgamento.observacoes?.length ? lista("Observações da IA para o auditor", julgamento.observacoes) : ""}
    </section>

    <section>
      <h3>OPME × kit-padrão de referência</h3>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Categoria</th><th class="num">Solicitado</th><th class="num">Referência</th><th>Situação</th><th>Itens do pedido</th></tr></thead>
        <tbody>${regras.opme.linhas
          .map(
            (l) => `<tr>
              <td>${esc(l.nome)}</td><td class="num">${l.solicitado}</td><td class="num">${l.referencia}</td>
              <td>${chip(ROTULO_OPME[l.status])}<br><small>${esc(l.detalhe)}</small></td>
              <td><small>${l.itens.map((i) => `${i.quantidade}× ${esc(i.descricao)}`).join("<br>")}</small></td>
            </tr>`,
          )
          .join("")}</tbody>
      </table></div>
    </section>

    <section>
      <h3>Documentação obrigatória</h3>
      <ul class="checklist">${regras.documentacao
        .map((d) => `<li class="${d.ok ? "ok" : "falta"}">${d.ok ? "✔" : "✖"} <strong>${esc(d.id)}</strong> ${esc(d.descricao)} — <small>${esc(d.detalhe)}</small></li>`)
        .join("")}</ul>
    </section>

    <section>
      <h3>Dados calculados</h3>
      ${regras.fatos.aneurismas.length
        ? `<ul>${regras.fatos.aneurismas
            .map(
              (a) => `<li>Aneurisma ${esc(a.localizacao)} ${esc(a.lado)} — colo largo: ${a.colo_largo === null ? "indeterminado" : a.colo_largo ? "sim" : "não"}; PHASES: ${
                a.phases.calculavel
                  ? `${a.phases.total} pontos (risco de ruptura em 5 anos ≈ ${a.phases.risco5anos}%; premissa: ${esc(a.phases.premissa)})`
                  : `não calculável (faltam ${esc(a.phases.faltam.join(", "))})`
              }</li>`,
            )
            .join("")}</ul>`
        : "<p>Sem aneurisma-alvo definido: PHASES e colo não calculáveis.</p>"}
    </section>

    <section>
      <h3>Resumo clínico (anonimizado)</h3>
      <p>${esc(caso.resumo_clinico)}</p>
    </section>

    <section class="custo-analise">
      <h3>Custo desta análise</h3>
      <table><tbody>${custos
        .map((c) => `<tr><td>${esc(c.etapa)} <small>(${esc(PRECOS[c.modelo]?.nome ?? c.modelo)})</small></td><td class="num">${usd(c.usd)}</td><td class="num">${brl(c.usd, cambio)}</td></tr>`)
        .join("")}
        <tr class="total"><td>Total</td><td class="num">${usd(total)}</td><td class="num">${brl(total, cambio)}</td></tr>
      </tbody></table>
    </section>

    <section class="assinatura">
      <h3>Decisão do médico auditor</h3>
      <p>☐ Autorizo &nbsp; ☐ Autorizo parcialmente &nbsp; ☐ Solicito complementação &nbsp; ☐ Encaminho à junta médica</p>
      <p>Observações: ______________________________________________________________</p>
      <p>Médico auditor / CRM: _______________________ &nbsp; Data: ___/___/______</p>
    </section>
  </article>`;
}

function lista(titulo, itens) {
  if (!itens?.length) return "";
  return `<section><h3>${esc(titulo)}</h3><ul>${itens.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`;
}
