import { Router, type Request, type Response } from "express";
import * as relationshipsRepo from "../db/relationships.repo";

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