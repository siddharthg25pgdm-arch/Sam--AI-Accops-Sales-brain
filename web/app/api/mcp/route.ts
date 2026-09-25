/** SAM as an MCP server (streamable HTTP) at /api/mcp. Same engine as the web app and the REST API.
 *  Auth: Authorization: Bearer <token> where the token is listed in SAM_API_TOKENS. The label becomes the user id in the dashboard.
 *  Client config (Claude Code / any MCP client):
 *    { "type": "http", "url": "https://sam-accops.vercel.app/api/mcp", "headers": { "Authorization": "Bearer <token>" } } */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { callerFromToken } from "@/lib/apiauth";
import { apiSearch, apiAsk, apiAssets, apiGaps, apiPublicLink, apiContextForAccount, apiRequestPublish } from "@/lib/api";
import { VERTICALS, PRODUCTS } from "@/lib/cards";
import { fileRequest } from "@/lib/requests";

export const maxDuration = 60;

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
// withMcpAuth sets req.auth, mcp-handler passes it to the SDK as fetch(req, { authInfo }), and SDK v2
// hands it to tools as ctx.http.authInfo - NOT ctx.authInfo, which is where v1 put it and where this
// used to look, so every authenticated call was logged as mcp-anonymous.
const who = (ctx: { http?: { authInfo?: { clientId?: string } } }) => ctx.http?.authInfo?.clientId ?? "mcp-anonymous";

const handler = createMcpHandler((server) => {
  server.registerTool("search_assets", {
    title: "Search collateral",
    description: "Search Accops sales and marketing collateral (case studies, whitepapers) with optional filters. Returns ranked asset cards with why each matched, visibility (internal/public), public_url (sendable) and internal_link (SharePoint, needs an Accops login, never forward outside Accops). Use audience=external to get only assets safe to send outside Accops.",
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
    description: "Ask SAM a question in natural language and get a short verdict plus up to three recommended assets with why-it-fits and links. When the exact thing is not in the library it says so, returns missing: true with up to two substitutes, and logs the gap; request_content then asks marketing to create it.",
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
    description: "Given an asset title or file path, return its public URL if one exists, or status private_only with where it sits in SharePoint (filename and folder) and a note not to forward it externally. For the SharePoint link itself, use internal_link from search_assets - internal only.",
    inputSchema: z.object({ asset: z.string().describe("Asset title or file path from a previous result") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ asset }) => text(apiPublicLink(asset)));

  // One of the two tools that write (with request_content). readOnlyHint stays FALSE deliberately: MCP clients use it to
  // decide what needs confirming, and marking a write read-only would let an agent file publish
  // requests on someone's behalf without asking. Idempotent because a repeat ask for the same asset
  // merges onto the existing open row rather than creating a second one.
  server.registerTool("request_publish", {
    title: "Request an asset be published",
    description: "Ask for an internal-only asset to be published so it can be sent to customers. Use when public_link returns private_only and the user needs something shareable. Say who it is for and why in the reason - that is what the approver reads.",
    inputSchema: z.object({
      asset: z.string().describe("Asset title from a previous result"),
      reason: z.string().optional().describe("Who needs it and why, in one line"),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ asset, reason }, extra) => text(await apiRequestPublish({ asset, reason }, who(extra), "mcp")));

  // Writes, so readOnlyHint is FALSE for the same reason as request_publish: a client must confirm
  // before filing on someone's behalf. Idempotent: a repeat ask adds nothing, the same rep counts once.
  server.registerTool("request_content", {
    title: "Ask marketing to create content",
    description: "When SAM has no asset for what the user needs (ask_sam returned missing or gap), ask marketing to create it. Repeat asks for the same thing merge; the result says how many people have asked. Use the user's words for what; put customer, deadline or why in note.",
    inputSchema: z.object({
      what: z.string().min(3).describe("The document wanted, in a few words, e.g. 'Remote browser isolation brochure'"),
      note: z.string().optional().describe("Customer, deadline or why, in one line"),
      question: z.string().optional().describe("The question originally asked of SAM, if different"),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ what, note, question }, extra) => text(await fileRequest({ title: what, note, question: question ?? what }, who(extra), "mcp")));

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
