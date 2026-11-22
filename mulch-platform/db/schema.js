const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = path.join(__dirname, 'mulch.db');

function initDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, name_ar TEXT, name_fr TEXT,
      center_lat REAL NOT NULL, center_lng REAL NOT NULL,
      evap_summer REAL NOT NULL, evap_spring REAL NOT NULL, evap_winter REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, name_ar TEXT, name_fr TEXT,
      mulch_thickness_cm INTEGER NOT NULL, kc REAL NOT NULL,
      degradation_k REAL NOT NULL DEFAULT 2.25
    );
    CREATE TABLE IF NOT EXISTS soil_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, name_ar TEXT, name_fr TEXT,
      water_retention_mod REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS farmers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT,
      region_id INTEGER NOT NULL REFERENCES regions(id),
      status TEXT NOT NULL DEFAULT 'pending',
      role TEXT NOT NULL DEFAULT 'farmer',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS alert_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL REFERENCES farmers(id),
      channel_type TEXT NOT NULL, destination TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL REFERENCES farmers(id),
      region_id INTEGER NOT NULL REFERENCES regions(id),
      crop_id INTEGER NOT NULL REFERENCES crops(id),
      soil_type_id INTEGER NOT NULL REFERENCES soil_types(id),
      polygon_geojson TEXT NOT NULL, area_ha REAL NOT NULL,
      last_application_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plot_id INTEGER NOT NULL REFERENCES plots(id),
      farmer_id INTEGER NOT NULL REFERENCES farmers(id),
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      scheduled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sms_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL REFERENCES farmers(id),
      plot_id INTEGER NOT NULL REFERENCES plots(id),
      message TEXT NOT NULL, trigger_type TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'sms',
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      replied INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL REFERENCES farmers(id),
      action TEXT NOT NULL, target_id INTEGER, details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS demo_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_date TEXT NOT NULL, day_offset INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS forecast_days (
      day_offset INTEGER PRIMARY KEY,
      heat_wave INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL
    );
  `);

  seedData(db);
  return db;
}

function seedData(db) {
  // All Arabic strings use Unicode escapes to avoid encoding issues
  const AR = {
    kairouan:   '\u0627\u0644\u0642\u064a\u0631\u0648\u0627\u0646',
    jendouba:   '\u062c\u0646\u062f\u0648\u0628\u0629',
    sfax:       '\u0635\u0641\u0627\u0642\u0633',
    // vegetables
    tomato:     '\u0637\u0645\u0627\u0637\u0645',
    pepper:     '\u0641\u0644\u0641\u0644',
    olive:      '\u0632\u064a\u062a\u0648\u0646 \u0634\u0627\u0628',
    citrus:     '\u062d\u0645\u0636\u064a\u0627\u062a',
    watermelon: '\u0628\u0637\u064a\u062e',
    melon:      '\u0634\u0645\u0627\u0645',
    eggplant:   '\u0628\u0627\u0630\u0646\u062c\u0627\u0646',
    zucchini:   '\u0643\u0648\u0633\u0629',
    potato:     '\u0628\u0637\u0627\u0637\u0633',
    onion:      '\u0628\u0635\u0644',
    garlic:     '\u062b\u0648\u0645',
    carrot:     '\u062c\u0632\u0631',
    strawberry: '\u0641\u0631\u0627\u0648\u0644\u0629',
    // trees
    fig:        '\u062a\u064a\u0646',
    pomegranate:'\u0631\u0645\u0627\u0646',
    date_palm:  '\u0646\u062e\u064a\u0644',
    almond:     '\u0644\u0648\u0632',
    // soils
    sandy:      '\u0631\u0645\u0644\u064a\u0629',
    loam:       '\u0637\u064a\u0646\u064a\u0629 \u0631\u0645\u0644\u064a\u0629',
    clay:       '\u0637\u064a\u0646\u064a\u0629',
    ahmed:      '\u0623\u062d\u0645\u062f',
    fatima:     '\u0641\u0627\u0637\u0645\u0629',
  };

  // Regions
  const ri = db.prepare(`INSERT OR IGNORE INTO regions (name,name_ar,name_fr,center_lat,center_lng,evap_summer,evap_spring,evap_winter) VALUES (?,?,?,?,?,?,?,?)`);
  ri.run('Kairouan', AR.kairouan, 'Kairouan', 35.6781, 10.0963, 5.5, 3.8, 2.1);
  ri.run('Jendouba', AR.jendouba, 'Jendouba', 36.5012,  8.7803, 4.2, 3.0, 1.8);
  ri.run('Sfax',     AR.sfax,     'Sfax',     34.7406, 10.7603, 6.0, 4.1, 2.4);

  // Crops  —  name | name_ar | name_fr | mulch_cm | Kc | degradation_k
  const ci = db.prepare(`INSERT OR IGNORE INTO crops (name,name_ar,name_fr,mulch_thickness_cm,kc,degradation_k) VALUES (?,?,?,?,?,?)`);
  // Vegetables
  ci.run('Tomato',           AR.tomato,      'Tomate',          5, 1.15, 2.25);
  ci.run('Pepper',           AR.pepper,      'Poivron',         5, 1.05, 2.25);
  ci.run('Eggplant',         AR.eggplant,    'Aubergine',       5, 1.05, 2.25);
  ci.run('Zucchini',         AR.zucchini,    'Courgette',       5, 0.95, 2.50);
  ci.run('Potato',           AR.potato,      'Pomme de terre',  6, 1.10, 2.00);
  ci.run('Onion',            AR.onion,       'Oignon',          4, 1.00, 2.75);
  ci.run('Garlic',           AR.garlic,      'Ail',             4, 1.00, 2.75);
  ci.run('Carrot',           AR.carrot,      'Carotte',         5, 1.05, 2.25);
  ci.run('Watermelon',       AR.watermelon,  'Pastèque',        6, 1.00, 2.25);
  ci.run('Melon',            AR.melon,       'Melon',           6, 1.00, 2.25);
  ci.run('Strawberry',       AR.strawberry,  'Fraise',          5, 1.05, 2.00);
  // Trees
  ci.run('Young Olive Tree', AR.olive,       'Jeune oliviers',  8, 0.65, 2.25);
  ci.run('Citrus',           AR.citrus,      'Agrumes',         7, 0.85, 2.25);
  ci.run('Fig Tree',         AR.fig,         'Figuier',         8, 0.70, 2.00);
  ci.run('Pomegranate',      AR.pomegranate, 'Grenadier',       8, 0.70, 2.00);
  ci.run('Date Palm',        AR.date_palm,   'Palmier dattier', 10, 0.90, 1.75);
  ci.run('Almond Tree',      AR.almond,      'Amandier',        8, 0.65, 2.00);

  // Soil types
  const si = db.prepare(`INSERT OR IGNORE INTO soil_types (name,name_ar,name_fr,water_retention_mod) VALUES (?,?,?,?)`);
  si.run('Sandy', AR.sandy, 'Sableux',  1.2);
  si.run('Loam',  AR.loam,  'Limon',    1.0);
  si.run('Clay',  AR.clay,  'Argileux', 0.8);

  // Demo state
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`INSERT OR IGNORE INTO demo_state (id,current_date,day_offset) VALUES (1,?,0)`).run(today);

  // Forecast days
  const fi = db.prepare(`INSERT OR IGNORE INTO forecast_days (day_offset,heat_wave,label) VALUES (?,?,?)`);
  fi.run(0, 0, 'Normal - moderate conditions');
  fi.run(1, 0, 'Normal - slight breeze');
  fi.run(2, 1, 'Heat wave - high evaporation alert');
  fi.run(3, 0, 'Normal - after heat wave');
  fi.run(4, 1, 'Heat wave - second event');
  fi.run(5, 0, 'Cooling down');
  fi.run(6, 0, 'Normal');
  fi.run(7, 1, 'Heat wave - third event');

  // Admin account
  db.prepare(`INSERT OR IGNORE INTO farmers (name,phone,email,region_id,status,role) VALUES ('Admin','+21600000000','admin@mulch.tn',(SELECT id FROM regions WHERE name='Kairouan'),'approved','admin')`).run();

  // Demo farmers
  const ago20 = new Date(Date.now() - 20*86400000).toISOString().split('T')[0];
  const kairouan_poly = JSON.stringify({type:'Polygon',coordinates:[[[10.085,35.672],[10.095,35.672],[10.095,35.680],[10.085,35.680],[10.085,35.672]]]});
  const jendouba_poly = JSON.stringify({type:'Polygon',coordinates:[[[8.770,36.495],[8.782,36.495],[8.782,36.503],[8.770,36.503],[8.770,36.495]]]});

  const fni = db.prepare(`INSERT OR IGNORE INTO farmers (name,phone,email,region_id,status,role) VALUES (?,?,?,(SELECT id FROM regions WHERE name=?),'approved','farmer')`);
  fni.run('Ahmed Ben Ali',   '+21671000001', 'ahmed@demo.tn',  'Kairouan');
  fni.run('Fatima Trabelsi', '+21671000002', 'fatima@demo.tn', 'Jendouba');

  // Alert channels
  const chi = db.prepare(`INSERT OR IGNORE INTO alert_channels (farmer_id,channel_type,destination,enabled,verified) SELECT id,?,?,1,1 FROM farmers WHERE phone=? AND NOT EXISTS (SELECT 1 FROM alert_channels WHERE farmer_id=(SELECT id FROM farmers WHERE phone=?) AND channel_type=?)`);
  chi.run('sms',   '+21671000001', '+21671000001', '+21671000001', 'sms');
  chi.run('email', 'ahmed@demo.tn','+21671000001', '+21671000001', 'email');
  chi.run('sms',   '+21671000002', '+21671000002', '+21671000002', 'sms');
  chi.run('email', 'fatima@demo.tn','+21671000002','+21671000002', 'email');

  // Demo plots
  const pi = db.prepare(`INSERT OR IGNORE INTO plots (farmer_id,region_id,crop_id,soil_type_id,polygon_geojson,area_ha,last_application_date) SELECT (SELECT id FROM farmers WHERE phone=?),(SELECT id FROM regions WHERE name=?),(SELECT id FROM crops WHERE name=?),(SELECT id FROM soil_types WHERE name=?),?,?,? WHERE NOT EXISTS (SELECT 1 FROM plots WHERE farmer_id=(SELECT id FROM farmers WHERE phone=?))`);
  pi.run('+21671000001','Kairouan','Tomato',          'Loam',  kairouan_poly, 0.85, ago20, '+21671000001');
  pi.run('+21671000002','Jendouba','Young Olive Tree','Sandy', jendouba_poly, 1.20, ago20, '+21671000002');
}

module.exports = { initDb, DB_PATH };
