-- Accops brain: shared reference lists. Project iwqhayuoxnrhqzozznes (shared by SAM, PRM, ADI, the
-- certificate tool and the marketing dashboard).
--
-- One master list per facet (industry, asset type, product, competitor) that every app points to,
-- instead of each app inventing its own spelling. A term has one label (what apps store and show)
-- and any number of aliases (lower-case spellings that mean the same thing). core.canon() turns any
-- spelling into the label, or null when the brain does not know it.
--
-- Additive only: nothing existing is altered. Wiring an app to the lists (normalising its values,
-- refusing unknown ones) is a separate migration per app.
--
-- Facets are data, not schema: a new app adds rows for a new facet ('region', 'persona'), no DDL.
-- Labels for industry deliberately match SAM's web app (web/lib/cards.ts VERTICALS) so SAM needs no
-- code change: Defence sits under Government, BPO under IT / ITeS, exactly as the app already does.

create schema if not exists core;
comment on schema core is 'Accops brain: shared reference data every app points to.';

create table if not exists core.terms (
  facet       text not null,                  -- industry | asset_type | product | competitor | ...
  label       text not null,                  -- the one spelling apps store and display
  aliases     text[] not null default '{}',   -- lower-case variants that map to this label
  kind        text,                           -- optional sub-group, e.g. product: accops | capability | partner
  description text not null default '',
  sort        int not null default 100,
  active      boolean not null default true,
  primary key (facet, label)
);
alter table core.terms enable row level security;
-- An alias may point to one label only, per facet, or canon() would be ambiguous.
create or replace function core.alias_conflicts() returns table (facet text, alias text, labels text[])
language sql stable set search_path = '' as $$
  select t.facet, a, array_agg(t.label order by t.label)
  from core.terms t, unnest(t.aliases || lower(t.label)) a
  group by t.facet, a having count(distinct t.label) > 1
$$;

create or replace function core.canon(p_facet text, p_raw text) returns text
language sql stable set search_path = '' as $$
  select t.label from core.terms t
  where t.facet = p_facet and t.active
    and (lower(t.label) = lower(btrim(p_raw)) or lower(btrim(p_raw)) = any (t.aliases))
  order by t.sort limit 1
$$;

grant usage on schema core to service_role;
grant select on core.terms to service_role;
grant execute on function core.canon(text, text), core.alias_conflicts() to service_role;
revoke all on function core.canon(text, text), core.alias_conflicts() from public, anon, authenticated;

-- REST-readable copy for apps (PostgREST exposes only `public`). Service role only.
create or replace view public.core_terms with (security_invoker = true) as
  select facet, label, aliases, kind, description, sort from core.terms where active;
revoke all on public.core_terms from anon, authenticated;
grant select on public.core_terms to service_role;

