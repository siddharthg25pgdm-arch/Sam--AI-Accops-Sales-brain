import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

/** "Test the bot" (admin only): a plain host page that loads the REAL loader, so Siddharth sees what an LP visitor
 *  sees before the Citrix LP goes live. data-page makes answers use the LP's page group; /embed honours it only
 *  because SAM frames itself here (app/embed/bridge.ts selfFramed), and every chat started here is stored is_test. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Test the bot · SAM", robots: { index: false, follow: false } };

const LP = "https://accops-citrix-lp.vercel.app/";

export default async function TestTheBot() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.admin) redirect("/");
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "Barlow, system-ui, sans-serif", color: "#282828" }}>
      <p style={{ background: "#fff4e5", border: "1px solid #f3d19c", borderRadius: 8, padding: "10px 14px", fontSize: 14 }}>
        Test page: the chatbot below answers as it would on <a href={LP}>the Citrix LP</a>. Only approved answers appear; drafts
        don&apos;t. Test chats are marked as tests. <a href="/admin?tab=website">Back to the Website tab</a>
      </p>
      <h1 style={{ color: "#0f1e3a", fontSize: 36, margin: "40px 0 12px" }}>Moving off Citrix?</h1>
      <p style={{ fontSize: 18, lineHeight: 1.5 }}>Accops gives you secure remote access, VDI and DaaS without the Citrix renewal shock.</p>
      <p style={{ fontSize: 18, lineHeight: 1.5 }}>Open the chat at the bottom right, or wait 5 seconds after scrolling for the teaser.</p>
      <div style={{ height: "120vh" }} aria-hidden="true" />
      <script src="/embed.js" async data-teaser="5" data-page={LP} />
    </main>
  );
}
