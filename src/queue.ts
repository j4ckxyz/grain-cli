import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getConfigPath } from "./config";
import type { AltAiConfig, MediaInput } from "./types";

export type QueuedUpload = {
  id: string;
  createdAt: string;
  attempts: number;
  notBefore?: string;
  title: string;
  description?: string;
  locationName?: string;
  locationValue?: string;
  placeName?: string;
  street?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  cw?: string;
  exifMode: "include" | "exclude";
  mediaInputs: MediaInput[];
  altTexts: string[];
  altAi?: AltAiConfig;
};

function queuePath(): string {
  const dir = dirname(getConfigPath());
  return join(dir, "upload-queue.json");
}

async function readQueue(): Promise<QueuedUpload[]> {
  const path = queuePath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }

  const text = await file.text();
  if (!text.trim()) {
    return [];
  }

  return JSON.parse(text) as QueuedUpload[];
}

async function writeQueue(items: QueuedUpload[]): Promise<void> {
  const path = queuePath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(items, null, 2)}\n`);
  await chmod(path, 0o600);
}

export async function listQueuedUploads(): Promise<QueuedUpload[]> {
  return readQueue();
}

export async function enqueueUpload(item: Omit<QueuedUpload, "id" | "createdAt" | "attempts">): Promise<QueuedUpload> {
  const queue = await readQueue();
  const next: QueuedUpload = {
    ...item,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  queue.push(next);
  await writeQueue(queue);
  return next;
}

export async function removeQueuedUpload(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.id !== id));
}

export async function updateQueuedUpload(item: QueuedUpload): Promise<void> {
  const queue = await readQueue();
  const next = queue.map((entry) => (entry.id === item.id ? item : entry));
  await writeQueue(next);
}

export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}
