// Leitura da camada de texto do PDF com pdf.js (no navegador; nada sai da máquina).
// Recebe o módulo pdf.js por parâmetro para funcionar também nos testes em Node.

/** Reconstrói as linhas pela posição vertical dos trechos de texto. */
function linhasDaPagina(itens) {
  const trechos = itens
    .filter((it) => it.str !== undefined && it.str.trim() !== "")
    .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: Math.abs(it.transform[3]) || 8, s: it.str }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const linhas = [];
  for (const t of trechos) {
    const atual = linhas.at(-1);
    if (atual && Math.abs(atual.y - t.y) <= Math.max(2, t.h * 0.4)) atual.trechos.push(t);
    else linhas.push({ y: t.y, trechos: [t] });
  }

  return linhas.map(({ trechos: ts }) => {
    ts.sort((a, b) => a.x - b.x);
    let texto = "";
    let fim = null;
    for (const t of ts) {
      const lacuna = fim === null ? 0 : t.x - fim;
      if (fim !== null && lacuna > 1 && !texto.endsWith(" ") && !t.s.startsWith(" ")) texto += lacuna > t.h * 3 ? "  " : " ";
      texto += t.s;
      fim = t.x + t.w;
    }
    return texto.replace(/\s{3,}/g, "  ").trim();
  });
}

export async function extrairTextoPdf(pdfjs, bytes) {
  const tarefa = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const doc = await tarefa.promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const { items } = await pagina.getTextContent();
    paginas.push(linhasDaPagina(items).join("\n"));
  }
  await tarefa.destroy();
  return { paginas: doc.numPages, texto: paginas.join("\n\n"), caracteres: paginas.map((p) => p.length) };
}
