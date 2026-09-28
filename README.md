# DealFinder

**Search once. Find the best deal.** DealFinder is a price-comparison web app for the Nepali market: it compares stores in Nepal only, with every price in NPR. Search for a product, see matched offers from multiple stores ranked by **total price including delivery**, check 30-day price history, and set price-drop alerts.

> **Live data:** prices come from real Nepali stores — Hukut, Mobilemandu, Gadgetbyte Nepal and Evo Store — read from the product data each store publishes on its own site (see §6). `npm run sync` refreshes them. The fictional demo stores are still available for development with `ENABLE_MOCK_PROVIDERS=true`.

**Stack:** Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS · PostgreSQL · Prisma 6 · Auth.js v5 (credentials with bcrypt, JWT sessions) · zod · hand-rolled SVG chart (zero-dependency).

---

## 1. Run it locally

Prerequisite: Node.js 20 or newer.

```bash
npm install
cp .env.example .env          # then set AUTH_SECRET and CRON_SECRET (see §3)

# Start PostgreSQL. Pick one:
npm run db:local              # A) no install needed: embedded Postgres on :5433 (keep this terminal open)
docker compose up -d          # B) Docker: Postgres 16 on :5433
                              # C) your own Postgres: point DATABASE_URL at it

npm run db:migrate            # create tables (prisma migrate dev)
npm run db:seed               # create the admin + demo user (imports demo stores only if ENABLE_MOCK_PROVIDERS=true)
npm run sync                  # read live prices from the Nepali stores (first run ~1 hour)
npm run dev                   # http://localhost:3000
```

Seeded accounts:

| Role  | Email                    | Password                                         |
|-------|--------------------------|--------------------------------------------------|
| Admin | `admin@dealfinder.local` | value of `SEED_ADMIN_PASSWORD` in `.env`         |
| User  | `demo@dealfinder.local`  | `DemoUser-123`                                   |

Other scripts:

| Command | What it does |
|---|---|
| `npm run build && npm start` | Production build and server |
| `npm run sync` | Pull fresh data from every provider, then check price alerts |
| `npm run test:matching` | Product-matcher test cases (e.g. iPhone 15 ≠ iPhone 15 Pro) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:studio` | Browse the database in Prisma Studio |

## 2. Configure the database

- Set the connection string in `.env`: `DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?schema=public"`.
- The schema lives in `prisma/schema.prisma`, with these models: `User`, `Product`, `Store`, `ProductOffer`, `PriceHistory`, `PriceAlert`, `SavedProduct`, `FavoriteStore`, `SearchLog` and `SyncRun`.
- Money is stored as integers in **minor units** (paisa or cents), so there are no floating-point rounding errors.
- Indexes cover the hot paths: offers by `(productId, totalPrice)` and `discountPercent`, price history by `(offerId, recordedAt)`, search logs by time and query, products by category, brand and model.
- In development, `npm run db:migrate` creates a migration each time you change the schema. In production, `npm run db:deploy` applies the committed migrations.
- For very large catalogs, add a trigram index for fuzzy search: `CREATE EXTENSION pg_trgm; CREATE INDEX ON "Product" USING gin ("searchText" gin_trgm_ops);`.

## 3. Where API keys and secrets go

