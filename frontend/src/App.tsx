import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Home, Search, Plus, X, Pencil, Trash2, ChevronDown, AlertTriangle,
  Syringe, Baby, Receipt, Check, Settings, Calendar, MapPin,
  Crosshair, Layers, Undo2
} from "lucide-react";
import { loadDB, saveEntity, deleteEntity, replaceAll, clearAll } from "./herdbookApi";

/* ---------------------------------------------------------------------------
   Herdbook — a field tool for managing livestock across herds.
   Persistence is handled by the relational Supabase backend via ./herdbookApi
   (loadDB on mount; targeted saveEntity/deleteEntity writes per change).
--------------------------------------------------------------------------- */

/* ---------- domain types ---------- */
export type LatLng = [number, number];
export type EntityKey = "herds" | "cattle" | "births" | "vaccinations" | "expenses" | "pastures";

export interface Herd { id: string; name: string; location: string; note: string; species?: string; }
export interface Animal { id: string; tag: string; name: string; herdId: string; cls: string; breed: string; birth: string; status: string; note: string; }
export interface Birth { id: string; damId: string; sireId: string; bred: string; expected: string; actual: string; status: string; note: string; }
export interface Vaccination { id: string; scope: "herd" | "animal"; targetId: string; vaccine: string; date: string; nextDue: string; note: string; customName?: string; }
export interface Expense { id: string; herdId: string; cat: string; amount: number; date: string; desc: string; }
export interface Pasture { id: string; name: string; herdId: string; color: string; note: string; coords: LatLng[]; }

export interface DB {
  herds: Herd[]; cattle: Animal[]; births: Birth[];
  vaccinations: Vaccination[]; expenses: Expense[]; pastures: Pasture[];
}

export interface AlertBuckets {
  vacOverdue: Vaccination[]; vacSoon: Vaccination[];
  calveOverdue: Birth[]; calveSoon: Birth[];
}

export interface SpeciesCfg {
  label: string; tagLabel: string;
  classes: string[]; dams: string[]; sires: string[]; young: string;
  gestation: number; birthVerb: string; borne: string;
  vaccines: string[]; plurals: Record<string, string>;
}

/* setter shapes shared across components */
export type Upsert = <K extends EntityKey>(key: K, item: DB[K][number]) => void;
export type Remove = (key: EntityKey, id: string) => void;
export type IconType = React.ElementType;
export type SetDB = React.Dispatch<React.SetStateAction<DB>>;
export type SetStr = React.Dispatch<React.SetStateAction<string>>;
export type Labeler = (id: string) => string;

/* Leaflet is loaded from a CDN at runtime (window.L) and has no bundled
   types, so we declare just the global we touch. Persistence now lives in
   ./herdbookApi (loadDB / saveEntity / deleteEntity), backed by Supabase. */
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L?: any; // Leaflet, loaded at runtime from CDN
  }
}

const PAGE_SIZE = 25;

const STATUSES = ["Active", "Sold", "Deceased"];
const EXPENSE_CATS = ["Feed", "Veterinary", "Breeding", "Equipment", "Labor", "Other"];
const PASTURE_COLORS = ["#F4C430", "#4CAF50", "#2196F3", "#E0552F", "#9C27B0", "#00BCD4", "#8BC34A", "#FF7043"];

/* ---------- species registry ----------
   Each herd carries a `species`. Everything species-specific — the animal
   classes, gestation length, vaccine presets, and the words the app uses —
   lives here. Add a new animal type by adding one object to this map. */
const SPECIES: Record<string, SpeciesCfg> = {
  cattle: {
    label: "Cattle", tagLabel: "Ear tag",
    classes: ["Cow", "Bull", "Heifer", "Steer", "Calf"],
    dams: ["Cow", "Heifer"], sires: ["Bull"], young: "Calf",
    gestation: 283, birthVerb: "calve", borne: "calved",
    vaccines: ["Blackleg (7-way)", "IBR/BVD", "Brucellosis", "Lepto", "Vibrio", "Deworm", "Other"],
    plurals: { Cow: "Cows", Bull: "Bulls", Heifer: "Heifers", Steer: "Steers", Calf: "Calves" },
  },
  sheep: {
    label: "Sheep", tagLabel: "Tag",
    classes: ["Ewe", "Ram", "Wether", "Lamb"],
    dams: ["Ewe"], sires: ["Ram"], young: "Lamb",
    gestation: 152, birthVerb: "lamb", borne: "lambed",
    vaccines: ["CDT (Clostridial)", "Footrot", "Deworm", "Other"],
    plurals: { Ewe: "Ewes", Ram: "Rams", Wether: "Wethers", Lamb: "Lambs" },
  },
  goats: {
    label: "Goats", tagLabel: "Tag",
    classes: ["Doe", "Buck", "Wether", "Kid"],
    dams: ["Doe"], sires: ["Buck"], young: "Kid",
    gestation: 150, birthVerb: "kid", borne: "kidded",
    vaccines: ["CDT (Clostridial)", "Deworm", "Other"],
    plurals: { Doe: "Does", Buck: "Bucks", Wether: "Wethers", Kid: "Kids" },
  },
  horses: {
    label: "Horses", tagLabel: "Name / ID",
    classes: ["Mare", "Stallion", "Gelding", "Foal"],
    dams: ["Mare"], sires: ["Stallion"], young: "Foal",
    gestation: 340, birthVerb: "foal", borne: "foaled",
    vaccines: ["EEE / WEE", "Tetanus", "West Nile", "Rabies", "Deworm", "Other"],
    plurals: { Mare: "Mares", Stallion: "Stallions", Gelding: "Geldings", Foal: "Foals" },
  },
  pigs: {
    label: "Pigs", tagLabel: "Tag",
    classes: ["Sow", "Boar", "Barrow", "Gilt", "Piglet"],
    dams: ["Sow", "Gilt"], sires: ["Boar"], young: "Piglet",
    gestation: 114, birthVerb: "farrow", borne: "farrowed",
    vaccines: ["Erysipelas", "Circovirus", "Mycoplasma", "Deworm", "Other"],
    plurals: { Sow: "Sows", Boar: "Boars", Barrow: "Barrows", Gilt: "Gilts", Piglet: "Piglets" },
  },
};
const SPECIES_KEYS: string[] = Object.keys(SPECIES);
const DEFAULT_SPECIES = "cattle";
const cfgOf = (key?: string): SpeciesCfg => SPECIES[key || DEFAULT_SPECIES] || SPECIES[DEFAULT_SPECIES];
const PLURALS: Record<string, string> = Object.assign({}, ...SPECIES_KEYS.map((k) => SPECIES[k].plurals));
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* generic setter used by the modal forms: set("field", value) */
function fieldSetter<T>(setF: React.Dispatch<React.SetStateAction<T>>) {
  return <K extends keyof T>(k: K, v: T[K]) => setF((prev) => ({ ...prev, [k]: v } as T));
}
type ExpenseDraft = Omit<Expense, "amount"> & { amount: number | string };

/* ---------- tiny helpers ---------- */
const uid = (): string => crypto.randomUUID();
const todayISO = (): string => new Date().toISOString().slice(0, 10);
const startOfToday = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parse = (s?: string | null): Date | null => (s ? new Date(s + "T00:00:00") : null);
const addDays = (s: string, n: number): string => { const d = parse(s); if (!d) return ""; d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysUntil = (s?: string | null): number | null => { const d = parse(s); if (!d) return null; return Math.round((d.getTime() - startOfToday().getTime()) / 86400000); };
const fmtDate = (s?: string | null): string => { const d = parse(s); return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"; };
const money = (n: number | string): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n) || 0);
const money0 = (n: number | string): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0);
const toRad = (d: number): number => (d * Math.PI) / 180;
function polyAreaSqM(coords: LatLng[]): number {
  if (!coords || coords.length < 3) return 0;
  const R = 6378137; let a = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[(i + 1) % coords.length];
    a += (toRad(lng2) - toRad(lng1)) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((a * R * R) / 2);
}
const acres = (coords: LatLng[]): number => polyAreaSqM(coords) / 4046.8564224;
const fmtAcres = (n: number): string => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)) + " ac";

function ageString(birth?: string | null): string {
  const d = parse(birth);
  if (!d) return "—";
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 0) return "—";
  const y = Math.floor(months / 12), m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

const emptyDB: DB = { herds: [], cattle: [], births: [], vaccinations: [], expenses: [], pastures: [] };

