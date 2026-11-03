import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadMarkdown(
  content: string,
  publicId: string
): Promise<string> {
  const buffer = Buffer.from(content, 'utf8');
  const base64 = buffer.toString('base64');
  const dataUri = `data:text/markdown;base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: 'raw',
    folder: 'repodoc',
    overwrite: true,
  });

  return result.secure_url;
}

export interface VersionedUploadResult {
  secureUrl: string;
  publicId: string;
}

export async function uploadMarkdownVersioned(
  content: string,
  slug: string,
  version: number
): Promise<VersionedUploadResult> {
  const publicId = `docs/${slug}/v${version}`;
  const buffer = Buffer.from(content, 'utf8');
  const dataUri = `data:text/markdown;base64,${buffer.toString('base64')}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: 'raw',
    overwrite: false,
  });

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id ?? publicId,
  };
}

export async function destroyPublicId(publicId: string): Promise<void> {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch {
    // best-effort cleanup: a leaked asset must never fail the request
  }
}

export async function fetchMarkdownFromUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch documentation from Cloudinary: ${response.status}`);
  }
  return response.text();
}

export function publicIdFromCloudinaryUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const marker = '/upload/';
    const idx = pathname.indexOf(marker);
    if (idx === -1) return '';
    let rest = pathname.slice(idx + marker.length);
    rest = rest.replace(/^v\d+\//, '');
    try {
      rest = decodeURIComponent(rest);
    } catch {
      // keep raw path if it is not valid percent-encoding
    }
    return rest;
  } catch {
    return '';
  }
}
