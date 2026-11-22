# 90-Second Live Demo Script

**Setup:** `npm start` → open **http://localhost:3000** → hard-refresh (`Ctrl+Shift+R`).
Hit **↺ Reset** on the dashboard before every run to ensure day=0.

---

## Flow A — Pre-seeded account (safest, fastest)

### 0–10 s: Landing page
The site opens on the **AgriCulture-styled hero carousel** — real field photos,
scrolling through 5 slides about the platform.

Scroll down to show:
- **How It Works** (3-step cards: Satellite → Calculation → SMS)
- **Impact stats** (33%, 1,599 m³, 230 TND, 3 regions)
- **Supported crops** grid (Tomato / Pepper / Olive / Citrus with photos and mulch specs)

**Say:** *"This is what the farmer sees when they first visit — a real agricultural platform, not a prototype."*

---

### 10–20 s: Login
Scroll to the login form. Type **+21671000001** → **Sign In →**

→ Dashboard loads with Ahmed's Kairouan tomato plot.

**Say:** *"No password — just a phone number. That's intentional: rural farmers don't want another password to remember."*

---

### 20–40 s: Dashboard tour
Point to:
1. **Map** — green polygon = Ahmed's field
2. **Recommendation card** (crop photo banner, then stats):
   - Degradation bar: ~35%
   - Evaporation: **3.8 mm/day** (Kairouan, spring)
   - Water saved: **1,599 m³/season**
   - Cost saved: **230 TND/season**
   - Apply before: `2026-12-06`

**Say:** *"Server pulled the FAO WaPOR evaporation value for Kairouan, calculated mulch degradation since last application, and computed real savings using Tunisia's STEG electricity tariff. All server-side."*

---

### 40–55 s: Thermal map
Click **🌡 Thermal** button above the map.

The map switches to **CARTO dark base** with a continuous heat field:
- Blue/cyan over Jendouba valley (cool, mulched)
- Orange over Kairouan
- Red/purple over Chott el Djerid (hottest node)
- Plot polygon shows as white outline above the heat field
- Legend bottom-left: 15°C → 45°C+

**Say:** *"This is the live temperature model — IDW interpolation across 6 regional anchor points plus each farmer's plot. Mulched plots are cooler, exposed ones run hot. This is exactly the kind of view an agronomist would use to prioritise where to send mulch crews first."*

Click **🗺 Normal** to switch back.

---

### 55–70 s: Simulate Day → Heat wave → SMS alert
Click **⏭ Next Day** twice.
- Day 2: **🔥 Heat Wave** badge appears in the demo bar

Switch to **📱 Alerts** tab. An SMS bubble appears in the dark phone frame:

> *"Heat wave Monday. Tomato plot #1: mulch 52% degraded. Apply 5cm mulch before 2026-11-26. Save ~1599m³ water / 230 TND this season. Reply 1 to schedule application."*

**Say:** *"On day 2 the forecast flags a heat wave. The server re-runs the logic, evaporation spikes, degradation crosses the threshold, and an SMS is queued. Plain text — no smartphone needed. Works during power cuts."*

---

### 70–80 s: Reply 1 → Scheduled
Click **Reply 1 — Schedule**.

Toast: *"Application scheduled."*

Go back to **Dashboard** — card shows `🚜 Scheduled · 2026-11-28`.

**Say:** *"One SMS reply, service scheduled. The technician gets dispatched. Zero app required from the farmer."*

---

### 80–90 s: Wrap-up
Point to the disclaimer:
> *"Sample data for demo — production uses FAO WaPOR satellite data at 20m resolution"*

**Say:** *"Production replaces these seeded values with live FAO WaPOR satellite data at 20-metre resolution. The formulas — 33% evaporation reduction, 0.45 kWh/m³ pumping energy, STEG tariff — are all documented with source citations in the code."*

Click **↺ Reset** for the next judge.

---

## Flow B — Live signup + map drawing

1. Scroll to login form → **New farmer? Create account**
2. Name: **Yassine Khalil**, Phone: **+21699000099** → **Draw Your Plot →**
3. Map opens on Tunisia (zoom 7) — navigate to any field area, click 4–5 corners
4. Click **✅ Close polygon** — area in ha appears, region auto-detected
5. **Crop Details →** → Citrus, Sandy → **Create Account →**
6. Dashboard opens with Yassine's new Citrus plot + live recommendation

**If drawing fails:** "Let me use a pre-seeded account" → Flow A.

---

## Judge Q&A

| Question | Answer |
|---|---|
| "Where's the data?" | FAO WaPOR sample values seeded per region; production calls live satellite API |
| "Why SMS, not an app?" | SMS reaches any phone, no internet, no power — 95%+ rural Tunisia coverage |
| "How accurate are the savings?" | Conservative 33% (Florida IFAS range 17–79%). Varies with mulch type and quality |
| "What's the thermal map?" | IDW temperature field from 6 Tunisian regional anchors + per-plot nodes. Mulched plots run 11°C cooler than exposed ones |
| "Can it scale?" | Stateless server-side logic — swap SQLite for Postgres, scale horizontally |
| "Business model?" | Service-request fee per mulch application; platform takes a margin |

---

## Recovery

| Problem | Fix |
|---|---|
| Map tiles don't load (no wifi) | Polygons still render, logic still works. "Tiles need internet, decision engine is offline." |
| Drawing goes wrong | Use pre-seeded `+21671000001` |
| Server crashed | `npm start` — DB persists |
| Need fresh state | **↺ Reset** button on dashboard |
| Wrong day | **↺ Reset** resets to day 0 |
