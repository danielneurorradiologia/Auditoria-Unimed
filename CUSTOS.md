# Estimativa de custo de IA por análise

> Preços de outubro de 2026. Claude segundo a tabela oficial da Anthropic. Jev segundo a TypeSafe e revendedores, que variam de US$ 0,04 a 0,058 por milhão de tokens.
> Câmbio usado: **US$ 1 = R$ 5,50**, sem IOF do cartão internacional. Confira os valores antes de decidir.
> O app mede o **custo real** de cada análise (aba *Estimativa de custos*). Use esse número para recalibrar a tabela.

## Preços dos modelos (US$ por 1 milhão de tokens)

| Modelo | Entrada | Saída | Observação |
|---|---:|---:|---|
| Claude Opus 5.5 | 4,00 | 20,00 | Mais preciso; julgamento clínico |
| Claude Sonnet 5.5 | 2,00 | 10,00 | Bom equilíbrio; lê PDF escaneado |
| Claude Haiku 5.5 | 0,10 | 0,50 | Muito barato; qualidade da extração a validar |
| TypeSafe Jev | 0,04 | grátis | Só texto; devolve decisão tipada + probabilidade, não gera texto |

## Premissas por análise (pedido típico de 5 páginas escaneadas)

| Etapa | Entrada | Saída |
|---|---:|---:|
| Extração do PDF (≈ 2.500 tokens/página + 2.500 de instruções) | 15.000 | 4.500 |
| Julgamento dos critérios (protocolo + caso) | 8.000 | 7.000 |
| Jev: estado do caso + 7 perguntas | 5.000 | 0 |
| Escalonamento ao Claude (só critérios com confiança < 80%; ~30% dos casos) | 6.000 | 4.000 |
| Regras determinísticas, PHASES, kit-padrão, parecer | 0 | 0 |

## Custo por análise e por mês

| Perfil | Extração | Critérios | **Por análise** | 1.000/mês | 5.000/mês |
|---|---|---|---:|---:|---:|
| **Qualidade máxima** | Opus 5.5 | Opus 5.5 | **US$ 0,32** (R$ 1,77) | R$ 1.771 | R$ 8.855 |
| **Equilibrado** | Sonnet 5.5 | Sonnet 5.5 | **US$ 0,16** (R$ 0,89) | R$ 886 | R$ 4.428 |
| **Híbrido** | Sonnet 5.5 | Jev → dúvidas ao Opus 5.5 | **US$ 0,11** (R$ 0,59) | R$ 585 | R$ 2.926 |
| **Econômico** | Haiku 5.5 | Jev → dúvidas ao Sonnet 5.5 | **US$ 0,02** (R$ 0,11) | R$ 108 | R$ 538 |

**Sensibilidade ao tamanho do pedido.** Cada página a mais custa cerca de US$ 0,010 no Opus, US$ 0,005 no Sonnet e US$ 0,0003 no Haiku. Um pedido de 15 páginas no perfil *Qualidade máxima* sai por cerca de US$ 0,42.

**Incerteza.** O raciocínio interno do modelo (*thinking*) varia de caso para caso. Considere uma faixa de **0,5× a 2×** em torno destes valores até haver medições reais.

## Onde o Jev ajuda e onde não ajuda

**Ajuda:**
- Responde cada critério ("atende / não atende / insuficiente") com uma **probabilidade**. O motor usa essa probabilidade para decidir o que vai ao Claude.
- O custo dos critérios fica praticamente zero (US$ 0,0002 por caso).
- Todas as perguntas vão em uma única requisição.

**Não substitui o Claude:**
- **Não lê PDF nem imagem**, só texto. A extração do documento escaneado continua no Claude.
- **Não escreve texto.** A justificativa narrativa vem do Claude ou do próprio texto do protocolo.
- **É fraco em contas.** PHASES, razão domo/colo e quantidades são calculados em código e entregues prontos.
- **Lê as perguntas ao pé da letra.** Por isso os critérios no protocolo são escritos de forma literal.
- **É sensível a texto adversarial.** Por isso o Jev recebe o caso já estruturado, e não o texto bruto do solicitante.
- **É produto novo** (GA em 20/09/2026), com dados processados nos EUA. Não está confirmado se a API aceita chamadas diretas do navegador (CORS). Se não aceitar, o app cai automaticamente para o Claude e avisa.

## Como reduzir mais

1. **Batch API (−50%).** Para análises sem urgência, por exemplo um lote noturno. Exige um backend; não funciona com o fallback do lado do servidor.
2. **Cache do protocolo.** O protocolo vai no prompt de sistema com cache. Quando passar do tamanho mínimo de cache do modelo, a leitura sai por cerca de 10% do preço.
3. **Calibrar o limiar do Jev.** Hoje é 0,80. Subir o limiar aumenta a segurança e o custo; baixar faz o contrário. Só mude depois do modo sombra (validação contra decisões humanas).
4. **Haiku na extração** só depois de comparar a extração dele com a do Sonnet/Opus em pedidos reais anonimizados.
