"""Agent runtime: the "Agent Runtime" box in the architecture. (The Google codelab diagram was the
shape reference only; SAM is built on Claude, not Gemini.)

Two implementations, chosen by environment:
  ANTHROPIC_API_KEY  -> ClaudeRuntime (Anthropic SDK tool runner, Claude Opus 5)
  no key             -> LocalRuntime  (no model; runs the search tool directly so the UI and data work)

Set SAM_RUNTIME=claude|local to force one. Both return the same shape:
  {"text": str, "trace": [ {"step": str, "detail": str} ... ], "runtime": str}
so app.py never needs to know which is behind it.
"""
from __future__ import annotations
import json, os, re, time, uuid
from dotenv import load_dotenv
import agent as sam_agent
from sam_tools import search_assets, list_catalog_summary, VERTICAL_SYNONYMS

load_dotenv()

def _choose() -> str:
    forced = os.getenv("SAM_RUNTIME", "").lower()
    if forced in {"claude", "local"}:
        return forced
    if os.getenv("ANTHROPIC_API_KEY"):
        return "claude"
    return "local"

# ---------------------------------------------------------------- Claude (Anthropic tool runner)
class ClaudeRuntime:
    name = "claude"
    def __init__(self) -> None:
        import anthropic
        from anthropic import beta_tool
        self.client = anthropic.Anthropic()
        self.model = os.getenv("CLAUDE_MODEL", "claude-opus-5")
        self.tools = [beta_tool(fn) for fn in sam_agent.TOOLS]
        self.histories: dict[str, list] = {}

    def ask(self, prompt: str, session_id: str) -> dict:
        t0 = time.time()
        history = self.histories.setdefault(session_id, [])
        history.append({"role": "user", "content": prompt})
        runner = self.client.beta.messages.tool_runner(
            model=self.model, max_tokens=4000, system=sam_agent.INSTRUCTION,
            tools=self.tools, messages=list(history),
            output_config={"effort": "medium"},
        )
        trace, final = [], None
        for message in runner:
            final = message
            for block in message.content:
                if block.type == "tool_use":
                    trace.append({"step": f"tool call: {block.name}", "detail": json.dumps(block.input, ensure_ascii=False)})
        text = "".join(b.text for b in (final.content if final else []) if b.type == "text").strip()
        history.append({"role": "assistant", "content": text or "(no text)"})
        usage = getattr(final, "usage", None)
        trace.append({"step": "model", "detail": f"{self.model} · {time.time()-t0:.1f}s · in {getattr(usage,'input_tokens','?')} / out {getattr(usage,'output_tokens','?')} tokens"})
        return {"text": text or "(no text returned)", "trace": trace, "runtime": self.name}

# ---------------------------------------------------------------- Local (no model)
class LocalRuntime:
    """Deterministic stand-in: crude slot extraction -> search tool -> templated answer.
    Exists so the flow can be demonstrated on a machine with no API key. Not the product."""
    name = "local"

    def ask(self, prompt: str, session_id: str) -> dict:
        t0 = time.time()
        p = prompt.lower()
        vertical = next((v for v, words in VERTICAL_SYNONYMS.items() if any(w in p for w in words)), "")
        asset_type = "Whitepaper" if re.search(r"white ?paper|guide|ebook", p) else ("Case Study" if re.search(r"case stud|proof|reference|customer", p) else "")
        product = next((x for x in ["ZTNA", "MFA", "VDI", "Nutanix", "HySecure", "HyID", "HyWorks", "BioAuth"] if x.lower() in p), "")
        audience = "external" if re.search(r"send|share|forward|customer-facing|public", p) else "internal"
        args = {"query": prompt, "asset_type": asset_type, "vertical": vertical, "product": product, "audience": audience, "limit": 3}
        trace = [{"step": "router (local heuristics)", "detail": json.dumps({k: v for k, v in args.items() if v and k != "query"})},
                 {"step": "tool call: search_assets", "detail": json.dumps(args, ensure_ascii=False)}]
        res = json.loads(search_assets(**args))
        if not res["results"] and (asset_type or product):
            args2 = {**args, "asset_type": "", "product": ""}
            trace.append({"step": "tool call: search_assets (relaxed)", "detail": json.dumps(args2, ensure_ascii=False)})
            res = json.loads(search_assets(**args2))
        trace.append({"step": "tool result", "detail": f"{len(res['results'])} of {res['total_considered']} assets"})
        if not res["results"]:
            text = "No asset matches that. Nothing in the Sales or Marketing library fits those filters. Try a broader industry or drop the product filter."
        else:
            lines = [f"{len(res['results'])} asset{'s' if len(res['results'])>1 else ''} fit{'s' if len(res['results'])==1 else ''} that ask" + (f" for {vertical.upper() if vertical=='bfsi' else vertical}" if vertical else "") + ":"]
            for r in res["results"]:
                link = r["public_url"] or r["sharepoint_url"] or "(no link)"
                vis = "public link" if r["public_url"] else "internal only, login required"
                fit = r["use_for"] or r["brief"] or r["why_match"]
                lines.append(f"\n**{r['title']}** ({r['asset_type']}, {r['industry']})  \n{fit}  \n{vis} · {link}")
            if audience == "external" and not any(r["public_url"] for r in res["results"]):
                lines.append("\nNone of these has a public version yet. Ask marketing to publish before sending externally.")
            text = "\n".join(lines)
        trace.append({"step": "model", "detail": f"none (local runtime) · {time.time()-t0:.2f}s"})
        return {"text": text, "trace": trace, "runtime": self.name}

def get_runtime():
    kind = _choose()
    try:
        if kind == "claude":
            return ClaudeRuntime()
    except Exception as e:  # missing package or bad key: degrade, but say so in the UI
        rt = LocalRuntime(); rt.degraded_reason = f"{kind} runtime failed to start: {e}"; return rt
    return LocalRuntime()

def new_session_id() -> str:
    return uuid.uuid4().hex[:12]

def _shorten(s: str, n: int = 600) -> str:
    return s if len(s) <= n else s[:n] + f"… (+{len(s)-n} chars)"

if __name__ == "__main__":
    rt = get_runtime()
    out = rt.ask("Need a case study for a bank replacing Citrix", new_session_id())
    print(out["runtime"]); print(out["text"]); print(json.dumps(out["trace"], indent=1))