All secrets go in **environment variables**: `.env` locally, and your host's dashboard in production. They are read only in server code (providers, server actions, route handlers) and are never prefixed with `NEXT_PUBLIC_`, so they are never sent to the browser.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `AUTH_SECRET` | Signs session JWTs. Generate with `npx auth secret` |
| `CRON_SECRET` | Bearer token for `/api/cron/*` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin account created by the seed |
| `ENABLE_MOCK_PROVIDERS` | `true` shows the fictional demo stores and the demo banner (development only) |
| `ENABLE_LIVE_PROVIDERS` | `false` stops reading the live Nepali stores |
| `LIVE_REFRESH_HOURS` | Hours before a store page is read again on the next sync (default 12) |
| `LIVE_MAX_PAGES` | Optional cap on pages read per store per sync, for testing |
| `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | Price-alert emails (without them, alerts are logged to the console) |
| `IMAGE_RECOGNITION_API_KEY` | For a real "Search by Image" backend |
| `EXAMPLE_AFFILIATE_API_KEY`, … | One set per real provider you add |

## 4. How it works

```
Providers (APIs / affiliate feeds / merchant feeds / demo)
   │  src/lib/providers/*   RetailerProvider interface
   ▼
Ingestion + matching   src/lib/services/ingest.ts, src/lib/matching/*
   │  GTIN → model number → brand-blocked title/spec matching → confidence score
   ▼
PostgreSQL (Products, Offers, PriceHistory …)
   ▼
Search / compare / deals / alerts   src/lib/services/*  →  pages in src/app/*
```

**Product matching** (`src/lib/matching/`) is how the same product is found across stores:

1. **Barcode (GTIN/EAN/UPC):** identical gives 99%. Different barcodes are never merged.
2. **Model number (MPN) + brand:** identical gives 97%.
3. **Hard conflicts** mean "not the same product", whatever the title says: a different brand, a different variant word (Pro, Max, Plus, Ultra, Slim, Disc/Digital…), different storage or size (128GB vs 256GB, 5L vs 3L), a different color, different model numbers (15 vs 14, XM5 vs XM4), or an accessory against the product itself (an iPhone case vs an iPhone).
4. **Title similarity** otherwise: token Jaccard plus character-bigram Dice on normalized "core" tokens, adjusted for missing attributes.

At or above 85% the listing is attached to the existing product. Below that it becomes its own product; the system never merges on a guess. Each offer stores its `matchConfidence` and `matchMethod`, which appear as a "98% match" badge. Admins can review title-based matches at `/admin/offers?review=1` and unlink wrong ones.

**Ranking:** offers are ranked by total (price plus delivery). In-stock **new** offers rank first, then refurbished and used (badged), then out of stock. The "Cheapest deal" is therefore always a like-for-like new item. Use the New/Used filter to see used offers first.

## 5. Adding a new retailer or provider

1. Copy `src/lib/providers/examples/affiliate-feed-provider.ts`. It is a complete, documented template for an HTTP API or affiliate provider.
2. Implement the `RetailerProvider` interface (`src/lib/providers/types.ts`):
   - `searchProducts(query)`: live keyword search at the source
   - `getProduct(externalId)` and `getOffers(externalId)`: one listing, and fresh price and stock for it
   - `listCatalog()` (optional): the full feed export. Implement it for merchant feeds (CSV, XML or JSON).
   - `healthCheck()`: shown on `/admin/providers`
   Map the source's fields to `ProviderListing`, and always convert prices to minor units.
3. Add the credentials to `.env` (for example `ACME_API_KEY`).
4. Register the provider in `src/lib/providers/registry.ts`, ideally only when its key is present.
5. Run `npm run sync`, or click **Run sync now** in the admin. A `Store` row is created automatically from the provider's `info`, and its listings go through the matcher.

**Use only legally permitted sources:** official retailer APIs, affiliate networks, merchant-supplied feeds, or data you are licensed to use. Respect rate limits, terms of service and robots.txt. Do not build providers that bypass CAPTCHAs, bot protection, logins or other access controls.

## 6. Live Nepali stores

The stores in `src/lib/providers/live/stores.ts` are read by `SitemapStoreProvider`:

- It walks the store's public sitemap and reads the structured product data (schema.org JSON-LD, or the product data of Blanxer-built shops) that each product page publishes.
- It obeys the store's robots.txt (including Crawl-delay), sends one request at a time per store with a pause between them, and identifies itself as `DealFinderBot` with your site URL. If a store answers 401/403/429 the sync for that store stops instead of retrying.
- Pages are cached in `.cache/live/`; an interrupted sync resumes, and a page is only read again after `LIVE_REFRESH_HOURS`.
- Delivery charges come from the page when the store publishes them; otherwise they are counted as 0, so check the store for delivery to your area.

**Adding a store:** it must publish a sitemap and structured product data, and its robots.txt must allow product pages. Add an entry to `LIVE_STORES`, preview it with `npm run live:check` (reads 15 pages, touches nothing), then run `npm run sync`. Stores that block automated access (bot protection, robots.txt) must not be added this way — ask them for a product feed or use their affiliate program instead. Even for allowed stores, check their terms of use and consider asking them for a feed; it is more reliable than reading pages.

Other notes:

1. Schedule syncs (§7). Price history builds up from real price changes.
2. Real stores get **View Deal** links that redirect straight to the retailer through `/go/[offerId]`, which is also the natural place to add affiliate click tracking. Demo stores show an interstitial instead.
3. For "Search by Image", implement `ImageRecognizer` in `src/lib/image-recognition/index.ts` (for example Google Cloud Vision, AWS Rekognition, Azure AI Vision, or a multimodal LLM) and return it from `getImageRecognizer()`.
4. For "Paste a product link", `src/lib/services/link-resolver.ts` matches known listing URLs and otherwise infers search words from the URL path. Where a retailer has an approved API, resolve the URL through that provider instead.

## 7. Deploying

**Vercel (simplest):**
1. Create a managed Postgres (Neon, Supabase, Vercel Postgres, RDS…) and copy its URL.
2. Import the repo in Vercel and set the environment variables from §3. Set `NEXT_PUBLIC_SITE_URL` to your domain.
3. Build command: `prisma migrate deploy && npm run build`.
4. Seed the admin user once from your machine against production: `DATABASE_URL=… npm run db:seed`, then run `npm run sync` (the first full crawl takes longer than a serverless function may run, so do it from a machine or a scheduled worker).
5. Add Vercel Cron jobs in `vercel.json`. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically:
   ```json
   { "crons": [
     { "path": "/api/cron/sync", "schedule": "0 */6 * * *" },
     { "path": "/api/cron/check-alerts", "schedule": "0 * * * *" }
   ] }
   ```

**Any Node host or VPS (Docker, Railway, Render, Fly.io):** run `npm ci && npx prisma migrate deploy && npm run build && npm start` behind HTTPS with `AUTH_TRUST_HOST=true`. Call the two cron URLs with `curl -H "Authorization: Bearer $CRON_SECRET" https://your.site/api/cron/sync`.

