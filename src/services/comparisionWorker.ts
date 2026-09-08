import pLimit from "p-limit";
import { pool } from "../db/pool";

import * as factsRepo from "../db/facts.repo";
import * as relationshipsRepo from "../db/relationships.repo";
import { judgeCandidates, type FactForJudging } from "./relationshipsJudge";
import { QuotaExhaustedError, isOverloadedError } from "./geminiErrors";
import { EXTRACTION_MODEL, FALLBACK_EXTRACTION_MODEL } from "./geminiClient";
import { createThrottle } from "../helpers/throttle";

const CONCURRENCY = 1;
const MIN_INTERVAL_MS = 13000; // same free-tier RPM ceiling as ingestion
const TOP_K_CANDIDATES = 5; // candidates judged per source fact, in one call
// Cosine similarity threshold below which a candidate isn't worth spending
// an LLM call on — tune this if you're getting too many "unrelated"
// verdicts (raise it) or missing real matches (lower it).
const SIMILARITY_THRESHOLD = 0.45;

function toFactForJudging(fact: {
  statement: string;
  quote: string | null;
  evidenceDescription: string | null;
}): FactForJudging {
  return {
    statement: fact.statement,
    quote: fact.quote,
    evidenceDescription: fact.evidenceDescription,
  };
}

/**
 * Runs cross-document comparison for every fact belonging to `documentId`.
 * Called fire-and-forget after ingestion finishes (see processDocument.ts)
 * — this is the "background worker" half of the pipeline: pgvector search
 * is cheap and local, only candidates above the similarity threshold cost
 * an actual LLM call, and that call is batched per source fact.
 */
export async function compareDocument(documentId: string): Promise<void> {
  try {
    console.log(`[COMPARE] Starting document ${documentId}`);

    const facts = await factsRepo.getFactsByDocument(documentId);

    console.log(`[COMPARE] Found ${facts.length} facts`);

    if (facts.length === 0) return;

    const limit = pLimit(CONCURRENCY);
    const throttle = createThrottle(MIN_INTERVAL_MS);
    let quotaExhausted = false;

    await Promise.all(
      facts.map((fact) =>
        limit(async () => {
          if (quotaExhausted) return;

          try {
            const embedding = await factsRepo.getFactEmbedding(fact.id);
            if (!embedding) {
              console.warn(
                `No embedding stored for fact ${fact.id}, skipping comparison`,
              );
              return;
            }

            // Cheap: pure SQL/pgvector, no LLM call.
            const similar = await factsRepo.findSimilarFacts(
              embedding,
              documentId,
              TOP_K_CANDIDATES,
            );
            const candidates = similar.filter(
              (c) => c.similarity >= SIMILARITY_THRESHOLD,
            );
            if (candidates.length === 0) return;

            await throttle();
            let result = await judgeCandidates(
              toFactForJudging(fact),
              candidates.map(toFactForJudging),
              EXTRACTION_MODEL,
            ).catch((err: any) => {
              if (err instanceof QuotaExhaustedError) {
                quotaExhausted = true;
              }
              return { ok: false as const, reason: String(err) };
            });

            if (
              !result.ok &&
              isOverloadedError(result.reason) &&
              !quotaExhausted
            ) {
              await throttle();
              result = await judgeCandidates(
                toFactForJudging(fact),
                candidates.map(toFactForJudging),
                FALLBACK_EXTRACTION_MODEL,
              ).catch((err: any) => ({
                ok: false as const,
                reason: String(err),
              }));
            }

            if (!result.ok) {
              console.error(
                `Comparison judging failed for fact ${fact.id} (doc ${documentId}): ${result.reason}`,
              );
              return;
            }

            for (const verdict of result.data.verdicts) {
              const candidate = candidates[verdict.candidateIndex];
              if (!candidate) continue; // model returned an out-of-range index — skip, don't crash
              if (verdict.relationshipType === "unrelated") continue; // not worth storing

              try {
                await relationshipsRepo.insertRelationship({
                  factAId: fact.id,
                  factBId: candidate.id,
                  verdict,
                  similarityScore: candidate.similarity,
                });
              } catch (err) {
                console.error(
                  `Failed to store relationship between ${fact.id} and ${candidate.id}:`,
                  err,
                );
              }
            }
          } catch (err) {
            // One fact's comparison failing (bad embedding, transient DB
            // hiccup, etc.) shouldn't take down the rest of the document's
            // comparison run.
            console.error(
              `Comparison failed for fact ${fact.id} (doc ${documentId}):`,
              err,
            );
          }
        }),
      ),
    );
  } catch (err) {
    console.error(`compareDocument failed for document ${documentId}:`, err);
  }
}

/**
 * Re-runs cross-document comparison for specific document IDs (or all if omitted),
 * logging step-by-step progress.
 */
export async function recompareDocuments(targetDocumentIds?: string[]): Promise<void> {
  console.log("[RECOMPARE] Starting targeted cross-document comparison...");

  let docs: { id: string }[] = [];

  if (targetDocumentIds && targetDocumentIds.length > 0) {
    docs = targetDocumentIds.map((id) => ({ id }));
  } else {
    const result = await pool.query("SELECT id FROM documents WHERE status = 'done'");
    docs = result.rows;
  }

  console.log(`[RECOMPARE] Target list: ${docs.length} document(s) to compare.`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    console.log(`\n⏳ [RECOMPARE Progress ${i + 1}/${docs.length}] Processing document ${doc!.id}...`);
    await compareDocument(doc!.id);
    console.log(`[RECOMPARE Progress ${i + 1}/${docs.length}] Finished document ${doc!.id}`);
  }

  console.log("\n🎉 [RECOMPARE] All target documents successfully cross-compared!");
}