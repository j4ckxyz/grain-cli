import sharp from "sharp";

function unsupported(mimeType: string): never {
  throw new Error(`Cannot strip EXIF metadata for unsupported image type: ${mimeType}`);
}

export async function stripImageMetadata(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const normalized = mimeType.toLowerCase();
  const input = sharp(Buffer.from(bytes), { failOn: "none" }).rotate();

  let output: Buffer;
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      output = await input.jpeg({ quality: 95 }).toBuffer();
      break;
    case "image/png":
      output = await input.png().toBuffer();
      break;
    case "image/webp":
      output = await input.webp({ quality: 95 }).toBuffer();
      break;
    case "image/avif":
      output = await input.avif({ quality: 70 }).toBuffer();
      break;
    case "image/heif":
    case "image/heic":
      output = await input.heif({ quality: 90 }).toBuffer();
      break;
    case "image/gif":
      output = await input.gif().toBuffer();
      break;
    default:
      unsupported(mimeType);
  }

  return new Uint8Array(output);
}
