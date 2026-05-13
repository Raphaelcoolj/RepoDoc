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

export async function fetchMarkdownFromUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch documentation from Cloudinary: ${response.status}`);
  }
  return response.text();
}
