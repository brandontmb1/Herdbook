-- Enable PostGIS for future pasture area calculations
create extension if not exists postgis;

-- 1. Herds
create table herds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid, -- We will link this to Supabase Auth later!
  created_at timestamptz default now()
);

-- 2. Cattle
create table cattle (
  id uuid primary key default gen_random_uuid(),
  herd_id uuid references herds(id) on delete restrict, -- Prevents accidentally deleting a whole herd
  tag_number text not null,
  name text,
  breed text,
  birth_date date,
  owner_id uuid,
  created_at timestamptz default now()
);

-- 3. Births
create table births (
  id uuid primary key default gen_random_uuid(),
  calf_id uuid references cattle(id) on delete cascade,
  mother_id uuid references cattle(id) on delete set null,
  date date not null,
  notes text,
  owner_id uuid,
  created_at timestamptz default now()
);

-- 4. Vaccinations
create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid references cattle(id) on delete cascade,
  vaccine_name text not null,
  date_administered date not null,
  owner_id uuid,
  created_at timestamptz default now()
);

-- 5. Expenses
create table expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(12, 2) not null, -- Ensures exact penny precision, no floating-point drift
  expense_date date not null,
  category text,
  owner_id uuid,
  created_at timestamptz default now()
);

-- 6. Pastures
create table pastures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  coordinates jsonb not null, -- Kept as JSONB so your current React frontend doesn't break
  owner_id uuid,
  created_at timestamptz default now()
);