import type { Metadata } from "next";
import { Barlow } from "next/font/google";
import { notFound } from "next/navigation";
import "@/components/blocks/blocks.css";
import "./gallery.css";
import Gallery from "./Gallery";

// Internal design review surface for the website answer blocks (plan 9, Stream C). Never indexed, never linked.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--sb-font", display: "swap" });

export const metadata: Metadata = { title: "Answer blocks · gallery", robots: { index: false, follow: false } };

export default function Page() {
  // Shows proposed and blocked fixtures (e.g. the $132/$220 calculator): previews and local only, never production.
  if (process.env.VERCEL_ENV === "production") notFound();
  return <div className={barlow.variable}><Gallery /></div>;
}
