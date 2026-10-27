import { handleBooking } from "@/lib/web-leads";

// A DNS lookup (2 s), two PostgREST calls and the forward to the Website Leads flow (8 s).
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** POST /api/v1/leads/booking: one Microsoft Bookings appointment from the Power Automate flow, server-to-server,
 *  `Authorization: Bearer <WEB_LEAD_SECRET>`. Checked, stored, forwarded only when clean (lib/web-leads.ts).
 *  Contract and flow spec: docs/plans/web-stage3-leads-runbook.md. Outside the website boundary on purpose: it uses the
 *  service key, and nothing the website serves may (scripts/web-guard.mjs). */
export function POST(req: Request) {
  return handleBooking(req);
}
