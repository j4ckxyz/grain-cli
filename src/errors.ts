export class GrainError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "GrainError";
    this.code = code;
    this.hint = hint;
  }
}

export function toGrainError(error: unknown): GrainError {
  if (error instanceof GrainError) {
    return error;
  }

  if (error instanceof Error) {
    return new GrainError("unexpected", error.message);
  }

  return new GrainError("unexpected", String(error));
}
