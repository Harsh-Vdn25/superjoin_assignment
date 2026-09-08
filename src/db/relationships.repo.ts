import { pool } from "./pool";
import type { RelationshipVerdict } from "../schema";

export interface RelationshipRow {
  id: string;
  factAId: string;
  factBId: string;
  relationshipType: string;
  confidence: number | null;
  explanation: string;
  similarityScore: number | null;
  createdAt: string;
}

function mapRow(row: any): RelationshipRow {
  return {
    id: row.id,
    factAId: row.fact_a_id,
    factBId: row.fact_b_id,
    relationshipType: row.relationship_type,
    confidence: row.confidence,
    explanation: row.explanation,
    similarityScore: row.similarity_score,
    createdAt: row.created_at,
  };
}

/**
 * Inserts a relationship verdict for a pair of facts. IDs can be passed in
 * either order — a DB trigger (see migrations/001_init_schema.sql) sorts
 * them into a canonical (fact_a_id < fact_b_id) order before the unique
 * constraint is checked, so this never creates duplicate (A,B) / (B,A) rows.
 */
export async function insertRelationship(input: {
  factAId: string;
  factBId: string;
  verdict: RelationshipVerdict;
  similarityScore: number;
}): Promise<RelationshipRow> {
  const { rows } = await pool.query(
    `INSERT INTO fact_relationships
       (fact_a_id, fact_b_id, relationship_type, confidence, explanation, similarity_score)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (fact_a_id, fact_b_id) DO UPDATE
       SET relationship_type = EXCLUDED.relationship_type,
           confidence = EXCLUDED.confidence,
           explanation = EXCLUDED.explanation,
           similarity_score = EXCLUDED.similarity_score
     RETURNING *`,
    [
      input.factAId,
      input.factBId,
      input.verdict.relationshipType,
      input.verdict.confidence,
      input.verdict.explanation,
      input.similarityScore,
    ]
  );
  return mapRow(rows[0]);
}

export async function getRelationshipsForFact(factId: string): Promise<RelationshipRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM fact_relationships
     WHERE fact_a_id = $1 OR fact_b_id = $1
     ORDER BY created_at DESC`,
    [factId]
  );
  return rows.map(mapRow);
}

export async function listRelationships(type?: string): Promise<RelationshipRow[]> {
  if (type) {
    const { rows } = await pool.query(
      `SELECT * FROM fact_relationships WHERE relationship_type = $1 ORDER BY created_at DESC`,
      [type]
    );
    return rows.map(mapRow);
  }
  const { rows } = await pool.query(`SELECT * FROM fact_relationships ORDER BY created_at DESC`);
  return rows.map(mapRow);
}