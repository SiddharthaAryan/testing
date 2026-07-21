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
  const templateUrl = `${import.meta.env.BASE_URL}templates/certificate-template-v1.pdf?v=4`;
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
  const muted = rgb(0.31, 0.31, 0.31);
  const navy = rgb(0.025, 0.105, 0.235);

  /*
   * The supplied template already contains sample wording. A single opaque white
   * panel now covers the COMPLETE original text zone, including its old title,
   * recipient, course and date. It remains inside the decorative frame and does
   * not touch either logo, the navy border or the gold corner artwork.
   */
  const panelX = width * 0.145;
  const panelY = height * 0.13;
  const panelW = width * 0.71;
  const panelH = height * 0.66;
  page.drawRectangle({ x: panelX, y: panelY, width: panelW, height: panelH, color: white });

  const centered = (text, y, font, size, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  centered('Certificate of Completion', height * 0.68, bold, 29, navy);
  centered('This is to certify that', height * 0.555, regular, 15);

  const nameSize = fitSize(bold, recipientName, panelW * 0.72, 25, 15);
  centered(recipientName, height * 0.49, bold, nameSize, navy);

  centered('has successfully completed the course', height * 0.425, regular, 15);

  let courseSize = fitSize(italic, courseName, panelW * 0.78, 19, 11.5);
  let courseLines = wrapLines(italic, courseName, courseSize, panelW * 0.78, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > panelW * 0.78) && courseSize > 11) {
    courseSize -= 0.5;
    courseLines = wrapLines(italic, courseName, courseSize, panelW * 0.78, 2);
  }

  const courseStartY = courseLines.length === 1 ? height * 0.345 : height * 0.37;
  courseLines.forEach((line, index) => {
    centered(line, courseStartY - index * (courseSize + 4), italic, courseSize);
  });

  centered(`Completed on ${displayDate}`, height * 0.255, italic, 14.5);

  const footerLeft = panelX + 14;
  const footerBottom = panelY + 13;

  page.drawText(`Certificate ID: ${certificateId}`, {
    x: footerLeft,
    y: footerBottom + 12,
    size: 7.2,
    font: bold,
    color: navy,
  });

  page.drawText('Scan the QR code or enter this ID on the verification portal.', {
    x: footerLeft,
    y: footerBottom + 2,
    size: 6.1,
    font: regular,
    color: muted,
  });

  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    margin: 2,
    width: 360,
    errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrDataUrl);
  const qrSize = height * 0.066;
  const qrX = panelX + panelW - qrSize - 14;
  const qrY = panelY + 10;

  page.drawRectangle({
    x: qrX - 3,
    y: qrY - 3,
    width: qrSize + 6,
    height: qrSize + 6,
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
