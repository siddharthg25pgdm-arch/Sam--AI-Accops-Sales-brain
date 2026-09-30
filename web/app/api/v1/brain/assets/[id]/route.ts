import { brain } from "@/lib/brain-route";
import { getAsset } from "@/lib/brain";

/** GET /api/v1/brain/assets/:id  (id = asset_id, URL-encoded: id%3A01ABC... or path%3Apublic%2F...) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return brain(req, () => getAsset(decodeURIComponent(id)));
}
