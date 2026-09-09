import { GoogleGenerativeAI } from "@google/generative-ai";
require("dotenv").config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set");
}

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// gemini-2.5-flash was retired for new API keys (confirmed via
// ai.google.dev/gemini-api/docs/models, Sept 2026) — gemini-3.6-flash is
// the current stable, Google-recommended Flash model as of this writing.
// Check https://ai.google.dev/gemini-api/docs/models if this 404s again;
// Google's Flash lineup has moved fast and old model strings get retired.
export const EXTRACTION_MODEL = "gemini-3.6-flash";
// Used when EXTRACTION_MODEL returns a 503 "high demand" error — a
// different model has a separate capacity pool, so it's often available
// even when the primary one is overloaded.
export const FALLBACK_EXTRACTION_MODEL = "gemini-3.5-flash-lite";
export const EMBEDDING_MODEL = "gemini-embedding-001"; // text-embedding-004 is also deprecated