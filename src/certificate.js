import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createCertificateId(year) {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
  return `NH-LD-${year}-${code}`;
}

function fitSize(font, text, maxWidth, initial, minimum = 13) {
  let size = initial;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
}

export async function generateCertificatePdf({ recipientName, courseName, displayDate, certificateId, verificationUrl }) {
  const template = await fetch('/templates/certificate-template-v1.pdf').then((r) => {
    if (!r.ok) throw new Error('Certificate template is missing.');
    return r.arrayBuffer();
  });
  const pdf = await PDFDocument.load(template);
  const page = pdf.getPages()[0];
  const { width } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const centered = (text, y, font, size) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color: rgb(0, 0, 0) });
  };

  const nameSize = fitSize(italic, recipientName, width * 0.55, 27);
  const courseSize = fitSize(italic, courseName, width * 0.72, 23);
  centered(recipientName, 348, italic, nameSize);
  centered(courseName, 285, italic, courseSize);
  centered(`on ${displayDate}`, 225, italic, 21);

  page.drawText(`Certificate ID: ${certificateId}`, { x: 70, y: 38, size: 8, font: regular });
  page.drawText('Verify authenticity by scanning the QR code.', { x: 70, y: 25, size: 7, font: regular });

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, { margin: 1, width: 220 });
  const qr = await pdf.embedPng(qrDataUrl);
  page.drawImage(qr, { x: width - 116, y: 20, width: 72, height: 72 });

  return pdf.save();
}

export function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
