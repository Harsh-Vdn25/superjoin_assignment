# Fact Knowledge Layer — Superjoin Hiring Assignment

A robust, grounded, and generalizable fact extraction and cross-referencing knowledge layer built for the **Superjoin VIT 2026 Engineering Intern Hiring Assignment**.

This system ingests PDF documents, extracts grounded factual claims (from written text, visual tables, bar graphs, and pie charts), and automatically identifies when facts across different documents **corroborate**, **contradict**, or can be **reconciled through context**.

---

## 🎥 Video Demo

- **Demo Video Link**: [Watch 3-Minute Video Demo](https://youtube.com/watch?v=your-demo-video-link-here) *(Shows live PDF upload, SSE progress stream, and walkthrough of the four required cases below)*

---

## 🏗️ System Architecture

### 1. Current Prototype Architecture (Implemented)

The prototype uses two **decoupled, asynchronous pipelines** sharing a PostgreSQL database with the `pgvector` extension:

```mermaid
flowchart TD
    subgraph ClientLayer ["Client & Upload Layer"]
        A["Client Upload PDF"] -->|"POST /documents"| B["Express Router"]
        B -->|"Save to Uploads & Return 202 Accepted"| C["Client (documentId)"]
        B -->|"Fire-and-Forget Ingestion"| D["Ingestion Pipeline"]
        C <-->|"SSE Stream (GET /documents/:id/events)"| E["SSE Manager"]
    end

    subgraph IngestionPipeline ["Pipeline 1: Document Ingestion"]
        D --> F["Text Extraction (pdfjs-dist) & Page Rasterization (pdf-to-img)"]
        F --> G["Page-Aligned Text & Image Chunks"]
        G --> H["Gemini 3.6 Flash Multimodal Extraction"]
        H -->|"Zod Schema Validation"| I["Extracted Facts (Statement, Quote, Attributes)"]
        I --> J["Batch Embedding (gemini-embedding-001)"]
        J --> K[("PostgreSQL + pgvector (documents, chunks, facts)")]
        K --> L["Push SSE Progress / Done Events"]
    end

    subgraph ComparisonPipeline ["Pipeline 2: Background Cross-Document Comparison"]
        K -.->|"Triggered on Ingestion Success"| M["compareDocument(documentId)"]
        M --> N["pgvector Cosine Distance Search (<=>)"]
        N -->|"Filter Candidates (Similarity >= 0.45)"| O["Candidate Fact Pairs"]
        O --> P["Batched Gemini 3.6 Flash Relationship Judging"]
        P -->|"Zod Schema Validation"| Q["Relationship Verdicts"]
        Q -->|"Store (corroborates, contradicts, contextual_explanation)"| R[("fact_relationships Table")]
    end
```

---

### 2. Proposed Scaled Architecture ("If I Had Another Week")

Below is the visual architecture mapping out production scalability improvements (as requested in the assignment brief):

```mermaid
flowchart TD
    subgraph Gateway ["1. Gateway & Ingestion Security"]
        U1["Client Upload Request"] --> U2["Upload & Content Dedup"]
        U2 -->|"SHA-256 Hash Check & Magic Bytes (%PDF-)"| U3{"Duplicate Document?"}
        U3 -- "Yes" --> U4["Short-Circuit to Existing Document ID"]
        U3 -- "No" --> U5["Enqueue Ingestion Job"]
    end

    subgraph QueueLayer ["2. Durable Distributed Queue"]
        U5 --> Q1["Job Queue (BullMQ + Redis)"]
        Q1 --> W1["Worker Process 1"]
        Q1 --> W2["Worker Process 2"]
    end

    subgraph WorkerLayer ["3. Adaptive Processing Workers"]
        W1 & W2 --> W3["Adaptive Chunking (Text/Image Density Sizing)"]
        W3 --> W4["Selective Rasterization (Chart/Table Pages Only)"]
        W4 --> W5["Gemini Multimodal Extraction & Embedding"]
    end

    subgraph StorageLayer ["4. Primary Database & Telemetry"]
        W5 --> DB[("PostgreSQL + pgvector")]
        W5 -->|"Failed Extraction / Schema Mismatch"| FL["extraction_failures Table"]
        DB --- FL
    end

    subgraph ProcessingBranches ["5. Independent Service Branches"]
        DB -.-> CW["Comparison Workers (Similarity Search + Batched Judging)"]
        CW --> DB
        DB <--> API["Rate-Limited REST API (Paginated Facts & Relationships)"]
    end
```

---

## 🎯 Demonstration of The Four Required Cases

### 1. Corroboration
- **Fact A** (`01-delhivery-prospectus-2022-excerpt.pdf`): Net cash from investing activities in FY24 was `₹(99) Cr`.
- **Fact B** (`02-rbi-annual-report-2024-25-excerpt.pdf`): Net cash used in investing activities for year ended March 31, 2024 was `INR 990.92 million`.
- **Verdict**: `corroborates` (99% confidence)
- **LLM Explanation**: *"Candidate states net cash from investing activities in FY24 was ₹(99) Cr (equivalent to ₹990 million) matching INR 990.92 million after currency scaling (1 Cr = 10 Million) and rounding."*

### 2. Contradiction
- **Fact A** (`01-delhivery-prospectus-2022-excerpt.pdf`): Income tax matters in appeal aggregated to `344.92 million` as of **March 31, 2024**.
- **Fact B** (`03-tax-audit-report-2024-excerpt.pdf`): Income tax matters under appeal aggregated to `344.92 million` as of **December 31, 2021**.
- **Verdict**: `contradicts` (95% confidence)
- **LLM Explanation**: *"Direct conflict in reporting dates: source states the income tax matters in appeal applied to March 31, 2024 whereas candidate claims this amount applies to December 31, 2021."*

### 3. Contextual Explanation
- **Fact A** (`01-delhivery-prospectus-2022-excerpt.pdf`): Freight, handling, and servicing costs reached `59,707.49 million` for the year ended **March 31, 2024**.
- **Fact B** (`03-tax-audit-report-2024-excerpt.pdf`): Freight and handling costs for the **nine-month period ended December 31, 2021**.
- **Verdict**: `contextual_explanation` (100% confidence)
- **LLM Explanation**: *"They look like conflicting operating costs at first glance, but refer to completely different operating periods (full fiscal year 2024 vs nine-month period ended Dec 31, 2021)."*

### 4. Concrete Extraction & Schema Validation Failure
- **Concrete Example Hit During Testing**: On Chunk 0 of `02-rbi-annual-report-2024-25-excerpt.pdf`, the Gemini API returned a malformed `attributes` field where `attributes` was returned as a flat string `"income_tax_appeals"` instead of a JSON object `{ "metric": "income_tax_appeals" }`.
- **Raw Response Received**:
  ```json
  {
    "statement": "Income tax matters under appeal aggregate to ₹344.92 million",
    "quote": "Income tax matters under appeal: ₹344.92M",
    "attributes": "income_tax_appeals"
  }
  ```
- **System Handling**: The Zod schema check (`ExtractedFactSchema.safeParse()`) failed with `ZodError: Expected object, received string`. The error was safely caught in `processDocument.ts`, logged to server output without crashing the pipeline, and retried using the fallback model (`gemini-3.5-flash-lite`).

---

## ⚙️ Setup and Run Instructions

### Prerequisites
- Node.js (v18+)
- PostgreSQL (v16+ with `pgvector` extension)
- Gemini API Key ([Google AI Studio](https://aistudio.google.com/))

### Environment Variables (`.env`)
```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/superjoin
GEMINI_API_KEY=your_gemini_api_key_here
```

### Installation & Local Run
```bash
# 1. Install dependencies
npm install

# 2. Apply database migrations
psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f migrations/001_init_schema.sql
psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f migrations/002_nullable_quote.sql

# 3. Build & start server
npm run build
npm start
```

---

## 📁 Sample Outputs

Full, unedited API JSON responses generated from a live run on starter financial documents are available in the `sample_outputs/` directory:

- [`sample_outputs/01_post_documents.json`](./sample_outputs/01_post_documents.json) — Upload response
- [`sample_outputs/02_get_documents.json`](./sample_outputs/02_get_documents.json) — Document list status
- [`sample_outputs/03_get_document_status.json`](./sample_outputs/03_get_document_status.json) — Progress details
- [`sample_outputs/04_get_facts.json`](./sample_outputs/04_get_facts.json) — Grounded fact claims
- [`sample_outputs/05_get_fact_evidence.json`](./sample_outputs/05_get_fact_evidence.json) — Fact evidence chain
- [`sample_outputs/06_get_fact_relationships_corroborates.json`](./sample_outputs/06_get_fact_relationships_corroborates.json) — Corroboration case
- [`sample_outputs/07_get_fact_relationships_contradicts.json`](./sample_outputs/07_get_fact_relationships_contradicts.json) — Contradiction case
- [`sample_outputs/08_get_fact_relationships_contextual.json`](./sample_outputs/08_get_fact_relationships_contextual.json) — Contextual explanation case
- [`sample_outputs/09_get_relationships_all.json`](./sample_outputs/09_get_relationships_all.json) — Knowledge layer relationship graph
- [`sample_outputs/10_get_relationships_filtered_contradicts.json`](./sample_outputs/10_get_relationships_filtered_contradicts.json) — Global relationships filtered by `?type=contradicts`
- [`sample_outputs/11_get_relationships_filtered_corroborates.json`](./sample_outputs/11_get_relationships_filtered_corroborates.json) — Global relationships filtered by `?type=corroborates`

---

## 📖 API Documentation

Complete REST API specifications, query parameters, SSE streams, and `curl` usage examples are documented in [`API_REFERENCE.md`](./API_REFERENCE.md).

---

## 🤖 AI Tools Used

- **Gemini 3.6 Flash & 3.5 Flash-Lite**: Core multimodal fact extraction, page vision, text embeddings (`gemini-embedding-001`), and cross-document relationship judging.
- **Claude**: TypeScript code generation, pipeline debugging .

---

## 🧪 Limitations and Next Steps

- **Pagination**: Currently returns full result sets. Production deployment would use cursor-based pagination (`?after=<id>&limit=50`).
- **Selective Rasterization**: Currently rasterizes all pages. Future builds can inspect page XObjects via `pdfjs-dist` to rasterize image/table pages only.
- **Queryable Failure Table**: Currently outputs extraction errors to server logs; a dedicated `extraction_failures` table would expose failed chunks directly via the API.
- **Job Queue**: Replacing in-process concurrency control with BullMQ + Redis for distributed worker scaling.

---

## 📝 Additional Notes

- **Model Lineup Shift**: Google's Gemini API model names shifted mid-project (`gemini-2.5-flash` $\rightarrow$ `gemini-3.6-flash` and `text-embedding-004` $\rightarrow$ `gemini-embedding-001`). All model identifiers were centralized in `geminiClient.ts` to ensure API updates remain single-line changes.
- **Free-Tier Constraints**: Free-tier rate limits (5 requests/minute) heavily shaped the architecture, driving request batching, throttle delays, and fallback model switching under `503` demand spikes.
