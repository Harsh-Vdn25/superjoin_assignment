import multer from "multer";
import { randomUUID } from "crypto";
import type { Request } from "express";

// Augment Request so route handlers can read the generated id without
// re-parsing the filename.
declare module "express-serve-static-core" {
  interface Request {
    documentId?: string;
  }
}

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req: Request, _file, cb) => {
    const id = randomUUID();
    req.documentId = id;
    cb(null, `${id}.pdf`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (file.mimetype !== "application/pdf") {
    return cb(new Error("Only PDF files are allowed"));
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap
});