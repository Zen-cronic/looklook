import sharp from "sharp";
import { sniffMediaType, type ImageMediaType } from "./read";

/**
 * Phone screenshots arrive large: a full-screen iPhone PNG is often 3 to 8 MB,
 * and a scrolling capture can be taller than the reader accepts. The reader
 * takes images up to 5 MB once base64-encoded and scales anything with a long
 * edge over 1568 px down to that size itself, so a big image is scaled to
 * 1568 px here and sent as a JPEG. Smaller images pass through untouched (the
 * same bytes, so their cached readings still match).
 */

/** The largest image we accept from a phone or the upload box, before it is made smaller. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Images up to this size and edge are read as they are (base64 stays under the reader's 5 MB). */
export const READ_AS_IS_BYTES = 3.5 * 1024 * 1024;
export const READ_AS_IS_EDGE = 4000;
/** The reader's own working size: a bigger image is scaled to this long edge. */
export const READ_EDGE = 1568;

/** HEIC/HEIF (iPhone camera photos): the "ftyp" box with a HEIF brand. */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const box = String.fromCharCode(...bytes.slice(4, 12));
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(box);
}

export type FitError = "type" | "heif" | "too-big";

export class ImageFitError extends Error {
  constructor(readonly code: FitError) {
    super(code);
    this.name = "ImageFitError";
  }
}

/**
 * The image as the reader should get it: unchanged when it is small enough,
 * otherwise scaled to READ_EDGE on its long edge and re-encoded as JPEG.
 * Throws ImageFitError for HEIC, for anything that isn't PNG/JPEG/GIF/WebP,
 * and for a file over MAX_UPLOAD_BYTES.
 */
export async function fitForReading(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mediaType: ImageMediaType; resized: boolean }> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ImageFitError("too-big");
  if (isHeif(bytes)) throw new ImageFitError("heif");
  const mediaType = sniffMediaType(bytes);
  if (!mediaType) throw new ImageFitError("type");
  let edge: number | undefined;
  try {
    const meta = await sharp(bytes).metadata();
    edge = Math.max(meta.width ?? 0, meta.pageHeight ?? meta.height ?? 0);
  } catch {
    // Not decodable here; a small file is passed on and the reader says if it can't read it.
    edge = undefined;
  }
  const small = bytes.byteLength <= READ_AS_IS_BYTES && (edge === undefined || edge <= READ_AS_IS_EDGE);
  if (small) return { bytes, mediaType, resized: false };
  if (edge === undefined) throw new ImageFitError("type");
  const out = await sharp(bytes, { animated: false })
    .rotate()
    .resize({ width: READ_EDGE, height: READ_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { bytes: new Uint8Array(out), mediaType: "image/jpeg", resized: true };
}
