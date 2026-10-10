# Auditoria OPME: protótipo com IA

Pré-análise de **pedidos de procedimentos e OPME** para auditoria médica. O sistema confere o pedido contra um **protocolo técnico versionado** (guidelines das sociedades, Rol/DUT da ANS, TUSS) e **sugere** uma decisão:

- autorizar;
- autorizar parcialmente;
- pendência;
- encaminhar ao especialista.

> ⚠️ **Protótipo.** A decisão final é sempre do médico auditor (Res. CFM 1.614/2001). Use documentos fictícios ou anonimizados.
> Nenhum documento de paciente pode ser commitado (o `.gitignore` bloqueia PDFs, exceto os fictícios `docs/exemplos/demo_*.pdf`).

**App:** https://danielneurorradiologia.github.io/Auditoria-Unimed/

## Arquitetura: Jev decide, Claude revisa as dúvidas, regras conferem

```
 Navegador (GitHub Pages)                         Servidor intermediário (Cloudflare Worker)
 ─────────────────────────                        ─────────────────────────────────────────
 PDF ─► pdf.js lê o texto ─► anonimização ──────► /jev    ─► TypeSafe Jev   (chave guardada no servidor)
          │ (sem texto?)                    └───► /claude ─► Anthropic      (chave guardada no servidor)
          └─► Claude transcreve o escaneado
 regras: códigos, quantidades, medidas, PHASES, kit-padrão
 Jev: ~50 perguntas tipadas com probabilidade (paciente, técnicas, aneurismas, OPME, critérios)
 Claude: só quando o Jev tem dúvida que poderia levar a uma aprovação indevida
 parecer: decisão + trilha (quem decidiu o quê) + custo real
```

**Política de dúvida.** Uma resposta do Jev com confiança baixa só vai ao Claude se o campo for crítico **e** a resposta provável não for a conservadora. Dúvidas que só podem gerar pendência ou glosa são mantidas e aparecem no parecer.

Resultados reais com os PDFs fictícios estão em [CUSTOS.md](CUSTOS.md).
- Pedido completo com texto: **Autorizar** em ~1 s, US$ 0,0005, só com o Jev.
- Pedido escaneado: **Autorizar** em ~14 s, US$ 0,05, com o Claude apenas transcrevendo.

## Usando o site

1. Em **Configurações**, preencha a URL do servidor e a **senha de acesso**. Você também pode abrir o link com `?servidor=URL` para não precisar digitar a URL.
2. Clique em **Testar conexão**.
3. Em **Analisar pedido**, envie um PDF ou clique num pedido de demonstração:
   - completo;
   - incompleto;
   - escaneado.
4. A **Simulação sem IA** funciona sem servidor e sem custo.

## Servidor intermediário (Cloudflare Worker)

O Jev não aceita chamadas diretas de sites (CORS). Por isso o site fala com um Worker gratuito, que guarda as chaves e exige a senha. O código está em [`proxy/`](proxy/).

```bash
cd proxy
npx wrangler login                          # abre o navegador para entrar na Cloudflare
npx wrangler secret put SENHA_ACESSO        # senha que você dará a quem for ver a demonstração
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy                         # publica em https://auditoria-opme.<sua-conta>.workers.dev
```

- Só as origens listadas em `ORIGENS_PERMITIDAS` (wrangler.toml) podem usar o servidor.
- Só duas rotas são repassadas: `/jev` e `/claude/v1/messages`.
- Defina também um **limite de gasto** no console da Anthropic.

## Protocolos

Cada doença ou procedimento é um YAML em [`docs/protocolos/`](docs/protocolos/), com quatro partes:
- **fontes**;
- **documentacao**: checagens determinísticas;
- **criterios**: perguntas literais para o Jev, cada uma com peso e fonte;
- **kit_padrao**: quantidades de referência de OPME.

As mudanças entram por Pull Request revisado por um especialista. Cada parecer registra a `versao` do protocolo.

| Protocolo | Status |
|---|---|
| Aneurisma intracraniano não roto (endovascular) | **rascunho**: critérios e kit-padrão a validar |

## Desenvolvimento

```bash
npm install
npm test                          # motor de regras, leitura dos PDFs, anonimização (sem custo)
npm run test:integracao           # pipeline completo com APIs reais (lê .env; centavos)
node tests/diagnostico_jev.mjs    # só Jev: mostra as respostas com baixa confiança
node tests/e2e_navegador.mjs DIR  # navegador real (Edge) + site local + wrangler dev
python ferramentas/gerar_demo_escaneado.py ferramentas/demo/X.html docs/exemplos/demo_X.pdf
```

O `.env` (ignorado pelo git) contém `ANTHROPIC_API_KEY` e `TYPESAFE_API_KEY`. O `proxy/.dev.vars` traz as mesmas chaves e a `SENHA_ACESSO`, para o `wrangler dev`.

## Roteiro

- [x] Fase 0: estrutura, protocolo-rascunho, motor de regras, parecer
- [x] Fase 1: Jev como motor principal, Claude de reserva, anonimização, servidor intermediário, PDFs de demonstração
- [ ] Validar o protocolo de aneurisma com especialistas e preencher os códigos TUSS reais
- [ ] Testar com pedidos reais anonimizados; calibrar limiares de confiança do Jev
- [ ] Novos protocolos (coluna, artroplastia, cardiologia...) e base TUSS/Rol/DUT
- [ ] Modo sombra contra decisões de auditores (meta: zero aprovação indevida)
