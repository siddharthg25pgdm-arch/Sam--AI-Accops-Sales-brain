import { searchRoute } from "@/lib/passages";

/** POST /api/v1/passages/search {query, k, audience, filters} (and GET ?q=): the same search as /api/v1/passages. */
export async function GET(req: Request) { return searchRoute(req); }
export async function POST(req: Request) { return searchRoute(req); }
