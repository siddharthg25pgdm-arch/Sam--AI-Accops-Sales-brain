import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { cleanSection } from "@/app/embed/bridge";

/** "Test the bot" (admin only): a plain host page that loads the REAL loader, so Siddharth sees what an LP visitor
 *  sees before the Citrix LP goes live. data-page makes answers use the LP's page group; /embed honours it only
 *  because SAM frames itself here (app/embed/bridge.ts selfFramed), and every chat started here is stored is_test. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Test the bot · SAM", robots: { index: false, follow: false } };

const LP = "https://accops-citrix-lp.vercel.app/";
// The LP's sections (their ids, or the page cards' section-N): ?section= stands in for "the visitor is reading this part",
// passed as data-page's #anchor (this page has none of the LP's sections to observe).
const SECTIONS: [string, string][] = [["", "Top"], ["section-2", "Trust strip"], ["section-3", "Cost calculator"], ["comparison", "Comparison"],
  ["proof", "Proof"], ["migration", "Migration"], ["talk", "Talk"], ["faq", "FAQ"]];
const NEEDED = ["WEB_CHAT_ENABLED", "SAM_WEB_READER_JWT", "SAM_WEB_SUPABASE_APIKEY", "WEB_IP_SALT", "WEB_HS_SECRET"];

/** Why the launcher might be missing, said plainly instead of an empty page. Names only, never values. */
async function status() {
  const missing = NEEDED.filter(k => !process.env[k]);
  let approved: number | null = null;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sam_web_qa?select=id&status=eq.approved`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY ?? "", Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY ?? ""}` }, cache: "no-store" });
    if (r.ok) approved = (await r.json()).length;
  } catch { /* shown as unknown */ }
  return { missing, approved };
}

export default async function TestTheBot({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const section = cleanSection(sp.section);
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.admin) redirect("/");
  const { missing, approved } = await status();
  const ready = !missing.length && (approved ?? 0) > 0;
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "Barlow, system-ui, sans-serif", color: "#282828" }}>
      <p style={{ background: "#fff4e5", border: "1px solid #f3d19c", borderRadius: 8, padding: "10px 14px", fontSize: 14 }}>
        Test page: the chatbot below answers as it would on <a href={LP}>the Citrix LP</a>. Only approved answers appear; drafts
        don&apos;t. Test chats are marked as tests. <a href="/admin?tab=website">Back to the Website tab</a>
      </p>
      {!ready && (
        <div role="status" style={{ background: "#fdecec", border: "1px solid #f0b4b4", borderRadius: 8, padding: "12px 16px", fontSize: 15, marginTop: 12 }}>
          <strong>The chat button is hidden because the bot isn&apos;t switched on yet.</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
            <li>{missing.length ? <>Run <code>ops\web-enable.ps1</code> (missing: {missing.join(", ")}), then ask Claude to redeploy.</> : <>Switch-on settings: done.</>}</li>
            <li>{approved === null ? "Couldn't read the Q&A bank." : approved > 0 ? `${approved} answers approved.` : <>Approve answers in <a href="/admin?tab=website">Website → Approve Q&amp;A</a> (0 approved; drafts never show).</>}</li>
          </ol>
        </div>
      )}
      <p style={{ fontSize: 14, marginTop: 12 }}>
        Reading on the LP:{" "}
        {SECTIONS.map(([id, label], i) => (
          <span key={id}>{i > 0 && " · "}{id === section ? <strong>{label}</strong> : <a href={id ? `?section=${id}` : "?"}>{label}</a>}</span>
        ))}
        {" "}(the chat&apos;s suggested questions follow it; the teaser shows once per browser session)
      </p>
      <h1 style={{ color: "#0f1e3a", fontSize: 36, margin: "40px 0 12px" }}>Moving off Citrix?</h1>
      <p style={{ fontSize: 18, lineHeight: 1.5 }}>Accops gives you secure remote access, VDI and DaaS without the Citrix renewal shock.</p>
      <p style={{ fontSize: 18, lineHeight: 1.5 }}>Open the chat at the bottom right, or wait 5 seconds after scrolling for the teaser.</p>
      <div style={{ height: "120vh" }} aria-hidden="true" />
      <script src="/embed.js" async data-teaser="5" data-page={section ? `${LP}#${section}` : LP} />
    </main>
  );
}
