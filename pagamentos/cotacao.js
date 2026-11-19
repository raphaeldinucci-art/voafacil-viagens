const arquivo = document.querySelector('#file');
const total = document.querySelector('#total');
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
    if (totais.size === 1) return [...totais][0];
    if (valores.size === 1) return [...valores][0];
    return '';
  } finally { await doc.destroy(); }
}

arquivo.onchange = async () => {
  const atual = ++revisao;
  const file = arquivo.files[0];
  if (url) URL.revokeObjectURL(url);
  total.value = '';
  total.disabled = false;
  document.querySelector('#conferencia').hidden = !file;
  if (!file) return;
  const link = document.querySelector('#abrirPdf');
  estado.textContent = 'Arquivo selecionado: ' + file.name + '. Lendo o valor…';
  estado.scrollIntoView({block: 'nearest'});
  try {
    url = URL.createObjectURL(file);
    link.href = url;
    link.hidden = false;
  } catch { link.hidden = true; }
  const prazo = setTimeout(() => {
    if (atual !== revisao) return;
    ++revisao;
    estado.textContent = 'A leitura demorou. Informe o valor à vista para continuar.';
  }, 12000);
  let valor = '';
  try { valor = await identificarTotal(file); } catch {}
  clearTimeout(prazo);
  if (atual !== revisao) return;
  if (valor && !total.value && document.activeElement !== total) {
    total.value = valor;
    if (irParaCalculadora()) return;
  }
  estado.textContent = 'Informe o valor à vista que aparece no PDF e toque em Calcular parcelamento.';
};
total.oninput = () => total.setCustomValidity('');
document.querySelector('#simular').onsubmit = event => {
  event.preventDefault();
  if (!irParaCalculadora()) erro();
};
function irParaCalculadora() {
  const valor = total.value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(valor)) return false;
  const centavos = Math.round(Number(valor.replaceAll('.', '').replace(',', '.')) * 100);
  if (!(centavos > 0 && centavos <= 99999999999)) return false;
  location.assign('calculadora.html#centavos=' + centavos);
  return true;
}
function erro() {
  total.setCustomValidity('Informe um valor em reais, por exemplo 1.250,50.');
  total.reportValidity();
}
