import pLimit from "p-limit";
import pRetry from "p-retry";

import * as documentsRepo from "../db/documents.repo";
import * as chunksRepo from "../db/chunks.repo";
import * as factsRepo from "../db/facts.repo";
import { extractPages, groupIntoChunks } from "./pdfExtractor";
import { extractFactsFromChunk } from "./extraction";
import { QuotaExhaustedError, isOverloadedError } from "./geminiErrors";
import { FALLBACK_EXTRACTION_MODEL } from "./geminiClient";
import { embedTextsBatch } from "./embeddings";
import { broadcast, closeConnections } from "../sse/connections";

const CONCURRENCY = 1; // free-tier RPM is too low to run calls in parallel
// Bundling more pages per request cuts total request count, which is what
// actually matters on free tier (5 RPM primary model) — 1M token context
// gives plenty of headroom, so token size isn't the binding constraint here.
// 100 pages at 1/chunk = 100 requests (~25+ min minimum); at 5/chunk = ~20
// requests (~5 min minimum). Tune down if a single chunk's output starts
// getting truncated (check maxOutputTokens below).
const PAGES_PER_CHUNK = 5;
// Confirmed via a live 429 error: this project's free-tier limit for
// gemini-3.6-flash is 5 requests/minute. 60s / 5 = 12s minimum; add a
// buffer since limits aren't guaranteed exact (see Google's rate-limits
// docs). If you link a billing account (Tier 1, still free under $250/mo,
// see https://ai.google.dev/gemini-api/docs/billing), this limit rises
// sharply — check https://aistudio.google.com/rate-limit for your actual
// current number and adjust this back down if so.
const MIN_INTERVAL_MS = 13000;

/**
 * p-limit only caps how many calls run at once — it does NOT space out when
 * each one starts. Two calls can still fire back-to-back the instant a slot
 * frees up, which is exactly what trips "high demand" 503s on the free tier.
 * This throttle enforces a minimum gap between call starts, independent of
 * concurrency, so we stay under Gemini's ~10-15 RPM free-tier ceiling.
 */
function createThrottle(minIntervalMs: number) {
  let nextAvailable = Date.now();
  return async function throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, nextAvailable - now);
    nextAvailable = Math.max(now, nextAvailable) + minIntervalMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}

/**
 * Runs the full ingestion pipeline for one uploaded document.
 * Called fire-and-forget from the upload route (never awaited there) so the
 * HTTP response returns immediately after the file is saved.
 *
 * Per-chunk extraction failures are caught and logged, not thrown — one bad
 * chunk (malformed LLM JSON, a Gemini timeout, an unreadable page) should
 * not take down processing for the rest of the document.
 */
