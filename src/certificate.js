import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createCertificateId(year) {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
  return `NH-LD-${year}-${code}`;
}

function fitSize(font, text, maxWidth, initial, minimum = 12) {
  let size = initial;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function splitToLines(font, text, size, maxWidth, maxLines = 2) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  return [lines.slice(0, maxLines - 1).join(' '), lines.slice(maxLines - 1).join(' ')];
}

export async function generateCertificatePdf({ recipientName, courseName, displayDate, certificateId, verificationUrl }) {
  const response = await fetch('/templates/certificate-template-v1.pdf');
  if (!response.ok) throw new Error('Certificate template is missing.');

  const pdf = await PDFDocument.load(await response.arrayBuffer());
  const page = pdf.getPages()[0];
  const { width, height } = page.getSize();
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  // The supplied template contains example text. This clean white panel removes
  // only that text while retaining the original border, logos and artwork.
  page.drawRectangle({
    x: width * 0.18,
    y: height * 0.16,
    width: width * 0.68,
    height: height * 0.67,
    color: rgb(1, 1, 1),
  });

  const centered = (text, y, font, size, color = rgb(0, 0, 0)) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  centered('Certificate of Completion', height * 0.72, bold, fitSize(bold, 'Certificate of Completion', width * 0.58, 34, 25));
  centered('This is to certify that', height * 0.56, regular, 18);

  const nameSize = fitSize(italic, recipientName, width * 0.55, 25, 16);
  centered(recipientName, height * 0.505, italic, nameSize);
  centered('has successfully completed the course', height * 0.445, regular, 17);

  let courseSize = fitSize(italic, courseName, width * 0.69, 21, 13);
  let courseLines = splitToLines(italic, courseName, courseSize, width * 0.69, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > width * 0.69) && courseSize > 12) {
    courseSize -= 0.5;
    courseLines = splitToLines(italic, courseName, courseSize, width * 0.69, 2);
  }
  const courseStartY = courseLines.length === 1 ? height * 0.365 : height * 0.385;
  courseLines.forEach((line, index) => centered(line, courseStartY - index * (courseSize + 4), italic, courseSize));

  centered(`on ${displayDate}`, height * 0.255, italic, 18);

  const footerY = Math.max(18, height * 0.045);
  page.drawText(`Certificate ID: ${certificateId}`, { x: width * 0.08, y: footerY + 10, size: 7.5, font: regular, color: rgb(0.12, 0.12, 0.12) });
  page.drawText('Verify authenticity using the QR code or certificate ID.', { x: width * 0.08, y: footerY, size: 6.5, font: regular, color: rgb(0.25, 0.25, 0.25) });

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
  const qr = await pdf.embedPng(qrDataUrl);
  const qrSize = Math.min(56, height * 0.1);
  page.drawRectangle({ x: width - qrSize - width * 0.055 - 3, y: footerY - 3, width: qrSize + 6, height: qrSize + 6, color: rgb(1, 1, 1) });
  page.drawImage(qr, { x: width - qrSize - width * 0.055, y: footerY, width: qrSize, height: qrSize });

  pdf.setTitle(`${recipientName} - ${courseName}`);
  pdf.setSubject(`Certificate ${certificateId}`);
  pdf.setKeywords(['certificate', certificateId, 'verification']);
  pdf.setProducer('Certificate Verification Portal');

  return pdf.save();
}

export function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
