/** Client-safe shapes. No JSON import here, so client components never bundle the full card file. */
export type SlimAsset = {
  key: string; title: string; type: "Case Study" | "Whitepaper" | "Other"; asset_type: string; industry: string; vertical: string;
  products: string[]; use_for: string; brief: string; year: string | null; modified: string | null; stale: boolean;
  visibility: "internal" | "public"; link: string | null; location: string | null; ext: string | null; pages: number | null; inventoried: boolean;
};
export type Facets = { types: [string, number][]; verticals: [string, number][]; products: [string, number][]; years: [string, number][] };
export type Gap = { vertical: string; type: "Case Study" | "Whitepaper"; product?: string; asked?: number };
export type ChatAsset = { title: string; asset_type: string; industry: string; why: string; link: string | null; location: string | null; visibility: string; year: string | null; stale: boolean; path: string | null };
export type ChatTurn = { role: "user" | "assistant"; content: string; assets?: ChatAsset[]; trace?: { step: string; detail: string }[]; eventId?: number | null; runtime?: string; zero?: boolean; filters?: Record<string, string> };
