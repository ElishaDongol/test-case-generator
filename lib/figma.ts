export interface FigmaImageResult {
  imageBase64: string;
  mediaType: string;
  nodeName: string;
}

function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  try {
    const u = new URL(url);
    // e.g. https://www.figma.com/design/FILE_KEY/... or /file/FILE_KEY/...
    const match = u.pathname.match(/\/(file|design)\/([a-zA-Z0-9]+)/);
    if (!match) return null;
    const fileKey = match[2];
    const nodeId = u.searchParams.get("node-id") ?? undefined;
    return { fileKey, nodeId };
  } catch {
    return null;
  }
}

export async function fetchFigmaImage(
  figmaUrl: string,
  figmaToken: string
): Promise<FigmaImageResult> {
  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed) throw new Error("Invalid Figma URL format");

  const { fileKey, nodeId } = parsed;

  // If a specific node is specified, export just that node as an image
  if (nodeId) {
    const encodedNodeId = nodeId.replace(/-/g, ":");
    const imgRes = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${encodedNodeId}&format=png&scale=2`,
      { headers: { "X-Figma-Token": figmaToken } }
    );
    if (!imgRes.ok) {
      const err = await imgRes.text();
      throw new Error(`Figma API error: ${imgRes.status} - ${err}`);
    }
    const imgData = await imgRes.json();
    const imageUrl = imgData.images?.[encodedNodeId];
    if (!imageUrl) throw new Error("Figma returned no image for that node");

    // Download the image
    const imgDownload = await fetch(imageUrl);
    const arrayBuffer = await imgDownload.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { imageBase64: base64, mediaType: "image/png", nodeName: nodeId };
  }

  // No node specified — get the file thumbnail or first page screenshot
  // Get file info to find the thumbnail
  const fileRes = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=1`, {
    headers: { "X-Figma-Token": figmaToken },
  });
  if (!fileRes.ok) {
    const err = await fileRes.text();
    throw new Error(`Figma API error: ${fileRes.status} - ${err}`);
  }
  const fileData = await fileRes.json();
  const thumbnailUrl = fileData.thumbnailUrl;
  if (!thumbnailUrl) throw new Error("No thumbnail available for this Figma file");

  const imgDownload = await fetch(thumbnailUrl);
  const arrayBuffer = await imgDownload.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = imgDownload.headers.get("content-type") ?? "image/png";

  return {
    imageBase64: base64,
    mediaType: contentType.startsWith("image/") ? contentType : "image/png",
    nodeName: fileData.name ?? "Figma Design",
  };
}
