import { supabase } from "./supabaseClient";
import type {
  DB, EntityKey, Herd, Animal, Birth, Vaccination, Expense, Pasture, LatLng,
} from "./App";

/* ============================================================================
   Herdbook data layer — talks to the relational Supabase/Postgres backend.

   THE NAMING SEAM lives here and ONLY here. The React app speaks camelCase
   (herdId, nextDue); Postgres speaks snake_case (herd_id, next_due). Every
   table has a `fromRow` (DB -> app) and a `toRow` (app -> DB). If a column in
   your schema is named differently than assumed below, fix it in the one
   mapper — nothing else in the app needs to change.

   ASSUMED COLUMNS (verify against init_herdbook_schema.sql):
     herds        : id, name, location, note, species
     cattle       : id, tag, name, herd_id, cls, breed, birth_date (date), status, note
     births       : id, dam_id, sire_id, bred, expected, actual (dates), status, note
     vaccinations : id, scope, target_id, vaccine, date_administered, next_due (dates), note, custom_name
     expenses     : id, herd_id, category, amount (numeric), date (date), description
     pastures     : id, name, herd_id, color, note, coords (jsonb)

   Two conversions worth knowing about:
     • Postgres `numeric` comes back from supabase-js as a STRING, so amount is
       coerced with Number() on read.
     • Empty-string dates/FKs ("") are written as NULL, because "" is not a
       valid date or uuid. On read, NULL becomes "" so the form inputs stay
       controlled.
============================================================================ */

// "" -> null (for nullable date / FK columns); anything else passes through.
const orNull = (v: string | undefined | null) => (v ? v : null);

interface EntityMap<T> {
  table: string;
  toRow: (item: T) => Record<string, unknown>;
  fromRow: (row: any) => T;
}

const herdMap: EntityMap<Herd> = {
  table: "herds",
  toRow: (h) => ({ id: h.id, name: h.name, location: h.location, note: h.note, species: h.species ?? null }),
  fromRow: (r) => ({ id: r.id, name: r.name ?? "", location: r.location ?? "", note: r.note ?? "", species: r.species ?? undefined }),
};

const cattleMap: EntityMap<Animal> = {
  table: "cattle",
  toRow: (c) => ({ id: c.id, tag: c.tag, name: c.name, herd_id: orNull(c.herdId), cls: c.cls, breed: c.breed, birth_date: orNull(c.birth), status: c.status, note: c.note }),
  fromRow: (r) => ({ id: r.id, tag: r.tag ?? "", name: r.name ?? "", herdId: r.herd_id ?? "", cls: r.cls ?? "", breed: r.breed ?? "", birth: r.birth_date ?? "", status: r.status ?? "Active", note: r.note ?? "" }),
};

const birthMap: EntityMap<Birth> = {
  table: "births",
  toRow: (b) => ({ id: b.id, dam_id: orNull(b.damId), sire_id: orNull(b.sireId), bred: orNull(b.bred), expected: orNull(b.expected), actual: orNull(b.actual), status: b.status, note: b.note }),
  fromRow: (r) => ({ id: r.id, damId: r.dam_id ?? "", sireId: r.sire_id ?? "", bred: r.bred ?? "", expected: r.expected ?? "", actual: r.actual ?? "", status: r.status ?? "Expecting", note: r.note ?? "" }),
};

const vaccinationMap: EntityMap<Vaccination> = {
  table: "vaccinations",
  toRow: (v) => ({ id: v.id, scope: v.scope, target_id: orNull(v.targetId), vaccine: v.vaccine, date_administered: orNull(v.date), next_due: orNull(v.nextDue), note: v.note, custom_name: v.customName ?? null }),
  fromRow: (r) => ({ id: r.id, scope: (r.scope === "animal" ? "animal" : "herd"), targetId: r.target_id ?? "", vaccine: r.vaccine ?? "", date: r.date_administered ?? "", nextDue: r.next_due ?? "", note: r.note ?? "", customName: r.custom_name ?? undefined }),
};

