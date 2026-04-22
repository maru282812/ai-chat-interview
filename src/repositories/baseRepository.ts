import { HttpError } from "../lib/http";

export function requireData<T>(data: T | null, message: string): T {
  if (!data) {
    throw new HttpError(404, message);
  }
  return data;
}

export function throwIfError(error: { message: string } | null): void {
  if (error) {
    throw new HttpError(500, error.message);
  }
}
