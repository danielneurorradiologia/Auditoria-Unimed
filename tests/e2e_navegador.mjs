// Teste ponta a ponta no navegador real (Edge headless via CDP), usando o site local
// e o servidor intermediário local (wrangler dev). Gasta alguns centavos de API.
//
// Pré-requisitos (em terminais separados):
//   python -m http.server 8000 --bind 127.0.0.1 --directory docs
//   cd proxy && npx wrangler dev --port 8787        (com proxy/.dev.vars preenchido)
// Uso: node tests/e2e_navegador.mjs <pasta-de-saida> [senha] [exemplo.pdf ...]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [saida = tmpdir(), senha = "demo-local-123", ...pedidos] = process.argv.slice(2);
const exemplos = pedidos.length
  ? pedidos
  : ["demo_pedido_completo_molas.pdf", "demo_pedido_incompleto_stent.pdf", "demo_pedido_completo_escaneado.pdf"];
const SITE = process.env.E2E_SITE ?? "http://localhost:8000/";
const SERVIDOR = process.env.E2E_SERVIDOR ?? "http://127.0.0.1:8787";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORTA = 9333;
mkdirSync(saida, { recursive: true });

const perfil = join(saida, "perfil-edge");
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, "--window-size=1200,900", "about:blank"], { stdio: "ignore" });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let alvo;
for (let i = 0; i < 40 && !alvo; i++) {
  try {
    alvo = await (await fetch(`http://127.0.0.1:${PORTA}/json/new?${SITE}`, { method: "PUT" })).json();
  } catch {
    await esperar(250);
  }
}
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pendentes = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendentes.has(m.id)) {
    pendentes.get(m.id)(m);
    pendentes.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") {
    console.log("  [exceção na página]", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    console.log(`  [console.${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  }
});
const cdp = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pendentes.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const avaliar = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await cdp("Runtime.enable");
await cdp("Page.enable");
await esperar(1500);
await avaliar(`localStorage.setItem("auditoria.servidor", JSON.stringify(${JSON.stringify(SERVIDOR)}));
  localStorage.setItem("auditoria.senha", JSON.stringify(${JSON.stringify(senha)}));
  localStorage.setItem("auditoria.aba", JSON.stringify("painel-analise")); true`);
await cdp("Page.reload");
await esperar(2500);

console.log("Teste de conexão:", await avaliar(`(async () => { document.querySelector("#testar").click(); for (let i = 0; i < 20 && /Testando/.test(document.querySelector("#status-conexao").textContent); i++) await new Promise(r => setTimeout(r, 500)); return document.querySelector("#status-conexao").textContent; })()`));

for (const nome of exemplos) {
  console.log(`\n══ ${nome}`);
  await avaliar(`document.querySelector('[data-exemplo="${nome}"]').click(); true`);
  const inicio = Date.now();
  let r;
  while (Date.now() - inicio < 240000) {
    await esperar(1000);
    r = await avaliar(`({ decisao: document.querySelector(".decisao-titulo")?.textContent ?? null,
      erro: document.querySelector("#erro").hidden ? null : document.querySelector("#erro").textContent,
      passos: [...document.querySelectorAll("#progresso li")].map(l => l.textContent),
      trilha: document.querySelector(".trilha")?.innerText ?? null,
      custo: document.querySelector(".custo-analise tr.total")?.innerText ?? null })`);
    if (r.decisao || r.erro) break;
  }
  console.log("  passos:", r.passos.join(" → "));
  console.log("  decisão:", r.decisao, "| erro:", r.erro);
  console.log("  trilha:", r.trilha?.replace(/\s+/g, " "));
  console.log("  custo:", r.custo?.replace(/\s+/g, " "));
  const metricas = await cdp("Page.getLayoutMetrics");
  const { width, height } = metricas.result.cssContentSize;
  const foto = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(height, 6000), scale: 1 } });
  const arquivo = join(saida, `e2e_${nome.replace(".pdf", "")}.png`);
  writeFileSync(arquivo, Buffer.from(foto.result.data, "base64"));
  console.log("  captura:", arquivo);
}

ws.close();
edge.kill();
process.exit(0);
