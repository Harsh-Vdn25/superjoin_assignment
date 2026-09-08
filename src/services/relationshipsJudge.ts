import { SchemaType } from "@google/generative-ai";
import { z } from "zod";
import { genAI } from "./geminiClient";
import { RelationshipType } from "../schema";
import { isDailyQuotaError, QuotaExhaustedError } from "./geminiErrors";

export interface FactForJudging {
  statement: string;
  quote: string | null;
  evidenceDescription: string | null;
}

const JUDGE_PROMPT = `You are comparing a SOURCE fact against several CANDIDATE
facts from other documents, found because they are semantically similar.

For each candidate, decide the relationship to the source fact:
- "corroborates": both state the same underlying fact, even if worded
  differently, covering the same period/scope/entity.
- "contradicts": they genuinely conflict — same period/scope/entity, but
  incompatible values or claims.
- "contextual_explanation": they LOOK like they conflict, but the difference
  is explained by context — different time periods, different scope
  (e.g. one is a subsidiary, one is the whole company), different units, or
  different definitions of the same-sounding metric. Explain the context.
- "unrelated": not meaningfully about the same underlying fact at all,
  despite surface-level similarity that triggered the match.

Be specific in "explanation" — name the actual numbers/dates/scope that make
you reach that conclusion, referencing both facts' evidence.

Return one verdict per candidate, in the same order, each tagged with its
"candidateIndex" (0-based, matching the order candidates were given).`;

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    verdicts: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          candidateIndex: { type: SchemaType.INTEGER },
          relationshipType: {
            type: SchemaType.STRING,
            enum: ["corroborates", "contradicts", "contextual_explanation", "unrelated"],
          },
          confidence: { type: SchemaType.NUMBER },
          explanation: { type: SchemaType.STRING },
        },
        required: ["candidateIndex", "relationshipType", "confidence", "explanation"],
      },
    },
  },
  required: ["verdicts"],
};

const BatchVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      candidateIndex: z.number().int(),
      relationshipType: RelationshipType,
      confidence: z.number().min(0).max(1),
      explanation: z.string().min(1),
    })
  ),
});
export type BatchVerdict = z.infer<typeof BatchVerdictSchema>;

function describeFact(fact: FactForJudging, label: string): string {
  const evidence = fact.quote ? `Quote: "${fact.quote}"` : `Evidence: ${fact.evidenceDescription}`;
  return `${label}: ${fact.statement}\n${evidence}`;
}

export interface JudgeResult {
  ok: true;
  data: BatchVerdict;
}
export interface JudgeFailure {
  ok: false;
  reason: string;
}

/**
 * Judges a source fact against all its candidates in ONE call, rather than
 * one call per pair — same rate-limit lesson as the extraction pipeline:
 * fewer, larger requests beat many small ones on the free tier.
 */
export async function judgeCandidates(
  source: FactForJudging,
  candidates: FactForJudging[],
  modelName: string
): Promise<JudgeResult | JudgeFailure> {
  if (candidates.length === 0) return { ok: true, data: { verdicts: [] } };

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema as any,
      maxOutputTokens: 4096,
      temperature: 0.1,
    },
  });

  const candidateText = candidates
    .map((c, i) => describeFact(c, `CANDIDATE ${i}`))
    .join("\n\n");

  let rawText: string;
  try {
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: JUDGE_PROMPT },
            { text: `${describeFact(source, "SOURCE")}\n\n${candidateText}` },
          ],
        },
      ],
    });
    rawText = result.response.text();
  } catch (err) {
    if (isDailyQuotaError(err)) {
      throw new QuotaExhaustedError(`Gemini daily free-tier quota exhausted: ${String(err)}`);
    }
    return { ok: false, reason: `Gemini API call failed: ${String(err)}` };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "Gemini response was not valid JSON" };
  }

  const validated = BatchVerdictSchema.safeParse(parsedJson);
  if (!validated.success) {
    return { ok: false, reason: `Schema validation failed: ${validated.error.message}` };
  }

  return { ok: true, data: validated.data };
}