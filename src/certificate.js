import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function fitSize(font, text, maxWidth, initial, minimum = 11) {
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

export async function generateCertificatePdf({ recipientName, courseName, displayDate }) {
  const templateUrl = `${import.meta.env.BASE_URL}certificate-template-v1.pdf.pdf?v=9`;
  const response = await fetch(templateUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('Certificate template is missing.');

  const pdf = await PDFDocument.load(await response.arrayBuffer());
  const page = pdf.getPages()[0];
  const { width, height } = page.getSize();

  // The sample certificate uses a classic Times New Roman-style serif treatment.
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const black = rgb(0, 0, 0);

  const safeWidth = width * 0.69;
  const centered = (text, y, font, size) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y,
      size,
      font,
      color: black,
    });
  };

  centered('Certificate of Completion', height * 0.70, bold, 34);
  centered('This is to certify that', height * 0.555, regular, 17);

  const nameSize = fitSize(italic, recipientName, safeWidth * 0.62, 19, 13);
  centered(recipientName, height * 0.495, italic, nameSize);

  centered('has successfully completed the course', height * 0.435, regular, 17);

  let courseSize = fitSize(italic, courseName, safeWidth, 21, 12);
  let courseLines = wrapLines(italic, courseName, courseSize, safeWidth, 2);
  while (courseLines.some((line) => italic.widthOfTextAtSize(line, courseSize) > safeWidth) && courseSize > 11.5) {
    courseSize -= 0.5;
    courseLines = wrapLines(italic, courseName, courseSize, safeWidth, 2);
  }

  const courseStartY = courseLines.length === 1 ? height * 0.355 : height * 0.375;
  courseLines.forEach((line, index) => {
    centered(line, courseStartY - index * (courseSize + 5), italic, courseSize);
  });

  centered(`on ${displayDate} and this certificate will be`, height * 0.255, italic, 16);
  centered('valid for one year from completion.', height * 0.205, italic, 16);

  pdf.setTitle(`${recipientName} - ${courseName}`);
  pdf.setSubject('Certificate of Completion');
  pdf.setKeywords(['certificate', 'learning and development']);
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
