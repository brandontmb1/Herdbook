Herdbook

A field tool for managing cattle across herds — built for the pasture, not the office.

Herdbook keeps a ranch's records in one place: the animals themselves, the ground they graze, breeding and calving, health and vaccinations, and what it all costs. It's designed to be usable with a phone in one hand at the working chute, including where the signal is poor or gone.

Features
Cattle & herd records — ear tag, name, class (cow, bull, heifer, steer, calf), breed, birth date, and status (active, sold, deceased), organized into herds. Search and filter across the whole operation or scope the entire app to a single herd.
Pastures — trace paddock boundaries on an interactive satellite map and Herdbook computes the acreage automatically. Assign a herd to each pasture to see stocking density (acres per head) at a glance.
Births & breeding — log a breeding and the expected calving date is worked out from a 283-day gestation. Mark a cow calved (optionally adding the calf as a new animal in one step) and track each record as expecting, calved, or lost.
Health & vaccinations — record a treatment for a whole herd or a single animal, set a next-due date, and get reminders before it lapses.
Expenses — track feed, vet, breeding, equipment, labor, and more, totaled by category and by herd.
At-a-glance dashboard — head counts by class, a "needs attention" feed for overdue and upcoming calvings and vaccinations, and month-to-date spend.
Multi-tenant — each account's data is isolated at the database level via row-level security.
Tech stack
Frontend: React + Vite + TypeScript
Backend: Supabase — PostgreSQL, Auth, and the auto-generated REST API — connected through the supabase-js client
Maps: Leaflet with Esri World Imagery (satellite) and OpenStreetMap tiles
Schema: raw SQL migrations and seed data
Getting started (local development)
Prerequisites
Node.js LTS
Docker + Docker Compose
Supabase CLI
git
Setup
bash
# 1. Clone and install
git clone <your-repo-url>
cd herdbook
npm install

# 2. Start the local Supabase stack (Postgres, Auth, REST) in Docker
supabase start

# 3. Apply the schema and seed data
supabase db reset      # runs migrations, then seed.sql

# 4. Point the app at your local backend
cp .env.example .env   # then fill in the values from `supabase start` output

# 5. Run the dev server
npm run dev

supabase start prints your local API URL and keys — copy those into .env.

Environment variables

The frontend reads these at build time (Vite requires the VITE_ prefix):

VITE_SUPABASE_URL=            # e.g. http://localhost:8000 (or your local API URL)
VITE_SUPABASE_ANON_KEY=       # the publishable / anon key, safe for client use

Never put the service-role / secret key in a VITE_-prefixed variable — anything with that prefix is shipped to the browser.

Project layout

Roughly (adjust to match your repo):

herdbook/
├── src/                 # React + TypeScript app
├── supabase/
│   ├── migrations/      # SQL schema migrations
│   ├── seed.sql         # sample data for local dev
│   └── config.toml      # Supabase CLI config
├── .env.example
└── package.json
Scripts
bash
npm run dev        # start the Vite dev server
npm run build      # production build
npm run preview    # preview the production build locally

(Adjust to match the scripts defined in your package.json.)

Deployment
Develop on your main machine with the Supabase CLI stack running in Docker.
Demo / pilot on a self-hosted Supabase stack (Docker Compose) reached through a Cloudflare Tunnel — see the separate host setup guide.
Production, once real users depend on uptime, moves off self-hosting: frontend to a static host such as Vercel, backend to hosted Supabase or a managed VPS.

The Supabase CLI's local stack is for development only and should never be exposed to external traffic; the self-hosted Docker Compose stack is the one built to face the internet.

Status

Active development. Moving from working prototype toward a commercial release.