const expenseMap: EntityMap<Expense> = {
  table: "expenses",
  toRow: (e) => ({ id: e.id, herd_id: orNull(e.herdId), category: e.cat, amount: e.amount, date: orNull(e.date), description: e.desc }),
  fromRow: (r) => ({ id: r.id, herdId: r.herd_id ?? "", cat: r.category ?? "", amount: Number(r.amount) || 0, date: r.date ?? "", desc: r.description ?? "" }),
};

const pastureMap: EntityMap<Pasture> = {
  table: "pastures",
  toRow: (p) => ({ id: p.id, name: p.name, herd_id: orNull(p.herdId), color: p.color, note: p.note, coords: p.coords }),
  fromRow: (r) => ({ id: r.id, name: r.name ?? "", herdId: r.herd_id ?? "", color: r.color ?? "", note: r.note ?? "", coords: (r.coords ?? []) as LatLng[] }),
};

const MAPS: { [K in EntityKey]: EntityMap<DB[K][number]> } = {
  herds: herdMap,
  cattle: cattleMap,
  births: birthMap,
  vaccinations: vaccinationMap,
  expenses: expenseMap,
  pastures: pastureMap,
};

// FK-safe orderings: parents before children on write, children before parents on delete.
const WRITE_ORDER: EntityKey[] = ["herds", "cattle", "births", "vaccinations", "expenses", "pastures"];
const DELETE_ORDER: EntityKey[] = ["births", "vaccinations", "expenses", "pastures", "cattle", "herds"];

/* ---- POINT 2: relational load — one select per table, assembled into a DB ---- */
export async function loadDB(): Promise<DB | null> {
  const results = await Promise.all(
    WRITE_ORDER.map((k) => supabase.from(MAPS[k].table).select("*"))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) { console.error("loadDB failed", failed.error); return null; }

  const rowsFor = (k: EntityKey) => results[WRITE_ORDER.indexOf(k)].data ?? [];
  return {
    herds: rowsFor("herds").map(herdMap.fromRow),
    cattle: rowsFor("cattle").map(cattleMap.fromRow),
    births: rowsFor("births").map(birthMap.fromRow),
    vaccinations: rowsFor("vaccinations").map(vaccinationMap.fromRow),
    expenses: rowsFor("expenses").map(expenseMap.fromRow),
    pastures: rowsFor("pastures").map(pastureMap.fromRow),
  };
}

/* ---- POINT 1: targeted writes — one small request per change ---- */
// upsert = insert or update on primary-key conflict, so it covers add AND edit.
export async function saveEntity<K extends EntityKey>(key: K, item: DB[K][number]): Promise<void> {
  const m = MAPS[key];
  const { error } = await supabase.from(m.table).upsert(m.toRow(item));
  if (error) console.error(`save ${key} failed`, error);
}

export async function deleteEntity(key: EntityKey, id: string): Promise<void> {
  const { error } = await supabase.from(MAPS[key].table).delete().eq("id", id);
  if (error) console.error(`delete ${key} failed`, error);
}

/* ---- bulk helpers, for the "Load sample ranch" / "Clear all data" buttons ---- */
export async function clearAll(): Promise<void> {
  for (const k of DELETE_ORDER) {
    const { error } = await supabase.from(MAPS[k].table).delete().not("id", "is", null);
    if (error) console.error(`clear ${k} failed`, error);
  }
}

export async function replaceAll(db: DB): Promise<void> {
  await clearAll();
  for (const k of WRITE_ORDER) {
    const rows = db[k].map((item) => (MAPS[k] as EntityMap<DB[typeof k][number]>).toRow(item));
    if (rows.length === 0) continue;
    const { error } = await supabase.from(MAPS[k].table).upsert(rows);
    if (error) console.error(`seed ${k} failed`, error);
  }
}