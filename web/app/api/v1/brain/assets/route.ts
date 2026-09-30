import { brain } from "@/lib/brain-route";
import { listAssets } from "@/lib/brain";

export const maxDuration = 30;
/** GET /api/v1/brain/assets?q=&type=&industry=&product=&family=&visibility=&current=&eligible=&answerable=&carded=&since=&limit=&offset= */
export async function GET(req: Request) { return brain(req, listAssets); }
