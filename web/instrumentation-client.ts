// Vercel BotID (Basic, plan 2.3): attaches its signal headers to the widget's asks; /api/web/ask calls checkBotId().
// Only the /embed iframe loads it, so the admin app and other pages carry no BotID script. Vercel routes the
// challenge requests itself (no withBotId in next.config). Verify on a preview: local dev always says human.
import { initBotId } from "botid/client/core";

if (location.pathname.startsWith("/embed")) initBotId({ protect: [{ path: "/api/web/ask", method: "POST" }] });
