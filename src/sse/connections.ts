import type { Response } from "express";

const connections = new Map<string, Response[]>();

export function addConnection(documentId: string, res: Response): void {
  const list = connections.get(documentId) ?? [];
  list.push(res);
  connections.set(documentId, list);

  res.on("close", () => {
    const remaining = (connections.get(documentId) ?? []).filter((r) => r !== res);
    connections.set(documentId, remaining);
  });
}

export function broadcast(documentId: string, event: string, data: unknown): void {
  const list = connections.get(documentId);
  if (!list || list.length === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of list) {
    res.write(payload);
  }
}

export function closeConnections(documentId: string): void {
  const list = connections.get(documentId);
  if (list) {
    for (const res of list) res.end();
  }
  connections.delete(documentId);
}