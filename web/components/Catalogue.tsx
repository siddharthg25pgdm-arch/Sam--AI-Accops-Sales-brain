"use client";
import { useEffect, useMemo, useState } from "react";
import type { SlimAsset, Facets, Gap } from "@/lib/types";

type View = "all" | "latest" | "missing";

export function Catalogue({ assets, facets, gaps, prefill }: { assets: SlimAsset[]; facets: Facets; gaps: Gap[]; prefill: { vertical?: string; type?: string; product?: string } | null }) {
  const [view, setView] = useState<View>("all");
  const [type, setType] = useState<string | null>(null);
  const [vertical, setVertical] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!prefill) return;
    setView("all"); setType(prefill.type ?? null); setVertical(prefill.vertical ?? null); setProduct(prefill.product ?? null); setYear(null); setQ("");
  }, [prefill]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    let list = assets.filter(a =>
      (!type || a.type === type) && (!vertical || a.vertical === vertical) && (!product || a.products.includes(product)) &&
      (!year || (a.year ?? "undated") === year) &&
      (!ql || `${a.title} ${a.industry} ${a.use_for} ${a.brief} ${a.products.join(" ")}`.toLowerCase().includes(ql)));
    if (view === "latest") list = [...list].sort((x, y) => (y.modified ?? "").localeCompare(x.modified ?? "")).slice(0, 18);
    return list;
  }, [assets, type, vertical, product, year, q, view]);

  const shelves = useMemo(() => {
    if (view === "latest") return [["Most recently added to the library", filtered] as const];
    const groupBy = vertical ? (a: SlimAsset) => a.type : (a: SlimAsset) => a.vertical;
    const m = new Map<string, SlimAsset[]>();
    for (const a of filtered) m.set(groupBy(a), [...(m.get(groupBy(a)) ?? []), a]);
    return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
  }, [filtered, view, vertical]);

  const any = type || vertical || product || year || q;
  function clear() { setType(null); setVertical(null); setProduct(null); setYear(null); setQ(""); }

  return (
    <>
      <div className="cat-head">
        <div><h2>Catalogue</h2><p>{assets.length} assets from the Sales and Marketing libraries. Filters combine.</p></div>
        <div className="views" role="group" aria-label="View">
          <button aria-pressed={view === "all"} onClick={() => setView("all")}>All</button>
          <button aria-pressed={view === "latest"} onClick={() => setView("latest")}>Latest</button>
          <button aria-pressed={view === "missing"} onClick={() => setView("missing")}>Not available</button>
        </div>
      </div>

      {view !== "missing" && (
        <>
          <input className="cat-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by title, client type, use…" aria-label="Filter catalogue" />
          <div className="facets">
            <Facet label="Type" items={facets.types} value={type} onChange={setType} />
            <Facet label="Industry" items={facets.verticals} value={vertical} onChange={setVertical} />
            <Facet label="Product" items={facets.products.slice(0, 9)} value={product} onChange={setProduct} />
            <Facet label="Year" items={facets.years} value={year} onChange={setYear} />
            {any && <div><button className="chip" onClick={clear}>Clear all</button></div>}
          </div>
          {filtered.length === 0 && <div className="empty">Nothing matches those filters. Clear one, or check "Not available" to see whether this is a known gap.</div>}
          {shelves.map(([name, list]) => (
            <div className="shelf" key={name}>
              <h3>{name} <span>{list.length}</span></h3>
              <div className="grid">{list.map(a => <Doc key={a.key} a={a} />)}</div>
            </div>
          ))}
        </>
      )}

      {view === "missing" && (
        <>
          <p style={{ color: "var(--ink-3)", margin: "0 0 12px", fontSize: 13.5 }}>
            Combinations a salesperson could ask for that have no asset today. Solid red border means someone has actually asked SAM for it.
          </p>
          <div className="gaps">
            {gaps.map(g => (
              <div key={`${g.vertical}-${g.type}-${g.product ?? ""}`} className={`gap${g.asked ? " asked" : ""}`}>
                <b>{g.vertical} · {g.product ? `${g.product} ` : ""}{g.type.toLowerCase()}</b>
                <small>{g.asked ? `asked ${g.asked} time${g.asked === 1 ? "" : "s"}` : "never asked yet"}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Facet({ label, items, value, onChange }: { label: string; items: [string, number][]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="facet">
      <span className="k">{label}</span>
      {items.map(([k, n]) => <button key={k} className="chip" aria-pressed={value === k} onClick={() => onChange(value === k ? null : k)}>{k} <span className="n">{n}</span></button>)}
    </div>
  );
}

function Doc({ a }: { a: SlimAsset }) {
  function opened() { fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: a.key, source: "catalogue" }) }); }
  return (
    <a className="doc" data-type={a.type} href={a.link ?? "#"} target="_blank" rel="noreferrer" onClick={opened}>
      <div className="spine" aria-hidden="true"><span>{a.year ?? a.ext?.toUpperCase() ?? ""}</span></div>
      <div className="body">
        <b>{a.title}</b>
        <small>{a.asset_type}{a.industry ? ` · ${a.industry}` : ""}{a.pages ? ` · ${a.pages} pages` : ""}</small>
        {(a.use_for || a.brief) && <p>{a.use_for || a.brief}</p>}
        <div className="tags">
          <span className={`tag ${a.visibility}`}>{a.visibility === "public" ? "Public link" : "Internal only"}</span>
          {a.stale && <span className="tag stale">Older than 2 years</span>}
          {!a.inventoried && <span className="tag gap">Not in inventory</span>}
        </div>
      </div>
    </a>
  );
}