-- ------------------------------------------------------------------ seed
insert into core.terms (facet, label, aliases, sort) values
  ('industry', 'BFSI', '{bfsi,banking,bank,"banking (private sector)","banking (public sector)","financial services",insurance,nbfc,"capital markets"}', 10),
  ('industry', 'Government', '{government,govt,"government & defence","government and defence",defence,defense,psu,"public sector"}', 20),
  ('industry', 'Pharma / Healthcare', '{pharma,healthcare,"healthcare & pharma","life sciences",hospital}', 30),
  ('industry', 'Manufacturing', '{automotive,industrial}', 40),
  ('industry', 'IT / ITeS', '{"it & ites",it/ites,ites,"it services","it services / consulting","bpm / bpo",bpo,"ites / content services",gcc}', 50),
  ('industry', 'Education', '{edtech,university}', 60),
  ('industry', 'E-commerce / Retail', '{retail,e-commerce,ecommerce,"logistics / e-commerce",logistics}', 70),
  ('industry', 'Media', '{"media & entertainment",broadcast}', 80),
  ('industry', 'Telecom', '{telco}', 90),
  ('industry', 'Cross-industry', '{"cross industry","all industries",horizontal}', 99),

  ('asset_type', 'Deck', '{presentation,ppt}', 10),
  ('asset_type', 'Battlecard', '{competitive,competition,comparison,"battle card"}', 20),
  ('asset_type', 'Case Study', '{"success story"}', 30),
  ('asset_type', 'Whitepaper', '{"white paper"}', 40),
  ('asset_type', 'Brochure', '{}', 50),
  ('asset_type', 'Datasheet', '{"data sheet"}', 55),
  ('asset_type', 'Solution Document', '{"solution brief","solution overview"}', 60),
  ('asset_type', 'Technical Guide', '{"integration guide","deployment guide"}', 65),
  ('asset_type', 'Analyst Report', '{}', 70),
  ('asset_type', 'Third-Party Research', '{}', 71),
  ('asset_type', 'Sample Report', '{}', 72),
  ('asset_type', 'Proposal', '{rfp,rfi}', 75),
  ('asset_type', 'Pricing', '{"price list"}', 76),
  ('asset_type', 'Product Info', '{}', 77),
  ('asset_type', 'Roadmap', '{}', 78),
  ('asset_type', 'FAQ', '{}', 79),
  ('asset_type', 'eBook', '{}', 80),
  ('asset_type', 'Certification', '{certificate}', 81),
  ('asset_type', 'Regulation', '{}', 82),
  ('asset_type', 'Brand', '{"brand guidelines","brand files"}', 83),
  ('asset_type', 'Event', '{"event publication",roadshow}', 84),
  ('asset_type', 'Webinar', '{}', 85),
  ('asset_type', 'Video', '{}', 86),
  ('asset_type', 'Demo', '{}', 87),
  ('asset_type', 'Press Coverage', '{}', 88),
  ('asset_type', 'Template', '{}', 89),
  ('asset_type', 'Sales Tool', '{}', 90),
  ('asset_type', 'Other', '{}', 99)
on conflict (facet, label) do nothing;

-- Products: Accops lines, the capabilities reps search by, and partner products.
insert into core.terms (facet, label, aliases, kind) values
  ('product', 'HySecure', '{}', 'accops'), ('product', 'HyID', '{}', 'accops'), ('product', 'HyWorks', '{}', 'accops'),
  ('product', 'HyLabs', '{}', 'accops'), ('product', 'HyDesk', '{}', 'accops'), ('product', 'HyMobile', '{}', 'accops'),
  ('product', 'HyLite', '{}', 'accops'), ('product', 'HyServe', '{}', 'accops'), ('product', 'BioAuth', '{biometric}', 'accops'),
  ('product', 'Biometric Server', '{}', 'accops'), ('product', 'Reporting Server', '{}', 'accops'), ('product', 'Huddle', '{}', 'accops'),
  ('product', 'Nano', '{}', 'accops'), ('product', 'NanoOS', '{}', 'accops'), ('product', 'AirBridge', '{}', 'accops'),
  ('product', 'Enterprise Browser', '{}', 'accops'), ('product', 'Virtual Browser', '{}', 'accops'),
  ('product', 'Vajra Browser', '{vajra}', 'accops'), ('product', 'Turbo', '{"hysecure turbo"}', 'accops'),
  ('product', 'Photon', '{}', 'accops'), ('product', 'Spectra', '{}', 'accops'), ('product', 'GlassFence', '{}', 'accops'),
  ('product', 'IRIS', '{}', 'accops'), ('product', 'Launchpad', '{}', 'accops'), ('product', 'Data-less PC', '{"dataless pc"}', 'accops'),
  ('product', 'Accops SSE', '{}', 'accops'), ('product', 'Accops Managed Desktops', '{}', 'accops'), ('product', 'AccopsNext', '{}', 'accops'),
  ('product', 'Thin Clients', '{"thin client"}', 'accops'), ('product', 'Password Vault', '{}', 'accops'), ('product', 'CMS', '{}', 'accops'),
  ('product', 'ZTNA', '{}', 'capability'), ('product', 'MFA', '{2fa,multi-factor}', 'capability'), ('product', 'SSO', '{}', 'capability'),
  ('product', 'VDI', '{"virtual desktop"}', 'capability'), ('product', 'DaaS', '{"desktop as a service"}', 'capability'),
  ('product', 'Digital Workspace', '{}', 'capability'), ('product', 'Browser Isolation', '{"remote browser isolation",rbi}', 'capability'),
  ('product', 'UEM', '{}', 'capability'), ('product', 'MDM', '{}', 'capability'), ('product', 'IAM', '{}', 'capability'),
  ('product', 'Password-less', '{passwordless}', 'capability'), ('product', 'FIDO', '{}', 'capability'), ('product', 'DLP', '{}', 'capability'),
  ('product', 'Reverse Proxy Gateway', '{}', 'capability'), ('product', 'PCoIP', '{}', 'capability'),
  ('product', 'Nutanix', '{}', 'partner'), ('product', 'Nutanix AHV', '{}', 'partner'), ('product', 'Nutanix Flow', '{}', 'partner'),
  ('product', 'Nutanix Prism', '{}', 'partner'), ('product', 'Nutanix Files', '{}', 'partner'), ('product', 'Proxmox', '{}', 'partner'),
  ('product', 'Forcepoint SSE', '{}', 'partner'), ('product', 'Forcepoint SWG', '{}', 'partner'), ('product', 'Forcepoint CASB', '{}', 'partner'),
  ('product', 'Forcepoint DLP', '{}', 'partner'), ('product', 'Forcepoint DSPM', '{}', 'partner'),
  ('product', 'JioBook', '{}', 'partner'), ('product', 'JioPC', '{}', 'partner'), ('product', 'Jio Innopia', '{jio-innopia}', 'partner'),
  ('product', 'NComputing LeafOS', '{}', 'partner')
