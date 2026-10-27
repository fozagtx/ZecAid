import type { ProgramData } from "../types";

export function emptyStore(): ProgramData {
  return {
    treasuryAccountUuid: null,
    treasuryAddress: null,
    openedAt: null,
    lastSyncAt: null,
    chainHeight: null,
    cards: [],
    vendors: [],
    receipts: [],
    audit: [],
  };
}

export interface ProgramStore {
  read(): Promise<ProgramData>;
  update<T>(fn: (draft: ProgramData) => Promise<T> | T): Promise<T>;
}
