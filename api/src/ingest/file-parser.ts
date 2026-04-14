import mammoth from 'mammoth';

const SUPPORTED_TYPES = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['text/html', 'html'],
  ['text/plain', 'text'],
]);

export class UnsupportedFileTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported file type: ${mimeType}. Supported: PDF, DOCX, HTML, TXT`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export async function parseFile(buffer: Buffer, mimeType: string): Promise<string> {
  const fileType = SUPPORTED_TYPES.get(mimeType) || inferTypeFromMime(mimeType);

  switch (fileType) {
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'html':
      return parseHtml(buffer.toString('utf-8'));
    case 'text':
      return buffer.toString('utf-8');
    default:
      throw new UnsupportedFileTypeError(mimeType);
  }
}

function inferTypeFromMime(mime: string): string | null {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('wordprocessing') || mime.includes('docx')) return 'docx';
  if (mime.includes('html')) return 'html';
  if (mime.startsWith('text/')) return 'text';
  return null;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfParse = await import('pdf-parse').then((m) => m.default || m);
  const data = await pdfParse(buffer);
  return data.text.replace(/\n{3,}/g, '\n\n').trim();
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.replace(/\n{3,}/g, '\n\n').trim();
}

function parseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
