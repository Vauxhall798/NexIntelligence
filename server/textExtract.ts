import mammoth from "mammoth";
import JSZip from "jszip";
// pdf-parse ships as CJS with no default-export types; require() keeps it simple & reliable.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Extracts raw text from a supported unstructured document.
 * Supported: .txt, .pdf, .docx, .pptx
 */
export async function extractText(file: UploadedFile): Promise<string> {
  const name = file.originalname.toLowerCase();

  if (name.endsWith(".txt") || file.mimetype === "text/plain") {
    return file.buffer.toString("utf-8");
  }

  if (name.endsWith(".pdf") || file.mimetype === "application/pdf") {
    const data = await pdfParse(file.buffer);
    return data.text;
  }

  if (
    name.endsWith(".docx") ||
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (
    name.endsWith(".pptx") ||
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return extractPptxText(file.buffer);
  }

  throw new Error(
    `Unsupported file type: ${file.originalname}. Supported formats: .txt, .pdf, .docx, .pptx`
  );
}

/**
 * .pptx files are a zip archive of XML slide parts. We pull the text runs
 * (<a:t> tags) out of each slideN.xml in order.
 */
async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return numA - numB;
    });

  const slideTexts: string[] = [];

  for (const path of slideFiles) {
    const xml = await zip.files[path].async("text");
    const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1])
    );
    if (matches.length > 0) {
      const slideNum = path.match(/slide(\d+)\.xml/)![1];
      slideTexts.push(`[Slide ${slideNum}]\n${matches.join(" ")}`);
    }
  }

  return slideTexts.join("\n\n");
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Splits text into overlapping chunks, roughly `chunkSize` characters each,
 * with `overlap` characters shared between consecutive chunks so that
 * context isn't lost at chunk boundaries. Breaks on whitespace where possible.
 */
export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 100
): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length);

    // Try to break on a sentence/word boundary near the end of the window
    if (end < cleaned.length) {
      const window = cleaned.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
        window.lastIndexOf(" ")
      );
      if (lastBreak > chunkSize * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);

    if (end >= cleaned.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks;
}
