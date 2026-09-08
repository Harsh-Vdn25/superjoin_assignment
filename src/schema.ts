// Shared types + Zod schemas for the Fact Knowledge Layer.
// Import this from extraction, DB repos, and API routes so every layer
// agrees on the same shape.

import { z } from "zod";

// ─────────────────────────────────────────────
// documents
// ─────────────────────────────────────────────
export const DocumentStatus = z.enum(["processing", "done", "failed"]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  filePath: z.string(),
  status: DocumentStatus,
  totalChunks: z.number().int().nullable(),
  processedChunks: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;

// ─────────────────────────────────────────────
// facts
// ─────────────────────────────────────────────
// attributes is deliberately open — different documents surface different
// kinds of facts (revenue figures, director names, addresses, percentages).
export const FactAttributesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);
export type FactAttributes = z.infer<typeof FactAttributesSchema>;

// A fact's evidence can come from running text OR from a chart/table/image
// on the rasterized page — in that case there's no literal string to quote.
export const EvidenceType = z.enum(["text", "chart", "table", "image"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

// What Gemini must return for ONE extracted fact.
export const ExtractedFactSchema = z
  .object({
    statement: z.string().min(1),
    evidenceType: EvidenceType,
    quote: z.string().nullable(), // required (non-null) when evidenceType === "text"
    evidenceDescription: z.string().nullable(), // e.g. "Pie chart on page 4, 'Revenue by Region'"
    attributes: FactAttributesSchema.default({}),
  })
  .refine((f) => f.evidenceType !== "text" || (f.quote && f.quote.length > 0), {
    message: "quote is required when evidenceType is 'text'",
    path: ["quote"],
  });
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

// What Gemini must return for a whole chunk.
export const ChunkExtractionResultSchema = z.object({
  facts: z.array(ExtractedFactSchema),
});
export type ChunkExtractionResult = z.infer<typeof ChunkExtractionResultSchema>;

// Full fact row as stored/returned.
export const FactSchema = ExtractedFactSchema.extend({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  chunkId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type Fact = z.infer<typeof FactSchema>;

// ─────────────────────────────────────────────
// fact_relationships (used by the comparison worker, referenced here
// so the whole codebase shares one contract)
// ─────────────────────────────────────────────
export const RelationshipType = z.enum([
  "corroborates",
  "contradicts",
  "contextual_explanation",
  "unrelated",
]);
export type RelationshipType = z.infer<typeof RelationshipType>;

export const RelationshipVerdictSchema = z.object({
  relationshipType: RelationshipType,
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
});
export type RelationshipVerdict = z.infer<typeof RelationshipVerdictSchema>;