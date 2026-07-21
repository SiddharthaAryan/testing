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
  const templateUrl = `${import.meta.env.BASE_URL}templates/certificate-template-v1.pdf`;
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error('Certificate template is missing.');

  const pdf = await PDFDocument.load(await response.arrayBuffer());
  const page = pdf.getPages()[0];
  const { width, height } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const white = rgb(1, 1, 1);
  const ink = rgb(0.08, 0.08, 0.08);

  // Remove only the old variable text. Keeping the rest of the original artwork
  // untouched avoids the visible white "page pasted over the certificate" effect.
  const cleanStrip = (x, y, w, h) => page.drawRectangle({ x, y, width: w, height: h, color: white });
  cleanStrip(width * 0.25, height * 0.465, width * 0.50, height * 0.075); // old recipient
  cleanStrip(width * 0.19, height * 0.315, width * 0.62, height * 0.105); // old course
  cleanStrip(width * 0.35, height * 0.225, width * 0.30, height * 0.060); // old date

  const centered = (text, y, font, size, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  const nameSize = fitSize(italic, recipientName, width * 0.50, 25, 16);
  centered(recipientName, height * 0.493, italic, nameSize);

  let courseSize = fitSize(italic, courseName, width * 0.62, 20, 12.5);
  let courseLines = splitToLines(italic, courseName, courseSize, width * 0.62, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > width * 0.62) && courseSize > 12) {
    courseSize -= 0.5;
    courseLines = splitToLines(italic, courseName, courseSize, width * 0.62, 2);
  }
  const courseStartY = courseLines.length === 1 ? height * 0.357 : height * 0.377;
  courseLines.forEach((line, index) => centered(line, courseStartY - index * (courseSize + 4), italic, courseSize));

  centered(`on ${displayDate}`, height * 0.245, italic, 17);

  // Keep verification details inside the certificate's lower white area.
  const footerY = height * 0.125;
  const footerX = width * 0.15;
  page.drawText(`Certificate ID: ${certificateId}`, {
    x: footerX,
    y: footerY + 10,
    size: 7.2,
    font: regular,
    color: rgb(0.12, 0.12, 0.12),
  });
  page.drawText('Verify authenticity using the QR code or certificate ID.', {
    x: footerX,
    y: footerY,
    size: 6.2,
    font: regular,
    color: rgb(0.28, 0.28, 0.28),
  });

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    margin: 1,
    width: 300,
    errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrDataUrl);
  const qrSize = height * 0.082;
  const qrX = width * 0.80;
  const qrY = height * 0.105;
  page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: white });
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
