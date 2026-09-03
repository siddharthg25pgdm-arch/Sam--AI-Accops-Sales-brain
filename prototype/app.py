"""SAM prototype: the "Web Interface" box. Streamlit chat.

Run:   streamlit run app.py
Deploy: see README.md.
"""
from __future__ import annotations
import json
import streamlit as st
from runtime import get_runtime, new_session_id
from sam_tools import list_catalog_summary, load_cards

st.set_page_config(page_title="SAM · Accops sales & marketing brain", page_icon="◆", layout="wide")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
html, body, [class*="css"], .stMarkdown, .stChatMessage { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.sam-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-right:6px}
.sam-badge.claude{background:#EDE9FE;color:#6D28D9}.sam-badge.local{background:#FEF3C7;color:#B45309}
.sam-step{border-left:2px solid #CBD5E1;padding:4px 10px;margin:4px 0;font-size:13px}
.sam-step b{color:#0B2545}
.sam-step code{font-size:11.5px;white-space:pre-wrap;word-break:break-word}
h1{font-weight:800;letter-spacing:-.02em}
</style>
""", unsafe_allow_html=True)

# ---- state
if "runtime" not in st.session_state:
    st.session_state.runtime = get_runtime()
if "session_id" not in st.session_state:
    st.session_state.session_id = new_session_id()
if "messages" not in st.session_state:
    st.session_state.messages = []
rt = st.session_state.runtime

# ---- sidebar: library summary + runtime + architecture note
with st.sidebar:
    st.markdown("### Library")
    summary = json.loads(list_catalog_summary())
    st.metric("Assets indexed", summary["total"])
    by_type = sorted(summary["by_type"].items(), key=lambda kv: -kv[1])[:6]
    st.caption("By type")
    for k, v in by_type:
        st.write(f"{v} · {k}")
    st.divider()
    st.markdown("### Runtime")
    st.markdown(f'<span class="sam-badge {rt.name}">{rt.name.upper()}</span>', unsafe_allow_html=True)
    if rt.name == "claude":
        st.caption("Anthropic tool runner, Claude Opus 5.")
    else:
        st.caption("No model key found. Retrieval-only stand-in so the flow can be seen. Set ANTHROPIC_API_KEY in .env to enable the agent.")
    if getattr(rt, "degraded_reason", None):
        st.warning(rt.degraded_reason)
    st.divider()
    st.caption("Architecture: Web interface → Agent runtime → custom Python tool → local asset_cards.json → Claude API. "
               "Four boxes, same shape as the reference diagram, on Accops collateral.")
    if st.button("New conversation"):
        st.session_state.messages = []
        st.session_state.session_id = new_session_id()
        st.rerun()

# ---- header
st.title("SAM")
st.caption("Ask for collateral the way you'd ask a colleague. Example: *bank replacing Citrix, need a proof point* · "
           "*ZTNA whitepaper for pharma* · *can I send the BFSI case study to a customer?*")

# ---- history
for m in st.session_state.messages:
    with st.chat_message(m["role"]):
        st.markdown(m["content"])
        if m.get("trace"):
            with st.expander(f"How SAM got there · {len(m['trace'])} steps", expanded=False):
                for s in m["trace"]:
                    st.markdown(f'<div class="sam-step"><b>{s["step"]}</b><br><code>{s["detail"]}</code></div>', unsafe_allow_html=True)

# ---- input
if prompt := st.chat_input("What do you need?"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)
    with st.chat_message("assistant"):
        with st.spinner("Searching the library…"):
            try:
                out = rt.ask(prompt, st.session_state.session_id)
            except Exception as e:
                out = {"text": f"SAM hit an error talking to the model: {e}", "trace": [], "runtime": rt.name}
        st.markdown(out["text"])
        if out["trace"]:
            with st.expander(f"How SAM got there · {len(out['trace'])} steps", expanded=False):
                for s in out["trace"]:
                    st.markdown(f'<div class="sam-step"><b>{s["step"]}</b><br><code>{s["detail"]}</code></div>', unsafe_allow_html=True)
    st.session_state.messages.append({"role": "assistant", "content": out["text"], "trace": out["trace"]})
