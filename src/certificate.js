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
  const muted = rgb(0.32, 0.32, 0.32);
  const navy = rgb(0.03, 0.12, 0.27);

  // Cover the entire original written-content region with one clean, flat-white panel.
  // It stays inside the decorative frame, so logos, borders and gold/navy artwork remain untouched.
  const panelX = width * 0.165;
  const panelY = height * 0.145;
  const panelW = width * 0.67;
  const panelH = height * 0.59;
  page.drawRectangle({ x: panelX, y: panelY, width: panelW, height: panelH, color: white });

  const centered = (text, y, font, size, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  centered('Certificate of Completion', height * 0.655, bold, 30, navy);
  centered('This is to certify that', height * 0.535, regular, 15.5);

  const nameSize = fitSize(bold, recipientName, panelW * 0.76, 25, 15);
  centered(recipientName, height * 0.465, bold, nameSize, navy);

  centered('has successfully completed the course', height * 0.405, regular, 15.5);

  let courseSize = fitSize(italic, courseName, panelW * 0.78, 20, 12);
  let courseLines = wrapLines(italic, courseName, courseSize, panelW * 0.78, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > panelW * 0.78) && courseSize > 11.5) {
    courseSize -= 0.5;
    courseLines = wrapLines(italic, courseName, courseSize, panelW * 0.78, 2);
  }
  const courseStartY = courseLines.length === 1 ? height * 0.325 : height * 0.345;
  courseLines.forEach((line, index) => centered(line, courseStartY - index * (courseSize + 4), italic, courseSize));

  centered(`Completed on ${displayDate}`, height * 0.245, italic, 15);

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    margin: 2,
    width: 320,
    errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrDataUrl);
  const qrSize = height * 0.062;
  const qrX = panelX + panelW - qrSize - 10;
  const qrY = panelY + 11;

  page.drawText(`Certificate ID: ${certificateId}`, {
    x: panelX + 16,
    y: panelY + 30,
    size: 7.3,
    font: bold,
    color: navy,
  });
  page.drawText('Verify at the portal or scan the QR code', {
    x: panelX + 16,
    y: panelY + 19,
    size: 6.4,
    font: regular,
    color: muted,
  });
  page.drawRectangle({ x: qrX - 2, y: qrY - 2, width: qrSize + 4, height: qrSize + 4, color: white });
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
