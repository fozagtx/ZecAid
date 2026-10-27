import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProgramData } from "../types";
import { emptyStore, type ProgramStore } from "./types";

export class FileStore implements ProgramStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath = path.join(process.cwd(), "data", "store.json"),
  ) {}

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  read(): Promise<ProgramData> {
    return this.locked(() => this.load());
  }

  update<T>(fn: (draft: ProgramData) => Promise<T> | T): Promise<T> {
    return this.locked(async () => {
      const draft = await this.load();
      const result = await fn(draft);
      await this.save(draft);
      return result;
    });
  }

  private async load(): Promise<ProgramData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ProgramData>;
      return {
        treasuryAccountUuid: parsed.treasuryAccountUuid ?? null,
        treasuryAddress: parsed.treasuryAddress ?? null,
        openedAt: parsed.openedAt ?? null,
        lastSyncAt: parsed.lastSyncAt ?? null,
        chainHeight: parsed.chainHeight ?? null,
        cards: parsed.cards ?? [],
        vendors: parsed.vendors ?? [],
        receipts: parsed.receipts ?? [],
        audit: parsed.audit ?? [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  private async save(data: ProgramData): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, this.filePath);
  }
}
