let downloadAtual;
let versaoPdf=0;
function limparDownload(){
  versaoPdf++;
  if(downloadAtual) URL.revokeObjectURL(downloadAtual);
  downloadAtual=null;
  porId('baixar').hidden=true;
  porId('erroPdf').textContent='';
}
let carregarBiblioteca;
function bibliotecaPdf(){
  if(!carregarBiblioteca) carregarBiblioteca=new Promise((ok,falha)=>{
    const script=document.createElement('script');
    script.src='./pdf-lib/pdf-lib.min.js';
    script.onload=()=>ok(window.PDFLib);
    script.onerror=()=>{carregarBiblioteca=null;falha(new Error('biblioteca'));};
    document.head.append(script);
  });
  return carregarBiblioteca;
}
async function margemInferior(arquivo){
  try{
    const {PDFiumLibrary}=await import('./pdfium/leitor.mjs');
    const resposta=await fetch('./pdfium/pdfium.wasm');
    if(!resposta.ok)return 0;
    const leitor=await PDFiumLibrary.init({wasmBinary:await resposta.arrayBuffer()});
    try{
      const doc=await leitor.loadDocument(new Uint8Array(arquivo));
      try{
        const page=doc.getPage(doc.getPageCount()-1);
        const img=await page.render({scale:1,render:async dados=>dados.data});
        const passo=img.width*4,cor=img.data.subarray(-4);
        let linhas=0;
        for(let y=img.height-1;y>=0;y--){
          if(!img.data.subarray(y*passo,(y+1)*passo).every((v,i)=>v===cor[i%4]))break;
          linhas++;
        }
        return linhas===img.height?0:Math.max(0,linhas*img.originalHeight/img.height-12);
      }finally{doc.destroy();}
    }finally{leitor.destroy();}
  }catch{return 0;}
}
async function montarOrcamento(lib,origem,logoBytes,plano){
  const {PDFDocument,StandardFonts,rgb,PDFName,PDFRawStream,decodePDFRawStream}=lib;
  const pdf=origem?await PDFDocument.load(origem):await PDFDocument.create();
  if(!pdf.getPageCount()) pdf.addPage([595,842]);
  const logo=await pdf.embedPng(logoBytes);
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const azul=rgb(8/255,109/255,246/255), tinta=rgb(.04,.14,.29), branco=rgb(1,1,1);
  const moeda=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100).replace(/\u00a0/g,' ');
  const paginas=pdf.getPages();
  function aplicarMarcaModelo(page){
    const conteudo=page.node.get(PDFName.of('Contents'));
    const stream=pdf.context.lookup(conteudo);
    if(!(stream instanceof PDFRawStream))return false;
    let texto;
    try{
      const bytes=decodePDFRawStream(stream).decode();
      // Byte-preserving conversion for the model's vector color operators.
      texto=Array.from(bytes,b=>String.fromCharCode(b)).join('');
    }catch{return false;}
    if(!texto.startsWith('1 0 0 -1 ')||!texto.includes('0.75 0 0 0.75 0 0 cm')||!texto.includes('0.05098 0.145098 0.25098 rg')||!texto.includes('14 14 765.700787'))return false;
    texto=texto.replace(/^0\.05098 0\.145098 0\.25098 rg$/gm,'0.031373 0.427451 0.964706 rg');
    const novo=pdf.context.flateStream(Uint8Array.from(texto,c=>c.charCodeAt(0)));
    page.node.set(PDFName.of('Contents'),pdf.context.register(novo));
    return true;
  }
  const modelo=paginas.map(aplicarMarcaModelo);
  let primeira=paginas[0],ultima=paginas[paginas.length-1];
  // Preserve rotated originals as-is; use a branded sheet for their payment block.
  if(primeira.getRotation().angle%360) primeira=pdf.insertPage(0,[595,122]);
  if(ultima.getRotation().angle%360) ultima=pdf.addPage([595,170]);
  function ampliar(page,acima,abaixo){
    const {x,y,width,height}=page.getCropBox();
    const tamanho=height+acima+abaixo;
    const my=y-abaixo;
    page.setMediaBox(x,my,width,tamanho);
    page.setCropBox(x,my,width,tamanho);
    return {x,y,width,height};
  }
  if(modelo[0] && primeira===paginas[0]){
    const caixa=primeira.getCropBox();
    primeira.drawImage(logo,{x:caixa.x+11,y:caixa.y+caixa.height-59,width:44,height:44});
  }else{
  const cab=ampliar(primeira,56,0);
  primeira.drawRectangle({x:cab.x,y:cab.y+cab.height,width:cab.width,height:56,color:branco});
  primeira.drawImage(logo,{x:cab.x+14,y:cab.y+cab.height+2,width:52,height:52});
  primeira.drawText('Orçamento de viagem',{x:cab.x+76,y:cab.y+cab.height+21,size:16,font:bold,color:tinta});
  primeira.drawRectangle({x:cab.x,y:cab.y+cab.height,width:cab.width,height:2,color:azul});
  }
  if(plano.espacoLivre>20 && ultima===paginas[paginas.length-1]){
    const caixa=ultima.getCropBox();
    ultima.setCropBox(caixa.x,caixa.y+plano.espacoLivre,caixa.width,caixa.height-plano.espacoLivre);
  }
  const rod=ampliar(ultima,0,134);
  const x=rod.x+18,y=rod.y-134,w=rod.width;
  ultima.drawRectangle({x:rod.x,y,width:w,height:134,color:branco});
  ultima.drawRectangle({x:rod.x,y:y+130,width:w,height:4,color:azul});
  const linha=''+plano.n+'x de '+moeda(Math.round(plano.total/plano.n));
  const tamanho=Math.min(32,(w-36)/bold.widthOfTextAtSize(linha,1));
  ultima.drawText('Total à vista: '+moeda(plano.vista),{x,y:y+106,size:12,font:regular,color:tinta});
  ultima.drawText(linha,{x,y:y+62,size:tamanho,font:bold,color:azul});
  ultima.drawText('Total parcelado: '+moeda(plano.total),{x,y:y+34,size:11,font:regular,color:tinta});
  if(plano.total%plano.n) ultima.drawText('Pode haver ajuste de centavos entre as parcelas.',{x,y:y+15,size:9,font:regular,color:tinta});
  pdf.setTitle('Orçamento VoaFácil Viagens');return pdf.save();
}
porId('gerar').onclick=async()=>{
  const btn=porId('gerar'),link=porId('baixar');
  limparDownload();
  const versao=versaoPdf;
  const plano={n:escolhida,vista:centavos(),total:totalPara(escolhida)};
  const origem=arquivoDoOrcamento;
  btn.disabled=true;btn.textContent='Gerando PDF…';
  try{
    const [lib,bytes,logo]=await Promise.all([bibliotecaPdf(),origem?.arrayBuffer(),fetch('marca-512.png').then(r=>{if(!r.ok)throw Error('logo');return r.arrayBuffer();})]);
    plano.espacoLivre=bytes?await margemInferior(bytes):0;
    const saida=await montarOrcamento(lib,bytes,logo,plano);
    if(versao!==versaoPdf)return;
    downloadAtual=URL.createObjectURL(new Blob([saida],{type:'application/pdf'}));
    link.href=downloadAtual;link.download=(origem?.name.replace(/\.pdf$/i,'')||'Orcamento')+'-VoaFacil-'+plano.n+'x.pdf';
    link.hidden=false;link.click();
  }catch{if(versao===versaoPdf)porId('erroPdf').textContent='Não foi possível gerar o PDF. Confira se o original tem proteção e tente novamente.';}
  finally{btn.disabled=false;btn.textContent='Gerar novo PDF';}
};
