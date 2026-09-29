"""A5 pallet label: a QR code linking to the scan page, export code underneath.

One page per PDF — the operator prints as many copies as the truck has pallets.
The QR encodes the frontend scan URL, so a phone's stock camera opens it
directly; the scan page itself requires login.
"""
from io import BytesIO

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

QR_SIZE = 120 * mm
EXPORT_CODE_FONT_SIZE = 40


def build_shipment_label_pdf(export_code: str, scan_url: str) -> bytes:
    """Render a single A5 portrait page: QR (scan_url) centred, export_code below."""
    page_w, page_h = A5
    buf = BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A5)
    pdf.setTitle(export_code)

    # Q-level error correction: the label lives on a pallet and gets scuffed.
    widget = QrCodeWidget(scan_url, barLevel='Q')
    x1, y1, x2, y2 = widget.getBounds()
    drawing = Drawing(
        QR_SIZE, QR_SIZE,
        transform=[QR_SIZE / (x2 - x1), 0, 0, QR_SIZE / (y2 - y1), 0, 0],
    )
    drawing.add(widget)
    qr_y = page_h - 25 * mm - QR_SIZE
    renderPDF.draw(drawing, pdf, (page_w - QR_SIZE) / 2, qr_y)

    # Shrink long codes (field allows 30 chars) to fit the page width.
    max_w = page_w - 20 * mm
    text_w = pdf.stringWidth(export_code, 'Helvetica-Bold', EXPORT_CODE_FONT_SIZE)
    font_size = min(EXPORT_CODE_FONT_SIZE, EXPORT_CODE_FONT_SIZE * max_w / text_w)
    pdf.setFont('Helvetica-Bold', font_size)
    pdf.drawCentredString(page_w / 2, qr_y - 20 * mm, export_code)

    pdf.showPage()
    pdf.save()
    return buf.getvalue()
