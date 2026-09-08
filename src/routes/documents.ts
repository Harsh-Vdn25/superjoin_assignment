import { Router, type Request, type Response } from "express";
import { upload } from "../middleware/multer";
import * as documentsRepo from "../db/documents.repo";
import { processDocument } from "../services/processDocument";
import { addConnection } from "../sse/connections";

export const documentRouter = Router();

documentRouter.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file || !req.documentId) {
      return res.status(400).json({ message: "PDF file is required." });
    }

    const documentId = req.documentId;

    await documentsRepo.insertDocument({
      id: documentId,
      filename: req.file.originalname,
      filePath: req.file.path,
    });

    res.status(202).json({ documentId, status: "processing" });

    // Fire-and-forget — do NOT await. The response above must return
    // immediately; processing continues in the background.
    processDocument(documentId, req.file.path).catch((err:any) => {
      console.error(`Unhandled error processing document ${documentId}:`, err);
    });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ message: "Failed to process upload." });
  }
});

documentRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const documents = await documentsRepo.listDocuments();
    res.json({ documents });
  } catch (err) {
    console.error("Failed to list documents:", err);
    res.status(500).json({ message: "Failed to list documents." });
  }
});

documentRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const document = await documentsRepo.getDocument(req.params.id as string);
    if (!document) {
      return res.status(404).json({ message: "Document not found." });
    }
    res.json(document);
  } catch (err) {
    console.error("Failed to fetch document:", err);
    res.status(500).json({ message: "Failed to fetch document." });
  }
});

// SSE stream of progress/done/error events for one document's processing.
documentRouter.get("/:id/events", async (req: Request, res: Response) => {
  const document = await documentsRepo.getDocument(req.params.id as string);
  if (!document) {
    return res.status(404).json({ message: "Document not found." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send current state immediately in case processing already finished
  // (or failed) before the client connected.
  res.write(
    `event: progress\ndata: ${JSON.stringify({
      processedChunks: document.processedChunks,
      totalChunks: document.totalChunks,
    })}\n\n`
  );
  if (document.status === "done" || document.status === "failed") {
    res.write(`event: ${document.status}\ndata: ${JSON.stringify(document)}\n\n`);
    return res.end();
  }

  addConnection(req.params.id as string, res);
});