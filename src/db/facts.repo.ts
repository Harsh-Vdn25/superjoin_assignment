import { pool } from "./pool";
import type { ExtractedFact, Fact, FactAttributes } from "../schema";

function mapRow(row: any): Fact {
  return {
    id: row.id,
    documentId: row.document_id,
    chunkId: row.chunk_id,
    statement: row.statement,
    evidenceType: row.attributes?.evidenceType ?? "text",
    quote: row.quote,
    evidenceDescription: row.attributes?.evidenceDescription ?? null,
    attributes: row.attributes,
    createdAt: row.created_at,
  };
}

// embedding is a plain number[]; pgvector accepts the literal '[0.1,0.2,...]'
// cast to ::vector — no extra client library needed for a simple insert.
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function insertFact(input: {
  documentId: string;
  chunkId: string;
  fact: ExtractedFact;
  embedding: number[];
}): Promise<Fact> {
  const { rows } = await pool.query(
    `INSERT INTO facts (document_id, chunk_id, statement, quote, attributes, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     RETURNING id, document_id, chunk_id, statement, quote, attributes, created_at`,
    [
      input.documentId,
      input.chunkId,
      input.fact.statement,
      input.fact.quote,
      // evidenceType + evidenceDescription live inside attributes as well,
      // so nothing about a fact's provenance is lost even though the table
      // itself only has a generic jsonb column for anything beyond quote.
      {
        ...input.fact.attributes,
        evidenceType: input.fact.evidenceType,
        evidenceDescription: input.fact.evidenceDescription,
      },
      toVectorLiteral(input.embedding),
    ]
  );
  return mapRow(rows[0]);
}

export async function getFactsByDocument(documentId: string): Promise<Fact[]> {
  const { rows } = await pool.query(
    `SELECT id, document_id, chunk_id, statement, quote, attributes, created_at
     FROM facts WHERE document_id = $1 ORDER BY created_at ASC`,
    [documentId]
  );
  return rows.map(mapRow);
}

export async function getAllFacts(): Promise<Fact[]> {
  const { rows } = await pool.query(
    `SELECT id, document_id, chunk_id, statement, quote, attributes, created_at
     FROM facts ORDER BY created_at DESC`
  );
  return rows.map(mapRow);
}

export async function getFactById(id: string): Promise<Fact | null> {
  const { rows } = await pool.query(
    `SELECT id, document_id, chunk_id, statement, quote, attributes, created_at
     FROM facts WHERE id = $1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function countByDocument(documentId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM facts WHERE document_id = $1`,
    [documentId]
  );
  return rows[0].count;
}

// pgvector returns its text representation as "[0.1,0.2,...]" over the wire
// (no custom type parser registered), so we parse it back into number[].
export async function getFactEmbedding(id: string): Promise<number[] | null> {
  const { rows } = await pool.query(
    `SELECT embedding::text AS embedding FROM facts WHERE id = $1`,
    [id]
  );
  const raw = rows[0]?.embedding;
  if (!raw) return null;
  return raw
    .slice(1, -1)
    .split(",")
    .map(Number);
}
 

// Used by the (separate) comparison worker — included here since it's the
// one query that actually needs pgvector, and it lives in this repo file.
export async function findSimilarFacts(
  embedding: number[],
  excludeDocumentId: string,
  limit = 10
): Promise<Array<Fact & { similarity: number }>> {
  const { rows } = await pool.query(
    `SELECT id, document_id, chunk_id, statement, quote, attributes, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM facts
     WHERE document_id != $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [toVectorLiteral(embedding), excludeDocumentId, limit]
  );
  return rows.map((r) => ({ ...mapRow(r), similarity: r.similarity }));
}