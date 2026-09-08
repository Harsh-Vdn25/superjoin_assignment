import { pool } from "./pool";

export interface ChunkRow {
  id: string;
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string;
}

function mapRow(row: any): ChunkRow {
  return {
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    text: row.text,
  };
}

export async function insertChunk(input: {
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string;
}): Promise<ChunkRow> {
  const { rows } = await pool.query(
    `INSERT INTO chunks (document_id, chunk_index, page_start, page_end, text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.documentId, input.chunkIndex, input.pageStart, input.pageEnd, input.text]
  );
  return mapRow(rows[0]);
}

export async function getChunksByDocument(documentId: string): Promise<ChunkRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM chunks WHERE document_id = $1 ORDER BY chunk_index ASC`,
    [documentId]
  );
  return rows.map(mapRow);
}