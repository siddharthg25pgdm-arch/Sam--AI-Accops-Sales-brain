import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname) },
  // SAM Live moved to its own app (github.com/siddharthg25pgdm-arch/sam-live); old links keep working.
  async redirects() {
    return [{ source: "/live/:path*", destination: "https://sam-live-nine.vercel.app/live/:path*", permanent: false }];
  },
};

export default nextConfig;
