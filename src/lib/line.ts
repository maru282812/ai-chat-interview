import crypto from "crypto";
import { env } from "../config/env";

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");

  return digest === signature;
}
