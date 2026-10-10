"""Gera um PDF "escaneado" (só imagem, sem camada de texto) a partir de um HTML de demonstração.

Uso: python ferramentas/gerar_demo_escaneado.py ferramentas/demo/pedido_completo_molas.html docs/exemplos/demo_pedido_completo_escaneado.pdf
Requer o Microsoft Edge instalado. Sem dependências Python externas.
"""
import pathlib
import struct
import subprocess
import sys
import tempfile
import zlib

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
LARGURA, ALTURA, ESCALA = 794, 1123, 2  # A4 a 96 dpi, renderizado em 2x (~190 dpi)

CSS = """<style>
body { width: %dpx; margin: 0; }
.pagina { height: %dpx; padding: 53px; overflow: hidden; box-sizing: border-box; background: #fff; }
.quebra { page-break-before: auto; }
</style>""" % (LARGURA, ALTURA)


def montar_html(origem: pathlib.Path) -> str:
    html = origem.read_text(encoding="utf-8")
    corpo_ini = html.index("<body>") + len("<body>")
    corpo_fim = html.index("</body>")
    corpo = html[corpo_ini:corpo_fim]
    if '<div class="quebra' in corpo:
        p1, p2 = corpo.split('<div class="quebra', 1)
        paginas = [p1, '<div class="quebra' + p2]
    else:
        paginas = [corpo]
    novo = "".join(f'<div class="pagina">{p}</div>' for p in paginas)
    return html[:corpo_ini].replace("</head>", CSS + "</head>") + novo + html[corpo_fim:], len(paginas)


def ler_png_cinza(caminho: pathlib.Path):
    dados = caminho.read_bytes()
    pos, idat = 8, b""
    w = h = canais = None
    while pos < len(dados):
        n, tipo = struct.unpack(">I4s", dados[pos:pos + 8])
        corpo = dados[pos + 8:pos + 8 + n]
        if tipo == b"IHDR":
            w, h, prof, cor = struct.unpack(">IIBB", corpo[:10])
            assert prof == 8 and cor in (2, 6), f"PNG não suportado (cor {cor})"
            canais = 3 if cor == 2 else 4
        elif tipo == b"IDAT":
            idat += corpo
        pos += 12 + n
    bruto = zlib.decompress(idat)
    passo = w * canais
    linhas, anterior, i = [], bytearray(passo), 0
    for _ in range(h):
        filtro, linha = bruto[i], bytearray(bruto[i + 1:i + 1 + passo])
        i += 1 + passo
        for x in range(passo):
            a = linha[x - canais] if x >= canais else 0
            b = anterior[x]
            c = anterior[x - canais] if x >= canais else 0
            if filtro == 1: linha[x] = (linha[x] + a) & 255
            elif filtro == 2: linha[x] = (linha[x] + b) & 255
            elif filtro == 3: linha[x] = (linha[x] + (a + b) // 2) & 255
            elif filtro == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                linha[x] = (linha[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        linhas.append(bytes(linha[k] * 299 // 1000 + linha[k + 1] * 587 // 1000 + linha[k + 2] * 114 // 1000
                            for k in range(0, passo, canais)))
        anterior = linha
    return w, h, linhas


def escrever_pdf(destino: pathlib.Path, paginas):
    objs = []
    def add(conteudo: bytes) -> int:
        objs.append(conteudo)
        return len(objs)
    ids_paginas = []
    raiz_paginas = 2  # reservado
    objs.extend([b"", b""])
    for w, h, linhas in paginas:
        img = zlib.compress(b"".join(linhas), 9)
        id_img = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
                     b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (w, h, len(img)) + img + b"\nendstream")
        desenho = b"q 595 0 0 842 0 0 cm /Im0 Do Q"
        id_cont = add(b"<< /Length %d >>\nstream\n" % len(desenho) + desenho + b"\nendstream")
        ids_paginas.append(add(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                               b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (id_img, id_cont)))
    objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % i for i in ids_paginas), len(ids_paginas))
    saida, offsets = bytearray(b"%PDF-1.4\n"), []
    for n, corpo in enumerate(objs, 1):
        offsets.append(len(saida))
        saida += b"%d 0 obj\n" % n + corpo + b"\nendobj\n"
    xref = len(saida)
    saida += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    saida += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    saida += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    destino.write_bytes(saida)


def main(origem: str, destino: str):
    origem_p = pathlib.Path(origem).resolve()
    html, n = montar_html(origem_p)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_html = origem_p.with_name("_escaneado_tmp.html")
        tmp_html.write_text(html, encoding="utf-8")
        png = pathlib.Path(tmp) / "pagina.png"
        try:
            subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--screenshot={png}",
                            f"--window-size={LARGURA},{ALTURA * n}", f"--force-device-scale-factor={ESCALA}",
                            tmp_html.as_uri()], check=True, capture_output=True, timeout=120)
        finally:
            tmp_html.unlink(missing_ok=True)
        w, h, linhas = ler_png_cinza(png)
    altura = h // n
    paginas = [(w, altura, linhas[i * altura:(i + 1) * altura]) for i in range(n)]
    escrever_pdf(pathlib.Path(destino), paginas)
    print(f"{destino}: {n} página(s), {w}x{altura} px cada")


if __name__ == "__main__":
    main(*sys.argv[1:3])
