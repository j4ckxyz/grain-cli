import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getConfigPath } from "./config";
import type { AltAiConfig, MediaInput } from "./types";

export type UploadDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
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
  scheduleAt?: string;
};

function draftsPath(): string {
  const dir = dirname(getConfigPath());
  return join(dir, "drafts.json");
}

async function readDrafts(): Promise<UploadDraft[]> {
  const path = draftsPath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }

  const text = await file.text();
  if (!text.trim()) {
    return [];
  }

  return JSON.parse(text) as UploadDraft[];
}

async function writeDrafts(items: UploadDraft[]): Promise<void> {
  const path = draftsPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(items, null, 2)}\n`);
  await chmod(path, 0o600);
}

export async function listDrafts(): Promise<UploadDraft[]> {
  return readDrafts();
}

export async function getDraft(id: string): Promise<UploadDraft | undefined> {
  const drafts = await readDrafts();
  return drafts.find((draft) => draft.id === id);
}

export async function saveDraft(payload: Omit<UploadDraft, "id" | "createdAt" | "updatedAt">): Promise<UploadDraft> {
  const drafts = await readDrafts();
  const now = new Date().toISOString();
  const next: UploadDraft = {
    ...payload,
    id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };

  drafts.push(next);
  await writeDrafts(drafts);
  return next;
}

export async function deleteDraft(id: string): Promise<void> {
  const drafts = await readDrafts();
  await writeDrafts(drafts.filter((draft) => draft.id !== id));
}
