import { Router, type Request, type Response } from "express";
import * as relationshipsRepo from "../db/relationships.repo";
import {  recompareDocuments } from "../services/comparisionWorker";

export const relationRouter = Router();

relationRouter.get("/", async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const relationships = await relationshipsRepo.listRelationships(type);
    res.json({ relationships });
  } catch (err) {
    console.error("Failed to list relationships:", err);
    res.status(500).json({ message: "Failed to list relationships." });
  }
});


relationRouter.post("/recompare", async (req:Request, res:Response) => {
  // Fire and forget - runs in background
  const { documentIds } = req.body || {};
  recompareDocuments(documentIds).catch((err) =>
    console.error("Recompare error:", err)
  );
  res.json({
    message: "Targeted relationship comparison started in background",
    targetDocuments: documentIds || "ALL",
  });
});