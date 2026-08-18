import { NextResponse } from "next/server";
import sharp from "sharp";
import { randomUUID } from "crypto";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  RACING_IMAGE_MAX_BYTES,
  RACING_IMAGE_OUTPUT_SIZE,
  detectImageMime,
} from "@/lib/validations/racing-image";

/**
 * Racing Phase 16: upload a competition/race icon and return its public URL.
 * Operator-only (organizer or super_admin) — only operators author competitions
 * and races. This route uploads and returns the URL; persistence happens in the
 * create/edit actions, so it works both before an entity exists (creation) and
 * after (editing). Mirrors /api/avatar: magic-byte MIME check, 5MB cap, sharp
 * resize to a square WebP, service-role upload to the public racing-images
 * bucket. The browser never writes storage directly.
 */
export async function POST(request: Request) {
  await requireOrganizerOrAbove();

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (file.size > RACING_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 5MB)." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedMime = detectImageMime(bytes);

  if (!detectedMime) {
    return NextResponse.json(
      { error: "Unsupported image type. Use JPEG, PNG, or WebP." },
      { status: 400 },
    );
  }

  let resized: Buffer;
  try {
    resized = await sharp(bytes)
      // Honor EXIF orientation before the cover-crop, same as avatars.
      .rotate()
      .resize(RACING_IMAGE_OUTPUT_SIZE, RACING_IMAGE_OUTPUT_SIZE, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process this image." }, { status: 400 });
  }

  const admin = createAdminClient();
  const path = `${randomUUID()}.webp`;

  const { error: uploadError } = await admin.storage.from("racing-images").upload(path, resized, {
    contentType: "image/webp",
    upsert: false,
  });

  if (uploadError) {
    return NextResponse.json({ error: "Could not upload image." }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = admin.storage.from("racing-images").getPublicUrl(path);

  return NextResponse.json({ imageUrl: publicUrl });
}
