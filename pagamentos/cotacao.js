const arquivo = document.querySelector('#file');
const alternativas = document.querySelector('#alternativas');
const estado = document.querySelector('#estado');
let revisao = 0;

let url;

async function lerComPdfJs(bytes) {
  const pdfjs = await import('./pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  // Preload the local worker module so PDF.js can parse on browsers that restrict workers.
  await import('./pdfjs/pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({data: bytes, isEvalSupported: false}).promise;
  try {
    const paginas = [];
    for (let pagina = 1; pagina <= doc.numPages; pagina++) {
      const conteudo = await (await doc.getPage(pagina)).getTextContent();
      paginas.push(conteudo.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
    }
    return valoresDoOrcamento(paginas);
  } finally { await doc.destroy(); }
}

function valoresDoOrcamento(paginas) {
  const valores = new Set();
  const totais = new Set();
  for (const texto of paginas) {
    const preco = /R\$\s*([\d.]+,\d{2})(?!\d)/gi;
    for (const m of texto.matchAll(preco)) valores.add(m[1]);
    const rotulo = /\b(?:valor\s+total|total\s+(?:geral|à\s+vista|do\s+orçamento)|total)\s*[:–-]?\s*(?:R\$\s*)?([\d.]+,\d{2})(?!\d)/gi;
    for (const m of texto.matchAll(rotulo)) totais.add(m[1]);
    }
    return [...(totais.size ? totais : valores)].filter(v => paraCentavos(v) > 0);
}

async function identificarTotal(bytes) {
  try {
    const {PDFiumLibrary} = await import('./pdfium/leitor.mjs');
    const resposta = await fetch('./pdfium/pdfium.wasm');
    if (!resposta.ok) throw new Error('Falha ao carregar o leitor');
    const leitor = await PDFiumLibrary.init({wasmBinary: await resposta.arrayBuffer()});
    try {
      const doc = await leitor.loadDocument(new Uint8Array(bytes));
      try {
        return valoresDoOrcamento(Array.from(doc.pages(), pagina => pagina.getText()));
      } finally { doc.destroy(); }
    } finally { leitor.destroy(); }
  } catch {
    return lerComPdfJs(bytes);
  }
}

function paraCentavos(valor) {
  const n = Number(valor.replace(/[.,]/g, ''));
  return Number.isSafeInteger(n) && n <= 99999999999 ? n : 0;
}
function calcular(valor) {
  document.querySelector('#abaCalc').hidden=false;
  document.querySelector('#campos').hidden=false;
  estado.textContent='';
  alternativas.replaceChildren();
  abrirOrcamento(paraCentavos(valor));
}
arquivo.onchange = async () => {
  const file = arquivo.files[0];
  if (!file) return;
  arquivoDoOrcamento=file;

  const atual = ++revisao;
  try { sessionStorage.removeItem('valorOrcamento'); } catch {}
  const link = document.querySelector('#abrirPdf');
  const direto = document.querySelector('#abaCalc');
  lendoOrcamento=true;
  valor.value='';
  atualizar();
  direto.hidden = false;
  document.querySelector('#campos').hidden=true;
  location.hash='#calculadora';
  exibirTela();
  alternativas.replaceChildren();
  document.querySelector('#nome').textContent = file.name;
  estado.textContent = 'Lendo o total do PDF…';
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(file);
  link.href = url;
  link.hidden = false;

  const prazo = setTimeout(() => {
    if (revisao === atual) estado.textContent = 'Ainda lendo o documento. Você pode escolher outro PDF.';
  }, 12000);
  try {
    const bytes = await file.arrayBuffer();
    if (atual !== revisao) return;
    const opcoes = await identificarTotal(bytes);
    if (atual !== revisao) return;
    if (opcoes.length === 1) {
      calcular(opcoes[0]);
      return;
    }
    estado.textContent = opcoes.length ? 'O PDF contém valores diferentes. Toque no valor a parcelar.' : 'Não encontrei um valor em reais no texto deste PDF. Escolha o orçamento original com texto selecionável.';
    for (const valor of opcoes) {
      const botao = document.createElement('button');
      botao.className = 'btn';
      botao.textContent = 'R$ ' + valor;
      botao.onclick = () => calcular(valor);
      alternativas.append(botao);
    }
  } catch {
    if (atual === revisao) estado.textContent = 'Não foi possível ler este PDF. Escolha um orçamento com texto selecionável e sem senha.';
  } finally {
    clearTimeout(prazo);
    if (atual === revisao) {
      lendoOrcamento=false;
      arquivo.value='';
    }
  }
};
