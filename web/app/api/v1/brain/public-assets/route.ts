import { brain } from "@/lib/brain-route";
import { listPublic } from "@/lib/brain";

/** GET /api/v1/brain/public-assets?since=&limit=&offset=  - only what a customer may see (sam_v1_public_assets) */
export async function GET(req: Request) { return brain(req, listPublic); }
