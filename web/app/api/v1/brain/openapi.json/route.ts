import { openapi } from "@/lib/brain";

/** GET /api/v1/brain/openapi.json - the OpenAPI 3.1 contract, public (it describes shapes, not data). Copy: docs/sales-brain-openapi.json */
export function GET() { return Response.json(openapi(), { headers: { "Cache-Control": "public, max-age=300" } }); }
