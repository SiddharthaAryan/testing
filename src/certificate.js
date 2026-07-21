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
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  return [lines[0], lines.slice(1).join(' ')];
}

function formatMmDdYyyy(completionDate, fallback = '') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(completionDate || '')) {
    const [year, month, day] = completionDate.split('-');
    return `${month}/${day}/${year}`;
  }
  return fallback;
}

export async function generateCertificatePdf({ recipientName, courseName, completionDate, displayDate, certificateId, verificationUrl }) {
  const templateUrl = `${import.meta.env.BASE_URL}certificate-template-v1.pdf.pdf?v=8`;
  const response = await fetch(templateUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('Certificate template is missing.');

  const pdf = await PDFDocument.load(await response.arrayBuffer());
  const page = pdf.getPages()[0];
  const { width, height } = page.getSize();

  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const white = rgb(1, 1, 1);
  const ink = rgb(0.06, 0.06, 0.06);
  const muted = rgb(0.30, 0.30, 0.30);
  const navy = rgb(0.025, 0.105, 0.235);

  // The uploaded template is already blank. Do not place a large white panel over it,
  // because that would cover the navy-and-gold artwork. These values only define the
  // safe inner writing area.
  const contentX = width * 0.17;
  const contentY = height * 0.13;
  const contentW = width * 0.66;

  const centered = (text, y, font, size, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  centered('Certificate of Completion', height * 0.705, bold, 30, ink);
  centered('This is to certify that', height * 0.565, regular, 15.5);

  const nameSize = fitSize(bold, recipientName, contentW * 0.78, 25, 15);
  centered(recipientName, height * 0.495, bold, nameSize, navy);

  centered('has successfully completed the course', height * 0.425, regular, 15.5);

  let courseSize = fitSize(italic, courseName, contentW * 0.88, 20, 12);
  let courseLines = wrapLines(italic, courseName, courseSize, contentW * 0.88, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > contentW * 0.88) && courseSize > 11.5) {
    courseSize -= 0.5;
    courseLines = wrapLines(italic, courseName, courseSize, contentW * 0.88, 2);
  }

  const courseStartY = courseLines.length === 1 ? height * 0.345 : height * 0.37;
  courseLines.forEach((line, index) => centered(line, courseStartY - index * (courseSize + 5), italic, courseSize, ink));

  const finalDisplayDate = formatMmDdYyyy(completionDate, displayDate);
  centered(`Completed on ${finalDisplayDate}`, height * 0.25, italic, 14.5);

  const footerLeft = contentX + 10;
  const footerBottom = contentY + 6;
  page.drawText(`Certificate ID: ${certificateId}`, {
    x: footerLeft, y: footerBottom + 14, size: 8.4, font: bold, color: navy,
  });
  page.drawText('Verify by scanning the QR code or entering this ID on the portal.', {
    x: footerLeft, y: footerBottom + 2, size: 6.8, font: regular, color: muted,
  });

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    margin: 2, width: 480, errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrDataUrl);
  const qrSize = height * 0.09;
  const qrX = contentX + contentW - qrSize - 10;
  const qrY = contentY + 2;
  page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: white });
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  pdf.setTitle(`${recipientName} - ${courseName}`);
  pdf.setSubject(`Certificate ${certificateId}`);
  pdf.setKeywords(['certificate', certificateId, 'verification']);
  pdf.setProducer('Narayana Health Learning & Development');
  return pdf.save();
}

export function downloadPdf(bytes, filename, openedWindow = null) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  if (openedWindow && !openedWindow.closed) openedWindow.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');

  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
