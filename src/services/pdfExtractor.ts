import fs from "fs/promises";
// @ts-ignore — pdfjs-dist ships as ESM; the legacy Node build works with a
// dynamic-style import under ts-node/CommonJS. If you hit import errors,
// switch your tsconfig "module" to "NodeNext" or use dynamic import().
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdf as rasterizePdf } from "pdf-to-img";

export interface PageContent {
  pageNumber: number; // 1-indexed
  text: string;
  imageBuffer: Buffer; // rendered PNG of the full page
}

export interface PageChunk {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string; // concatenated text of all pages in this chunk
  imageBuffers: Buffer[]; // one rasterized image per page in this chunk
}

/**
 * Extracts per-page text using pdfjs-dist, and rasterizes every page to PNG.
 * We rasterize ALL pages (not just ones that look chart-heavy) — simpler
 * and more robust than trying to detect visual content up front.
 */
export async function extractPages(filePath: string): Promise<PageContent[]> {
  const fileBuffer = await fs.readFile(filePath);

  // --- text extraction, per page ---
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer) });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const pageTexts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(" ");
    pageTexts.push(text);
  }

  // --- rasterization, per page ---
  const imageBuffers: Buffer[] = [];
  const rasterDoc = await rasterizePdf(filePath, { scale: 2 });
  for await (const image of rasterDoc) {
    imageBuffers.push(image as Buffer);
  }

  if (imageBuffers.length !== numPages) {
    // Rasterizer and text extractor disagreeing on page count is a real
    // failure mode worth surfacing rather than silently misaligning pages.
    console.warn(
      `Page count mismatch: pdfjs saw ${numPages} pages, rasterizer produced ${imageBuffers.length}`
    );
  }
  //@ts-ignore
  return pageTexts.map((text, idx) => ({
    pageNumber: idx + 1,
    text,
    imageBuffer: imageBuffers[idx],
  }));
}

/**
 * Groups pages into chunks of `pagesPerChunk` pages each (page-aligned,
 * not word-count based, so each chunk's text and images stay in sync).
 */
export function groupIntoChunks(pages: PageContent[], pagesPerChunk = 2): PageChunk[] {
  const chunks: PageChunk[] = [];
  for (let i = 0; i < pages.length; i += pagesPerChunk) {
    const slice = pages.slice(i, i + pagesPerChunk);
    chunks.push({
      chunkIndex: chunks.length,
      pageStart: slice[0]!.pageNumber,
      pageEnd: slice[slice.length - 1]!.pageNumber,
      text: slice.map((p) => p.text).join("\n\n"),
      imageBuffers: slice.map((p) => p.imageBuffer).filter(Boolean),
    });
  }
  return chunks;
}