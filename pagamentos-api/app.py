"""Leitor de orçamentos VoaFácil. Não publica PDFs nem dados de clientes."""
import io
import re
from decimal import Decimal
from flask import Flask, jsonify, request
from pypdf import PdfReader

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

def extract_quote(data: bytes) -> dict:
    reader = PdfReader(io.BytesIO(data), strict=False)
    if len(reader.pages) > 10:
        raise ValueError("PDF com mais de 10 páginas")
    text = "\n".join(page.extract_text(extraction_mode="layout") or "" for page in reader.pages)
    if not text.strip():
        raise ValueError("PDF sem texto pesquisável; leitura de imagem ainda não disponível")
    name = re.search(r"CLIENTE\s*\n\s*([^\n]+)", text, re.I)
    prices = re.findall(r"R\$\s*([\d.]+,\d{2})", text)
    total = None
    if prices:
        # Orçamentos podem repetir o mesmo valor no subtotal, PIX e dinheiro.
        amounts = [Decimal(v.replace(".", "").replace(",", ".")) for v in prices]
        if len(set(amounts)) == 1:
            total = str(amounts[0])
    codes = re.findall(r"\b(?:GIG|GRU|CNF|GVR|VCP|OPS|SDU|REC|BSB|CGH|SSA|FOR|BEL|MAO|POA|CWB)\b", text)
    flights = re.findall(r"\b(?:G3|AD|LA)\s*\d{3,4}\b", text)
    dates = re.findall(r"\b\d{1,2}\s+(?:DE\s+)?(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z.]*\s*(?:DE\s+)?20\d{2}", text, re.I)
    times = re.findall(r"\b(?:[01]?\d|2[0-3]):[0-5]\d\b", text)
    return {"cliente": name.group(1).strip() if name else None,
            "valor_avista": total, "moeda": "BRL",
            "aeroportos": codes, "voos": flights, "datas": dates, "horarios": times,
            "precisa_revisao": not bool(name and total and codes and times),
            "avisos": (["Valor não identificado com segurança"] if not total else []) +
                      (["Cliente não identificado"] if not name else [])}

@app.post("/api/ler-pdf")
def read_pdf():
    # Endpoint de desenvolvimento: deve permanecer privado até autenticação e controle de acesso.
    f = request.files.get("pdf")
    if not f or not f.filename.lower().endswith(".pdf"):
        return jsonify({"erro": "Envie um arquivo PDF"}), 400
    data = f.read()
    if not data.startswith(b"%PDF-"):
        return jsonify({"erro": "Arquivo inválido"}), 400
    try:
        return jsonify(extract_quote(data))
    except (ValueError, Exception) as exc:
        return jsonify({"erro": "Não foi possível ler este PDF", "detalhe": str(exc)[:160]}), 422
