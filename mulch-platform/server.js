/**
 * Mulch Advisory Platform — Express Server
 * Run with: node server.js  (or npm start)
 * Opens at: http://localhost:3000
 * Admin:    http://localhost:3000/admin
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const nodemailer = require('nodemailer');
const { initDb } = require('./db/schema');
const { buildRecommendation, buildSmsMessage } = require('./db/logic');

const app = express();
const db  = initDb();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Nodemailer (Ethereal test account for demo — logs preview URL to console)
let mailer;
nodemailer.createTestAccount().then(acct => {
  mailer = nodemailer.createTransport({
    host: acct.smtp.host, port: acct.smtp.port, secure: acct.smtp.secure,
    auth: { user: acct.user, pass: acct.pass },
  });
  console.log('📧  Email preview: https://ethereal.email (check console for preview URLs)');
}).catch(() => { mailer = null; });

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDemoState() {
  const st  = db.prepare('SELECT * FROM demo_state WHERE id = 1').get();
  const max = db.prepare('SELECT MAX(day_offset) as m FROM forecast_days').get().m;
  const eff = st.day_offset % (max + 1);
  const fc  = db.prepare('SELECT * FROM forecast_days WHERE day_offset = ?').get(eff);
  return {
    currentDate:   st.current_date,
    dayOffset:     st.day_offset,
    isHeatWave:    fc ? !!fc.heat_wave : false,
    forecastLabel: fc ? fc.label : 'Normal',
  };
}

function getPlotRecommendation(plot, currentDate, isHeatWave) {
  const region   = db.prepare('SELECT * FROM regions    WHERE id = ?').get(plot.region_id);
  const crop     = db.prepare('SELECT * FROM crops      WHERE id = ?').get(plot.crop_id);
  const soilType = db.prepare('SELECT * FROM soil_types WHERE id = ?').get(plot.soil_type_id);
  return buildRecommendation({ region, crop, soilType, areaHa: plot.area_ha,
    lastApplicationDate: plot.last_application_date, currentDate, isHeatWave });
}

/** Send alert via all enabled channels for a farmer */
async function dispatchAlert(farmer, plot, crop, message) {
  const channels = db.prepare(`
    SELECT * FROM alert_channels WHERE farmer_id = ? AND enabled = 1
  `).all(farmer.id);

  for (const ch of channels) {
    if (ch.channel_type === 'sms') {
      // SMS is simulated — recorded in DB (real gateway: Twilio/Nexmo)
      console.log(`📱 SMS → ${ch.destination}: ${message.substring(0,80)}...`);
    } else if (ch.channel_type === 'email' && mailer) {
      try {
        const info = await mailer.sendMail({
          from:    '"Mulch Advisory" <noreply@mulch.tn>',
          to:      ch.destination,
          subject: `🌿 Mulch Alert — ${crop.name} Plot #${plot.id}`,
          text:    message,
          html:    `<p style="font-family:sans-serif">${message.replace(/\n/g,'<br>')}</p>
                    <hr><small>Mulch Advisory Platform — Tunisia</small>`,
        });
        console.log(`📧 Email preview: ${nodemailer.getTestMessageUrl(info)}`);
      } catch(e) { console.error('Email error:', e.message); }
    } else if (ch.channel_type === 'whatsapp') {
      // WhatsApp stub — log only (real: Twilio WhatsApp API)
      console.log(`💬 WhatsApp → ${ch.destination}: ${message.substring(0,80)}...`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FARMER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/regions',    (_, res) => res.json(db.prepare('SELECT * FROM regions').all()));
app.get('/api/crops',      (_, res) => res.json(db.prepare('SELECT * FROM crops').all()));
app.get('/api/soil-types', (_, res) => res.json(db.prepare('SELECT * FROM soil_types').all()));

/** POST /api/login  { phone } */
app.post('/api/login', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const farmer = db.prepare('SELECT * FROM farmers WHERE phone = ?').get(phone.trim());
  if (!farmer) return res.status(404).json({ error: 'Farmer not found. Please sign up first.' });
  if (farmer.status === 'pending')
    return res.status(403).json({ error: 'Account pending approval. An admin will review your registration shortly.' });
  if (farmer.status === 'rejected')
    return res.status(403).json({ error: 'Account rejected. Please contact support.' });
  const plots = db.prepare('SELECT * FROM plots WHERE farmer_id = ?').all(farmer.id);
  res.json({ farmer, plots });
});

/** POST /api/signup  { name, phone, email?, region_id? } */
app.post('/api/signup', (req, res) => {
  const { name, phone, email } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
  if (db.prepare('SELECT id FROM farmers WHERE phone = ?').get(phone.trim()))
    return res.status(409).json({ error: 'Phone already registered. Please log in.' });

  const result = db.prepare(
    'INSERT INTO farmers (name, phone, email, region_id, status, role) VALUES (?, ?, ?, 1, ?, ?)'
  ).run(name.trim(), phone.trim(), email || null, 'pending', 'farmer');

  const farmer = db.prepare('SELECT * FROM farmers WHERE id = ?').get(result.lastInsertRowid);

  // Auto-create SMS channel
  db.prepare('INSERT INTO alert_channels (farmer_id, channel_type, destination) VALUES (?,?,?)')
    .run(farmer.id, 'sms', phone.trim());
  if (email) {
    db.prepare('INSERT INTO alert_channels (farmer_id, channel_type, destination) VALUES (?,?,?)')
      .run(farmer.id, 'email', email.trim());
  }

  res.status(201).json({ farmer });
});

/** POST /api/plots */
app.post('/api/plots', (req, res) => {
  const { farmer_id, region_id, crop_id, soil_type_id, polygon_geojson, area_ha } = req.body;
  if (!farmer_id || !region_id || !crop_id || !soil_type_id || !polygon_geojson || !area_ha)
    return res.status(400).json({ error: 'All plot fields are required' });

  const result = db.prepare(`
    INSERT INTO plots (farmer_id, region_id, crop_id, soil_type_id, polygon_geojson, area_ha)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(farmer_id, region_id, crop_id, soil_type_id,
     typeof polygon_geojson === 'string' ? polygon_geojson : JSON.stringify(polygon_geojson),
     area_ha);

  res.status(201).json({ plot: db.prepare('SELECT * FROM plots WHERE id = ?').get(result.lastInsertRowid) });
});

/** PUT /api/plots/:id  — farmer edits crop, soil, mulch date, area, region */
app.put('/api/plots/:id', (req, res) => {
  const { crop_id, soil_type_id, last_application_date, area_ha, region_id, polygon_geojson } = req.body;
  const plot = db.prepare('SELECT * FROM plots WHERE id = ?').get(req.params.id);
  if (!plot) return res.status(404).json({ error: 'Plot not found' });

  db.prepare(`
    UPDATE plots SET
      crop_id               = COALESCE(?, crop_id),
      soil_type_id          = COALESCE(?, soil_type_id),
      last_application_date = COALESCE(?, last_application_date),
      area_ha               = COALESCE(?, area_ha),
      region_id             = COALESCE(?, region_id),
      polygon_geojson       = COALESCE(?, polygon_geojson)
    WHERE id = ?
  `).run(
    crop_id        || null,
    soil_type_id   || null,
    last_application_date !== undefined ? (last_application_date || null) : null,
    area_ha        || null,
    region_id      || null,
    polygon_geojson ? (typeof polygon_geojson === 'string' ? polygon_geojson : JSON.stringify(polygon_geojson)) : null,
    req.params.id
  );

  res.json({ plot: db.prepare('SELECT * FROM plots WHERE id = ?').get(req.params.id) });
});

/** GET /api/farmers/:id/dashboard */
app.get('/api/farmers/:id/dashboard', (req, res) => {
  const farmer = db.prepare('SELECT * FROM farmers WHERE id = ?').get(req.params.id);
  if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

  const { currentDate, isHeatWave, forecastLabel, dayOffset } = getDemoState();
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(farmer.region_id);
  const plots  = db.prepare('SELECT * FROM plots WHERE farmer_id = ?').all(farmer.id);
  const channels = db.prepare('SELECT * FROM alert_channels WHERE farmer_id = ?').all(farmer.id);

  const plotCards = plots.map(plot => {
    const rec     = getPlotRecommendation(plot, currentDate, isHeatWave);
    const crop    = db.prepare('SELECT * FROM crops WHERE id = ?').get(plot.crop_id);
    const soil    = db.prepare('SELECT * FROM soil_types WHERE id = ?').get(plot.soil_type_id);
    const request = db.prepare(
      'SELECT * FROM service_requests WHERE plot_id = ? ORDER BY requested_at DESC LIMIT 1'
    ).get(plot.id);
    return { plot, crop, soil, recommendation: rec, serviceRequest: request || null };
  });

  res.json({ farmer, region, plotCards, currentDate, isHeatWave, forecastLabel, dayOffset, channels });
});

/** POST /api/service-requests */
app.post('/api/service-requests', (req, res) => {
  const { plot_id, farmer_id } = req.body;
  if (!plot_id || !farmer_id) return res.status(400).json({ error: 'plot_id and farmer_id required' });
  const result = db.prepare(
    'INSERT INTO service_requests (plot_id, farmer_id, status) VALUES (?,?,?)'
  ).run(plot_id, farmer_id, 'pending');
  res.status(201).json({ request: db.prepare('SELECT * FROM service_requests WHERE id = ?').get(result.lastInsertRowid) });
});

/** GET  /api/farmers/:id/alerts */
app.get('/api/farmers/:id/alerts', (req, res) => {
  const alerts = db.prepare(`
    SELECT a.*, c.name AS crop_name FROM sms_alerts a
    JOIN plots p ON a.plot_id = p.id JOIN crops c ON p.crop_id = c.id
    WHERE a.farmer_id = ? ORDER BY a.sent_at DESC
  `).all(req.params.id);
  res.json(alerts);
});

/** POST /api/alerts/:id/reply */
app.post('/api/alerts/:id/reply', (req, res) => {
  const alert = db.prepare('SELECT * FROM sms_alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (alert.replied) return res.status(400).json({ error: 'Already replied' });

  db.prepare('UPDATE sms_alerts SET replied = 1 WHERE id = ?').run(alert.id);
  const scheduledDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
  const existing = db.prepare(
    'SELECT * FROM service_requests WHERE plot_id = ? AND status IN (?,?) ORDER BY requested_at DESC LIMIT 1'
  ).get(alert.plot_id, 'pending', 'scheduled');
  if (existing) {
    db.prepare('UPDATE service_requests SET status=?, scheduled_at=? WHERE id=?')
      .run('scheduled', scheduledDate, existing.id);
  } else {
    db.prepare('INSERT INTO service_requests (plot_id, farmer_id, status, scheduled_at) VALUES (?,?,?,?)')
      .run(alert.plot_id, alert.farmer_id, 'scheduled', scheduledDate);
  }
  res.json({ success: true, scheduledDate, message: 'Application scheduled. You will receive a confirmation SMS.' });
});

/** POST /api/alerts/:id/mark-read */
app.post('/api/alerts/:id/mark-read', (req, res) => {
  db.prepare('UPDATE sms_alerts SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/** GET  /api/farmers/:id/channels */
app.get('/api/farmers/:id/channels', (req, res) => {
  res.json(db.prepare('SELECT * FROM alert_channels WHERE farmer_id = ?').all(req.params.id));
});

/** POST /api/farmers/:id/channels */
app.post('/api/farmers/:id/channels', (req, res) => {
  const { channel_type, destination } = req.body;
  if (!channel_type || !destination) return res.status(400).json({ error: 'channel_type and destination required' });
  const result = db.prepare(
    'INSERT INTO alert_channels (farmer_id, channel_type, destination) VALUES (?,?,?)'
  ).run(req.params.id, channel_type, destination.trim());
  res.status(201).json({ channel: db.prepare('SELECT * FROM alert_channels WHERE id = ?').get(result.lastInsertRowid) });
});

/** PUT /api/channels/:id */
app.put('/api/channels/:id', (req, res) => {
  const { enabled } = req.body;
  db.prepare('UPDATE alert_channels SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});

/** DELETE /api/channels/:id */
app.delete('/api/channels/:id', (req, res) => {
  db.prepare('DELETE FROM alert_channels WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DEMO CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/demo/simulate-day', async (req, res) => {
  const st  = db.prepare('SELECT * FROM demo_state WHERE id = 1').get();
  const newOffset = st.day_offset + 1;
  const newDate   = new Date(new Date(st.current_date).getTime() + 86400000).toISOString().split('T')[0];
  db.prepare('UPDATE demo_state SET current_date=?, day_offset=? WHERE id=1').run(newDate, newOffset);

  const max = db.prepare('SELECT MAX(day_offset) as m FROM forecast_days').get().m;
  const eff = newOffset % (max + 1);
  const fc  = db.prepare('SELECT * FROM forecast_days WHERE day_offset = ?').get(eff);
  const isHeatWave = fc ? !!fc.heat_wave : false;

  const allPlots = db.prepare('SELECT * FROM plots').all();
  const newAlerts = [];

  for (const plot of allPlots) {
    const rec = getPlotRecommendation(plot, newDate, isHeatWave);
    if (!rec.needsAlert) continue;

    const farmer = db.prepare('SELECT * FROM farmers WHERE id = ?').get(plot.farmer_id);
    const crop   = db.prepare('SELECT * FROM crops WHERE id = ?').get(plot.crop_id);
    const message = buildSmsMessage({ farmerName: farmer.name, cropName: crop.name,
      plotId: plot.id, recommendation: rec, currentDate: newDate });

    const result = db.prepare(
      'INSERT INTO sms_alerts (farmer_id, plot_id, message, trigger_type) VALUES (?,?,?,?)'
    ).run(plot.farmer_id, plot.id, message, rec.alertTrigger);

    // Dispatch to all channels
    await dispatchAlert(farmer, plot, crop, message);

    newAlerts.push({ id: result.lastInsertRowid, farmer_id: plot.farmer_id,
      plot_id: plot.id, message, trigger_type: rec.alertTrigger });
  }

  res.json({ newDate, dayOffset: newOffset, isHeatWave,
    forecastLabel: fc ? fc.label : 'Normal',
    alertsGenerated: newAlerts.length, alerts: newAlerts });
});

app.post('/api/demo/reset', (req, res) => {
  db.prepare('DELETE FROM sms_alerts').run();
  db.prepare('DELETE FROM service_requests').run();
  const twentyDaysAgo = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
  db.prepare('UPDATE plots SET last_application_date = ? WHERE id IN (1,2)').run(twentyDaysAgo);
  db.prepare('UPDATE demo_state SET current_date=?, day_offset=0 WHERE id=1')
    .run(new Date().toISOString().split('T')[0]);
  res.json({ success: true, message: 'Demo reset. All alerts and requests cleared.' });
});

app.get('/api/demo/state', (_, res) => res.json(getDemoState()));

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES  (all require ?token=admin — simple auth for hackathon demo)
// ═══════════════════════════════════════════════════════════════════════════════

function adminAuth(req, res, next) {
  const phone = req.headers['x-admin-phone'] || req.query.phone;
  if (!phone) return res.status(401).json({ error: 'Admin phone required' });
  const admin = db.prepare("SELECT * FROM farmers WHERE phone=? AND role='admin' AND status='approved'").get(phone);
  if (!admin) return res.status(403).json({ error: 'Not an admin account' });
  req.admin = admin;
  next();
}

/** POST /api/admin/login  { phone } */
app.post('/api/admin/login', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const admin = db.prepare("SELECT * FROM farmers WHERE phone=? AND role='admin' AND status='approved'").get(phone.trim());
  if (!admin) return res.status(403).json({ error: 'Not an admin account' });
  res.json({ admin });
});

/** GET /api/admin/stats */
app.get('/api/admin/stats', adminAuth, (req, res) => {
  res.json({
    totalFarmers:    db.prepare("SELECT COUNT(*) as c FROM farmers WHERE role='farmer'").get().c,
    pendingFarmers:  db.prepare("SELECT COUNT(*) as c FROM farmers WHERE status='pending'").get().c,
    approvedFarmers: db.prepare("SELECT COUNT(*) as c FROM farmers WHERE status='approved' AND role='farmer'").get().c,
    rejectedFarmers: db.prepare("SELECT COUNT(*) as c FROM farmers WHERE status='rejected'").get().c,
    totalPlots:      db.prepare("SELECT COUNT(*) as c FROM plots").get().c,
    totalAlerts:     db.prepare("SELECT COUNT(*) as c FROM sms_alerts").get().c,
    pendingRequests: db.prepare("SELECT COUNT(*) as c FROM service_requests WHERE status='pending'").get().c,
    scheduledRequests: db.prepare("SELECT COUNT(*) as c FROM service_requests WHERE status='scheduled'").get().c,
  });
});

/** GET /api/admin/farmers */
app.get('/api/admin/farmers', adminAuth, (req, res) => {
  const farmers = db.prepare(`
    SELECT f.*,
      r.name as region_name,
      (SELECT COUNT(*) FROM plots WHERE farmer_id = f.id) as plot_count,
      (SELECT COUNT(*) FROM sms_alerts WHERE farmer_id = f.id) as alert_count,
      (SELECT COUNT(*) FROM alert_channels WHERE farmer_id = f.id) as channel_count
    FROM farmers f LEFT JOIN regions r ON f.region_id = r.id
    WHERE f.role = 'farmer'
    ORDER BY f.created_at DESC
  `).all();
  res.json(farmers);
});

/** GET /api/admin/farmers/:id */
app.get('/api/admin/farmers/:id', adminAuth, (req, res) => {
  const farmer   = db.prepare('SELECT * FROM farmers WHERE id = ?').get(req.params.id);
  if (!farmer) return res.status(404).json({ error: 'Not found' });
  const plots    = db.prepare('SELECT p.*, c.name as crop_name, r.name as region_name FROM plots p JOIN crops c ON p.crop_id=c.id JOIN regions r ON p.region_id=r.id WHERE p.farmer_id=?').all(farmer.id);
  const channels = db.prepare('SELECT * FROM alert_channels WHERE farmer_id=?').all(farmer.id);
  const alerts   = db.prepare('SELECT * FROM sms_alerts WHERE farmer_id=? ORDER BY sent_at DESC LIMIT 20').all(farmer.id);
  const requests = db.prepare('SELECT sr.*, p.area_ha FROM service_requests sr JOIN plots p ON sr.plot_id=p.id WHERE sr.farmer_id=? ORDER BY sr.requested_at DESC').all(farmer.id);
  res.json({ farmer, plots, channels, alerts, requests });
});

/** POST /api/admin/farmers/:id/approve */
app.post('/api/admin/farmers/:id/approve', adminAuth, (req, res) => {
  db.prepare("UPDATE farmers SET status='approved' WHERE id=?").run(req.params.id);
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (?,?,?,?)')
    .run(req.admin.id, 'approve_farmer', req.params.id, 'Account approved');
  res.json({ success: true });
});

/** POST /api/admin/farmers/:id/reject */
app.post('/api/admin/farmers/:id/reject', adminAuth, (req, res) => {
  const { reason } = req.body;
  db.prepare("UPDATE farmers SET status='rejected' WHERE id=?").run(req.params.id);
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (?,?,?,?)')
    .run(req.admin.id, 'reject_farmer', req.params.id, reason || 'Account rejected');
  res.json({ success: true });
});

/** POST /api/admin/farmers/:id/make-admin */
app.post('/api/admin/farmers/:id/make-admin', adminAuth, (req, res) => {
  db.prepare("UPDATE farmers SET role='admin', status='approved' WHERE id=?").run(req.params.id);
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_id) VALUES (?,?,?)')
    .run(req.admin.id, 'promote_to_admin', req.params.id);
  res.json({ success: true });
});

/** GET /api/admin/service-requests */
app.get('/api/admin/service-requests', adminAuth, (req, res) => {
  const requests = db.prepare(`
    SELECT sr.*, f.name as farmer_name, f.phone as farmer_phone,
           c.name as crop_name, r.name as region_name, p.area_ha
    FROM service_requests sr
    JOIN farmers f ON sr.farmer_id = f.id
    JOIN plots p ON sr.plot_id = p.id
    JOIN crops c ON p.crop_id = c.id
    JOIN regions r ON p.region_id = r.id
    ORDER BY sr.requested_at DESC
  `).all();
  res.json(requests);
});

/** PUT /api/admin/service-requests/:id */
app.put('/api/admin/service-requests/:id', adminAuth, (req, res) => {
  const { status, scheduled_at } = req.body;
  db.prepare('UPDATE service_requests SET status=?, scheduled_at=? WHERE id=?')
    .run(status, scheduled_at || null, req.params.id);
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (?,?,?,?)')
    .run(req.admin.id, 'update_request_status', req.params.id, status);
  res.json({ success: true });
});

/** GET /api/admin/alerts */
app.get('/api/admin/alerts', adminAuth, (req, res) => {
  const alerts = db.prepare(`
    SELECT a.*, f.name as farmer_name, f.phone, c.name as crop_name
    FROM sms_alerts a
    JOIN farmers f ON a.farmer_id = f.id
    JOIN plots p ON a.plot_id = p.id
    JOIN crops c ON p.crop_id = c.id
    ORDER BY a.sent_at DESC LIMIT 100
  `).all();
  res.json(alerts);
});

/** GET /api/admin/logs */
app.get('/api/admin/logs', adminAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT l.*, f.name as admin_name FROM admin_logs l
    JOIN farmers f ON l.admin_id = f.id
    ORDER BY l.created_at DESC LIMIT 50
  `).all();
  res.json(logs);
});

/** POST /api/admin/send-alert  { farmer_id, message } */
app.post('/api/admin/send-alert', adminAuth, async (req, res) => {
  const { farmer_id, message } = req.body;
  if (!farmer_id || !message) return res.status(400).json({ error: 'farmer_id and message required' });
  const farmer = db.prepare('SELECT * FROM farmers WHERE id=?').get(farmer_id);
  if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

  // Find first plot or use 1
  const plot = db.prepare('SELECT * FROM plots WHERE farmer_id=? LIMIT 1').get(farmer_id);
  if (!plot) return res.status(400).json({ error: 'Farmer has no plots' });
  const crop = db.prepare('SELECT * FROM crops WHERE id=?').get(plot.crop_id);

  db.prepare('INSERT INTO sms_alerts (farmer_id, plot_id, message, trigger_type, channel) VALUES (?,?,?,?,?)')
    .run(farmer_id, plot.id, message, 'manual', 'admin');

  await dispatchAlert(farmer, plot, crop, message);
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (?,?,?,?)')
    .run(req.admin.id, 'manual_alert', farmer_id, message.substring(0, 100));
  res.json({ success: true });
});

// ── Serve admin dashboard
app.get('/admin', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Arabic version
app.get('/ar', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-ar.html'));
});

// ── SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅  Mulch Advisory Platform  → http://localhost:${PORT}`);
  console.log(`🔧  Admin dashboard          → http://localhost:${PORT}/admin`);
  console.log(`\n   Farmer logins: +21671000001 (Ahmed)  +21671000002 (Fatima)`);
  console.log(`   Admin login:   +21600000000\n`);
});
