/**
 * Server-side decision logic for the Mulch Advisory Platform.
 *
 * All formulas are documented with their source constants.
 * This module is intentionally kept pure (no DB calls) so it can be
 * unit-tested and explained to judges independently.
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/**
 * Reduction factor for evaporation under mulch.
 * Source: University of Florida IFAS study on organic mulch.
 * Range reported: 17–79%. We use 33% as a conservative figure.
 */
const MULCH_EVAP_REDUCTION_FACTOR = 0.33;

/**
 * Energy required to pump 1 m³ of water (kWh/m³).
 * Source: Tunisian agricultural pumping energy benchmark
 * (typical small-pump efficiency in irrigated plains).
 */
const PUMPING_ENERGY_KWH_PER_M3 = 0.45;

/**
 * Electricity tariff for agricultural use in Tunisia (TND/kWh).
 * Source: STEG (Société Tunisienne de l'Electricité et du Gaz)
 * agricultural low-voltage tariff, 2023 reference.
 */
const ELECTRICITY_TARIFF_TND_PER_KWH = 0.320;

/**
 * Irrigation season length in days.
 * We use 150 days (roughly May–September) as the reference season.
 */
const SEASON_DAYS = 150;

/**
 * Degradation threshold (%) above which the system recommends mulch application.
 */
const DEGRADATION_ALERT_THRESHOLD = 60;

/**
 * Heat-wave evaporation multiplier.
 * On a heat-wave day the effective evaporation is boosted by 40%.
 */
const HEAT_WAVE_MULTIPLIER = 1.4;

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Determine which seasonal evaporation rate to use based on a date string.
 * Returns 'summer' | 'spring' | 'winter'.
 * @param {string} dateStr  ISO date, e.g. "2026-11-21"
 */
function getSeason(dateStr) {
  const month = new Date(dateStr).getMonth() + 1; // 1-based
  if (month >= 6 && month <= 9)  return 'summer';
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 10 && month <= 11) return 'spring'; // transitional
  return 'winter';
}

/**
 * Get the evaporation rate (mm/day) for a region on a given date.
 * @param {object} region   Row from regions table
 * @param {string} dateStr  ISO date string
 * @param {boolean} isHeatWave  Whether the forecast flags a heat wave
 */
function getEvaporationRate(region, dateStr, isHeatWave = false) {
  const season = getSeason(dateStr);
  let rate;
  if (season === 'summer')      rate = region.evap_summer;
  else if (season === 'spring') rate = region.evap_spring;
  else                          rate = region.evap_winter;

  // Apply heat-wave multiplier when forecast flag is set
  if (isHeatWave) rate = rate * HEAT_WAVE_MULTIPLIER;
  return Math.round(rate * 100) / 100;
}

/**
 * Estimate mulch degradation percentage.
 *
 * Formula:
 *   degradation% = min(100, (days_since_application × evap_rate) / K)
 *
 * K is crop-specific but tuned so that mulch at the recommended thickness
 * fully degrades in ~45 days under 5 mm/day evaporation:
 *   K = (45 × 5) / 100 = 2.25
 *
 * The soil water retention modifier adjusts effective evaporation stress.
 *
 * @param {number} daysSinceApplication
 * @param {number} evapRate  mm/day (current)
 * @param {number} K         degradation constant from crops table
 * @param {number} soilMod   water retention modifier from soil_types table
 * @returns {number} 0–100
 */
function calcDegradation(daysSinceApplication, evapRate, K, soilMod = 1.0) {
  if (daysSinceApplication == null || daysSinceApplication < 0) return 0;
  const effectiveEvap = evapRate * soilMod;
  return Math.min(100, Math.round((daysSinceApplication * effectiveEvap) / K));
}

/**
 * Estimate soil moisture status based on degradation and evaporation.
 * Returns 'high' | 'medium' | 'low'.
 */
function calcSoilMoistureStatus(degradationPct, evapRate) {
  // High moisture: mulch still mostly intact and evap is low
  if (degradationPct < 30 && evapRate < 4.0) return 'high';
  if (degradationPct > 70 || evapRate > 5.0) return 'low';
  return 'medium';
}

/**
 * Calculate estimated water savings for the season.
 *
 * Formula:
 *   water_saved_m3 = evap_rate × reduction_factor × area_ha × 10000 m²/ha
 *                   × SEASON_DAYS / 1000 (convert mm·m² to m³)
 *
 * Simplification: evap_rate here is the average daily rate for the season.
 * We use the summer (peak) rate as a conservative worst-case season average.
 *
 * @param {number} evapRate      mm/day
 * @param {number} areaHa        plot area in hectares
 * @returns {number}             m³ saved per season
 */
function calcWaterSavings(evapRate, areaHa) {
  // 10000 converts ha → m²; /1000 converts mm·m² → m³
  const saved = evapRate * MULCH_EVAP_REDUCTION_FACTOR * areaHa * 10000 * SEASON_DAYS / 1000;
  return Math.round(saved);
}

/**
 * Calculate estimated electricity savings from reduced irrigation.
 *
 * Formula:
 *   elec_savings_kWh = water_saved_m3 × PUMPING_ENERGY_KWH_PER_M3
 *   elec_savings_TND = elec_savings_kWh × ELECTRICITY_TARIFF_TND_PER_KWH
 *
 * Constants:
 *   0.45 kWh/m³ — Tunisian pumping energy benchmark
 *   0.320 TND/kWh — STEG agricultural tariff
 *
 * @param {number} waterSavedM3
 * @returns {{ kWh: number, tnd: number }}
 */
