import { pool } from "./pool";
import type { Document, DocumentStatus } from "../schema";

function mapRow(row: any): Document {
  return {
    id: row.id,
    filename: row.filename,
    filePath: row.file_path,
    status: row.status,
    totalChunks: row.total_chunks,
    processedChunks: row.processed_chunks,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertDocument(input: {
  id: string;
  filename: string;
  filePath: string;
}): Promise<Document> {
  const { rows } = await pool.query(
    `INSERT INTO documents (id, filename, file_path, status)
     VALUES ($1, $2, $3, 'processing')
     RETURNING *`,
    [input.id, input.filename, input.filePath]
  );
  return mapRow(rows[0]);
}

export async function getDocument(id: string): Promise<Document | null> {
  const { rows } = await pool.query(`SELECT * FROM documents WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listDocuments(): Promise<Document[]> {
  const { rows } = await pool.query(`SELECT * FROM documents ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

export async function setTotalChunks(id: string, totalChunks: number): Promise<void> {
  await pool.query(`UPDATE documents SET total_chunks = $2 WHERE id = $1`, [id, totalChunks]);
}

export async function incrementProcessedChunks(id: string): Promise<void> {
  await pool.query(
    `UPDATE documents SET processed_chunks = processed_chunks + 1 WHERE id = $1`,
    [id]
  );
}

export async function updateStatus(
  id: string,
  status: DocumentStatus,
  error?: string
): Promise<void> {
  await pool.query(`UPDATE documents SET status = $2, error = $3 WHERE id = $1`, [
    id,
    status,
    error ?? null,
  ]);
}