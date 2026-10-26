import type { NextConfig } from "next";
import path from "node:path";

// Website chatbot (plan 7.2): only /embed may be framed, and only by accops.com + the Citrix LP (+ WEB_EMBED_ORIGINS,
// e.g. an LP preview host). Same list as app/embed/bridge.ts EMBED_ORIGINS (web-widget.check proves they match).
// 'self' lets SAM frame its own /embed (the admin "Test the bot" page); the widget still talks only to listed origins.
// No X-Frame-Options anywhere; every other path is unchanged.
const EMBED_ORIGINS = ["https://www.accops.com", "https://accops.com", "https://accops-citrix-lp.vercel.app"];
const embedOrigins = () => [...new Set([...EMBED_ORIGINS, ...(process.env.WEB_EMBED_ORIGINS ?? "").split(",").map(s => s.trim())
  .filter(s => URL.canParse(s) && new URL(s).protocol === "https:" && new URL(s).origin === s)])];

const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname) },
  // SAM Live moved to its own app (github.com/siddharthg25pgdm-arch/sam-live); old links keep working.
  async redirects() {
    return [{ source: "/live/:path*", destination: "https://sam-live-nine.vercel.app/live/:path*", permanent: false }];
  },
  async headers() {
    return [{ source: "/embed", headers: [
      { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${embedOrigins().join(" ")}` },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }];
  },
};

export default nextConfig;