function calcElectricitySavings(waterSavedM3) {
  const kWh = Math.round(waterSavedM3 * PUMPING_ENERGY_KWH_PER_M3);
  const tnd = Math.round(kWh * ELECTRICITY_TARIFF_TND_PER_KWH * 10) / 10;
  return { kWh, tnd };
}

/**
 * Calculate how many days until mulch should be applied (deadline).
 * When degradation > threshold, deadline is 0 (apply immediately).
 * Otherwise project how many days until threshold is hit.
 *
 * @param {number} degradationPct  current degradation (0–100)
 * @param {number} evapRate        mm/day
 * @param {number} K               degradation constant
 * @param {number} soilMod         soil modifier
 * @returns {number}               days until deadline (0 = apply now)
 */
function calcDaysUntilDeadline(degradationPct, evapRate, K, soilMod = 1.0) {
  if (degradationPct >= DEGRADATION_ALERT_THRESHOLD) return 0;
  const effectiveEvap = evapRate * soilMod;
  if (effectiveEvap === 0) return 999;
  // Remaining days: (threshold - current) * K / effectiveEvap
  const remaining = Math.floor(
    (DEGRADATION_ALERT_THRESHOLD - degradationPct) * K / effectiveEvap
  );
  return Math.max(0, remaining);
}

/**
 * Build a complete recommendation object for a single plot.
 *
 * @param {object} opts
 * @param {object} opts.region        region row (evap_summer, evap_spring, evap_winter)
 * @param {object} opts.crop          crop row (mulch_thickness_cm, degradation_k)
 * @param {object} opts.soilType      soil_type row (water_retention_mod)
 * @param {number} opts.areaHa        plot area in hectares
 * @param {string|null} opts.lastApplicationDate  ISO date or null
 * @param {string} opts.currentDate   ISO date (from demo_state)
 * @param {boolean} opts.isHeatWave   from forecast_days for current day_offset
 * @returns {object}  full recommendation card data
 */
function buildRecommendation({ region, crop, soilType, areaHa, lastApplicationDate, currentDate, isHeatWave }) {
  const evapRate = getEvaporationRate(region, currentDate, isHeatWave);

  // Days since last mulch application
  let daysSince = null;
  if (lastApplicationDate) {
    const ms = new Date(currentDate) - new Date(lastApplicationDate);
    daysSince = Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  const degradationPct = calcDegradation(daysSince, evapRate, crop.degradation_k, soilType.water_retention_mod);
  const soilMoisture   = calcSoilMoistureStatus(degradationPct, evapRate);
  const applyMulch     = degradationPct >= DEGRADATION_ALERT_THRESHOLD || daysSince === null;
  const waterSaved     = calcWaterSavings(evapRate, areaHa);
  const electricitySaved = calcElectricitySavings(waterSaved);
  const daysUntil      = calcDaysUntilDeadline(degradationPct, evapRate, crop.degradation_k, soilType.water_retention_mod);

  // Deadline date string
  const deadlineDate = new Date(new Date(currentDate).getTime() + daysUntil * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  return {
    evapRate,
    isHeatWave,
    season: getSeason(currentDate),
    daysSince,
    degradationPct,
    soilMoisture,
    applyMulch,
    mulchThicknessCm: crop.mulch_thickness_cm,
    waterSavedM3: waterSaved,
    electricitySavedKWh: electricitySaved.kWh,
    electricitySavedTND: electricitySaved.tnd,
    daysUntilDeadline: daysUntil,
    deadlineDate,
    // Flags used for SMS generation
    needsAlert: applyMulch || isHeatWave,
    alertTrigger: isHeatWave ? 'heat_wave' : (applyMulch ? 'degradation' : 'routine'),
  };
}

/**
 * Generate the SMS message text for a plot alert.
 * Designed to be terse and readable on a basic phone screen.
 */
function buildSmsMessage({ farmerName, cropName, plotId, recommendation, currentDate }) {
  const { isHeatWave, degradationPct, mulchThicknessCm, waterSavedM3, electricitySavedTND, deadlineDate } = recommendation;

  let opening = '';
  if (isHeatWave) {
    // Format date as "Thursday 23 Nov"
    const d = new Date(currentDate);
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
    opening = `Heat wave ${dayName}. `;
  }

  const cropLabel = cropName;
  const degradLabel = `mulch ${degradationPct}% degraded`;
  const action = `Apply ${mulchThicknessCm}cm mulch before ${deadlineDate}`;
  const savings = `Save ~${waterSavedM3}m³ water / ${electricitySavedTND} TND this season`;
  const reply = `Reply 1 to schedule application.`;

  return `${opening}${cropLabel} plot #${plotId}: ${degradLabel}. ${action}. ${savings}. ${reply}`;
}

module.exports = {
  getEvaporationRate,
  calcDegradation,
  calcSoilMoistureStatus,
  calcWaterSavings,
  calcElectricitySavings,
  calcDaysUntilDeadline,
  buildRecommendation,
  buildSmsMessage,
  getSeason,
  DEGRADATION_ALERT_THRESHOLD,
  MULCH_EVAP_REDUCTION_FACTOR,
  PUMPING_ENERGY_KWH_PER_M3,
  ELECTRICITY_TARIFF_TND_PER_KWH,
  SEASON_DAYS,
};
