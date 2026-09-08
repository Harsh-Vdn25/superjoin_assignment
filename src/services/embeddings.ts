import { genAI, EMBEDDING_MODEL } from "./geminiClient";
import { QuotaExhaustedError, isDailyQuotaError } from "./geminiErrors";

/**
 * Returns a numeric embedding for the given text. Used both when storing a
 * new fact and when the (separate) comparison worker looks up similar facts.
 * Throws QuotaExhaustedError (not a generic Error) when the daily free-tier
 * quota is exhausted, so callers can stop making further Gemini calls
 * instead of retrying something retries can't fix.
 */
const TARGET_DIMENSIONS = 1536; // must match facts.embedding column (VECTOR(1536))

function truncateToTarget(values: number[]): number[] {
  if (values.length === TARGET_DIMENSIONS) return values;
  // Safety net: if the installed SDK version ignores outputDimensionality
  // and still returns the full 3072-dim vector, truncate manually. Gemini
  // embeddings are Matryoshka-trained, so taking a prefix and renormalizing
  // to unit length is a documented-safe way to shrink dimensions.
  const truncated = values.slice(0, TARGET_DIMENSIONS);
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? truncated.map((v) => v / norm) : truncated;
}

export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  try {
    const result = await model.embedContent({
      content: { role: "user", parts: [{ text }] },
      outputDimensionality: TARGET_DIMENSIONS,
    } as any);
    return truncateToTarget(result.embedding.values);
  } catch (err) {
    if (isDailyQuotaError(err)) {
      throw new QuotaExhaustedError(`Gemini daily free-tier quota exhausted: ${String(err)}`);
    }
    throw err;
  }
}

/**
 * Embeds many texts in ONE API call instead of one call per text. A single
 * chunk can now yield dozens of facts (up to ~8 per page x 5 pages per
 * chunk), and calling embedText per-fact would burn through the embedding
 * model's own rate limit fast. Order of returned vectors matches `texts`.
 */
export async function embedTextsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  try {
    const result = await model.batchEmbedContents({
      requests: texts.map((text) => ({
        content: { role: "user", parts: [{ text }] },
        outputDimensionality: TARGET_DIMENSIONS,
      })),
    } as any);
    return result.embeddings.map((e: { values: number[] }) => truncateToTarget(e.values));
  } catch (err) {
    if (isDailyQuotaError(err)) {
      throw new QuotaExhaustedError(`Gemini daily free-tier quota exhausted: ${String(err)}`);
    }
    throw err;
  }
}