export async function processDocument(documentId: string, filePath: string): Promise<void> {
  try {
    const pages = await extractPages(filePath);
    const chunks = groupIntoChunks(pages, PAGES_PER_CHUNK);

    await documentsRepo.setTotalChunks(documentId, chunks.length);
    broadcast(documentId, "progress", { processedChunks: 0, totalChunks: chunks.length });

    let processed = 0;
    const limit = pLimit(CONCURRENCY);
    const throttle = createThrottle(MIN_INTERVAL_MS);
    // Once the daily quota is confirmed exhausted, stop calling Gemini for
    // every remaining chunk — retrying would just waste time and produce
    // misleading per-chunk error noise for something that isn't per-chunk.
    let quotaExhausted = false;

    await Promise.all(
      chunks.map((chunk) =>
        limit(async () => {
          // Store the chunk's text regardless of extraction outcome — it's
          // the evidence record, independent of whether the LLM call succeeds.
          const chunkRow = await chunksRepo.insertChunk({
            documentId,
            chunkIndex: chunk.chunkIndex,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            text: chunk.text,
          });

          let extraction: Awaited<ReturnType<typeof extractFactsFromChunk>>;

          if (quotaExhausted) {
            extraction = { ok: false, reason: "Skipped: daily Gemini quota already exhausted" };
          } else {
            await throttle();
            extraction = await pRetry(
              async (bail) => {
                await throttle(); // also space out retry attempts, not just first tries
                try {
                  return await extractFactsFromChunk(chunk);
                } catch (err) {
                  if (err instanceof QuotaExhaustedError) {
                    quotaExhausted = true;
                    //@ts-expect-error
                    bail(err); // stop retrying immediately — more attempts won't help
                    throw err;
                  }
                  throw err;
                }
              },
              {
                retries: 4,
                minTimeout: 2000, // start at 2s, doubling each retry — 503s from
                factor: 2, // "high demand" often need 10s+ to clear, not 1s
                onFailedAttempt: (err:any) =>
                  console.warn(
                    `Extraction attempt ${err.attemptNumber} failed for chunk ${chunk.chunkIndex} (doc ${documentId}): ${err.message}`
                  ),
              }
            ).catch((err) => ({
              ok: false as const,
              reason: quotaExhausted
                ? `Gemini daily quota exhausted: ${String(err)}`
                : `All retries exhausted: ${String(err)}`,
            }));

            // Primary model is overloaded (503), not just slow — a
            // different model has a separate capacity pool, so try it once
            // before marking this chunk a total failure.
            if (!extraction.ok && isOverloadedError(extraction.reason)) {
              console.warn(
                `Chunk ${chunk.chunkIndex} (doc ${documentId}): primary model overloaded, trying fallback ${FALLBACK_EXTRACTION_MODEL}`
              );
              await throttle();
              extraction = await extractFactsFromChunk(chunk, FALLBACK_EXTRACTION_MODEL).catch(
                (err) => ({
                  ok: false as const,
                  reason: `Fallback model also failed: ${String(err)}`,
                })
              );
            }
          }

          if (!extraction.ok) {
            console.error(
              `Extraction failed for chunk ${chunk.chunkIndex} of document ${documentId}: ${extraction.reason}`
            );
            // Deliberately not re-thrown — this chunk contributes zero facts
            // and processing continues. Surfacing these in the UI/README is
            // the required "extraction failure" case for the assignment.
          } else if (!quotaExhausted) {
            const facts = extraction.data.facts;
            let embeddings: number[][] = [];
            try {
              embeddings = await embedTextsBatch(
                facts.map((f) => `${f.statement} ${f.quote ?? f.evidenceDescription ?? ""}`)
              );
            } catch (err) {
              if (err instanceof QuotaExhaustedError) {
                quotaExhausted = true;
                console.error(`Gemini quota exhausted while embedding (doc ${documentId})`);
              } else {
                console.error(
                  `Batch embedding failed for chunk ${chunk.chunkIndex} (doc ${documentId}):`,
                  err
                );
              }
            }

            for (let i = 0; i < facts.length; i++) {
              if (!embeddings[i]) continue; // embedding failed/skipped for this fact
              try {
                await factsRepo.insertFact({
                  documentId,
                  chunkId: chunkRow.id,
                  fact: facts[i]!,
                  embedding: embeddings[i]!,
                });
              } catch (err) {
                console.error(
                  `Failed to store a fact from chunk ${chunk.chunkIndex} (doc ${documentId}):`,
                  err
                );
              }
            }
          }

          processed++;
          await documentsRepo.incrementProcessedChunks(documentId);
          broadcast(documentId, "progress", {
            processedChunks: processed,
            totalChunks: chunks.length,
          });
        })
      )
    );

    await documentsRepo.updateStatus(documentId, "done");
    const factCount = await factsRepo.countByDocument(documentId);
    broadcast(documentId, "done", { documentId, factCount });
  } catch (err) {
    console.error(`processDocument failed for document ${documentId}:`, err);
    await documentsRepo.updateStatus(documentId, "failed", String(err));
    broadcast(documentId, "error", { message: String(err) });
  } finally {
    closeConnections(documentId);
  }
}