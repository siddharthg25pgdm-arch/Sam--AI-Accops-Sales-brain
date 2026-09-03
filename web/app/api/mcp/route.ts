/** SAM as an MCP server (streamable HTTP) at /api/mcp. Same engine as the web app and the REST API.
 *  Auth: Authorization: Bearer <token> where the token is listed in SAM_API_TOKENS. The label becomes the user id in the dashboard.
 *  Client config (Claude Code / any MCP client):
 *    { "type": "http", "url": "https://sam-accops.vercel.app/api/mcp", "headers": { "Authorization": "Bearer <token>" } } */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { callerFromToken } from "@/lib/apiauth";
import { apiSearch, apiAsk, apiAssets, apiGaps, apiPublicLink, apiContextForAccount } from "@/lib/api";
import { VERTICALS, PRODUCTS } from "@/lib/cards";

export const maxDuration = 60;

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
// The SDK puts the verified AuthInfo on the handler context; the exact context type is not exported, so read it defensively.
const who = (extra: unknown) => (extra as { authInfo?: { clientId?: string } })?.authInfo?.clientId ?? "mcp-anonymous";

const handler = createMcpHandler((server) => {
  server.registerTool("search_assets", {
    title: "Search collateral",
    description: "Search Accops sales and marketing collateral (case studies, whitepapers) with optional filters. Returns ranked asset cards with why each matched, visibility (internal/public) and links. Use audience=external to get only assets safe to send outside Accops.",
    inputSchema: z.object({
      query: z.string().describe("Plain-language need: use case, competitor, regulator, persona"),
      vertical: z.enum(Object.keys(VERTICALS) as [string, ...string[]]).optional(),
      asset_type: z.enum(["Case Study", "Whitepaper"]).optional(),
      product: z.enum(PRODUCTS as [string, ...string[]]).optional(),
      audience: z.enum(["internal", "external"]).default("internal"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => text(await apiSearch(args, who(extra), "mcp")));

  server.registerTool("ask_sam", {
    title: "Ask SAM",
    description: "Ask SAM a question in natural language and get a short verdict plus up to three recommended assets with why-it-fits and links. Says plainly when nothing fits and logs the gap.",
    inputSchema: z.object({ question: z.string().min(3) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ question }, extra) => text(await apiAsk(question, who(extra), "mcp")));

  server.registerTool("list_catalogue", {
    title: "List catalogue",
    description: "List all assets, optionally filtered by vertical, type or product, with facet counts. Use this to browse rather than search.",
    inputSchema: z.object({ vertical: z.string().optional(), type: z.enum(["Case Study", "Whitepaper", "Other"]).optional(), product: z.string().optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => text(apiAssets(args)));

  server.registerTool("public_link", {
    title: "Get public link",
    description: "Given an asset title or file path, return its public URL if one exists, or status private_only with the internal SharePoint link and a note not to forward it externally.",
    inputSchema: z.object({ asset: z.string().describe("Asset title or file path from a previous result") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ asset }) => text(apiPublicLink(asset)));

  server.registerTool("content_gaps", {
    title: "Content gaps",
    description: "Industry × type × product combinations that have no collateral today, ranked by how often people have asked for them.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text({ gaps: await apiGaps() }));

  server.registerTool("context_for_account", {
    title: "Account brief",
    description: "For a target company and persona (e.g. from a LinkedIn profile open in the Dwight extension), return a short brief: which proof points to lead with, which assets are safe to send externally, and which are internal only.",
    inputSchema: z.object({
      company: z.string(), person_title: z.string().optional(), country: z.string().optional(),
      industry: z.string().optional().describe("If known, e.g. BFSI, Pharma, Government"), intent: z.string().optional().describe("e.g. first outreach, follow-up after demo"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => text(await apiContextForAccount(args, who(extra), "mcp")));
}, {
  serverInfo: { name: "sam-accops", version: "0.1.0" },
  instructions: "SAM finds Accops sales and marketing collateral. Prefer search_assets for 'find me X' and ask_sam when the user wants a recommendation with reasons. Never forward internal-only links outside Accops; check public_link first.",
});

const authed = withMcpAuth(handler, (_req, token) => {
  const c = callerFromToken(token ? `Bearer ${token}` : null);
  return c ? { token: token!, clientId: c.id, scopes: ["sam:read"] } : undefined;
}, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
