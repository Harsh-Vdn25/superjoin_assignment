import { Router, type Request, type Response } from "express";
import * as factsRepo from "../db/facts.repo";
import * as chunksRepo from "../db/chunks.repo";
import * as relationshipsRepo from "../db/relationships.repo";

export const factRouter = Router();

factRouter.get("/", async (req: Request, res: Response) => {
  try {
    const documentId = req.query.documentId as string | undefined;
    const facts = documentId
      ? await factsRepo.getFactsByDocument(documentId)
      : await factsRepo.getAllFacts();
    res.json({ facts });
  } catch (err) {
    console.error("Failed to list facts:", err);
    res.status(500).json({ message: "Failed to list facts." });
  }
});

factRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const fact = await factsRepo.getFactById(req.params.id as string);
    if (!fact) {
      return res.status(404).json({ message: "Fact not found." });
    }
    // Pull the full chunk text so the response carries complete evidence,
    // not just the short quote.
    const chunks = await chunksRepo.getChunksByDocument(fact.documentId);
    const chunk = chunks.find((c) => c.id === fact.chunkId) ?? null;

    res.json({ ...fact, chunk });
  } catch (err) {
    console.error("Failed to fetch fact:", err);
    res.status(500).json({ message: "Failed to fetch fact." });
  }
});

factRouter.get("/:id/relationships", async (req: Request, res: Response) => {
  try {
    const fact = await factsRepo.getFactById(req.params.id as string);
    if (!fact) {
      return res.status(404).json({ message: "Fact not found." });
    }

    const relationships = await relationshipsRepo.getRelationshipsForFact(fact.id);

    const enriched = await Promise.all(
      relationships.map(async (rel) => {
        const otherFactId = rel.factAId === fact.id ? rel.factBId : rel.factAId;
        const otherFact = await factsRepo.getFactById(otherFactId);
        return {
          relationshipType: rel.relationshipType,
          confidence: rel.confidence,
          explanation: rel.explanation,
          similarityScore: rel.similarityScore,
          otherFact: otherFact
            ? {
                id: otherFact.id,
                statement: otherFact.statement,
                quote: otherFact.quote,
                documentId: otherFact.documentId,
              }
            : null,
        };
      })
    );

    res.json({ relationships: enriched });
  } catch (err) {
    console.error("Failed to fetch relationships:", err);
    res.status(500).json({ message: "Failed to fetch relationships." });
  }
});