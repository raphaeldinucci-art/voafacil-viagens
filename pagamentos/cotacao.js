const arquivo = document.querySelector('#file');
const alternativas = document.querySelector('#alternativas');
const estado = document.querySelector('#estado');
let revisao = 0;
let url;

async function identificarTotal(file) {
  const pdfjs = await import('./pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  const doc = await pdfjs.getDocument({data: await file.arrayBuffer(), isEvalSupported: false}).promise;
  try {
    const valores = new Set();
    const totais = new Set();
    for (let pagina = 1; pagina <= doc.numPages; pagina++) {
      const conteudo = await (await doc.getPage(pagina)).getTextContent();
      const texto = conteudo.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      const preco = /R\$\s*([\d.]+,\d{2})(?!\d)/gi;
      for (const m of texto.matchAll(preco)) valores.add(m[1]);
      const rotulo = /\b(?:valor\s+total|total\s+(?:geral|à\s+vista|do\s+orçamento)|total)\s*[:–-]?\s*R\$\s*([\d.]+,\d{2})(?!\d)/gi;
      for (const m of texto.matchAll(rotulo)) totais.add(m[1]);
    }
    return [...(totais.size ? totais : valores)].filter(v => paraCentavos(v) > 0);
  } finally { await doc.destroy(); }
}

function paraCentavos(valor) {
  const n = Number(valor.replace(/[.,]/g, ''));
  return Number.isSafeInteger(n) && n <= 99999999999 ? n : 0;
}
function calcular(valor) {
  location.assign('calculadora.html#centavos=' + paraCentavos(valor));
}
arquivo.onchange = async () => {
  const file = arquivo.files[0];
  if (!file) return;
  const atual = ++revisao;
  try { sessionStorage.removeItem('valorOrcamento'); } catch {}
  const link = document.querySelector('#abrirPdf');
  const direto = document.querySelector('#direto');
  direto.hidden = true;
  alternativas.replaceChildren();
  document.querySelector('#nome').textContent = file.name;
  estado.textContent = 'Lendo o total do PDF…';
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(file);
  link.href = url;
  link.hidden = false;
  arquivo.value = '';
  const prazo = setTimeout(() => {
    if (revisao === atual) estado.textContent = 'Ainda lendo o documento. Você pode escolher outro PDF.';
  }, 12000);
  try {
    const opcoes = await identificarTotal(file);
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
    if (atual === revisao) direto.hidden = false;
  }
};
