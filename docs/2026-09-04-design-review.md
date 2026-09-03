# Design Review: SAM (design v0.2 + query flow simulation)
Reviewed 2026-09-04 using the Steve Jobs review protocol. Subject: the product as designed, judged through the simulation, the only working artifact so far.

**Verdict:** NOT DONE (score 6/10, 4 of 7 diagnostic rows pass)
**The One Thing:** A salesperson types what they need and gets the right file, safe for the audience, in one reply.
**Keeps its promise?** On paper, yes. Every simulated scenario reaches the right asset in one turn and the private/public rule holds. But the promise is untested against real SharePoint files, so the answer is "not yet proven".

Diagnostic rows:
- One Thing in one sentence: PASS
- Core value in 3 steps or fewer: PASS (open channel, type, read)
- Reviewer experienced it cold: PASS (opened the simulation with no walkthrough, pressed Play)
- Working demo on the real device: FAIL (a simulation of an engine that does not exist yet; Teams and WhatsApp are mock frames)
- Something removed this cycle: PASS (Slack, CRM writes, per-user permission trimming, generated collateral, OpenWA in production were all cut)
- Error, empty, edge states at hero quality: FAIL (the gap scenario is designed, but timeouts, "SharePoint is down", unverified WhatsApp numbers, and "I found 40 matches" have no designed response)
- Team would proudly use it daily: FAIL (nobody has used it)

**Cut list:**
- The "Draft the competitor slide" follow-up chip. Drafting is Phase 2 and showing it in a Phase 1 reply over-promises.
- Speed selector in the simulator. Nobody needs 1x. Default to 2x and remove the control.
- Six "sources touched" rows collapse to three that matter to a buyer of this idea: index, public registry, live SharePoint.

**Fix list:**
1. Replace the simulation with a Phase 0 demo on real files: run the asset-card generator over the 66 PDFs already on disk and show the card table. That single demo retires the biggest risk (can Claude tag Accops collateral as well as the hand inventory?) and converts the FAIL on "working demo".
2. Design the four missing failure replies before Phase 1 code: too many matches (ask one narrowing question, never list 40), SharePoint unreachable (answer from index, say so, offer to retry), unverified WhatsApp sender (one-line refusal with the verification step), and an asset that is stale and private (badge plus owner name, not silence).
3. In the WhatsApp reply, put the public link first and the SharePoint link last, always. The simulation does this by accident in one scenario; make it a composer rule.
4. Every asset card in a reply needs one line of "why", never more. Two of the simulated cards run to two sentences. Cap it.
5. The simulator header wraps to two rows on a 1440px screen. Move the scenario chips below the title bar into their own row.

**Back of the fence:**
- The follow-up nudge (T6) copy is undesigned. "Did this help?" a day later from a bot is the surface most likely to make reps mute SAM. Write it as one tap, no text reply needed.
- The publish-request approval card that marketing sees (T5) has no design at all, and it is the moment SAM earns marketing's trust.
- The MCP JSON payload includes a confidence score with no definition of what 0.82 means to the extension. Define it or drop it.
