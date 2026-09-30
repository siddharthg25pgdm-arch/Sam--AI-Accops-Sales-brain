import { brain } from "@/lib/brain-route";
import { listChanges } from "@/lib/brain";

/** GET /api/v1/brain/changes?since=&after=&entity=&limit=  - poll with the next cursor from the last response */
export async function GET(req: Request) { return brain(req, listChanges); }
