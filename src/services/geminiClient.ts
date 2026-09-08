import { GoogleGenerativeAI } from "@google/generative-ai";

require("dotenv").config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set");
}

export const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY
);

export const EXTRACTION_MODEL = "gemini-3.6-flash";
export const EMBEDDING_MODEL = "gemini-embedding-001";