-- Fix: quote was incorrectly NOT NULL from the original schema, before
-- evidenceType/evidenceDescription were introduced to support chart/table
-- facts that have no literal text to quote.
-- Run with: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f migrations/002_nullable_quote.sql

ALTER TABLE facts ALTER COLUMN quote DROP NOT NULL;