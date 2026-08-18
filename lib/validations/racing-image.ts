// Racing Phase 16: competition/race icon upload validation. Reuses the avatar
// pipeline's magic-byte MIME detection (never trust the client-reported type)
// and the same 5MB cap. Output is a square WebP (rendered rounded on cards and
// pages), mirroring avatars.
import { detectImageMime } from "./avatar";

export const RACING_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const RACING_IMAGE_OUTPUT_SIZE = 256; // px, square (rendered rounded)

export { detectImageMime };
