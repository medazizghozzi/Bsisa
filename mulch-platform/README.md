# Mulch Advisory Platform

A local-first decision support web app for Tunisian farmers.
Farmers sign up, draw their plot on a map, and receive mulch application
recommendations with water and electricity savings estimates.
SMS alerts are simulated server-side — no internet or smartphone required by the farmer.

---

## Quick Start

```bash
# 1. Install dependencies (one-time)
npm install

# 2. Start the server
npm start

# 3. Open in browser
http://localhost:3000
```

The SQLite database (`db/mulch.db`) is created and seeded automatically on first run.
Delete it and restart to reset to a clean state.

---

## Demo Accounts (pre-seeded, ready to use)

| Name           | Phone          | Region   | Crop            | Soil |
|----------------|----------------|----------|-----------------|------|
| Ahmed Ben Ali  | +21671000001   | Kairouan | Tomato          | Loam |
| Fatima Trabelsi| +21671000002   | Jendouba | Young Olive Tree| Sandy|

Both accounts have pre-drawn plot polygons so the demo works even if live polygon
drawing fails during the presentation.

---

## Project Structure

```
mulch-platform/
├── server.js          # Express app — all API routes
├── package.json
├── db/
│   ├── schema.js      # SQLite schema creation + seed data
│   └── logic.js       # Server-side decision logic (all formulas)
└── public/
    ├── index.html     # Single-page app shell
    ├── css/
    │   └── style.css  # Mobile-first stylesheet
    └── js/
        └── app.js     # Frontend SPA: routing, map drawing, rendering
```

---

## Seeded Reference Data

### Regions — Evaporation Rates (mm/day)
Source: FAO WaPOR sample values for Tunisia

| Region   | Summer (Jun–Sep) | Spring/Autumn | Winter (Nov–Feb) | Map center         |
|----------|-----------------|---------------|------------------|--------------------|
| Kairouan | 5.5             | 3.8           | 2.1              | 35.678°N, 10.096°E |
| Jendouba | 4.2             | 3.0           | 1.8              | 36.501°N, 8.780°E  |
| Sfax     | 6.0             | 4.1           | 2.4              | 34.741°N, 10.760°E |

### Crops — Mulch Thickness & Crop Coefficient (Kc)
Source: Mulch thickness from agronomic practice guidelines; Kc from FAO Irrigation and Drainage Paper 56, Table 12

| Crop            | Thickness (cm) | Kc   |
|-----------------|---------------|------|
| Tomato          | 5             | 1.15 |
| Pepper          | 5             | 1.05 |
| Young Olive Tree| 8             | 0.65 |
| Citrus          | 7             | 0.85 |

### Soil Types — Water Retention Modifier
| Soil  | Modifier | Effect                          |
|-------|----------|---------------------------------|
| Sandy | 1.2      | Drains fast, higher evap stress |
| Loam  | 1.0      | Baseline                        |
| Clay  | 0.8      | Retains moisture, lower stress  |

### Forecast Days (for "Simulate Day" button)
| Day | Heat Wave | Label                       |
|-----|-----------|-----------------------------|
| 0   | No        | Normal — moderate conditions|
| 1   | No        | Normal — slight breeze      |
| 2   | Yes       | Heat wave — high evaporation|
| 3   | No        | Normal — after heat wave    |
| 4   | Yes       | Heat wave — second event    |
| 5   | No        | Cooling down                |
| 6   | No        | Normal                      |
| 7   | Yes       | Heat wave — third event     |

The sequence loops: day 8 reuses day 0's forecast, etc.

---

## Decision Logic & Formulas

All formulas live in `db/logic.js` with inline source citations.

### 1. Evaporation Rate
```
evap_rate = region_seasonal_value × (1.4 if heat_wave else 1.0)
```
Values sourced from FAO WaPOR Tunisia sample data.

### 2. Mulch Degradation
```
degradation% = min(100, (days_since_application × evap_rate × soil_modifier) / K)
```
- **K = 2.25** — tuned so 5 cm mulch degrades fully in ~45 days at 5 mm/day
  (K = 45 × 5 / 100 = 2.25)
- **soil_modifier**: Sandy=1.2, Loam=1.0, Clay=0.8
- Alert threshold: 60% degradation

### 3. Water Savings
```
water_saved_m³ = evap_rate × 0.33 × area_ha × 10,000 × 150 / 1,000
```
- **0.33** — 33% evaporation reduction under mulch
  Source: University of Florida IFAS study; range 17–79%, conservative figure used
- **10,000** — converts hectares to m²
- **150** — irrigation season days (May–September)
- **/1,000** — converts mm·m² to m³

### 4. Electricity Savings
```
elec_kWh = water_saved_m³ × 0.45
elec_TND = elec_kWh × 0.320
```
- **0.45 kWh/m³** — Tunisian agricultural pumping energy benchmark
- **0.320 TND/kWh** — STEG agricultural low-voltage tariff (2023 reference)

---

## API Reference

| Method | Path                            | Description                        |
|--------|---------------------------------|------------------------------------|
| POST   | /api/login                      | Login by phone number              |
| POST   | /api/signup                     | Create farmer account              |
| GET    | /api/regions                    | List all regions                   |
| GET    | /api/crops                      | List all crops                     |
| GET    | /api/soil-types                 | List all soil types                |
| POST   | /api/plots                      | Create a new plot                  |
| GET    | /api/farmers/:id/dashboard      | Full dashboard data for a farmer   |
| POST   | /api/service-requests           | Request a mulch application        |
| GET    | /api/farmers/:id/alerts         | List SMS alerts for a farmer       |
| POST   | /api/alerts/:id/reply           | Simulate "Reply 1" to schedule     |
| POST   | /api/alerts/:id/mark-read       | Mark alert as read                 |
| POST   | /api/demo/simulate-day          | Advance date, run decision logic   |
| POST   | /api/demo/reset                 | Reset demo state                   |
| GET    | /api/demo/state                 | Current demo date & forecast       |

---

## Offline Note

Leaflet map tiles are loaded from OpenStreetMap CDN.
For a fully offline demo, either:
1. Cache the tiles beforehand by panning around the map, or
2. Use a local tile server (e.g. `mbtiles-server`) with a Tunisia tile extract.

All decision logic, API routes, and seeded data work 100% offline — only the
map background tiles require a network connection.
