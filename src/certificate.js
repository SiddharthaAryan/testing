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

function wrapLines(font, text, size, maxWidth, maxLines = 2) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  return [lines[0], lines.slice(1).join(' ')];
}

export async function generateCertificatePdf({ recipientName, courseName, displayDate, certificateId, verificationUrl }) {
  const templateUrl = `${import.meta.env.BASE_URL}templates/certificate-template-v1.pdf`;
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error('Certificate template is missing.');

  const pdf = await PDFDocument.load(await response.arrayBuffer());
  const page = pdf.getPages()[0];
  const { width, height } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const white = rgb(1, 1, 1);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.28, 0.28, 0.28);
  const navy = rgb(0.03, 0.12, 0.27);

  // The source template contains sample content. Clear one deliberately inset,
  // flat-white content zone only; this preserves the border, logos, shadows and
  // gold/navy artwork while eliminating every underlying sample-text fragment.
  page.drawRectangle({
    x: width * 0.225,
    y: height * 0.205,
    width: width * 0.55,
    height: height * 0.425,
    color: white,
  });

  const centered = (text, y, font, size, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  // Rebuild the entire central copy as one controlled typographic system.
  centered('This is to certify that', height * 0.565, regular, 15.5);

  const nameSize = fitSize(bold, recipientName, width * 0.47, 24, 15);
  centered(recipientName, height * 0.495, bold, nameSize, navy);

  centered('has successfully completed the course', height * 0.435, regular, 15.5);

  let courseSize = fitSize(italic, courseName, width * 0.50, 19, 12.5);
  let courseLines = wrapLines(italic, courseName, courseSize, width * 0.50, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > width * 0.50) && courseSize > 11.5) {
    courseSize -= 0.5;
    courseLines = wrapLines(italic, courseName, courseSize, width * 0.50, 2);
  }
  const courseStartY = courseLines.length === 1 ? height * 0.355 : height * 0.377;
  courseLines.forEach((line, index) => {
    centered(line, courseStartY - index * (courseSize + 4), italic, courseSize);
  });

  centered(`on ${displayDate}`, height * 0.265, italic, 15.5);

  // Compact verification footer fully inside the white certificate area.
  const footerY = height * 0.172;
  const footerX = width * 0.255;
  page.drawText(`Certificate ID: ${certificateId}`, {
    x: footerX,
    y: footerY + 9,
    size: 7.2,
    font: bold,
    color: navy,
  });
  page.drawText('Scan the QR code to verify authenticity', {
    x: footerX,
    y: footerY,
    size: 6.3,
    font: regular,
    color: muted,
  });

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrDataUrl);
  const qrSize = height * 0.062;
  const qrX = width * 0.705;
  const qrY = height * 0.158;
  page.drawRectangle({
    x: qrX - 2.5,
    y: qrY - 2.5,
    width: qrSize + 5,
    height: qrSize + 5,
    color: white,
  });
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

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