/* ---------- sample data ---------- */
function sampleDB(): DB {
  const h1 = uid(), h2 = uid(), h3 = uid(), h4 = uid();
  const herds: Herd[] = [
    { id: h1, name: "North Pasture", location: "Section 12", note: "Main cow-calf herd", species: "cattle" },
    { id: h2, name: "River Bottom", location: "Section 4", note: "Yearlings", species: "cattle" },
    { id: h3, name: "Sale Barn Lot", location: "Home place", note: "Ready to sell", species: "cattle" },
    { id: h4, name: "East Flock", location: "Section 9", note: "Katahdin ewes", species: "sheep" },
  ];
  const cattle: Animal[] = [];
  const breedsFor: Record<string, string[]> = {
    cattle: ["Angus", "Hereford", "Charolais", "Brangus", "Red Angus"],
    sheep: ["Katahdin", "Dorper", "Suffolk", "Katahdin", "Dorper"],
  };
  let tag = 100;
  const push = (herdId: string, species: string, cls: string, count: number) => {
    const breeds = breedsFor[species] || breedsFor.cattle;
    const younglings = SPECIES[species].young;
    for (let i = 0; i < count; i++) {
      const yearsBack = cls === younglings ? 0 : /Heifer|Steer|Wether/.test(cls) ? 1 : 3 + (i % 4);
      const bd = new Date(); bd.setFullYear(bd.getFullYear() - yearsBack); bd.setMonth((i * 3) % 12);
      cattle.push({
        id: uid(), tag: String(tag++), name: "", herdId, cls,
        breed: breeds[i % breeds.length], birth: bd.toISOString().slice(0, 10),
        status: "Active", note: "",
      });
    }
  };
  push(h1, "cattle", "Cow", 18); push(h1, "cattle", "Calf", 12); push(h1, "cattle", "Bull", 2);
  push(h2, "cattle", "Heifer", 9); push(h2, "cattle", "Steer", 7);
  push(h3, "cattle", "Steer", 6);
  push(h4, "sheep", "Ewe", 22); push(h4, "sheep", "Ram", 2); push(h4, "sheep", "Lamb", 15);

  const cow = cattle.find((c) => c.cls === "Cow");
  const bull = cattle.find((c) => c.cls === "Bull");
  const ewe = cattle.find((c) => c.cls === "Ewe");
  const ram = cattle.find((c) => c.cls === "Ram");
  const bred = addDays(todayISO(), -250);
  const sBred = addDays(todayISO(), -130);
  const births: Birth[] = [
    { id: uid(), damId: cow?.id || "", sireId: bull?.id || "", bred, expected: addDays(bred, SPECIES.cattle.gestation), actual: "", status: "Expecting", note: "" },
    { id: uid(), damId: cattle.filter(c => c.cls === "Cow")[1]?.id || "", sireId: bull?.id || "", bred: addDays(todayISO(), -290), expected: addDays(addDays(todayISO(), -290), SPECIES.cattle.gestation), actual: addDays(todayISO(), -6), status: "Calved", note: "Healthy heifer calf" },
    { id: uid(), damId: ewe?.id || "", sireId: ram?.id || "", bred: sBred, expected: addDays(sBred, SPECIES.sheep.gestation), actual: "", status: "Expecting", note: "" },
  ];
  const vaccinations: Vaccination[] = [
    { id: uid(), scope: "herd", targetId: h1, vaccine: "Blackleg (7-way)", date: addDays(todayISO(), -400), nextDue: addDays(todayISO(), -20), note: "Annual" },
    { id: uid(), scope: "herd", targetId: h2, vaccine: "IBR/BVD", date: addDays(todayISO(), -60), nextDue: addDays(todayISO(), 20), note: "" },
    { id: uid(), scope: "animal", targetId: cow?.id || "", vaccine: "Lepto", date: addDays(todayISO(), -30), nextDue: addDays(todayISO(), 150), note: "" },
    { id: uid(), scope: "herd", targetId: h4, vaccine: "CDT (Clostridial)", date: addDays(todayISO(), -45), nextDue: addDays(todayISO(), 15), note: "Whole flock" },
  ];
  const expenses: Expense[] = [
    { id: uid(), herdId: h1, cat: "Feed", amount: 1840.5, date: addDays(todayISO(), -5), desc: "Hay — 40 round bales" },
    { id: uid(), herdId: h1, cat: "Veterinary", amount: 620, date: addDays(todayISO(), -12), desc: "Vet call + meds" },
    { id: uid(), herdId: h2, cat: "Feed", amount: 410, date: addDays(todayISO(), -2), desc: "Mineral tubs" },
    { id: uid(), herdId: h3, cat: "Equipment", amount: 275.99, date: addDays(todayISO(), -20), desc: "Fence repair" },
  ];
  const pastures: Pasture[] = [
    { id: uid(), name: "North Pasture", herdId: h1, color: "#4CAF50", note: "Good water", coords: [[35.610, -97.770], [35.610, -97.760], [35.602, -97.760], [35.602, -97.770]] },
    { id: uid(), name: "River Bottom", herdId: h2, color: "#2196F3", note: "", coords: [[35.602, -97.770], [35.602, -97.762], [35.596, -97.763], [35.596, -97.771]] },
    { id: uid(), name: "Sale Barn Lot", herdId: h3, color: "#F4C430", note: "Near the chute", coords: [[35.610, -97.760], [35.610, -97.753], [35.604, -97.753], [35.604, -97.760]] },
  ];
  return { herds, cattle, births, vaccinations, expenses, pastures };
}

