# Fact Knowledge Layer — API Reference Specification

All API responses are formatted in JSON. Long-running document ingestion occurs asynchronously (202 Accepted response upon upload), while clients can track live progress via Server-Sent Events (SSE) or polling.

---

## Base URL
```
http://localhost:5000
```

---

## 1. Document Management (`/documents`)

### `POST /documents`
Uploads a PDF document to begin async text extraction, page rasterization, grounded fact extraction, vector embedding, and cross-document comparison.

- **Content-Type**: `multipart/form-data`
- **Field**: `file` (PDF file binary, max 50MB)

#### Example Request (`curl`)
```bash
curl -F "file=@sample.pdf" http://localhost:5000/documents
```

#### Example Response (`202 Accepted`)
```json
{
  "documentId": "f304fa62-de75-49bb-ad1c-d443b7170144",
  "status": "processing"
}
```

#### Error Responses
- `400 Bad Request`: Missing file payload or invalid non-PDF file.
- `500 Internal Server Error`: Server storage or database failure.

---

### `GET /documents`
Lists all uploaded documents with their current processing status.

#### Example Request (`curl`)
```bash
curl http://localhost:5000/documents
```

#### Example Response (`200 OK`)
```json
{
  "documents": [
    {
      "id": "f304fa62-de75-49bb-ad1c-d443b7170144",
      "filename": "01-delhivery-prospectus-2022-excerpt.pdf",
      "status": "done",
      "createdAt": "2026-09-08T10:50:48.607Z"
    }
  ]
}
```

---

### `GET /documents/:id`
Retrieves detailed status, file path, chunk totals, and progress metrics for a single document.

#### Example Request (`curl`)
```bash
curl http://localhost:5000/documents/f304fa62-de75-49bb-ad1c-d443b7170144
```

#### Example Response (`200 OK`)
```json
{
  "id": "f304fa62-de75-49bb-ad1c-d443b7170144",
  "filename": "01-delhivery-prospectus-2022-excerpt.pdf",
  "filePath": "uploads/f304fa62-de75-49bb-ad1c-d443b7170144.pdf",
  "status": "done",
  "totalChunks": 20,
  "processedChunks": 20,
  "error": null,
  "createdAt": "2026-09-08T10:50:48.607Z",
  "updatedAt": "2026-09-08T10:59:50.527Z"
}
```

---

### `GET /documents/:id/events`
Opens a Server-Sent Events (SSE) connection streaming real-time ingestion progress updates.

- **Content-Type**: `text/event-stream`

#### Event Formats
```http
event: progress
data: {"processedChunks": 12, "totalChunks": 20}

event: done
data: {"documentId": "f304fa62-de75-49bb-ad1c-d443b7170144", "factCount": 57}

event: error
data: {"message": "Gemini API daily quota exhausted"}
```

---

## 2. Fact Extraction (`/facts`)

### `GET /facts`
Lists all extracted facts stored in the knowledge layer, optionally filtered by document.

- **Query Parameters**:
  - `documentId` (optional): Filter facts belonging to a specific document UUID.

#### Example Request (`curl`)
```bash
curl "http://localhost:5000/facts?documentId=f304fa62-de75-49bb-ad1c-d443b7170144"
```

#### Example Response (`200 OK`)
```json
{
  "facts": [
    {
      "id": "3d3e428b-e784-4d60-b833-7c34050ac30b",
      "documentId": "f304fa62-de75-49bb-ad1c-d443b7170144",
      "chunkId": "67484446-d778-4b98-8018-6b0778424ee8",
      "statement": "Net cash from investing activities in FY24 was ₹(99) Cr (equivalent to ₹990 million).",
      "evidenceType": "text",
      "quote": "Net cash generated from / (used in) investing activities for FY24 stood at ₹(99) Cr...",
      "evidenceDescription": null,
      "attributes": {
        "metric": "net_cash_investing",
        "period": "FY24",
        "value": -990000000,
        "unit": "INR"
      },
      "createdAt": "2026-09-08T10:51:26.181Z"
    }
  ]
}
```

---

### `GET /facts/:id`
Retrieves a single fact along with its full evidence chain (source chunk text and page range).

#### Example Request (`curl`)
```bash
curl http://localhost:5000/facts/3d3e428b-e784-4d60-b833-7c34050ac30b
```

