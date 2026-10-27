import type { Metadata } from "next";
import { Barlow } from "next/font/google";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import "@/components/blocks/blocks.css"; // the one import of the block styles (contract notes: the host owns it)
import "./embed.css";
import { mintHs } from "@/lib/web/bot";
import { settings, webReady } from "@/lib/web/db";
import { cleanPage } from "@/lib/web/fill";
import { suggest } from "@/lib/web/suggest";
import { cleanSection, embedOrigins, ID, selfFramed } from "./bridge";
import Widget from "./Widget";

// The iframe the loader opens on first interaction (plan 7.2). Server-rendered: the starter questions for the page and
// the section being read (`sec`, suggest.ts) and a fresh handshake per request (hs = conv.issued.HMAC, minted by bot.ts
// so mint and verify share one secret).
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--sb-font", display: "swap" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ask Accops", robots: { index: false, follow: false } };

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Inert until the site is switched on (WEB_CHAT_ENABLED + the reader env + the handshake secret + settings.enabled).
  if (!webReady() || !process.env.WEB_HS_SECRET) notFound();
  const s = await settings().catch(() => null);
  if (!s?.enabled) notFound();

  const sp = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  // SAM framing its own /embed (the admin-only "Test the bot" page), proven by the browser's Sec-Fetch headers: a test
  // conversation ("t_", inside the hs MAC, so answer.ts logs is_test from it) and the only host whose `pg` page override
  // is honoured. Any other host's `pg` is ignored.
  // ponytail: no session check here (lib/auth is outside the web-guard boundary); a non-browser forging the headers
  // gains only what it already has (any `page` in the ask body) plus hiding its own chats from the dashboard.
  const test = selfFramed(await headers(), embedOrigins());
  const page = (test && cleanPage(one(sp.pg))) || cleanPage(one(sp.page));
  const q = String(one(sp.q) ?? "");
  const conversationId = `${test ? "t" : "c"}_${randomUUID()}`;
  const rows = await suggest(page, cleanSection(one(sp.sec))).catch(() => []);

  return (
    <div className={barlow.variable}>
      <Widget conversationId={conversationId} hs={mintHs(conversationId)} page={page} origins={embedOrigins()}
        starters={rows.filter(r => ID.test(r.id))}
        talk={{ label: cut(s.cta_label || "Talk to an expert", 28), url: (s.cta_url || "https://www.accops.com/schedule-a-free-demo").slice(0, 300) }}
        ask={ID.test(q) ? q : null} />
    </div>
  );
}
