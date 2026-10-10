# Custo de IA por análise: Jev primeiro, Claude de reserva

> Preços de outubro/2026. Câmbio: **US$ 1 = R$ 5,50**, sem IOF.
> Os valores vêm de **análises reais** dos PDFs de demonstração (out/2026). O app registra o custo de cada análise na aba *Custos*.

## Como o custo se forma

| Etapa | Quem faz | Custo medido |
|---|---|---|
| Leitura do PDF, anonimização, códigos, quantidades, medidas, PHASES, kit-padrão, parecer | Regras (navegador) | **zero** |
| Classificação (paciente, técnicas, aneurismas, categorias de OPME, coerência) e critérios clínicos | **Jev** (~40–60 perguntas) | **US$ 0,0005–0,0008** |
| PDF escaneado, sem texto: transcrição | Claude | ~US$ 0,025 por página (Opus 5.5) |
| Dúvida do Jev em campo crítico da extração | Claude | ~US$ 0,08–0,10 (Opus 5.5) |
| Critério clínico com confiança do Jev < 80% | Claude | ~US$ 0,03 (Opus 5.5) |

**Quando o Claude não é chamado.** Se a dúvida do Jev só pode tornar a decisão **mais rigorosa** (gerar uma pendência ou uma glosa, nunca uma aprovação indevida), a resposta do Jev é mantida. O auditor vê a dúvida no parecer.

## Resultados medidos

| Pedido de demonstração | Decisão | Claude | Custo | Tempo |
|---|---|---|---:|---:|
| Completo (texto) | Autorizar | não | US$ 0,0005 | 1 s |
| Incompleto (texto) | Pendência + glosas | não / às vezes 1 etapa | US$ 0,0008 – 0,12 | 1–40 s |
| Completo escaneado (2 páginas) | Autorizar | só transcrição | US$ 0,05 – 0,08 | 14–28 s |

## Estimativa mensal

Cenário: 5 páginas por pedido; 30% escaneados; 20% com dúvida na extração; 30% com dúvida nos critérios.

| Claude de reserva | Por análise | 1.000/mês | 5.000/mês |
|---|---:|---:|---:|
| **Só Jev** (PDF com texto, sem dúvidas) | **R$ 0,003** | **R$ 3** | **R$ 17** |
| Opus 5.5 | R$ 0,40 | R$ 399 | R$ 1.996 |
| Sonnet 5.5 | R$ 0,20 | R$ 201 | R$ 1.006 |
| Haiku 5.5 | R$ 0,013 | R$ 13 | R$ 66 |

A maior parte do custo vem dos **PDFs escaneados**. Se os prestadores enviarem o PDF digital em vez da foto do papel, o custo com Opus cai de R$ 0,40 para cerca de R$ 0,18 por análise.

Para comparação, o modelo anterior, com Claude em tudo, custava cerca de R$ 1,77 por análise usando Opus 5.5.

## Observações

- O Jev **não lê PDF nem imagem** e **não escreve texto**. Por isso a transcrição de escaneados e as justificativas narrativas ficam com o Claude.
- A confiança do Jev varia um pouco entre execuções. A política de dúvidas absorve essa variação, e o pior caso é chamar o Claude.
- O modelo Claude de reserva é escolhido em *Configurações*. O Sonnet 5.5 é cerca de 2× mais barato e mais rápido que o Opus 5.5. Valide a qualidade antes de trocar.
