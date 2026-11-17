import sharp from 'sharp';

export async function toJpeg(buffer) {
  try { return await sharp(buffer).jpeg({ quality: 90 }).toBuffer(); } catch { return buffer; }
}
