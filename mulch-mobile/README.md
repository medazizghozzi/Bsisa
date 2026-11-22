# EcoRay mobile

Flutter companion app for the existing Mulch Advisory Platform. It uses the
platform's existing Express API and seeded data; it does not modify or replace
the platform.

## Run

Start the platform server from `mulch-platform`:

```powershell
npm start
```

From `mulch-mobile`, fetch dependencies and run the generated Android or iOS
app with the server address reachable from your device:

```powershell
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

`10.0.2.2` is the Android emulator's route to the host machine. For a physical
phone, replace it with the computer's LAN IP (for example
`http://192.168.1.20:3000`). For iOS Simulator or Flutter web, use
`http://localhost:3000`.

The app implements the farmer experience: EcoRay landing page and phone-based
sign-in, the three-step account/field setup, dashboard recommendations and
plot map, normal/thermal map modes, demo-day controls, and SMS alert actions.
The server remains authoritative for all recommendation and savings values.

The existing server enables CORS. The included Android manifest allows
cleartext HTTP for local development; retain
`android:usesCleartextTraffic="true"` if platform scaffolding regenerates it.
Use HTTPS for a deployed server.

To display the platform's OpenWeatherMap temperature tiles in Thermal mode,
provide a key with `--dart-define=OWM_TILE_API_KEY=...`. Without it, the app
shows a sample thermal overlay rather than embedding the platform's key in the
mobile binary.
