# Note: a "Needs you" inbox for SAM admin (parked, 28 Oct 2026)

**Status:** idea, parked by Siddharth on 28 Oct 2026 ("keep this in notes"). The website chatbot comes first.

**Inspiration:** CopilotKit OpenDuet (https://github.com/CopilotKit/OpenDuet, MIT). We are borrowing design patterns only. Its product doesn't fit: it's a self-hosted personal work agent that needs Docker, Postgres and containers, is in early development, and has no embeddable widget.

## The problem
Everything waiting on Siddharth is scattered:
- Excel review sheets: Q&A review, simplify review, old-assets review
- the Approve Q&A view and the Leads quarantine in the Website tab
- content requests
- Power Automate connections that need a sign-in (e.g. the Bookings connection for flow A)
- the morning digest

## Three patterns to borrow
1. **One "Needs you" inbox** in SAM admin: every pending decision as a card with a preview and inline actions (Approve / Edit / Retire / Release / Discard). It replaces the review spreadsheets. Examples: "4 new answers to approve", "28 simpler rewrites", "1 lead in quarantine", "Bookings connection needs sign-in".
2. **Status lanes: Working → Ready for review → Resolved.** Show what agents and nightly jobs are doing, what's ready for review, and what's done. Resolved items fold away.
3. **Setup checklist:** every dependency is Ready / Not checked / Needs setup. This covers PA flows on or off, connections authenticated, env vars present, notify_to pointing at the right person, and the nightly carding heartbeat.

Optional: OpenDuet's **Refuse / Allow once / Always allow** as standing approvals, e.g. auto-approve rewrites that only rephrase an approved answer without new facts.

## Not borrowed
The agent's own browser and workspace views, channels, and swipe gestures.
