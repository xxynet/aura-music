import { resolveUrl, getApiBase } from "./syncConfig";

export type UploadResult = {
  mediaId: string;
  url: string; // absolute or relative resolved URL usable by the browser
  contentType: string;
  filename: string;
};

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);

  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    mediaId: string;
    url: string;
    contentType: string;
    filename: string;
  };
  return {
    mediaId: data.mediaId,
    url: resolveUrl(data.url),
    contentType: data.contentType,
    filename: data.filename,
  };
}

export function dataUrlToFile(dataUrl: string, filename: string): File | null {
  try {
    const [header, base64] = dataUrl.split(",");
    if (!header || !base64) return null;
    const match = header.match(/data:([^;]+);base64/i);
    const mime = match?.[1] || "application/octet-stream";
    const needsExt = !/\.[a-z0-9]+$/i.test(filename);
    const ext =
      mime === "image/jpeg"
        ? ".jpg"
        : mime === "image/png"
          ? ".png"
          : mime === "image/webp"
            ? ".webp"
            : mime === "image/gif"
              ? ".gif"
              : "";
    const finalName = needsExt ? `${filename}${ext}` : filename;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], finalName, { type: mime });
  } catch {
    return null;
  }
}

