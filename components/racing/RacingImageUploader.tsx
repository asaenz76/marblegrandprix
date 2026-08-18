"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Racing Phase 16: controlled uploader for a competition/race rounded icon.
 * Posts the file to the operator-only /api/racing-image route (which validates,
 * resizes to a square WebP, and returns a public URL) and hands the URL back
 * via onChange. The browser never writes storage directly. Purely a URL
 * producer — the caller decides how to persist it (create-form state, or an
 * edit action).
 */
export function RacingImageUploader({
  value,
  onChange,
  label = "image",
  disabled = false,
}: {
  value: string | null;
  onChange: (url: string | null) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch("/api/racing-image", { method: "POST", body: formData });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error ?? "Could not upload image.");
        return;
      }
      await onChange(result.imageUrl as string);
    } catch {
      setError("Could not upload image. Try again.");
    } finally {
      setPending(false);
      e.target.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="size-12 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-border-subtle text-xs text-text-muted">
          None
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || disabled}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? "Uploading…" : value ? `Change ${label}` : `Upload ${label}`}
          </Button>
          {value && !pending && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