#### Example Response (`200 OK`)
```json
{
  "id": "3d3e428b-e784-4d60-b833-7c34050ac30b",
  "documentId": "f304fa62-de75-49bb-ad1c-d443b7170144",
  "chunkId": "67484446-d778-4b98-8018-6b0778424ee8",
  "statement": "Net cash from investing activities in FY24 was ₹(99) Cr (equivalent to ₹990 million).",
  "evidenceType": "text",
  "quote": "Net cash generated from / (used in) investing activities for FY24 stood at ₹(99) Cr...",
  "attributes": {
    "metric": "net_cash_investing",
    "period": "FY24",
    "value": -990000000,
    "unit": "INR"
  },
  "createdAt": "2026-09-08T10:51:26.181Z",
  "chunk": {
    "id": "67484446-d778-4b98-8018-6b0778424ee8",
    "pageStart": 3,
    "pageEnd": 7,
    "text": "FINANCIAL SUMMARY & CASH FLOW STATEMENT\nNet cash generated from / (used in) investing activities for FY24 stood at ₹(99) Cr..."
  }
}
```

---

## 3. Cross-Document Relationships (`/relationships`)

### `GET /facts/:id/relationships`
Returns all evaluated cross-document relationships (`corroborates`, `contradicts`, `contextual_explanation`) involving a specific fact.

#### Example Request (`curl`)
```bash
curl http://localhost:5000/facts/3d3e428b-e784-4d60-b833-7c34050ac30b/relationships
```

#### Example Response (`200 OK`)
```json
{
  "relationships": [
    {
      "id": "6b82d553-d90a-4e65-afaa-d81e337c7517",
      "relationshipType": "corroborates",
      "confidence": 0.99,
      "explanation": "Candidate 0 states net cash from investing activities in FY24 was ₹(99) Cr (equivalent to ₹990 million) and in FY23 was ₹(3,411) Cr (equivalent to ₹34,107 million), which matches the source values of INR 990.92 million and INR 34,107.48 million after currency scaling and rounding.",
      "similarityScore": 0.8504527577713054,
      "otherFact": {
        "id": "4f3cfcc1-a29f-41b4-96d7-0024abf12856",
        "statement": "Net cash used in investing activities for the year ended March 31, 2024 was INR 990.92 million...",
        "quote": "Net cash used in investing activities: March 31, 2024: INR 990.92 million...",
        "documentId": "5a843371-37f8-4bd0-8c08-d283c1d00688"
      }
    }
  ]
}
```

---

### `GET /relationships?type=contradicts`
Lists all relationships stored across the entire knowledge layer, optionally filtered by relationship type.

- **Query Parameters**:
  - `type` (optional): Filter by `corroborates`, `contradicts`, or `contextual_explanation`.

#### Example Request (`curl`)
```bash
curl "http://localhost:5000/relationships?type=contradicts"
```

#### Example Response (`200 OK`)
```json
{
  "relationships": [
    {
      "id": "1a0ee6bf-d45e-46a8-b963-43ecad40b251",
      "factAId": "d6b42f7b-a0ea-4a50-b432-620ccd5e8360",
      "factBId": "e33c0992-b633-4842-9edc-d10396c2603f",
      "relationshipType": "contradicts",
      "confidence": 0.95,
      "explanation": "The source states the income tax matters in appeal were 344.92 million as of March 31, 2024 and March 31, 2023, whereas Candidate 1 claims this amount applies to December 31, 2021, creating a direct conflict in the dates for the same figure.",
      "similarityScore": 0.8088195682506226,
      "createdAt": "2026-09-08T14:00:21.895Z"
    }
  ]
}
```

---

### `POST /relationships/recompare`
Triggers targeted or global cross-document relationship comparison in the background.

- **Body (JSON, optional)**:
  ```json
  {
    "documentIds": [
      "f304fa62-de75-49bb-ad1c-d443b7170144",
      "5a843371-37f8-4bd0-8c08-d283c1d00688"
    ]
  }
  ```

#### Example Request (`curl`)
```bash
curl -X POST http://localhost:5000/relationships/recompare \
  -H "Content-Type: application/json" \
  -d '{"documentIds": ["f304fa62-de75-49bb-ad1c-d443b7170144", "5a843371-37f8-4bd0-8c08-d283c1d00688"]}'
```

#### Example Response (`200 OK`)
```json
{
  "message": "Targeted relationship comparison started in background",
  "targetDocuments": [
    "f304fa62-de75-49bb-ad1c-d443b7170144",
    "5a843371-37f8-4bd0-8c08-d283c1d00688"
  ]
}
```
