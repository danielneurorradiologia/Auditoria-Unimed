# Auditoria OPME: protótipo com IA

Web app para **pré-análise de pedidos de procedimentos e OPME** em auditoria médica. O fluxo é:

1. O médico auditor envia o PDF do pedido (formulário TISS, relatório, laudos).
2. O sistema confere o pedido contra um **protocolo técnico versionado**, baseado nos guidelines das sociedades médicas, no Rol/DUT da ANS e na TUSS.
3. O sistema **sugere** uma decisão: autorizar, autorizar parcialmente, pendência ou encaminhar ao especialista.

> ⚠️ **Protótipo pessoal, experimental.** A decisão final é sempre do médico auditor (Res. CFM 1.614/2001).
> Não envie dados de pacientes sem autorização institucional (LGPD). Nenhum documento de paciente deve ser
> commitado neste repositório (o `.gitignore` bloqueia PDFs e imagens).

**App:** https://danielneurorradiologia.github.io/Auditoria-Unimed/

## Como funciona

```
PDF do pedido
   │
   ▼
1. Extração (Claude lê o PDF, inclusive escaneado) ──► caso estruturado e anonimizado (JSON)
   │
   ▼
2. Regras determinísticas (código, custo zero)
   • documentação obrigatória (CID, TUSS, ANVISA, 3 marcas, laudos)
   • OPME × kit-padrão (excedentes, itens fora do kit, duplicidades)
   • cálculos: PHASES, colo largo
   │
   ▼
3. Critérios clínicos do protocolo
   • perfil Claude: o Claude julga cada critério e cita a evidência
   • perfil Jev: o Jev decide cada critério com probabilidade; confiança < 80% → Claude
   │
   ▼
4. Classificação + parecer (imprimível; registra a versão do protocolo e o custo)
```

| Decisão sugerida | Quando |
|---|---|
| 🟢 Autorizar | Documentação completa, critérios atendidos, OPME dentro do kit |
| 🟡 Autorizar parcialmente | Tudo certo, exceto itens excedentes ou fora do kit (glosa sugerida) |
| 🟠 Pendência | Falta documentação, informação insuficiente ou item que exige justificativa |
| 🔴 Encaminhar ao especialista | Algum critério obrigatório **não atendido** (o sistema nunca nega sozinho) |

## Usando

1. Abra o app e vá em **Configurações**. Cole sua chave da API Claude (crie em console.anthropic.com e **defina um limite de gasto**). Ela fica salva só no seu navegador.
2. Para ver o funcionamento sem custo e sem chave, clique em **Ver exemplo sintético**.
3. Envie o PDF, escolha o perfil de IA e clique em **Analisar pedido**.
4. Imprima ou salve o parecer em PDF e preencha a decisão do auditor.

Custos por perfil: veja [CUSTOS.md](CUSTOS.md) ou a aba **Estimativa de custos** do app.

## Protocolos: o conhecimento técnico

Cada doença ou procedimento é um arquivo YAML em [`docs/protocolos/`](docs/protocolos/), com:
- **fontes**: guidelines e normas;
- **documentacao**: checagens determinísticas;
- **criterios**: perguntas literais julgadas pela IA, cada uma com fonte e peso;
- **kit_padrao**: quantidades de referência de OPME por técnica.

**Fluxo de atualização:**
1. Edite o YAML em uma branch e abra um Pull Request.
2. O especialista revisa e aprova.
3. Suba a `versao` e preencha `revisado_por` e `data_revisao`.
4. Ao validar, mude `status: rascunho` para `vigente`.

Para incluir uma doença nova, crie o YAML e registre-o em `docs/protocolos/index.json`.

| Protocolo | Status |
|---|---|
| Aneurisma intracraniano não roto (endovascular) | **rascunho**: critérios e kit-padrão a validar |

## Desenvolvimento

O frontend é estático: HTML e módulos JS, sem build, publicado pelo GitHub Pages a partir de `docs/`.

```bash
npm install     # só para os testes (js-yaml)
npm test        # testa o motor de regras com o caso sintético
```

```
docs/
  index.html, css/, js/
    regras.js      motor determinístico (testado)
    custos.js      preços e estimativas
    ia.js          clientes Claude (SDK oficial) e Jev
    extracao.js    prompt + schema da extração
    julgamento.js  critérios (Claude / Jev + escalonamento)
    parecer.js     renderização do parecer
  protocolos/      YAML por doença
  exemplos/        casos sintéticos anonimizados
tests/             testes do motor (node --test)
```

## Roteiro

- [x] Fase 0: estrutura, protocolo-rascunho de aneurisma, motor de regras, parecer, custos
- [ ] Fase 1: validar o protocolo de aneurisma com especialistas; códigos TUSS reais; testar com pedidos anonimizados
- [ ] Fase 2: protocolos das procedências de maior volume e custo de OPME (coluna, artroplastia, cardiologia...)
- [ ] Fase 3: base TUSS 19/22 e Rol/DUT importada; checagem automática de códigos
- [ ] Fase 4: modo sombra contra decisões de auditores, medindo concordância (meta: zero aprovação indevida)
- [ ] Fase 5: backend institucional (chave fora do navegador, login, trilha de auditoria, Batch API)
