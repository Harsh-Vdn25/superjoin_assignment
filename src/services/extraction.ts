import { SchemaType } from "@google/generative-ai";
import { genAI, EXTRACTION_MODEL } from "./geminiClient";
import { ChunkExtractionResultSchema, type ChunkExtractionResult } from "../schema";
import type { PageChunk } from "./pdfExtractor";
import { isDailyQuotaError, QuotaExhaustedError } from "./geminiErrors";

const EXTRACTION_PROMPT = `You are extracting factual claims from a document page.
You are given the page's raw text AND an image of the rendered page. The text
may come from a multi-column layout, so its line order can jump between
columns and NOT match visual reading order — treat the image as the source
of truth for layout, chart contents, and table structure; use the text
mainly to get exact wording for quotes.

Extract meaningful factual claims: numbers, dates, names, roles, amounts,
relationships between entities, and anything stated in a chart, table, or
figure.

DO NOT extract:
- Bibliography, "References", or citation list entries (e.g. author names
  and publication years listed as sources) — these are not facts about the
  document's subject matter.
- Page headers/footers, page numbers, or section numbering on their own.

Multiple charts or tables can appear on one page (e.g. a chart labeled "1a"
and another labeled "1b" inside the same box, or a table alongside a chart).
Treat each one as a distinct evidence source: name it specifically in
"evidenceDescription" (e.g. "Chart 1a: Persistence in CPI Food and
Beverages" — not just "chart on this page") so two facts from different
charts on the same page are never confused with each other.

For a data table, extract the notable or headline rows/comparisons rather
than every single cell — e.g. one fact per row summarizing its key figures,
not one fact per individual number in the row. Prioritize rows relevant to
figures likely to be compared against other documents (totals, percentages,
named categories) over exhaustive coverage.

For each fact:
- "statement": a clear, self-contained sentence stating the fact.
- "evidenceType": "text" if it's stated in running text, "chart" if it comes
  from a chart/graph, "table" if from a table, "image" for any other visual.
- "quote": the EXACT verbatim text supporting the fact, ONLY if evidenceType
  is "text". Otherwise set this to null — do not invent a quote for a chart.
- "evidenceDescription": for non-text evidence, name and describe the
  specific chart/table (see above). Null for text facts.
- "attributes": any structured fields you can pull out (e.g. metric, value,
  unit, period, entity) as a flat key-value object. Use whatever fields make
  sense for this specific fact — do not force a fixed set of keys.

If a chart's numbers are hard to read precisely, still extract your best
reading, but note the uncertainty inside "statement" (e.g. "approximately").

Return ONLY facts actually grounded in this page. If there is nothing
extractable, return an empty facts array — do not fabricate facts. Aim for
at most 20 facts for this page — prioritize the most significant, specific,
and comparison-worthy claims over exhaustive coverage.`;

// Gemini's structured-output schema, mirroring schema.ts's Zod shape.
// Using responseSchema (not just prompting for JSON) meaningfully reduces
// malformed output, though we still validate with Zod afterward since no
// model is 100% reliable — that gap is exactly where our "failure" case lives.
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    facts: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          statement: { type: SchemaType.STRING },
          evidenceType: {
            type: SchemaType.STRING,
            enum: ["text", "chart", "table", "image"],
          },
          quote: { type: SchemaType.STRING, nullable: true },
          evidenceDescription: { type: SchemaType.STRING, nullable: true },
          attributes: {
            type: SchemaType.OBJECT,
            properties: {},
            // Gemini requires at least an empty object shape; extra keys
            // still come through since we don't set additionalProperties:false
          },
        },
        required: ["statement", "evidenceType", "quote", "evidenceDescription"],
      },
    },
  },
  required: ["facts"],
};

export interface ExtractionResult {
  ok: true;
  data: ChunkExtractionResult;
}
export interface ExtractionFailure {
  ok: false;
  reason: string;
  rawResponse?: string;
}

/**
 * Sends one chunk's text + page images to Gemini and validates the result.
 * Never throws for a malformed model response — callers treat a returned
 * `ok: false` as a per-chunk extraction failure and move on, rather than
 * crashing the whole document's processing.
 */
export async function extractFactsFromChunk(
  chunk: PageChunk
): Promise<ExtractionResult | ExtractionFailure> {
  const model = genAI.getGenerativeModel({
    model: EXTRACTION_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema as any,
      maxOutputTokens: 4096, // guards against mid-JSON truncation on dense pages
      temperature: 0.1, // low temperature: consistent extraction, not creative writing
    },
  });

  const imageParts = chunk.imageBuffers.map((buf) => ({
    inlineData: {
      mimeType: "image/png",
      data: buf.toString("base64"),
    },
  }));

  let rawText: string;
  try {
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: EXTRACTION_PROMPT },
            { text: `Page text (pages ${chunk.pageStart}-${chunk.pageEnd}):\n${chunk.text}` },
            ...imageParts,
          ],
        },
      ],
    });
    rawText = result.response.text();
  } catch (err) {
    if (isDailyQuotaError(err)) {
      throw new QuotaExhaustedError(
        `Gemini daily free-tier quota exhausted: ${String(err)}`
      );
    }
    return { ok: false, reason: `Gemini API call failed: ${String(err)}` };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, reason: "Gemini response was not valid JSON", rawResponse: rawText };
  }

  const validated = ChunkExtractionResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      ok: false,
      reason: `Schema validation failed: ${validated.error.message}`,
      rawResponse: rawText,
    };
  }

  return { ok: true, data: validated.data };
}