/* =========================================================================
   Main component
========================================================================= */
export default function Herdbook() {
  const [db, setDb] = useState<DB>(emptyDB);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("home");
  const [herdScope, setHerdScope] = useState("all"); // "all" or herd id
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      const saved = await loadDB();
      if (saved) setDb({ ...emptyDB, ...saved });
      loaded.current = true;
      setLoading(false);
    })();
  }, []);

  const herdName = (id: string) => db.herds.find((h) => h.id === id)?.name || "—";
  const animalLabel = (id: string) => {
    const a = db.cattle.find((c) => c.id === id);
    return a ? `#${a.tag}${a.name ? " " + a.name : ""}` : "—";
  };

  const inScope = (herdId?: string) => herdScope === "all" || herdId === herdScope;
  const scopedCattle = db.cattle.filter((c) => inScope(c.herdId));
  const activeScoped = scopedCattle.filter((c) => c.status === "Active");

  /* ----- derived alerts ----- */
  const alerts = useMemo(() => {
    const vacOverdue = db.vaccinations.filter((v) => {
      const scoped = v.scope === "herd" ? inScope(v.targetId) : inScope(db.cattle.find(c => c.id === v.targetId)?.herdId);
      const du = daysUntil(v.nextDue);
      return scoped && v.nextDue && du !== null && du < 0;
    });
    const vacSoon = db.vaccinations.filter((v) => {
      const scoped = v.scope === "herd" ? inScope(v.targetId) : inScope(db.cattle.find(c => c.id === v.targetId)?.herdId);
      const du = daysUntil(v.nextDue);
      return scoped && v.nextDue && du !== null && du >= 0 && du <= 30;
    });
    const calveOverdue = db.births.filter((b) => {
      const dam = db.cattle.find(c => c.id === b.damId);
      const du = daysUntil(b.expected);
      return b.status === "Expecting" && inScope(dam?.herdId) && du !== null && du < 0;
    });
    const calveSoon = db.births.filter((b) => {
      const dam = db.cattle.find(c => c.id === b.damId);
      const du = daysUntil(b.expected);
      return b.status === "Expecting" && inScope(dam?.herdId) && du !== null && du >= 0 && du <= 30;
    });
    return { vacOverdue, vacSoon, calveOverdue, calveSoon };
  }, [db, herdScope]);

  /* ----- setters ----- */
  // Optimistic local update for a snappy UI, then one targeted write to Postgres.
  const upsert: Upsert = (key, item) => {
    setDb((d) => {
      const list = d[key] as Array<{ id: string }>;
      const it = item as { id: string };
      const exists = list.some((x) => x.id === it.id);
      const next = exists ? list.map((x) => (x.id === it.id ? it : x)) : [...list, it];
      return { ...d, [key]: next } as DB;
    });
    void saveEntity(key, item);
  };
  const remove: Remove = (key, id) => {
    setDb((d) => ({ ...d, [key]: (d[key] as Array<{ id: string }>).filter((x) => x.id !== id) } as DB));
    void deleteEntity(key, id);
  };

  const NAV: { id: string; label: string; icon: IconType }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "cattle", label: "Animals", icon: CowIcon },
    { id: "pastures", label: "Pastures", icon: MapPin },
    { id: "births", label: "Births", icon: Baby },
    { id: "health", label: "Health", icon: Syringe },
    { id: "expenses", label: "Money", icon: Receipt },
  ];

  return (
    <div className="hb-root">
      <style>{CSS}</style>

      <aside className="rail">
        <div className="rail-brand"><CowIcon size={26} /><span>Herdbook</span></div>
        {NAV.map((n) => {
          const I = n.icon;
          return (
            <button key={n.id} className={"rail-item" + (tab === n.id ? " on" : "")} onClick={() => setTab(n.id)}>
              <I size={22} /><span>{n.label}</span>
            </button>
          );
        })}
      </aside>

      <div className="main">
        <TopBar
          herds={db.herds}
          herdScope={herdScope}
          setHerdScope={setHerdScope}
          db={db}
          setDb={setDb}
        />
        <main className="content">
          {loading ? (
            <div className="empty"><p>Opening your herdbook…</p></div>
          ) : (
            <>
              {tab === "home" && <Dashboard db={db} herdScope={herdScope} activeScoped={activeScoped} alerts={alerts} herdName={herdName} animalLabel={animalLabel} setTab={setTab} setDb={setDb} />}
              {tab === "cattle" && <Cattle db={db} herdScope={herdScope} scopedCattle={scopedCattle} herdName={herdName} upsert={upsert} remove={remove} />}
              {tab === "pastures" && <Pastures db={db} herdName={herdName} upsert={upsert} remove={remove} />}
              {tab === "births" && <Births db={db} herdScope={herdScope} animalLabel={animalLabel} upsert={upsert} remove={remove} setDb={setDb} />}
              {tab === "health" && <Health db={db} herdScope={herdScope} animalLabel={animalLabel} herdName={herdName} upsert={upsert} remove={remove} />}
              {tab === "expenses" && <Expenses db={db} herdScope={herdScope} herdName={herdName} upsert={upsert} remove={remove} />}
            </>
          )}
        </main>
      </div>

      <nav className="tabbar">
        {NAV.map((n) => {
          const I = n.icon;
          return (
            <button key={n.id} className={"tab" + (tab === n.id ? " on" : "")} onClick={() => setTab(n.id)}>
              <I size={24} /><span>{n.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* =========================================================================
   Top bar with herd selector + settings
========================================================================= */
function TopBar({ herds, herdScope, setHerdScope, db, setDb }: {
  herds: Herd[]; herdScope: string; setHerdScope: SetStr; db: DB; setDb: SetDB;
}) {
  const [open, setOpen] = useState(false);
  const [gear, setGear] = useState(false);
  const [manage, setManage] = useState(false);
  const label = herdScope === "all" ? "All herds" : (herds.find((h) => h.id === herdScope)?.name || "All herds");

  return (
    <header className="topbar">
      <div className="tb-brand"><CowIcon size={22} /><span>Herdbook</span></div>

      <div className="tb-right">
        <div className="dropdown">
          <button className="herd-select" onClick={() => setOpen((v) => !v)}>
            <span className="hs-label">{label}</span>
            <ChevronDown size={18} />
          </button>
          {open && (
            <div className="menu" onMouseLeave={() => setOpen(false)}>
              <button className={"menu-item" + (herdScope === "all" ? " on" : "")} onClick={() => { setHerdScope("all"); setOpen(false); }}>All herds</button>
              {herds.map((h) => (
                <button key={h.id} className={"menu-item" + (herdScope === h.id ? " on" : "")} onClick={() => { setHerdScope(h.id); setOpen(false); }}>
                  {h.name}<span className="menu-tag">{cfgOf(h.species).label}</span>
                </button>
              ))}
              {herds.length === 0 && <div className="menu-empty">No herds yet</div>}
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { setManage(true); setOpen(false); }}>Manage herds…</button>
            </div>
          )}
        </div>

        <div className="dropdown">
          <button className="icon-btn" title="Settings" onClick={() => setGear((v) => !v)}><Settings size={20} /></button>
          {gear && (
            <div className="menu right" onMouseLeave={() => setGear(false)}>
              <button className="menu-item" onClick={() => { const s = sampleDB(); setDb(s); void replaceAll(s); setGear(false); }}>Load sample ranch</button>
              <button className="menu-item danger" onClick={() => { if (confirm("Erase all data and start empty? This can't be undone.")) { setDb(emptyDB); void clearAll(); } setGear(false); }}>Clear all data</button>
            </div>
          )}
        </div>
      </div>

      {manage && <HerdsManager db={db} setDb={setDb} onClose={() => setManage(false)} />}
    </header>
  );
}

/* Manage herds — add, rename, set species, delete. A herd's species drives
   the classes, gestation, vaccines and wording used everywhere else. */
function HerdsManager({ db, setDb, onClose }: { db: DB; setDb: SetDB; onClose: () => void; }) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState(DEFAULT_SPECIES);

  // local update only; the caller persists (name on blur, species on change)
  const setHerd = (id: string, patch: Partial<Herd>) => setDb((d) => ({ ...d, herds: d.herds.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
  const saveHerd = (h: Herd) => void saveEntity("herds", h);
  const addHerd = () => {
    if (!name.trim()) return;
    const h: Herd = { id: uid(), name: name.trim(), location: "", note: "", species };
    setDb((d) => ({ ...d, herds: [...d.herds, h] }));
    void saveEntity("herds", h);
    setName(""); setSpecies(DEFAULT_SPECIES);
  };
  const delHerd = (h: Herd) => {
    const orphans = db.cattle.filter((c) => c.herdId === h.id);
    const msg = orphans.length > 0
      ? `Delete "${h.name}"? ${orphans.length} animal${orphans.length === 1 ? "" : "s"} will be left without a herd.`
      : `Delete "${h.name}"?`;
    if (!confirm(msg)) return;
    // Detach animals first so the herd's foreign key can be removed cleanly.
    setDb((d) => ({
      ...d,
      cattle: d.cattle.map((c) => (c.herdId === h.id ? { ...c, herdId: "" } : c)),
      herds: d.herds.filter((x) => x.id !== h.id),
    }));
    orphans.forEach((c) => void saveEntity("cattle", { ...c, herdId: "" }));
    void deleteEntity("herds", h.id);
  };

  return (
    <Modal title="Manage herds" onClose={onClose}>
      {db.herds.length === 0 && <div className="notice">No herds yet. Add one below and pick what kind of animals it holds.</div>}
      <div className="herd-mgr">
        {db.herds.map((h) => {
          const head = db.cattle.filter((c) => c.herdId === h.id).length;
          return (
            <div key={h.id} className="herd-mgr-row">
              <input value={h.name} onChange={(e) => setHerd(h.id, { name: e.target.value })} onBlur={() => saveHerd(h)} placeholder="Herd name" />
              <select value={h.species || DEFAULT_SPECIES} onChange={(e) => { setHerd(h.id, { species: e.target.value }); saveHerd({ ...h, species: e.target.value }); }}>
                {SPECIES_KEYS.map((k) => <option key={k} value={k}>{SPECIES[k].label}</option>)}
              </select>
              <span className="herd-mgr-count">{head}</span>
              <button className="icon-btn sm danger" onClick={() => delHerd(h)}><Trash2 size={16} /></button>
            </div>
          );
        })}
      </div>

      <div className="field-label" style={{ marginTop: 6 }}>Add a herd</div>
      <div className="herd-mgr-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. West Goat Pen" onKeyDown={(e) => { if (e.key === "Enter") addHerd(); }} />
        <select value={species} onChange={(e) => setSpecies(e.target.value)}>
          {SPECIES_KEYS.map((k) => <option key={k} value={k}>{SPECIES[k].label}</option>)}
        </select>
        <button className="btn sm tag" onClick={addHerd} disabled={!name.trim()}><Plus size={16} /> Add</button>
      </div>
      <p className="hint">Changing a herd's species updates the class options, gestation and vaccine list for its animals. Existing animals keep their recorded class.</p>
      <div className="form-actions"><button className="btn tag" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

/* =========================================================================
   Dashboard
========================================================================= */
function Dashboard({ db, herdScope, activeScoped, alerts, herdName, animalLabel, setTab, setDb }: {
  db: DB; herdScope: string; activeScoped: Animal[]; alerts: AlertBuckets;
  herdName: Labeler; animalLabel: Labeler; setTab: (t: string) => void; setDb: SetDB;
}) {
  const total = activeScoped.length;
  const classOrder: string[] = [];
  activeScoped.forEach((a) => { if (!classOrder.includes(a.cls)) classOrder.push(a.cls); });
  const byClass = classOrder.map((c) => ({ c, n: activeScoped.filter((a) => a.cls === c).length })).filter((x) => x.n > 0);
  const damVerb = (damId: string) => cfgOf(db.herds.find((h) => h.id === db.cattle.find((c) => c.id === damId)?.herdId)?.species).birthVerb;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthSpend = db.expenses
    .filter((e) => (herdScope === "all" || e.herdId === herdScope) && (parse(e.date)?.getTime() ?? 0) >= monthStart.getTime())
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const needsAttention = alerts.vacOverdue.length + alerts.calveOverdue.length;
  const upcoming = alerts.vacSoon.length + alerts.calveSoon.length;

  if (db.herds.length === 0 && db.cattle.length === 0) {
    return (
      <div className="empty tall">
        <CowIcon size={54} />
        <h2>Welcome to your herdbook</h2>
        <p>Start by adding a herd and your first head of cattle — or load a sample ranch to look around.</p>
        <div className="empty-actions">
          <button className="btn tag" onClick={() => { const s = sampleDB(); setDb(s); void replaceAll(s); }}>Load sample ranch</button>
          <button className="btn ghost" onClick={() => setTab("cattle")}>Add cattle</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="statboard">
        <div className="head-total">
          <span className="st-label">Head on the ground</span>
          <span className="st-number">{total.toLocaleString()}</span>
          <span className="st-sub">{herdScope === "all" ? "across all herds" : `in ${herdName(herdScope)}`}</span>
        </div>
        <div className="head-breakdown">
          {byClass.length === 0 ? <span className="muted">No active animals in view</span> :
            byClass.map((b) => (
              <div key={b.c} className="bd-row">
                <span className="bd-count">{b.n}</span>
                <span className="bd-class">{b.n === 1 ? b.c : pluralize(b.c)}</span>
              </div>
            ))}
        </div>
      </div>

      {(needsAttention > 0 || upcoming > 0) ? (
        <section className="panel">
          <h3 className="panel-title">Needs attention</h3>
          <div className="alerts">
            {alerts.calveOverdue.map((b) => (
              <div key={b.id} className="alert rust" onClick={() => setTab("births")}>
                <AlertTriangle size={20} />
                <div><strong>{animalLabel(b.damId)}</strong> is past due to {damVerb(b.damId)} — expected {fmtDate(b.expected)}</div>
              </div>
            ))}
            {alerts.vacOverdue.map((v) => (
              <div key={v.id} className="alert rust" onClick={() => setTab("health")}>
                <AlertTriangle size={20} />
                <div><strong>{v.vaccine}</strong> overdue for {v.scope === "herd" ? herdName(v.targetId) : animalLabel(v.targetId)} — was due {fmtDate(v.nextDue)}</div>
              </div>
            ))}
            {alerts.calveSoon.map((b) => (
              <div key={b.id} className="alert soft" onClick={() => setTab("births")}>
                <Baby size={20} />
                <div><strong>{animalLabel(b.damId)}</strong> due to {damVerb(b.damId)} {fmtDate(b.expected)} ({daysUntil(b.expected)} days)</div>
              </div>
            ))}
            {alerts.vacSoon.map((v) => (
              <div key={v.id} className="alert soft" onClick={() => setTab("health")}>
                <Syringe size={20} />
                <div><strong>{v.vaccine}</strong> due {fmtDate(v.nextDue)} for {v.scope === "herd" ? herdName(v.targetId) : animalLabel(v.targetId)}</div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel">
          <h3 className="panel-title">Needs attention</h3>
          <div className="all-clear"><Check size={20} /> Nothing overdue or coming up in the next 30 days.</div>
        </section>
      )}

      <div className="mini-grid">
        <button className="mini" onClick={() => setTab("expenses")}>
          <span className="mini-label">Spent this month</span>
          <span className="mini-value">{money0(monthSpend)}</span>
        </button>
        <button className="mini" onClick={() => setTab("births")}>
          <span className="mini-label">Expecting</span>
          <span className="mini-value">{db.births.filter((b) => b.status === "Expecting" && (herdScope === "all" || db.cattle.find(c => c.id === b.damId)?.herdId === herdScope)).length}</span>
        </button>
        <button className="mini" onClick={() => setTab("cattle")}>
          <span className="mini-label">Herds</span>
          <span className="mini-value">{db.herds.length}</span>
        </button>
      </div>
    </div>
  );
}
const pluralize = (c: string) => PLURALS[c] || c + "s";

/* =========================================================================
   Cattle
========================================================================= */
function Cattle({ db, herdScope, scopedCattle, herdName, upsert, remove }: {
  db: DB; herdScope: string; scopedCattle: Animal[]; herdName: Labeler; upsert: Upsert; remove: Remove;
}) {
  const [q, setQ] = useState("");
  const [fClass, setFClass] = useState("all");
  const [fStatus, setFStatus] = useState("Active");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Animal | null>(null); // object or null
  const [showForm, setShowForm] = useState(false);

  const scopeClasses = useMemo(() => {
    const set = new Set<string>();
    const herdsInScope = db.herds.filter((h) => herdScope === "all" || h.id === herdScope);
    (herdsInScope.length ? herdsInScope : db.herds).forEach((h) => cfgOf(h.species).classes.forEach((c) => set.add(c)));
    scopedCattle.forEach((c) => c.cls && set.add(c.cls));
    return [...set];
  }, [db.herds, herdScope, scopedCattle]);

  const filtered = scopedCattle.filter((c) => {
    if (fClass !== "all" && c.cls !== fClass) return false;
    if (fStatus !== "all" && c.status !== fStatus) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(`${c.tag} ${c.name} ${c.breed}`.toLowerCase().includes(s))) return false;
    }
    return true;
  }).sort((a, b) => (a.tag || "").localeCompare(b.tag || "", undefined, { numeric: true }));

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampPage = Math.min(page, pages - 1);
  const rows = filtered.slice(clampPage * PAGE_SIZE, clampPage * PAGE_SIZE + PAGE_SIZE);

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (c: Animal) => { setEditing(c); setShowForm(true); };

  return (
    <div className="view">
      <div className="view-head">
        <h2>Animals</h2>
        <button className="btn tag" onClick={openNew}><Plus size={18} /> Add animal</button>
      </div>

      <div className="toolbar">
        <div className="searchbox">
          <Search size={18} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search tag, name, or breed" />
        </div>
        <select value={fClass} onChange={(e) => { setFClass(e.target.value); setPage(0); }}>
          <option value="all">All classes</option>
          {scopeClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(0); }}>
          <option value="all">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>{scopedCattle.length === 0 ? "No animals in this view yet." : "No animals match your search."}</p>
          {scopedCattle.length === 0 && <button className="btn tag" onClick={openNew}><Plus size={18} /> Add your first animal</button>}
        </div>
      ) : (
        <>
          <div className="list-head desk-only">
            <span>Tag</span><span>Class</span><span>Herd</span><span>Breed</span><span>Age</span><span></span>
          </div>
          <div className="list">
            {rows.map((c) => (
              <div key={c.id} className={"row" + (c.status !== "Active" ? " dim" : "")}>
                <div className="cell tag-cell">
                  <span className="eartag">{c.tag}</span>
                  {c.name && <span className="row-name">{c.name}</span>}
                </div>
                <div className="cell"><span className="mob-label">Class </span>{c.cls}</div>
                <div className="cell"><span className="mob-label">Herd </span>{herdName(c.herdId)}</div>
                <div className="cell"><span className="mob-label">Breed </span>{c.breed || "—"}</div>
                <div className="cell"><span className="mob-label">Age </span>{ageString(c.birth)}</div>
                <div className="cell actions">
                  {c.status !== "Active" && <span className="pill">{c.status}</span>}
                  <button className="icon-btn sm" onClick={() => openEdit(c)}><Pencil size={16} /></button>
                  <button className="icon-btn sm danger" onClick={() => { if (confirm(`Remove #${c.tag} from your records?`)) remove("cattle", c.id); }}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
          <Pager page={clampPage} pages={pages} count={filtered.length} setPage={setPage} />
        </>
      )}

      {showForm && (
        <CattleForm
          herds={db.herds}
          herdScope={herdScope}
          initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(item) => { upsert("cattle", item); setShowForm(false); }}
        />
      )}
    </div>
  );
}

function CattleForm({ herds, herdScope, initial, onClose, onSave }: {
  herds: Herd[]; herdScope: string; initial: Animal | null; onClose: () => void; onSave: (item: Animal) => void;
}) {
  const spOf = (herdId?: string) => cfgOf(herds.find((h) => h.id === herdId)?.species);
  const defHerd = herdScope !== "all" ? herdScope : (herds[0]?.id || "");
  const [f, setF] = useState<Animal>(initial || {
    id: uid(), tag: "", name: "", herdId: defHerd,
    cls: spOf(defHerd).classes[0], breed: "", birth: "", status: "Active", note: "",
  });
  const set = fieldSetter(setF);
  const setHerd = (v: string) => setF((s) => {
    const cls = spOf(v).classes.includes(s.cls) ? s.cls : spOf(v).classes[0];
    return { ...s, herdId: v, cls };
  });
  const sp = spOf(f.herdId);
  const canSave = f.tag.trim() && f.herdId;

  return (
    <Modal title={initial ? `Edit #${initial.tag}` : "Add animal"} onClose={onClose}>
      {herds.length === 0 && <div className="notice">Add a herd first — you'll find that below the class picker.</div>}
      <Field label={sp.tagLabel} required>
        <input value={f.tag} onChange={(e) => set("tag", e.target.value)} placeholder="e.g. 142" />
      </Field>
      <Field label="Name (optional)">
        <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Bessie" />
      </Field>
      <div className="field-row">
        <Field label="Class">
          <select value={f.cls} onChange={(e) => set("cls", e.target.value)}>{sp.classes.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
      </div>
      <Field label="Herd" required>
        <HerdPicker herds={herds} value={f.herdId} onChange={setHerd} onAdd={(h) => { herds.push(h); setHerd(h.id); }} />
      </Field>
      <div className="field-row">
        <Field label="Breed"><input value={f.breed} onChange={(e) => set("breed", e.target.value)} placeholder="e.g. Angus" /></Field>
        <Field label="Birth date"><input type="date" value={f.birth} onChange={(e) => set("birth", e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2} /></Field>
      <FormActions onClose={onClose} onSave={() => onSave(f)} disabled={!canSave} />
    </Modal>
  );
}

/* =========================================================================
   Births / breeding
========================================================================= */
function Births({ db, herdScope, animalLabel, upsert, remove, setDb }: {
  db: DB; herdScope: string; animalLabel: Labeler;
  upsert: Upsert; remove: Remove; setDb: SetDB;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Birth | null>(null);
  const [calving, setCalving] = useState<Birth | null>(null); // birth record being marked calved

  const spOf = (herdId?: string) => cfgOf(db.herds.find((h) => h.id === herdId)?.species);
  const rows = db.births
    .filter((b) => herdScope === "all" || db.cattle.find(c => c.id === b.damId)?.herdId === herdScope)
    .sort((a, b) => (b.expected || "").localeCompare(a.expected || ""));

  const dams = db.cattle.filter((c) => c.status === "Active" && spOf(c.herdId).dams.includes(c.cls));
  const sires = db.cattle.filter((c) => c.status === "Active" && spOf(c.herdId).sires.includes(c.cls));

  return (
    <div className="view">
      <div className="view-head">
        <h2>Births &amp; breeding</h2>
        <button className="btn tag" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Log breeding</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <p>No breeding records yet. Log a breeding and Herdbook works out the expected calving date for you.</p>
          <button className="btn tag" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Log breeding</button>
        </div>
      ) : (
        <div className="cards">
          {rows.map((b) => {
            const du = daysUntil(b.expected);
            const late = b.status === "Expecting" && du !== null && du < 0;
            const soon = b.status === "Expecting" && du !== null && du >= 0 && du <= 30;
            const bsp = spOf(db.cattle.find((c) => c.id === b.damId)?.herdId);
            return (
              <div key={b.id} className={"card birth" + (late ? " late" : soon ? " soon" : "")}>
                <div className="card-main">
                  <div className="card-title">{animalLabel(b.damId)}</div>
                  <div className="card-meta">
                    {b.sireId ? `by ${animalLabel(b.sireId)} · ` : ""}bred {fmtDate(b.bred)}
                  </div>
                  {b.status === "Expecting" ? (
                    <div className="card-line">
                      <Calendar size={16} /> Due {fmtDate(b.expected)}
                      {du !== null && <span className={"due-badge" + (late ? " late" : soon ? " soon" : "")}>{late ? `${Math.abs(du)} days over` : `${du} days`}</span>}
                    </div>
                  ) : b.status === "Calved" ? (
                    <div className="card-line ok"><Check size={16} /> {cap(bsp.borne)} {fmtDate(b.actual)}{b.note ? ` · ${b.note}` : ""}</div>
                  ) : (
                    <div className="card-line">Lost{b.note ? ` · ${b.note}` : ""}</div>
                  )}
                </div>
                <div className="card-actions">
                  {b.status === "Expecting" && <button className="btn sm tag" onClick={() => setCalving(b)}>Mark {bsp.borne}</button>}
                  <button className="icon-btn sm" onClick={() => { setEditing(b); setShowForm(true); }}><Pencil size={16} /></button>
                  <button className="icon-btn sm danger" onClick={() => { if (confirm("Delete this breeding record?")) remove("births", b.id); }}><Trash2 size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <BreedingForm dams={dams} sires={sires} herds={db.herds} initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(item) => { upsert("births", item); setShowForm(false); }} />
      )}
      {calving && (
        <CalvingForm birth={calving} dam={db.cattle.find(c => c.id === calving.damId)}
          sp={spOf(db.cattle.find(c => c.id === calving.damId)?.herdId)}
          onClose={() => setCalving(null)}
          onSave={(updatedBirth, newCalf) => {
            setDb((d) => {
              const births = d.births.map((x) => (x.id === updatedBirth.id ? updatedBirth : x));
              const cattle = newCalf ? [...d.cattle, newCalf] : d.cattle;
              return { ...d, births, cattle };
            });
            void saveEntity("births", updatedBirth);
            if (newCalf) void saveEntity("cattle", newCalf);
            setCalving(null);
          }} />
      )}
    </div>
  );
}

function BreedingForm({ dams, sires, herds, initial, onClose, onSave }: {
  dams: Animal[]; sires: Animal[]; herds: Herd[]; initial: Birth | null; onClose: () => void; onSave: (item: Birth) => void;
}) {
  function spForHerd(herdId?: string) { return cfgOf((herds || []).find((h) => h.id === herdId)?.species); }
  function gestFor(damId: string) { const dam = dams.find((d) => d.id === damId); return spForHerd(dam?.herdId).gestation; }
  const initDam = dams[0]?.id || "";
  const [f, setF] = useState<Birth>(initial || { id: uid(), damId: initDam, sireId: "", bred: todayISO(), expected: addDays(todayISO(), gestFor(initDam)), actual: "", status: "Expecting", note: "" });
  const set = <K extends keyof Birth>(k: K, v: Birth[K]) => setF((s) => {
    const next: Birth = { ...s, [k]: v } as Birth;
    if (k === "bred") next.expected = addDays(v as string, gestFor(s.damId));
    if (k === "damId") { next.expected = addDays(s.bred, gestFor(v as string)); next.sireId = ""; }
    return next;
  });
  const damHerd = dams.find((d) => d.id === f.damId)?.herdId;
  const damSpKey = (herds || []).find((h) => h.id === damHerd)?.species || DEFAULT_SPECIES;
  const siresForDam = f.damId ? sires.filter((s) => (((herds || []).find((h) => h.id === s.herdId)?.species) || DEFAULT_SPECIES) === damSpKey) : sires;
  return (
    <Modal title={initial ? "Edit breeding" : "Log breeding"} onClose={onClose}>
      <Field label="Dam (mother)" required>
        <select value={f.damId} onChange={(e) => set("damId", e.target.value)}>
          <option value="">Select…</option>
          {dams.map((c) => <option key={c.id} value={c.id}>#{c.tag}{c.name ? " " + c.name : ""}</option>)}
        </select>
      </Field>
      <Field label="Sire (optional)">
        <select value={f.sireId} onChange={(e) => set("sireId", e.target.value)}>
          <option value="">Unknown / pasture sire</option>
          {siresForDam.map((c) => <option key={c.id} value={c.id}>#{c.tag}{c.name ? " " + c.name : ""}</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="Bred on"><input type="date" value={f.bred} onChange={(e) => set("bred", e.target.value)} /></Field>
        <Field label="Expected (auto)"><input type="date" value={f.expected} onChange={(e) => set("expected", e.target.value)} /></Field>
      </div>
      <p className="hint">Expected date uses a {gestFor(f.damId)}-day gestation for this species. Adjust it if you like.</p>
      <FormActions onClose={onClose} onSave={() => onSave(f)} disabled={!f.damId} />
    </Modal>
  );
}

function CalvingForm({ birth, dam, sp, onClose, onSave }: {
  birth: Birth; dam?: Animal; sp?: SpeciesCfg; onClose: () => void; onSave: (updated: Birth, newCalf: Animal | null) => void;
}) {
  const cfg = sp || SPECIES[DEFAULT_SPECIES];
  const young = cfg.young.toLowerCase();
  const [actual, setActual] = useState(todayISO());
  const [note, setNote] = useState("");
  const [addCalf, setAddCalf] = useState(true);
  const [tag, setTag] = useState("");
  return (
    <Modal title={`Record ${cfg.borne}`} onClose={onClose}>
      <Field label="Date"><input type="date" value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`e.g. healthy ${young}`} /></Field>
      <label className="check">
        <input type="checkbox" checked={addCalf} onChange={(e) => setAddCalf(e.target.checked)} />
        Add the {young} as a new animal
      </label>
      {addCalf && (
        <Field label={`${cap(young)} ${cfg.tagLabel.toLowerCase()}`} required><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. 305" /></Field>
      )}
      <FormActions onClose={onClose} disabled={addCalf && !tag.trim()}
        saveLabel="Save"
        onSave={() => {
          const updated = { ...birth, status: "Calved", actual, note };
          let newCalf = null;
          if (addCalf && tag.trim() && dam) {
            newCalf = { id: uid(), tag: tag.trim(), name: "", herdId: dam.herdId, cls: cfg.young, breed: dam.breed || "", birth: actual, status: "Active", note: "" };
          }
          onSave(updated, newCalf);
        }} />
    </Modal>
  );
}

/* =========================================================================
   Health / vaccinations
========================================================================= */
function Health({ db, herdScope, animalLabel, herdName, upsert, remove }: {
  db: DB; herdScope: string; animalLabel: Labeler; herdName: Labeler; upsert: Upsert; remove: Remove;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vaccination | null>(null);

  const rows = db.vaccinations.filter((v) => {
    if (herdScope === "all") return true;
    return v.scope === "herd" ? v.targetId === herdScope : db.cattle.find(c => c.id === v.targetId)?.herdId === herdScope;
  }).sort((a, b) => (a.nextDue || "9999").localeCompare(b.nextDue || "9999"));

  return (
    <div className="view">
      <div className="view-head">
        <h2>Health &amp; vaccinations</h2>
        <button className="btn tag" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Record vaccination</button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <p>No vaccination records yet. Record one for a whole herd or a single animal, and set the next-due date to get reminders on the home screen.</p>
          <button className="btn tag" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Record vaccination</button>
        </div>
      ) : (
        <div className="cards">
          {rows.map((v) => {
            const du = daysUntil(v.nextDue);
            const late = v.nextDue && du !== null && du < 0;
            const soon = v.nextDue && du !== null && du >= 0 && du <= 30;
            return (
              <div key={v.id} className={"card" + (late ? " late" : soon ? " soon" : "")}>
                <div className="card-main">
                  <div className="card-title">{v.vaccine}</div>
                  <div className="card-meta">{v.scope === "herd" ? `Whole herd · ${herdName(v.targetId)}` : animalLabel(v.targetId)} · given {fmtDate(v.date)}</div>
                  {v.nextDue && (
                    <div className="card-line"><Syringe size={16} /> Next due {fmtDate(v.nextDue)}
                      {du !== null && <span className={"due-badge" + (late ? " late" : soon ? " soon" : "")}>{late ? `${Math.abs(du)} days over` : `${du} days`}</span>}
                    </div>
                  )}
                  {v.note && <div className="card-line muted">{v.note}</div>}
                </div>
                <div className="card-actions">
                  <button className="icon-btn sm" onClick={() => { setEditing(v); setShowForm(true); }}><Pencil size={16} /></button>
                  <button className="icon-btn sm danger" onClick={() => { if (confirm("Delete this record?")) remove("vaccinations", v.id); }}><Trash2 size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <VaccineForm db={db} herdScope={herdScope} initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(item) => { upsert("vaccinations", item); setShowForm(false); }} />
      )}
    </div>
  );
}

function VaccineForm({ db, herdScope, initial, onClose, onSave }: {
  db: DB; herdScope: string; initial: Vaccination | null; onClose: () => void; onSave: (item: Vaccination) => void;
}) {
  const herdSpecies = (id?: string) => cfgOf(db.herds.find((h) => h.id === id)?.species);
  const animalSpecies = (id?: string) => herdSpecies(db.cattle.find((c) => c.id === id)?.herdId);
  const speciesForTarget = (scope: string, targetId?: string) => (scope === "herd" ? herdSpecies(targetId) : animalSpecies(targetId));
  const defTarget = herdScope !== "all" ? herdScope : (db.herds[0]?.id || "");
  const [f, setF] = useState<Vaccination>(initial || {
    id: uid(), scope: "herd", targetId: defTarget,
    vaccine: herdSpecies(defTarget).vaccines[0], date: todayISO(), nextDue: addDays(todayISO(), 365), note: "",
  });
  const set = fieldSetter(setF);
  const animals = db.cattle.filter((c) => c.status === "Active");
  const presets = speciesForTarget(f.scope, f.targetId).vaccines;

  const retargetVaccine = (s: Vaccination, cfg: SpeciesCfg) => (cfg.vaccines.includes(s.vaccine) ? s.vaccine : cfg.vaccines[0]);
  const pickHerd = () => setF((s) => { const t = db.herds[0]?.id || ""; return { ...s, scope: "herd", targetId: t, vaccine: retargetVaccine(s, herdSpecies(t)) }; });
  const pickAnimal = () => setF((s) => { const t = animals[0]?.id || ""; return { ...s, scope: "animal", targetId: t, vaccine: retargetVaccine(s, animalSpecies(t)) }; });
  const setTarget = (v: string) => setF((s) => ({ ...s, targetId: v, vaccine: retargetVaccine(s, speciesForTarget(s.scope, v)) }));

  return (
    <Modal title={initial ? "Edit vaccination" : "Record vaccination"} onClose={onClose}>
      <Field label="Applies to">
        <div className="segmented">
          <button className={f.scope === "herd" ? "on" : ""} onClick={pickHerd}>Whole herd</button>
          <button className={f.scope === "animal" ? "on" : ""} onClick={pickAnimal}>One animal</button>
        </div>
      </Field>
      <Field label={f.scope === "herd" ? "Herd" : "Animal"} required>
        <select value={f.targetId} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select…</option>
          {f.scope === "herd"
            ? db.herds.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)
            : animals.map((c) => <option key={c.id} value={c.id}>#{c.tag}{c.name ? " " + c.name : ""}</option>)}
        </select>
      </Field>
      <Field label="Vaccine / treatment">
        <select value={f.vaccine} onChange={(e) => set("vaccine", e.target.value)}>{presets.map((v) => <option key={v}>{v}</option>)}</select>
      </Field>
      {f.vaccine === "Other" && <Field label="Name"><input value={f.customName || ""} onChange={(e) => set("customName", e.target.value)} placeholder="Product name" /></Field>}
      <div className="field-row">
        <Field label="Date given"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Next due (optional)"><input type="date" value={f.nextDue} onChange={(e) => set("nextDue", e.target.value)} /></Field>
      </div>
      <Field label="Notes"><input value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      <FormActions onClose={onClose} disabled={!f.targetId}
        onSave={() => onSave({ ...f, vaccine: f.vaccine === "Other" && f.customName ? f.customName : f.vaccine })} />
    </Modal>
  );
}

/* =========================================================================
   Expenses
========================================================================= */
function Expenses({ db, herdScope, herdName, upsert, remove }: {
  db: DB; herdScope: string; herdName: Labeler; upsert: Upsert; remove: Remove;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const rows = db.expenses
    .filter((e) => herdScope === "all" || e.herdId === herdScope)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCat = EXPENSE_CATS.map((c) => ({ c, n: rows.filter((e) => e.cat === c).reduce((s, e) => s + Number(e.amount || 0), 0) })).filter((x) => x.n > 0);
  const max = Math.max(1, ...byCat.map((x) => x.n));

  return (
    <div className="view">
      <div className="view-head">
        <h2>Expenses</h2>
        <button className="btn tag" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Add expense</button>
      </div>

      {rows.length > 0 && (
        <div className="statboard slim">
          <div className="head-total">
            <span className="st-label">Total in view</span>
            <span className="st-number">{money0(total)}</span>
            <span className="st-sub">{herdScope === "all" ? "all herds" : herdName(herdScope)}</span>
          </div>
          <div className="bars">
            {byCat.map((b) => (
              <div key={b.c} className="bar-row">
                <span className="bar-label">{b.c}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(b.n / max) * 100}%` }} /></div>
                <span className="bar-val">{money0(b.n)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <p>No expenses logged yet. Track feed, vet bills, equipment and more — Herdbook totals them by category and herd.</p>
          <button className="btn tag" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Add expense</button>
        </div>
      ) : (
        <div className="list">
          {rows.map((e) => (
            <div key={e.id} className="row expense">
              <div className="cell"><span className="cat-pill">{e.cat}</span></div>
              <div className="cell grow">{e.desc || "—"}</div>
              <div className="cell"><span className="mob-label">Herd </span>{herdName(e.herdId)}</div>
              <div className="cell"><span className="mob-label">Date </span>{fmtDate(e.date)}</div>
              <div className="cell amount">{money(e.amount)}</div>
              <div className="cell actions">
                <button className="icon-btn sm" onClick={() => { setEditing(e); setShowForm(true); }}><Pencil size={16} /></button>
                <button className="icon-btn sm danger" onClick={() => { if (confirm("Delete this expense?")) remove("expenses", e.id); }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ExpenseForm herds={db.herds} herdScope={herdScope} initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(item) => { upsert("expenses", item); setShowForm(false); }} />
      )}
    </div>
  );
}

function ExpenseForm({ herds, herdScope, initial, onClose, onSave }: {
  herds: Herd[]; herdScope: string; initial: Expense | null; onClose: () => void; onSave: (item: Expense) => void;
}) {
  const [f, setF] = useState<ExpenseDraft>(initial || { id: uid(), herdId: herdScope !== "all" ? herdScope : (herds[0]?.id || ""), cat: "Feed", amount: "", date: todayISO(), desc: "" });
  const set = fieldSetter(setF);
  return (
    <Modal title={initial ? "Edit expense" : "Add expense"} onClose={onClose}>
      <div className="field-row">
        <Field label="Amount" required><input type="number" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
      </div>
      <Field label="Category">
        <select value={f.cat} onChange={(e) => set("cat", e.target.value)}>{EXPENSE_CATS.map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Herd">
        <select value={f.herdId} onChange={(e) => set("herdId", e.target.value)}>
          {herds.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          {herds.length === 0 && <option value="">No herds yet</option>}
        </select>
      </Field>
      <Field label="Description"><input value={f.desc} onChange={(e) => set("desc", e.target.value)} placeholder="e.g. Hay — 40 round bales" /></Field>
      <FormActions onClose={onClose} disabled={!f.amount} onSave={() => onSave({ ...f, amount: Number(f.amount) || 0 })} />
    </Modal>
  );
}

/* =========================================================================
   Pastures — interactive property map (satellite + boundary drawing)
========================================================================= */
function Pastures({ db, herdName, upsert, remove }: {
  db: DB; herdName: Labeler; upsert: Upsert; remove: Remove;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const pastureLayerRef = useRef<any>(null);
  const draftLayerRef = useRef<any>(null);
  const draftRef = useRef<LatLng[]>([]);
  const drawingRef = useRef(false);
  const satRef = useRef<any>(null);
  const streetRef = useRef<any>(null);
  const fittedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [basemap, setBasemap] = useState("sat");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingCoords, setPendingCoords] = useState<LatLng[] | null>(null);
  const [editing, setEditing] = useState<Pasture | null>(null);
  const [err, setErr] = useState(false);

  const pastures = db.pastures || [];
  const headForHerd = (id: string) => db.cattle.filter((c) => c.herdId === id && c.status === "Active").length;

  const redrawDraft = () => {
    const L = window.L; const g = draftLayerRef.current; if (!L || !g) return;
    g.clearLayers();
    const pts: LatLng[] = draftRef.current;
    pts.forEach((p) => L.circleMarker(p, { radius: 6, color: "#fff", weight: 2, fillColor: "#F4C430", fillOpacity: 1 }).addTo(g));
    if (pts.length >= 3) L.polygon(pts, { color: "#F4C430", weight: 2, fillColor: "#F4C430", fillOpacity: 0.25, dashArray: "6 6" }).addTo(g);
    else if (pts.length === 2) L.polyline(pts, { color: "#F4C430", weight: 2, dashArray: "6 6" }).addTo(g);
  };

  // load Leaflet from CDN and build the map once
  useEffect(() => {
    let cancelled = false;
    if (!document.getElementById("leaflet-css")) {
      const l = document.createElement("link");
      l.id = "leaflet-css"; l.rel = "stylesheet";
      l.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(l);
    }
    const init = () => {
      if (cancelled || mapRef.current || !mapEl.current || !window.L) return;
      const L = window.L;
      const map = L.map(mapEl.current, { zoomControl: true }).setView([35.0, -97.2], 6);
      mapRef.current = map;
      satRef.current = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery &copy; Esri" });
      streetRef.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
      satRef.current.addTo(map);
      pastureLayerRef.current = L.layerGroup().addTo(map);
      draftLayerRef.current = L.layerGroup().addTo(map);
      map.on("click", (e: any) => {
        if (!drawingRef.current) return;
        draftRef.current = [...draftRef.current, [e.latlng.lat, e.latlng.lng] as LatLng];
        setDraftCount(draftRef.current.length);
        redrawDraft();
      });
      setReady(true);
      setTimeout(() => map.invalidateSize(), 250);
    };
    if (window.L) init();
    else {
      let s = document.getElementById("leaflet-js") as HTMLScriptElement | null;
      if (!s) {
        s = document.createElement("script");
        s.id = "leaflet-js";
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
        document.body.appendChild(s);
      }
      s.addEventListener("load", init);
      s.addEventListener("error", () => setErr(true));
      setTimeout(() => { if (!window.L) setErr(true); }, 7000);
    }
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  // draw saved pastures whenever they change
  useEffect(() => {
    if (!ready || !mapRef.current || !window.L) return;
    const L = window.L; const g = pastureLayerRef.current; if (!g) return;
    g.clearLayers();
    pastures.forEach((p) => {
      if (!p.coords || p.coords.length < 3) return;
      const sel = p.id === selectedId;
      const poly = L.polygon(p.coords, { color: p.color || "#F4C430", weight: sel ? 4 : 2, fillColor: p.color || "#F4C430", fillOpacity: sel ? 0.4 : 0.2 });
      poly.on("click", () => setSelectedId(p.id));
      poly.bindTooltip(p.name || "Pasture", { permanent: true, direction: "center", className: "pasture-tip" });
      poly.addTo(g);
    });
    if (!fittedRef.current) {
      const all: LatLng[] = [];
      pastures.forEach((p) => p.coords && p.coords.forEach((c) => all.push(c)));
      if (all.length) { try { mapRef.current.fitBounds(all, { padding: [40, 40] }); } catch (e) {} fittedRef.current = true; }
    }
  }, [pastures, selectedId, ready]);

  // basemap toggle
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    if (basemap === "sat") { if (streetRef.current) map.removeLayer(streetRef.current); if (satRef.current) satRef.current.addTo(map); }
    else { if (satRef.current) map.removeLayer(satRef.current); if (streetRef.current) streetRef.current.addTo(map); }
  }, [basemap, ready]);

  const startDraw = () => { draftRef.current = []; setDraftCount(0); drawingRef.current = true; setDrawing(true); setSelectedId(null); redrawDraft(); };
  const undoPoint = () => { draftRef.current = draftRef.current.slice(0, -1); setDraftCount(draftRef.current.length); redrawDraft(); };
  const cancelDraw = () => { draftRef.current = []; setDraftCount(0); drawingRef.current = false; setDrawing(false); redrawDraft(); };
  const finishDraw = () => {
    if (draftRef.current.length < 3) return;
    const coords = draftRef.current.slice();
    draftRef.current = []; setDraftCount(0); drawingRef.current = false; setDrawing(false); redrawDraft();
    setPendingCoords(coords);
  };
  const locate = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition((pos) => mapRef.current.setView([pos.coords.latitude, pos.coords.longitude], 15), () => {});
  };
  const zoomTo = (p: Pasture) => { setSelectedId(p.id); if (mapRef.current && p.coords && p.coords.length) { try { mapRef.current.fitBounds(p.coords, { padding: [50, 50] }); } catch (e) {} } };

  return (
    <div className="view">
      <div className="view-head">
        <h2>Pastures</h2>
        {!drawing && <button className="btn tag" onClick={startDraw} disabled={err}><Plus size={18} /> Add pasture</button>}
      </div>

      {err ? (
        <div className="empty">
          <MapPin size={44} />
          <p>The map couldn't load in this preview — external map imagery may be blocked by the sandbox. Everything else in Herdbook still works, and the map will run when this app is hosted normally.</p>
        </div>
      ) : (
        <>
          {drawing && (
            <div className="draw-bar">
              <span className="grow">Tap the map to drop a corner at each fence point. {draftCount} {draftCount === 1 ? "point" : "points"} so far.</span>
              <button className="btn sm ghost" onClick={undoPoint} disabled={draftCount === 0}><Undo2 size={16} /> Undo</button>
              <button className="btn sm ghost" onClick={cancelDraw}>Cancel</button>
              <button className="btn sm tag" onClick={finishDraw} disabled={draftCount < 3}><Check size={16} /> Finish</button>
            </div>
          )}

          <div className="map-wrap">
            <div className="map" ref={mapEl} />
            {ready && (
              <div className="map-controls">
                <button className={"map-ctrl" + (basemap === "sat" ? " on" : "")} title="Toggle satellite / street" onClick={() => setBasemap((b) => (b === "sat" ? "street" : "sat"))}><Layers size={20} /></button>
                <button className="map-ctrl" title="Find my location" onClick={locate}><Crosshair size={20} /></button>
              </div>
            )}
          </div>

          {pastures.length === 0 ? (
            <div className="hint-box">No pastures mapped yet. Tap <strong>Add pasture</strong>, then tap the map to trace the boundary — Herdbook fills in the acreage automatically.</div>
          ) : (
            <div className="p-list">
              {pastures.map((p) => {
                const ac = acres(p.coords);
                const head = p.herdId ? headForHerd(p.herdId) : 0;
                return (
                  <div key={p.id} className={"p-item" + (p.id === selectedId ? " on" : "")} onClick={() => zoomTo(p)}>
                    <span className="p-swatch" style={{ background: p.color || "#F4C430" }} />
                    <div className="p-main">
                      <div className="p-name">{p.name || "Untitled pasture"}</div>
                      <div className="p-meta">
                        {fmtAcres(ac)}
                        {p.herdId ? ` · ${herdName(p.herdId)} · ${head} head` : " · no herd assigned"}
                        {p.herdId && head > 0 ? ` · ${(ac / head).toFixed(1)} ac/head` : ""}
                      </div>
                    </div>
                    <div className="p-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn sm" onClick={() => setEditing(p)}><Pencil size={16} /></button>
                      <button className="icon-btn sm danger" onClick={() => { if (confirm(`Delete ${p.name || "this pasture"}?`)) remove("pastures", p.id); }}><Trash2 size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {(pendingCoords || editing) && (
        <PastureForm
          herds={db.herds}
          initial={editing}
          coords={pendingCoords}
          onClose={() => { setPendingCoords(null); setEditing(null); }}
          onSave={(item) => { upsert("pastures", item); setPendingCoords(null); setEditing(null); setSelectedId(item.id); }}
        />
      )}
    </div>
  );
}

function PastureForm({ herds, initial, coords, onClose, onSave }: {
  herds: Herd[]; initial: Pasture | null; coords: LatLng[] | null; onClose: () => void; onSave: (item: Pasture) => void;
}) {
  const [f, setF] = useState<Pasture>(initial || { id: uid(), name: "", herdId: "", color: PASTURE_COLORS[1], note: "", coords: coords || [] });
  const set = fieldSetter(setF);
  const ac = acres(f.coords);
  return (
    <Modal title={initial ? "Edit pasture" : "Name this pasture"} onClose={onClose}>
      <div className="acre-readout"><span>{fmtAcres(ac)}</span><small>{f.coords.length} corners mapped</small></div>
      <Field label="Pasture name" required><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. North 40" /></Field>
      <Field label="Assign a herd (optional)">
        <select value={f.herdId} onChange={(e) => set("herdId", e.target.value)}>
          <option value="">No herd</option>
          {herds.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </Field>
      <Field label="Color on the map">
        <div className="swatch-row">
          {PASTURE_COLORS.map((c) => (
            <button key={c} type="button" className={"swatch" + (f.color === c ? " on" : "")} style={{ background: c }} onClick={() => set("color", c)} />
          ))}
        </div>
      </Field>
      <Field label="Notes"><input value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. good water, needs fence work" /></Field>
      <FormActions onClose={onClose} disabled={!f.name.trim()} saveLabel={initial ? "Save" : "Save pasture"} onSave={() => onSave(f)} />
    </Modal>
  );
}

/* =========================================================================
   Shared UI bits
========================================================================= */
function HerdPicker({ herds, value, onChange, onAdd }: {
  herds: Herd[]; value: string; onChange: (v: string) => void; onAdd: (h: Herd) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [species, setSpecies] = useState(DEFAULT_SPECIES);
  if (adding) {
    return (
      <div className="inline-add wrap">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New herd name" />
        <select value={species} onChange={(e) => setSpecies(e.target.value)}>
          {SPECIES_KEYS.map((k) => <option key={k} value={k}>{SPECIES[k].label}</option>)}
        </select>
        <button className="btn sm tag" onClick={() => { if (name.trim()) { onAdd({ id: uid(), name: name.trim(), location: "", note: "", species }); setAdding(false); setName(""); } }}>Add</button>
        <button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="inline-add">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {herds.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <button className="btn sm ghost" onClick={() => setAdding(true)}><Plus size={16} /> New herd</button>
    </div>
  );
}

function Pager({ page, pages, count, setPage }: {
  page: number; pages: number; count: number; setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  if (pages <= 1) return <div className="pager"><span className="muted">{count} {count === 1 ? "animal" : "animals"}</span></div>;
  const from = page * PAGE_SIZE + 1, to = Math.min(count, (page + 1) * PAGE_SIZE);
  return (
    <div className="pager">
      <span className="muted">Showing {from}–{to} of {count}</span>
      <div className="pager-btns">
        <button className="btn sm ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="muted">Page {page + 1} of {pages}</span>
        <button className="btn sm ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void; }) {
  return (
    <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode; }) => (
  <label className="field">
    <span className="field-label">{label}{required && <em> *</em>}</span>
    {children}
  </label>
);
const FormActions = ({ onClose, onSave, disabled, saveLabel = "Save" }: {
  onClose: () => void; onSave?: () => void; disabled?: boolean; saveLabel?: string;
}) => (
  <div className="form-actions">
    <button className="btn ghost" onClick={onClose}>Cancel</button>
    <button className="btn tag" disabled={disabled} onClick={onSave}>{saveLabel}</button>
  </div>
);

function CowIcon({ size = 24 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 6.5C3 6 2.5 4.5 3 3.2" />
      <path d="M19.5 6.5C21 6 21.5 4.5 21 3.2" />
      <path d="M5 7c-.8 1-1.2 2.4-1.2 3.8C3.8 14.6 7.4 17.5 12 17.5s8.2-2.9 8.2-6.7C20.2 9.4 19.8 8 19 7" />
      <path d="M9 13.6c.9.7 1.9 1 3 1s2.1-.3 3-1" />
      <circle cx="9.3" cy="10" r=".6" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="10" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* =========================================================================
   Styles
========================================================================= */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap');

.hb-root {
  --canvas:#E7E8DF; --surface:#FCFBF7; --ink:#242A20; --muted:#6C7264;
  --line:#D4D6C9; --pasture:#33502F; --pasture-dk:#284126; --tag:#F4C430;
  --tag-dk:#E0AE1C; --rust:#B0471F; --rust-bg:#F6E3DA; --soft-bg:#EDEFDF;
  --ok:#3E7A3A;
  font-family:'Archivo', system-ui, -apple-system, sans-serif;
  color:var(--ink); background:var(--canvas);
  min-height:100vh; display:flex; font-size:17px; line-height:1.4;
  -webkit-font-smoothing:antialiased;
}
.hb-root *{box-sizing:border-box;}
.hb-root button{font-family:inherit; cursor:pointer;}
.hb-root input, .hb-root select, .hb-root textarea{font-family:inherit; font-size:16px;}

/* ---- desktop rail ---- */
.rail{display:none; width:212px; background:var(--pasture-dk); color:#E9EEE4;
  flex-direction:column; padding:18px 12px; gap:4px; position:sticky; top:0; height:100vh;}
.rail-brand{display:flex; align-items:center; gap:10px; font-weight:800; font-size:22px;
  padding:8px 10px 20px; color:var(--tag); letter-spacing:.3px;}
.rail-item{display:flex; align-items:center; gap:12px; background:none; border:none;
  color:#CBD5C2; padding:13px 12px; border-radius:10px; font-size:16px; font-weight:600; text-align:left;}
.rail-item:hover{background:rgba(255,255,255,.07); color:#fff;}
.rail-item.on{background:var(--pasture); color:#fff;}

.main{flex:1; min-width:0; display:flex; flex-direction:column;}

/* ---- top bar ---- */
.topbar{position:sticky; top:0; z-index:20; background:var(--pasture);
  color:#fff; display:flex; align-items:center; justify-content:space-between;
  padding:12px 16px; gap:12px;}
.tb-brand{display:flex; align-items:center; gap:9px; font-weight:800; font-size:20px; color:var(--tag);}
.tb-right{display:flex; align-items:center; gap:10px;}
.dropdown{position:relative;}
.herd-select{display:flex; align-items:center; gap:8px; background:rgba(255,255,255,.14);
  color:#fff; border:1px solid rgba(255,255,255,.25); border-radius:9px; padding:9px 12px; font-weight:600; font-size:15px;}
.hs-label{max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.icon-btn{background:rgba(255,255,255,.14); color:#fff; border:1px solid rgba(255,255,255,.25);
  border-radius:9px; width:42px; height:42px; display:inline-flex; align-items:center; justify-content:center;}
.icon-btn:hover{background:rgba(255,255,255,.24);}
.menu{position:absolute; right:0; top:52px; background:var(--surface); color:var(--ink);
  border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 28px rgba(20,30,15,.18);
  min-width:200px; padding:6px; z-index:40;}
.menu.right{right:0;}
.menu-item{display:block; width:100%; text-align:left; background:none; border:none; padding:12px 12px;
  border-radius:8px; font-size:16px; color:var(--ink); font-weight:500;}
.menu-item:hover{background:var(--soft-bg);}
.menu-item.on{background:var(--soft-bg); font-weight:700;}
.menu-item.danger{color:var(--rust);}
.menu-empty{padding:12px; color:var(--muted); font-size:15px;}
.menu-item{display:flex; align-items:center; justify-content:space-between; gap:10px;}
.menu-tag{font-size:12px; font-weight:700; color:var(--muted); background:var(--soft-bg); padding:2px 8px; border-radius:20px;}
.menu-sep{height:1px; background:var(--line); margin:6px 4px;}

/* ---- content ---- */
.content{padding:18px 16px 96px; max-width:960px; width:100%; margin:0 auto;}
.view{display:flex; flex-direction:column; gap:18px;}
.view-head{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;}
.view-head h2{font-size:26px; font-weight:800; margin:0;}

/* ---- buttons ---- */
.btn{display:inline-flex; align-items:center; gap:7px; border:none; border-radius:10px;
  padding:12px 16px; font-size:16px; font-weight:700; min-height:46px;}
.btn.tag{background:var(--tag); color:#2A2410; box-shadow:inset 0 -2px 0 var(--tag-dk);}
.btn.tag:hover{background:#f7cd52;}
.btn.tag:disabled{background:#E4E2D4; color:#A6A594; box-shadow:none; cursor:not-allowed;}
.btn.ghost{background:var(--surface); color:var(--ink); border:1.5px solid var(--line);}
.btn.ghost:hover{border-color:var(--muted);}
.btn.ghost:disabled{opacity:.5; cursor:not-allowed;}
.btn.sm{padding:8px 12px; min-height:38px; font-size:15px; border-radius:9px;}
.icon-btn.sm{width:38px; height:38px; background:var(--surface); color:var(--muted); border:1.5px solid var(--line);}
.icon-btn.sm:hover{color:var(--ink); border-color:var(--muted);}
.icon-btn.sm.danger:hover{color:var(--rust); border-color:var(--rust);}

/* ---- stat board (hero) ---- */
.statboard{background:var(--pasture); color:#fff; border-radius:16px; padding:22px;
  display:flex; gap:24px; align-items:center; flex-wrap:wrap;}
.statboard.slim{padding:18px 22px;}
.head-total{display:flex; flex-direction:column; min-width:150px;}
.st-label{font-size:15px; color:#CBD9C4; font-weight:600;}
.st-number{font-size:58px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; color:var(--tag); margin:4px 0 2px;}
.st-sub{font-size:14px; color:#CBD9C4;}
.head-breakdown{display:flex; flex-wrap:wrap; gap:8px 22px; align-content:center;}
.bd-row{display:flex; align-items:baseline; gap:7px;}
.bd-count{font-size:24px; font-weight:800; font-variant-numeric:tabular-nums;}
.bd-class{font-size:15px; color:#CBD9C4;}

/* ---- panels & alerts ---- */
.panel{background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:16px 18px;}
.panel-title{margin:0 0 12px; font-size:17px; font-weight:700;}
.alerts{display:flex; flex-direction:column; gap:9px;}
.alert{display:flex; align-items:center; gap:11px; padding:13px 14px; border-radius:10px; font-size:15.5px; cursor:pointer;}
.alert.rust{background:var(--rust-bg); color:#7A2E12; border-left:4px solid var(--rust);}
.alert.soft{background:var(--soft-bg); color:#37451F; border-left:4px solid var(--pasture);}
.alert strong{font-weight:700;}
.all-clear{display:flex; align-items:center; gap:9px; color:var(--ok); font-weight:600; font-size:16px;}

.mini-grid{display:grid; grid-template-columns:repeat(3,1fr); gap:12px;}
.mini{background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:16px;
  display:flex; flex-direction:column; gap:4px; text-align:left;}
.mini:hover{border-color:var(--muted);}
.mini-label{font-size:14px; color:var(--muted); font-weight:600;}
.mini-value{font-size:28px; font-weight:800; font-variant-numeric:tabular-nums;}

/* ---- toolbar ---- */
.toolbar{display:flex; gap:10px; flex-wrap:wrap;}
.searchbox{flex:1; min-width:180px; display:flex; align-items:center; gap:8px; background:var(--surface);
  border:1.5px solid var(--line); border-radius:10px; padding:0 12px; color:var(--muted);}
.searchbox input{flex:1; border:none; outline:none; background:none; padding:12px 0; color:var(--ink);}
.toolbar select{background:var(--surface); border:1.5px solid var(--line); border-radius:10px; padding:11px 12px; color:var(--ink);}

/* ---- lists ---- */
.list-head{display:grid; grid-template-columns:1.4fr 1fr 1.3fr 1fr .8fr auto; gap:12px;
  padding:6px 14px; color:var(--muted); font-size:13px; font-weight:700;}
.list{display:flex; flex-direction:column; gap:8px;}
.row{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:12px 14px;
  display:grid; grid-template-columns:1.4fr 1fr 1.3fr 1fr .8fr auto; gap:6px 12px; align-items:center;}
.row.dim{opacity:.6;}
.row.expense{grid-template-columns:auto 2fr 1.2fr 1fr auto auto;}
.cell{font-size:15.5px; min-width:0;}
.cell.grow{overflow:hidden; text-overflow:ellipsis;}
.cell.amount{font-weight:800; font-variant-numeric:tabular-nums; text-align:right;}
.cell.actions{display:flex; align-items:center; gap:6px; justify-content:flex-end;}
.tag-cell{display:flex; align-items:center; gap:9px;}
.eartag{background:var(--tag); color:#2A2410; font-weight:800; padding:4px 9px; border-radius:7px;
  font-variant-numeric:tabular-nums; box-shadow:inset 0 -2px 0 var(--tag-dk); min-width:36px; text-align:center;}
.row-name{font-weight:600;}
.mob-label{display:none; color:var(--muted); font-size:13px; font-weight:600;}
.pill{background:var(--soft-bg); color:var(--muted); padding:3px 9px; border-radius:20px; font-size:13px; font-weight:700;}
.cat-pill{background:var(--soft-bg); color:#37451F; padding:5px 11px; border-radius:20px; font-size:14px; font-weight:700; white-space:nowrap;}

.pager{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding-top:4px;}
.pager-btns{display:flex; align-items:center; gap:10px;}
.muted{color:var(--muted); font-size:14px;}

/* ---- cards (births / health) ---- */
.cards{display:flex; flex-direction:column; gap:10px;}
.card{background:var(--surface); border:1px solid var(--line); border-radius:13px; padding:15px 16px;
  display:flex; justify-content:space-between; gap:14px; align-items:flex-start;}
.card.late{border-left:5px solid var(--rust);}
.card.soon{border-left:5px solid var(--tag-dk);}
.card-main{min-width:0;}
.card-title{font-size:18px; font-weight:800;}
.card-meta{color:var(--muted); font-size:14px; margin-top:2px;}
.card-line{display:flex; align-items:center; gap:7px; margin-top:8px; font-size:15.5px; flex-wrap:wrap;}
.card-line.ok{color:var(--ok); font-weight:600;}
.card-line.muted{color:var(--muted); font-size:14px;}
.due-badge{background:var(--soft-bg); padding:3px 9px; border-radius:20px; font-size:13px; font-weight:700; color:#37451F;}
.due-badge.late{background:var(--rust-bg); color:#7A2E12;}
.due-badge.soon{background:#FBEFC7; color:#7A5B12;}
.card-actions{display:flex; align-items:center; gap:6px; flex-shrink:0;}

/* ---- expense bars ---- */
.bars{flex:1; min-width:200px; display:flex; flex-direction:column; gap:7px;}
.bar-row{display:flex; align-items:center; gap:10px; font-size:14px;}
.bar-label{width:82px; color:#DCE6D6; font-weight:600;}
.bar-track{flex:1; background:rgba(255,255,255,.15); border-radius:6px; height:16px; overflow:hidden;}
.bar-fill{height:100%; background:var(--tag); border-radius:6px;}
.bar-val{width:78px; text-align:right; font-weight:700; font-variant-numeric:tabular-nums; color:#fff;}

/* ---- empty ---- */
.empty{background:var(--surface); border:1.5px dashed var(--line); border-radius:14px;
  padding:34px 22px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; color:var(--muted);}
.empty.tall{padding:56px 24px;}
.empty h2{color:var(--ink); font-size:24px; margin:0;}
.empty p{margin:0; max-width:420px; font-size:16px;}
.empty-actions{display:flex; gap:10px; flex-wrap:wrap; justify-content:center;}

/* ---- modal & forms ---- */
.modal-wrap{position:fixed; inset:0; background:rgba(25,30,18,.5); z-index:100;
  display:flex; align-items:flex-end; justify-content:center; padding:0;}
.modal{background:var(--surface); width:100%; max-width:520px; border-radius:18px 18px 0 0;
  max-height:92vh; overflow-y:auto; box-shadow:0 -8px 40px rgba(0,0,0,.25);}
.modal-head{position:sticky; top:0; background:var(--surface); display:flex; align-items:center;
  justify-content:space-between; padding:18px 18px 12px; border-bottom:1px solid var(--line); z-index:2;}
.modal-head h3{margin:0; font-size:20px; font-weight:800;}
.modal-head .icon-btn{background:var(--soft-bg); color:var(--ink); border:none;}
.modal-body{padding:16px 18px 22px; display:flex; flex-direction:column; gap:14px;}
.field{display:flex; flex-direction:column; gap:6px;}
.field-label{font-size:14px; font-weight:700; color:var(--ink);}
.field-label em{color:var(--rust); font-style:normal;}
.field input, .field select, .field textarea{border:1.5px solid var(--line); border-radius:10px;
  padding:12px 12px; background:#fff; color:var(--ink); width:100%; outline:none;}
.field input:focus, .field select:focus, .field textarea:focus{border-color:var(--pasture); box-shadow:0 0 0 3px rgba(51,80,47,.15);}
.field-row{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
.hint{font-size:13.5px; color:var(--muted); margin:0;}
.notice{background:var(--soft-bg); border-radius:10px; padding:12px; font-size:14.5px; color:#37451F;}
.check{display:flex; align-items:center; gap:10px; font-size:16px; font-weight:600; cursor:pointer;}
.check input{width:20px; height:20px; accent-color:var(--pasture);}
.form-actions{display:flex; gap:10px; justify-content:flex-end; padding-top:6px;}
.inline-add{display:flex; gap:8px; align-items:center;}
.inline-add select, .inline-add input{flex:1;}
.inline-add.wrap{flex-wrap:wrap;}
.inline-add.wrap input{min-width:140px;}
.herd-mgr{display:flex; flex-direction:column; gap:8px;}
.herd-mgr-row{display:flex; gap:8px; align-items:center;}
.herd-mgr-row input{flex:1; min-width:0; border:1.5px solid var(--line); border-radius:10px; padding:11px 12px; background:#fff; color:var(--ink); outline:none;}
.herd-mgr-row select{border:1.5px solid var(--line); border-radius:10px; padding:11px 10px; background:#fff; color:var(--ink); outline:none;}
.herd-mgr-row input:focus, .herd-mgr-row select:focus{border-color:var(--pasture); box-shadow:0 0 0 3px rgba(51,80,47,.15);}
.herd-mgr-count{min-width:34px; text-align:center; font-size:13px; font-weight:700; color:var(--muted); background:var(--soft-bg); border-radius:20px; padding:5px 0;}
.segmented{display:flex; border:1.5px solid var(--line); border-radius:10px; overflow:hidden;}
.segmented button{flex:1; background:#fff; border:none; padding:12px; font-weight:600; color:var(--muted); font-size:15px;}
.segmented button.on{background:var(--pasture); color:#fff;}

/* ---- bottom tab bar (mobile) ---- */
.tabbar{position:fixed; bottom:0; left:0; right:0; z-index:30; background:var(--surface);
  border-top:1px solid var(--line); display:flex; justify-content:space-around; padding:6px 4px 8px;
  box-shadow:0 -2px 16px rgba(20,30,15,.08);}
.tab{flex:1; background:none; border:none; display:flex; flex-direction:column; align-items:center; gap:3px;
  padding:6px 2px; color:var(--muted); font-size:12px; font-weight:600; border-radius:10px; min-height:54px;}
.tab.on{color:var(--pasture);}
.tab.on svg{color:var(--pasture);}

.desk-only{display:none;}

/* ---- pastures / map ---- */
.map-wrap{position:relative; border-radius:14px; overflow:hidden; border:1px solid var(--line);}
.map{height:56vh; min-height:340px; width:100%; background:#c7c8bd;}
.leaflet-container{font-family:inherit;}
.map-controls{position:absolute; top:12px; right:12px; z-index:500; display:flex; flex-direction:column; gap:8px;}
.map-ctrl{background:var(--surface); border:1px solid var(--line); border-radius:10px; width:46px; height:46px; display:flex; align-items:center; justify-content:center; color:var(--ink); box-shadow:0 2px 8px rgba(20,30,15,.2);}
.map-ctrl.on{background:var(--pasture); color:#fff; border-color:var(--pasture);}
.draw-bar{background:var(--pasture); color:#fff; display:flex; align-items:center; gap:9px; flex-wrap:wrap; padding:12px 14px; border-radius:12px;}
.draw-bar .grow{flex:1; min-width:180px; font-size:15px; font-weight:600;}
.draw-bar .btn.ghost{background:rgba(255,255,255,.14); border-color:rgba(255,255,255,.3); color:#fff;}
.draw-bar .btn.ghost:disabled{opacity:.5;}
.leaflet-tooltip.pasture-tip{background:rgba(28,38,20,.82); color:#fff; border:none; border-radius:6px; font-weight:700; font-size:12px; box-shadow:none; padding:3px 8px; white-space:nowrap;}
.leaflet-tooltip.pasture-tip:before{display:none;}
.hint-box{background:var(--soft-bg); border-radius:12px; padding:16px; color:#37451F; font-size:15.5px;}
.p-list{display:flex; flex-direction:column; gap:8px;}
.p-item{display:flex; align-items:center; gap:12px; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:12px 14px; cursor:pointer;}
.p-item.on{border-color:var(--pasture); box-shadow:0 0 0 2px rgba(51,80,47,.18);}
.p-swatch{width:22px; height:22px; border-radius:6px; flex-shrink:0; box-shadow:inset 0 0 0 2px rgba(255,255,255,.6);}
.p-main{flex:1; min-width:0;}
.p-name{font-weight:700; font-size:16px;}
.p-meta{color:var(--muted); font-size:14px; margin-top:1px;}
.p-actions{display:flex; gap:6px; flex-shrink:0;}
.acre-readout{display:flex; align-items:baseline; gap:10px; background:var(--soft-bg); border-radius:10px; padding:12px 14px;}
.acre-readout span{font-size:26px; font-weight:800; color:var(--pasture); font-variant-numeric:tabular-nums;}
.acre-readout small{color:var(--muted); font-size:13px;}
.swatch-row{display:flex; gap:8px; flex-wrap:wrap;}
.swatch{width:36px; height:36px; border-radius:9px; border:3px solid #fff; box-shadow:0 0 0 1px var(--line); cursor:pointer; padding:0;}
.swatch.on{box-shadow:0 0 0 3px var(--ink);}

/* ================= responsive ================= */
@media (max-width:719px){
  .row, .row.expense{grid-template-columns:1fr 1fr; gap:8px 12px;}
  .row .cell.actions{grid-column:1 / -1; justify-content:flex-start; border-top:1px dashed var(--line); padding-top:8px; margin-top:2px;}
  .mob-label{display:inline;}
  .cell.amount{text-align:left;}
  .row.expense .cell.grow{grid-column:1 / -1; font-weight:600;}
}
@media (min-width:720px){
  .rail{display:flex;}
  .tabbar{display:none;}
  .tb-brand{display:none;}
  .content{padding:24px 28px 40px;}
  .desk-only{display:grid;}
  .modal-wrap{align-items:center; padding:20px;}
  .modal{border-radius:18px;}
}
`;