on conflict (facet, label) do nothing;

-- Competitors: vendors as carded, true synonyms folded. Protocols the cards list (IPsec, WireGuard...)
-- are kept with kind 'technology' so an app can leave them out of vendor views.
insert into core.terms (facet, label, aliases, kind) values
  ('competitor', 'Citrix', '{}', 'vendor'), ('competitor', 'VMware', '{"broadcom vmware","vmware horizon",horizon}', 'vendor'),
  ('competitor', 'Omnissa', '{}', 'vendor'), ('competitor', 'Broadcom', '{}', 'vendor'), ('competitor', 'Microsoft', '{}', 'vendor'),
  ('competitor', 'Azure Virtual Desktop', '{"microsoft avd","microsoft wvd",avd,wvd}', 'vendor'), ('competitor', 'Windows 365', '{}', 'vendor'),
  ('competitor', 'Azure AD', '{"microsoft azure ad","entra id","microsoft entra id"}', 'vendor'), ('competitor', 'ADFS', '{}', 'vendor'),
  ('competitor', 'Microsoft Authenticator', '{}', 'vendor'), ('competitor', 'Microsoft Hyper-V', '{hyper-v}', 'vendor'),
  ('competitor', 'AWS', '{"amazon web services"}', 'vendor'), ('competitor', 'AWS WorkSpaces', '{"amazon workspaces"}', 'vendor'),
  ('competitor', 'Google', '{}', 'vendor'), ('competitor', 'Google Authenticator', '{}', 'vendor'), ('competitor', 'Alibaba Cloud', '{}', 'vendor'),
  ('competitor', 'Zscaler', '{}', 'vendor'), ('competitor', 'Okta', '{}', 'vendor'), ('competitor', 'OneLogin', '{}', 'vendor'),
  ('competitor', 'Ping Identity', '{}', 'vendor'), ('competitor', 'ForgeRock', '{}', 'vendor'), ('competitor', 'SecureAuth', '{}', 'vendor'),
  ('competitor', 'Auth0', '{}', 'vendor'), ('competitor', 'One Identity', '{}', 'vendor'), ('competitor', 'WSO2', '{}', 'vendor'),
  ('competitor', 'RSA', '{}', 'vendor'), ('competitor', 'Vasco', '{onespan}', 'vendor'), ('competitor', 'Thales', '{}', 'vendor'),
  ('competitor', 'Cisco', '{}', 'vendor'), ('competitor', 'Cisco Duo', '{duo}', 'vendor'), ('competitor', 'Cisco AnyConnect', '{anyconnect}', 'vendor'),
  ('competitor', 'Cisco Webex', '{webex}', 'vendor'), ('competitor', 'Palo Alto Networks', '{"palo alto"}', 'vendor'),
  ('competitor', 'Fortinet', '{}', 'vendor'), ('competitor', 'Check Point', '{checkpoint}', 'vendor'), ('competitor', 'F5', '{}', 'vendor'),
  ('competitor', 'Forcepoint', '{}', 'vendor'), ('competitor', 'Netskope', '{}', 'vendor'), ('competitor', 'Akamai', '{}', 'vendor'),
  ('competitor', 'SonicWall', '{}', 'vendor'), ('competitor', 'WatchGuard', '{}', 'vendor'), ('competitor', 'Pulse Secure', '{ivanti}', 'vendor'),
  ('competitor', 'Array Networks', '{}', 'vendor'), ('competitor', 'Appgate', '{}', 'vendor'), ('competitor', 'Cloudbrink', '{}', 'vendor'),
  ('competitor', 'McAfee', '{}', 'vendor'), ('competitor', 'SSE vendors', '{}', 'vendor'),
  ('competitor', 'AnyDesk', '{}', 'vendor'), ('competitor', 'TeamViewer', '{}', 'vendor'),
  ('competitor', 'Nutanix', '{}', 'vendor'), ('competitor', 'Nutanix Frame', '{frame}', 'vendor'), ('competitor', 'Parallels', '{"parallels ras"}', 'vendor'),
  ('competitor', 'Workspot', '{}', 'vendor'), ('competitor', 'Teradici', '{}', 'vendor'), ('competitor', 'Ericom', '{}', 'vendor'),
  ('competitor', 'Dizzion', '{}', 'vendor'), ('competitor', 'Apporto', '{}', 'vendor'), ('competitor', 'dinCloud', '{}', 'vendor'),
  ('competitor', 'Flexxible', '{}', 'vendor'), ('competitor', 'IronOrbit', '{}', 'vendor'), ('competitor', 'V2 Cloud', '{}', 'vendor'),
  ('competitor', 'Inuvika', '{}', 'vendor'), ('competitor', 'Systancia', '{}', 'vendor'), ('competitor', 'Anunta', '{}', 'vendor'),
  ('competitor', 'Zettagrid', '{}', 'vendor'), ('competitor', 'oneclick', '{}', 'vendor'), ('competitor', 'Apache VCL', '{}', 'vendor'),
  ('competitor', 'Red Hat OpenStack', '{}', 'vendor'), ('competitor', 'NComputing', '{}', 'vendor'), ('competitor', 'Scalefusion', '{}', 'vendor'),
  ('competitor', 'Dell', '{}', 'vendor'), ('competitor', 'HP', '{}', 'vendor'), ('competitor', 'Fujitsu', '{}', 'vendor'),
  ('competitor', 'IBM', '{}', 'vendor'), ('competitor', 'Oracle', '{}', 'vendor'), ('competitor', 'Huawei', '{}', 'vendor'),
  ('competitor', 'Hikvision', '{}', 'vendor'), ('competitor', 'Neurotechnology', '{}', 'vendor'), ('competitor', 'Safran Morpho', '{morpho}', 'vendor'),
  ('competitor', 'Idemia', '{}', 'vendor'), ('competitor', 'Ameyo', '{}', 'vendor'), ('competitor', 'Avaya', '{}', 'vendor'),
  ('competitor', 'Genesys', '{}', 'vendor'), ('competitor', 'ATSG', '{}', 'vendor'), ('competitor', 'Infosys Finacle', '{finacle}', 'vendor'),
  ('competitor', 'IPsec', '{}', 'technology'), ('competitor', 'OpenVPN', '{}', 'technology'), ('competitor', 'WireGuard', '{}', 'technology'),
  ('competitor', 'strongSwan', '{}', 'technology'), ('competitor', 'IKEv2', '{}', 'technology'), ('competitor', 'DTLS', '{}', 'technology')
on conflict (facet, label) do nothing;

-- Self-check: every alias resolves to exactly one label.
do $$ begin
  if exists (select 1 from core.alias_conflicts()) then
    raise exception 'core.terms has aliases pointing at two labels: %', (select string_agg(facet || '/' || alias, ', ') from core.alias_conflicts());
  end if;
end $$;

-- Added 6 Oct 2026 when the 64 inventory cards were loaded (named in the cards, unknown to the list).
insert into core.terms (facet, label, aliases, kind) values
  ('competitor', 'AmmyAdmin', '{ammyy admin,ammyy}', 'vendor'),
  ('competitor', 'Hysolate', '{}', 'vendor')
on conflict (facet, label) do nothing;
