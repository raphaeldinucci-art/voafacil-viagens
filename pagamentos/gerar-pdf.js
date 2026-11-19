let downloadAtual;
let pdfGerado;
function nomeDoPdf(){
  const nome=porId('identificacao').value.trim().replace(/\.pdf$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').trim();
  return (nome || 'Orçamento VoaFácil')+'.pdf';
}
porId('identificacao').oninput=()=>{porId('baixar').download=nomeDoPdf();};
porId('compartilhar').onclick=async()=>{
  if(!pdfGerado)return;
  const arquivo=new File([pdfGerado],nomeDoPdf(),{type:'application/pdf'});
  try{
    await navigator.share({files:[arquivo]});
  }catch(erro){
    if(erro.name!=='AbortError') porId('erroPdf').textContent='Baixe o PDF e envie o arquivo pelo WhatsApp.';
  }
};
let versaoPdf=0;
function limparDownload(){
  versaoPdf++;
  if(downloadAtual) URL.revokeObjectURL(downloadAtual);
  downloadAtual=null;
  pdfGerado=null;
  porId('compartilhar').hidden=true;
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
  const modeloConhecido=modelo[0] && primeira===paginas[0];
  const cab=modeloConhecido?primeira.getCropBox():ampliar(primeira,72,0);
  const topo=cab.y+cab.height+(modeloConhecido?0:72);
  const escala=Math.min(1,cab.width/335);
  const xMarca=cab.x+11*escala;
  const xTexto=cab.x+66*escala;
  primeira.drawRectangle({x:cab.x,y:topo-71*escala,width:modeloConhecido?Math.min(cab.width,315*escala):cab.width,height:71*escala,color:azul});
  primeira.drawImage(logo,{x:xMarca,y:topo-60*escala,width:45*escala,height:45*escala});
  const dadosMarca=[
    ['VoaFácil Viagens',bold,13,21],
    ['Voa Fácil. Sua passagem sem complicação.',regular,9,34],
    ['CNPJ 42.640.302/0001-74',regular,9,47],
    ['+55 (21) 99797-5010',regular,9,60]
  ];
  for(const [texto,font,tamanho,distancia] of dadosMarca){
    primeira.drawText(texto,{x:xTexto,y:topo-distancia*escala,size:tamanho*escala,font,color:branco});
  }
  if(plano.espacoLivre>20 && ultima===paginas[paginas.length-1]){
    const caixa=ultima.getCropBox();
    ultima.setCropBox(caixa.x,caixa.y+plano.espacoLivre,caixa.width,caixa.height-plano.espacoLivre);
  }
  const rod=ampliar(ultima,0,156);
  const x=rod.x+28,y=rod.y-156,w=rod.width;
  ultima.drawRectangle({x:rod.x,y,width:w,height:156,color:azul});
  const largura=w-20;
  const contorno=[
    'M 8 0', 'H '+(largura-8), 'Q '+largura+' 0 '+largura+' 8',
    'V 128', 'Q '+largura+' 136 '+(largura-8)+' 136',
    'H 8', 'Q 0 136 0 128', 'V 8', 'Q 0 0 8 0', 'Z'
  ].join(' ');
  ultima.drawSvgPath(contorno,{x:rod.x+10,y:y+146,color:branco});
  for(const lado of [rod.x+10,rod.x+w-10]){
    ultima.drawCircle({x:lado,y:y+78,size:6,color:azul});
  }
  const respostaMarca=await fetch('./bandeiras/'+encodeURIComponent(plano.bandeira.toLowerCase())+'.png');
  if(!respostaMarca.ok) throw Error('Logotipo da bandeira indisponível');
  const marcaCartao=await pdf.embedPng(await respostaMarca.arrayBuffer());
  const dimensoes=marcaCartao.scaleToFit(30,17);
  ultima.drawImage(marcaCartao,{x,y:y+131-dimensoes.height/2,...dimensoes});
  ultima.drawText('Cartão: '+plano.bandeira,{x:x+dimensoes.width+6,y:y+127,size:12,font:bold,color:tinta});
  if(plano.parcelas){
    const inicio=!origem?y+87:y+101;
    if(!origem) ultima.drawText('Total à vista: '+moeda(plano.vista),{x,y:y+106,size:12,font:regular,color:tinta});
    const valores=plano.parcelas.map(moeda);
    const medir=texto=>bold.widthOfTextAtSize(texto,1);
    const larguraRotulo=medir('12x ');
    const larguraValor=Math.max(...valores.map(medir));
    const size=Math.min(14,(w/2-36)/(larguraRotulo+larguraValor));
    valores.forEach((texto,i)=>{
      const coluna=Math.floor(i/6), linha=i%6;
      const esquerda=x+coluna*(w/2-16);
      const altura=inicio-linha*(!origem?13:16);
      const estilo={y:altura,size,font:bold,color:azul};
      ultima.drawText((i+1)+'x',{...estilo,x:esquerda});
      ultima.drawText(texto,{...estilo,x:esquerda+(larguraRotulo+larguraValor-medir(texto))*size});
    });
  }else{
  const linha=''+plano.n+'x de '+moeda(Math.round(plano.total/plano.n));
  const tamanho=Math.min(32,(w-56)/bold.widthOfTextAtSize(linha,1));
  ultima.drawText('Total à vista: '+moeda(plano.vista),{x,y:y+106,size:12,font:regular,color:tinta});
  ultima.drawText(linha,{x,y:y+62,size:tamanho,font:bold,color:azul});
  ultima.drawText('Total parcelado: '+moeda(plano.total),{x,y:y+34,size:11,font:regular,color:tinta});
  }
  pdf.setTitle('Orçamento VoaFácil Viagens');return pdf.save();
}
porId('gerar').onclick=async()=>{
  const btn=porId('gerar'),link=porId('baixar');
  limparDownload();
  const versao=versaoPdf;
  const plano={n:escolhida,vista:centavos(),bandeira:bandeira.selectedOptions[0].textContent};
  if(escolhida==='todos') plano.parcelas=Array.from({length:12},(_,i)=>Math.round(totalPara(i+1)/(i+1)));
  else plano.total=totalPara(escolhida);
  const origem=arquivoDoOrcamento;
  btn.disabled=true;btn.textContent='Gerando PDF…';
  try{
    const [lib,bytes,logo]=await Promise.all([bibliotecaPdf(),origem?.arrayBuffer(),fetch('marca-512.png').then(r=>{if(!r.ok)throw Error('logo');return r.arrayBuffer();})]);
    plano.espacoLivre=bytes?await margemInferior(bytes):0;
    const saida=await montarOrcamento(lib,bytes,logo,plano);
    if(versao!==versaoPdf)return;
    pdfGerado=new File([saida],nomeDoPdf(),{type:'application/pdf'});
    downloadAtual=URL.createObjectURL(pdfGerado);
    link.href=downloadAtual;
    link.download=nomeDoPdf();
    link.hidden=false;
    const podeCompartilhar=!!navigator.share && !!navigator.canShare?.({files:[pdfGerado]});
    porId('compartilhar').hidden=!podeCompartilhar;
    porId('erroPdf').textContent=podeCompartilhar?'PDF pronto para compartilhar.':'PDF pronto. Baixe o arquivo para enviá-lo pelo WhatsApp.';
  }catch{if(versao===versaoPdf)porId('erroPdf').textContent='Não foi possível gerar o PDF. Confira se o original tem proteção e tente novamente.';}
  finally{btn.disabled=false;btn.textContent='Gerar novo PDF';}
};