**Before going live:**
- Replace the in-memory rate limiter and cache (`src/lib/rate-limit.ts`, `src/lib/cache.ts`) with Redis or Upstash when running more than one instance.
- Configure Resend (or another email provider) for alert emails, and verify your sending domain.
- Add your real image hosts to `images.remotePatterns` in `next.config.mjs`.

## 8. Security measures

- **Input validation:** zod schemas (`src/lib/validation.ts`) are checked server-side on every form, query string and API input.
- **Authentication:** Auth.js with bcrypt (cost 12) password hashes and signed JWT sessions. Middleware protects `/account`, `/saved` and `/admin`. The admin role is re-checked in the database on every admin action.
- **Rate limiting:** login (per IP and per email), sign-up, alerts, suggestions, image uploads and link lookups.
- **SQL injection:** every query goes through Prisma's parameterized API. There is no string-built SQL.
- **XSS:** React escapes all output. JSON-LD is serialized with `<` escaped, and alert email HTML is escaped.
- **Other:** open-redirect-safe `callbackUrl` handling, magic-byte checks on image uploads, a constant-time cron secret comparison, and security headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).

## 9. Project map

```
prisma/schema.prisma, seed.ts         database schema and demo seed
src/app/                              pages: /, /search, /product/[slug], /deals, /alerts, /saved, /account,
                                      /login, /signup, /category/[slug], /store/[slug], /image-search,
                                      /compare-link, /go/[offerId], /admin/*, api/*, sitemap.ts, robots.ts
src/actions/                          server actions (auth, user, admin, region)
src/components/                       UI (layout, product, search, admin)
src/lib/providers/                    RetailerProvider interface, registry, live Nepali stores, mock stores, real-provider template
src/lib/matching/                     normalization and the product matcher
src/lib/services/                     ingest, search, catalog, deals, alerts, suggestions, link resolver
scripts/                              sync, matcher tests, local embedded Postgres
```

*Prices and availability can change. Always verify the final price and delivery charges on the retailer's website.*
