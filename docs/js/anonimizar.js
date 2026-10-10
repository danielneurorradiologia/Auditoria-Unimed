// Anonimização no navegador, ANTES de qualquer envio à IA (melhor esforço — o
// auditor vê o texto anonimizado na tela e pode conferir o que foi enviado).

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const TELEFONES = [
  /\(\d{2}\)\s*9?\d{4}[-\s]?\d{4}\b/g, // (91) 98888-0000
  /\b\d{2}\s+9\d{8}\b/g, // 91 988887777
  /\b9?\d{4}-\d{4}\b/g, // 98888-0000
];
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CARTEIRA = /\b\d{12,20}\b/g;
const CRM = /\bCRM\s*[-/:]?\s*(?:[A-Z]{2}\s*[-/:]?\s*)?\d{3,7}\b/gi;

// Palavras de formulário/medicina que interrompem uma sequência de nomes próprios.
const VOCABULARIO = new Set(
  `anexo solicitação órteses próteses materiais especiais opme operadora folha dados beneficiário beneficiária
  número carteira nome profissional solicitante telefone e-mail email cirurgia justificativa técnica registro
  ans guia senha data autorização referenciada atribuído pela documento
  assinatura especificação material observação laudo exame serviço imagem tabela código descrição
  paciente médico médica doutor doutora dr dra angiografia digital cerebral angiorressonância artéria
  aneurisma impressão achados diagnóstica`.split(/\s+/).filter(Boolean),
);
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e"]);
const MAIUSCULA = /^[A-ZÀ-Ý][a-zà-ÿ'’]+$/;

/** Sequências de 2+ palavras capitalizadas (permitindo "de/da/do") fora do vocabulário. */
function sequenciasDeNomes(linha) {
  const nomes = [];
  let atual = [];
  const fechar = () => {
    while (atual.length && CONECTIVOS.has(atual.at(-1))) atual.pop();
    if (atual.filter((p) => !CONECTIVOS.has(p)).length >= 2) nomes.push(atual.join(" "));
    atual = [];
  };
  for (const palavra of linha.split(/\s+/)) {
    const limpa = palavra.replace(/[.,;:()]+$/g, "");
    if (MAIUSCULA.test(limpa) && !VOCABULARIO.has(limpa.toLowerCase())) atual.push(limpa);
    else if (atual.length && CONECTIVOS.has(limpa)) atual.push(limpa);
    else fechar();
  }
  fechar();
  return nomes;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// \b do JavaScript não reconhece letras acentuadas ("Íris"): usa lookaround Unicode.
const palavraInteira = (s) => new RegExp(`(?<!\\p{L})${escapar(s)}(?!\\p{L})`, "gu");

/**
 * Anonimiza o texto do pedido.
 * Nomes: procurados no cabeçalho (antes do primeiro parágrafo clínico), em linhas
 * com e-mail/telefone e depois de rótulos "Nome"/"CRM"; depois removidos do texto todo.
 */
export function anonimizar(textoBruto, nomeArquivo = "") {
  const texto = textoBruto.replace(/\r/g, "");
  const linhas = texto.split("\n");
  const nomes = new Set();
  const fimCabecalho = linhas.findIndex((l) => l.split(/\s+/).length >= 12 || /justificativa/i.test(l));
  const limite = fimCabecalho === -1 ? Math.min(linhas.length, 15) : fimCabecalho;

  linhas.forEach((linha, i) => {
    const comContato = EMAIL.test(linha) || TELEFONES.some((r) => r.test(linha)) || CRM.test(linha);
    [EMAIL, CRM, ...TELEFONES].forEach((r) => (r.lastIndex = 0));
    if (i < limite || comContato) sequenciasDeNomes(linha).forEach((n) => nomes.add(n));
  });

  let saida = texto;
  const contagem = { nomes: 0, contatos: 0, documentos: 0 };
  const trocar = (regex, rotulo, chave) => {
    saida = saida.replace(regex, () => {
      contagem[chave]++;
      return rotulo;
    });
  };
  trocar(EMAIL, "[E-MAIL]", "contatos");
  TELEFONES.forEach((r) => trocar(r, "[TELEFONE]", "contatos"));
  trocar(CPF, "[CPF]", "documentos");
  trocar(CARTEIRA, "[NÚMERO]", "documentos");
  trocar(CRM, "[CRM]", "documentos");

  // Nomes mais longos primeiro, para não deixar sobrenomes soltos.
  const ordenados = [...nomes].sort((a, b) => b.length - a.length);
  for (const nome of ordenados) trocar(palavraInteira(nome), "[NOME]", "nomes");

  let arquivo = nomeArquivo.replace(/\.pdf$/i, "").replace(/[_]+/g, " ");
  for (const nome of ordenados) {
    for (const parte of nome.split(" ").filter((p) => !CONECTIVOS.has(p))) {
      arquivo = arquivo.replace(palavraInteira(parte), "");
    }
  }
  arquivo = arquivo.replace(/\b\d{2}[./-]\d{2}[./-]\d{4}\b/g, "").replace(/\s{2,}/g, " ").trim();

  return { texto: saida, nomeArquivo: arquivo, nomesRemovidos: ordenados.length, contagem };
}
