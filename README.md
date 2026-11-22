# Bsisa

Bsisa includes a web platform for mulch recommendations and its companion
Flutter mobile app.

## Projects

- [`mulch-platform/`](./mulch-platform/) — Express API and web application
  backed by SQLite. See its [README](./mulch-platform/README.md) for platform
  details.
- [`mulch-mobile/`](./mulch-mobile/) — Flutter app for farmers. See its
  [README](./mulch-mobile/README.md) for mobile details.

## Run the platform

Install [Node.js](https://nodejs.org/) and, from a terminal, run:

```powershell
cd mulch-platform
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The admin dashboard is at
[http://localhost:3000/admin](http://localhost:3000/admin). Stop the server
with `Ctrl+C`.

The SQLite database is initialized and seeded automatically on the first run.

## Run the mobile app

With the platform server running, install
[Flutter](https://docs.flutter.dev/get-started/install), then open another
terminal and run:

```powershell
cd mulch-mobile
flutter pub get
flutter run
```

For an Android emulator, the app uses `http://10.0.2.2:3000` to reach the
platform on the host computer. On a physical phone, pass the computer's
reachable LAN address instead:

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:3000
```

Thermal map temperature tiles are optional. To enable them, provide an
OpenWeatherMap key at launch with
`--dart-define=OWM_TILE_API_KEY=your_key`.
