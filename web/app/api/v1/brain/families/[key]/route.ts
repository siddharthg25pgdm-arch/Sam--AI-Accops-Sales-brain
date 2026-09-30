import { brain } from "@/lib/brain-route";
import { getFamily } from "@/lib/brain";

/** GET /api/v1/brain/families/:key */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return brain(req, () => getFamily(decodeURIComponent(key)));
}
