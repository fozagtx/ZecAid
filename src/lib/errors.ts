export class ZecAidError extends Error {
  readonly details?: unknown;

  constructor(message: string, readonly status: number, details?: unknown) {
    super(message);
    this.name = "ZecAidError";
    this.details = details;
  }
}
