import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'plot_geometry.dart';

const _green = Color(0xFF3D6B35);
const _greenLight = Color(0xFFF0F9F3);
const _background = Color(0xFFF4F1EC);
const _ink = Color(0xFF141412);
const _muted = Color(0xFF7A7570);
const _border = Color(0xFFE7E3DC);
const _apiBase = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',
);
const _owmTileApiKey = String.fromEnvironment('OWM_TILE_API_KEY');

void main() {
  runApp(const EcoRayApp());
}

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient(this.baseUrl);

  final String baseUrl;
  final http.Client _client = http.Client();

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<dynamic> put(String path, Map<String, dynamic> body) =>
      _send('PUT', path, body);

  Future<dynamic> _send(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers['Content-Type'] = 'application/json';
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _client
        .send(request)
        .timeout(const Duration(seconds: 20));
    final response = await http.Response.fromStream(streamed);
    dynamic payload;
    try {
      payload = response.body.isEmpty ? null : jsonDecode(response.body);
    } on FormatException {
      throw const ApiException('The server returned an invalid response.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map ? payload['error']?.toString() : null;
      throw ApiException(message ?? 'Request failed (${response.statusCode}).');
    }
    return payload;
  }
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  throw const FormatException('Unexpected server data.');
}

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const [];
  return value.map((item) => _map(item)).toList();
}

double _number(Object? value, [double fallback = 0]) =>
    value is num ? value.toDouble() : fallback;

String _text(Object? value, [String fallback = '']) =>
    value?.toString() ?? fallback;

String _cropPhoto(String crop) {
  if (crop == 'Tomato') return 'assets/images/img_sq_1.jpg';
  if (crop == 'Pepper') return 'assets/images/img_sq_3.jpg';
  if (crop == 'Eggplant' || crop == 'Zucchini') {
    return 'assets/images/img_sq_4.jpg';
  }
  if (crop == 'Potato') return 'assets/images/img_sq_5.jpg';
  if (crop == 'Watermelon' || crop == 'Melon') {
    return 'assets/images/img_sq_6.jpg';
  }
  if (crop == 'Strawberry') return 'assets/images/img_sq_8.jpg';
  return 'assets/images/hero_3.jpg';
}

String _phone(String value) {
  final number = value.trim().replaceAll(' ', '');
  return number.startsWith('+216') ? number : '+216$number';
}

List<LatLng> _polygonPoints(Object? raw) {
  try {
    final decoded = raw is String ? jsonDecode(raw) : raw;
    final geometry = _map(decoded);
    final coordinates = geometry['coordinates'] as List;
    final ring = coordinates.first as List;
    return ring.map((point) {
      final pair = point as List;
      return LatLng(_number(pair[1]), _number(pair[0]));
    }).toList();
  } on Object {
    return const [];
  }
}

class EcoRayApp extends StatefulWidget {
  const EcoRayApp({super.key});

  @override
  State<EcoRayApp> createState() => _EcoRayAppState();
}

class _EcoRayAppState extends State<EcoRayApp> {
  late final ApiClient _api = ApiClient(
    _apiBase.replaceFirst(RegExp(r'/$'), ''),
  );
  Map<String, dynamic>? _farmer;
  Map<String, dynamic>? _dashboard;
  List<Map<String, dynamic>> _regions = const [];
  List<Map<String, dynamic>> _crops = const [];
  List<Map<String, dynamic>> _soils = const [];
  List<Map<String, dynamic>> _alerts = const [];
  bool _loading = true;
  bool _dark = false;
  bool _busy = false;
  String? _startupError;
  String _page = 'home';
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      _dark = preferences.getBool('ecoray-dark') ?? false;
      final saved = preferences.getString('ecoray-farmer');
      if (saved != null) _farmer = _map(jsonDecode(saved));
      final values = await Future.wait([
        _api.get('/api/regions'),
        _api.get('/api/crops'),
        _api.get('/api/soil-types'),
      ]);
      _regions = _maps(values[0]);
      _crops = _maps(values[1]);
      _soils = _maps(values[2]);
      if (_farmer != null) {
        _page = 'dashboard';
        await _loadDashboard(showErrors: false);
      }
    } on Object catch (error) {
      _startupError = _friendlyError(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _friendlyError(Object error) {
    if (error is ApiException) return error.message;
    if (error is TimeoutException) {
      return 'The platform server took too long to respond.';
    }
    return 'Could not connect to the platform at $_apiBase.';
  }

  void _showMessage(String message) {
    _messengerKey.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _login(String phone) async {
    final response = _map(
      await _api.post('/api/login', {'phone': _phone(phone)}),
    );
    await _openFarmer(_map(response['farmer']));
  }

  Future<void> _createAccount({
    required String name,
    required String phone,
    required Map<String, dynamic> region,
    required Map<String, dynamic> crop,
    required Map<String, dynamic> soil,
    required List<LatLng> points,
  }) async {
    final farmerResponse = _map(
      await _api.post('/api/signup', {
        'name': name.trim(),
        'phone': _phone(phone),
        'region_id': region['id'],
      }),
    );
    final farmer = _map(farmerResponse['farmer']);
    final coordinates = points
        .map((point) => [point.longitude, point.latitude])
        .toList();
    if (coordinates.isNotEmpty) coordinates.add(coordinates.first);
    await _api.post('/api/plots', {
      'farmer_id': farmer['id'],
      'region_id': region['id'],
      'crop_id': crop['id'],
      'soil_type_id': soil['id'],
      'polygon_geojson': {
        'type': 'Polygon',
        'coordinates': [coordinates],
      },
      'area_ha': double.parse(areaHectares(points).toStringAsFixed(4)),
    });
    await _openFarmer(farmer);
    _showMessage('Account created.');
  }

  Future<void> _openFarmer(Map<String, dynamic> farmer) async {
    _farmer = farmer;
    _page = 'dashboard';
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString('ecoray-farmer', jsonEncode(farmer));
    if (mounted) setState(() {});
    await _loadDashboard();
  }

  Future<void> _loadDashboard({bool showErrors = true}) async {
    if (_farmer == null) return;
    try {
      final data = await _api.get('/api/farmers/${_farmer!['id']}/dashboard');
      final alerts = await _api.get('/api/farmers/${_farmer!['id']}/alerts');
      if (!mounted) return;
      setState(() {
        _dashboard = _map(data);
        _alerts = _maps(alerts);
        _startupError = null;
      });
    } on Object catch (error) {
      final message = _friendlyError(error);
      if (mounted) setState(() => _startupError = message);
      if (showErrors) _showMessage('Error loading dashboard: $message');
    }
  }

  Future<void> _refreshAlerts() async {
    if (_farmer == null) return;
    try {
      final response = await _api.get('/api/farmers/${_farmer!['id']}/alerts');
      if (mounted) setState(() => _alerts = _maps(response));
    } on Object catch (error) {
      _showMessage('Error loading alerts: ${_friendlyError(error)}');
    }
  }

  Future<void> _simulateDay() async {
    setState(() => _busy = true);
    try {
      final response = _map(await _api.post('/api/demo/simulate-day', {}));
      await _loadDashboard();
      _showMessage(
        _number(response['alertsGenerated']) > 0
            ? 'New SMS alert generated.'
            : 'Day advanced. No new alerts.',
      );
    } on Object catch (error) {
      _showMessage('Error: ${_friendlyError(error)}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetDemo() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reset demo?'),
        content: const Text('Reset all demo alerts and service requests?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Reset'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _api.post('/api/demo/reset', {});
      await _loadDashboard();
      _showMessage('Demo reset. Alerts cleared.');
    } on Object catch (error) {
      _showMessage('Error: ${_friendlyError(error)}');
    }
  }

  Future<void> _requestApplication(int plotId) async {
    try {
      await _api.post('/api/service-requests', {
        'plot_id': plotId,
        'farmer_id': _farmer!['id'],
      });
      await _loadDashboard();
      _showMessage('Request submitted. Status: Pending');
    } on Object catch (error) {
      _showMessage('Error: ${_friendlyError(error)}');
    }
  }

  Future<void> _editPlot(Map<String, dynamic> card) async {
    final plot = _map(card['plot']);
    final crop = _map(card['crop']);
    final soil = _map(card['soil']);
    var cropId = _number(crop['id']).round();
    var soilId = _number(soil['id']).round();
    final lastApplication = TextEditingController(
      text: _text(plot['last_application_date']),
    );
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, updateDialog) => AlertDialog(
          title: const Text('Edit Plot'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Plot #${plot['id']} · ${_text(crop['name'])} · ${_number(plot['area_ha']).toStringAsFixed(2)} ha',
                  style: const TextStyle(color: _muted, fontSize: 12),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<int>(
                  initialValue: cropId,
                  decoration: const InputDecoration(labelText: 'Crop'),
                  items: _crops
                      .map(
                        (item) => DropdownMenuItem<int>(
                          value: _number(item['id']).round(),
                          child: Text(_text(item['name'])),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) updateDialog(() => cropId = value);
                  },
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  initialValue: soilId,
                  decoration: const InputDecoration(labelText: 'Soil type'),
                  items: _soils
                      .map(
                        (item) => DropdownMenuItem<int>(
                          value: _number(item['id']).round(),
                          child: Text(_text(item['name'])),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) updateDialog(() => soilId = value);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: lastApplication,
                  readOnly: true,
                  decoration: const InputDecoration(
                    labelText: 'Last mulch application',
                    hintText: 'Select date',
                    suffixIcon: Icon(Icons.calendar_today_outlined),
                  ),
                  onTap: () async {
                    final now = DateTime.now();
                    final current = DateTime.tryParse(lastApplication.text);
                    final date = await showDatePicker(
                      context: context,
                      initialDate: current ?? now,
                      firstDate: DateTime(2000),
                      lastDate: DateTime(now.year + 5),
                    );
                    if (date != null) {
                      lastApplication.text =
                          '${date.year.toString().padLeft(4, '0')}-'
                          '${date.month.toString().padLeft(2, '0')}-'
                          '${date.day.toString().padLeft(2, '0')}';
                      updateDialog(() {});
                    }
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    final lastApplicationDate = lastApplication.text;
    lastApplication.dispose();
    if (saved != true) return;
    try {
      await _api.put('/api/plots/${plot['id']}', {
        'crop_id': cropId,
        'soil_type_id': soilId,
        'last_application_date': lastApplicationDate,
      });
      await _loadDashboard();
      _showMessage('Plot updated.');
    } on Object catch (error) {
      _showMessage('Error: ${_friendlyError(error)}');
    }
  }

  Future<void> _replyToAlert(int alertId) async {
    try {
      final result = _map(await _api.post('/api/alerts/$alertId/reply', {}));
      await _refreshAlerts();
      await _loadDashboard();
      _showMessage(_text(result['message'], 'Application scheduled.'));
    } on Object catch (error) {
      _showMessage('Error: ${_friendlyError(error)}');
    }
  }

  Future<void> _dismissAlert(int alertId) async {
    try {
      await _api.post('/api/alerts/$alertId/mark-read', {});
      await _refreshAlerts();
    } on Object catch (error) {
      _showMessage('Error: ${_friendlyError(error)}');
    }
  }

  Future<void> _logout() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove('ecoray-farmer');
    if (!mounted) return;
    setState(() {
      _farmer = null;
      _dashboard = null;
      _alerts = const [];
      _page = 'home';
    });
  }

  Future<void> _toggleTheme() async {
    setState(() => _dark = !_dark);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool('ecoray-dark', _dark);
  }

  Future<void> _retryConnection() async {
    setState(() {
      _loading = true;
      _startupError = null;
    });
    await _initialize();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _green,
      brightness: _dark ? Brightness.dark : Brightness.light,
      surface: _dark ? const Color(0xFF1A2219) : Colors.white,
    );
    return MaterialApp(
      title: 'EcoRay',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messengerKey,
      themeMode: _dark ? ThemeMode.dark : ThemeMode.light,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: _background,
        appBarTheme: const AppBarTheme(
          backgroundColor: _background,
          foregroundColor: _ink,
          elevation: 0,
          centerTitle: false,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: _dark ? const Color(0xFF202C20) : Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _border),
          ),
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: const Color(0xFF0E120F),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0E120F),
          foregroundColor: Color(0xFFEEEAE3),
          elevation: 0,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF202C20),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF344234)),
          ),
        ),
      ),
      home: _loading
          ? const _LoadingScreen()
          : _farmer == null
          ? _LandingPage(
              regions: _regions,
              crops: _crops,
              soils: _soils,
              initialError: _startupError,
              onLogin: _login,
              onCreateAccount: _createAccount,
              onRetry: _retryConnection,
              onThemeToggle: _toggleTheme,
              dark: _dark,
            )
          : _AuthenticatedPage(
              page: _page,
              farmer: _farmer!,
              dashboard: _dashboard,
              error: _startupError,
              alerts: _alerts,
              busy: _busy,
              onSelectPage: (page) async {
                setState(() => _page = page);
                if (page == 'alerts') await _refreshAlerts();
              },
              onThemeToggle: _toggleTheme,
              onLogout: _logout,
              onSimulateDay: _simulateDay,
              onResetDemo: _resetDemo,
              onRequestApplication: _requestApplication,
              onEditPlot: _editPlot,
              onReply: _replyToAlert,
              onDismiss: _dismissAlert,
              onRefresh: _loadDashboard,
            ),
    );
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
    body: Center(child: CircularProgressIndicator(color: _green)),
  );
}

class _Brand extends StatelessWidget {
  const _Brand({this.height = 54});

  final double height;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: height * 1.25,
    child: SvgPicture.asset(
      'assets/images/ecoray-logo.svg',
      fit: BoxFit.contain,
      semanticsLabel: 'EcoRay',
    ),
  );
}

class _LandingPage extends StatefulWidget {
  const _LandingPage({
    required this.regions,
    required this.crops,
    required this.soils,
    required this.initialError,
    required this.onLogin,
    required this.onCreateAccount,
    required this.onRetry,
    required this.onThemeToggle,
    required this.dark,
  });

  final List<Map<String, dynamic>> regions;
  final List<Map<String, dynamic>> crops;
  final List<Map<String, dynamic>> soils;
  final String? initialError;
  final Future<void> Function(String phone) onLogin;
  final Future<void> Function({
    required String name,
    required String phone,
    required Map<String, dynamic> region,
    required Map<String, dynamic> crop,
    required Map<String, dynamic> soil,
    required List<LatLng> points,
  })
  onCreateAccount;
  final Future<void> Function() onRetry;
  final VoidCallback onThemeToggle;
  final bool dark;

  @override
  State<_LandingPage> createState() => _LandingPageState();
}

class _LandingPageState extends State<_LandingPage> {
  final _scrollController = ScrollController();
  final _loginPhone = TextEditingController();
  final _name = TextEditingController();
  final _signupPhone = TextEditingController();
  final _loginKey = GlobalKey();
  final _mapController = MapController();
  final _slides = PageController();
  final List<LatLng> _points = [];
  int _slide = 0;
  int _signupStep = 1;
  int? _cropId;
  int? _soilId;
  Map<String, dynamic>? _region;
  bool _signup = false;
  bool _polygonClosed = false;
  bool _busy = false;
  String? _error;

  static const _slidesData = [
    (
      'Smart Mulch Advisory\nfor Tunisian Farmers',
      'Save water, reduce energy costs, and protect your crops with real-time mulch degradation alerts sent directly to your phone.',
    ),
    (
      'From Field to Insight.\nNo Internet Required.',
      'Server-side decision logic delivers SMS alerts that work during power cuts and internet outages.',
    ),
    (
      'Draw Your Plot.\nGet Your Recommendation.',
      'Sign up, draw your field on the map, and receive personalized mulch thickness and water savings estimates.',
    ),
    (
      'Kairouan. Jendouba.\nSfax.',
      "Coverage across Tunisia's key agricultural regions, with satellite evaporation data at 20m resolution.",
    ),
    (
      '1,599 m³ Saved.\n230 TND Per Season.',
      "Real savings, calculated from FAO WaPOR satellite data and Tunisia's STEG electricity tariff.",
    ),
  ];

  @override
  void dispose() {
    _scrollController.dispose();
    _loginPhone.dispose();
    _name.dispose();
    _signupPhone.dispose();
    _slides.dispose();
    super.dispose();
  }

  Future<void> _jumpToLogin() async {
    final target = _loginKey.currentContext;
    if (target != null) {
      await Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeInOut,
        alignment: 0.08,
      );
    }
  }

  Future<void> _login() async {
    if (_loginPhone.text.trim().isEmpty) {
      setState(() => _error = 'Please enter your phone number.');
      return;
    }
    await _run(() => widget.onLogin(_loginPhone.text));
  }

  Future<void> _continueSignup() async {
    if (_signupStep == 1) {
      if (_name.text.trim().isEmpty || _signupPhone.text.trim().isEmpty) {
        setState(() => _error = 'Please enter your name and phone number.');
        return;
      }
      setState(() {
        _error = null;
        _signupStep = 2;
      });
      return;
    }
    if (_signupStep == 2) {
      if (_points.length < 3) {
        setState(
          () =>
              _error = 'Please draw your plot on the map (at least 3 points).',
        );
        return;
      }
      _region = _detectRegion();
      if (_region == null) {
        setState(
          () => _error = 'No platform region is available for this plot.',
        );
        return;
      }
      setState(() {
        _error = null;
        _polygonClosed = true;
        _signupStep = 3;
      });
      return;
    }
    if (_cropId == null || _soilId == null || _region == null) {
      setState(() => _error = 'Please select both a crop and a soil type.');
      return;
    }
    final crop = widget.crops.firstWhere((item) => item['id'] == _cropId);
    final soil = widget.soils.firstWhere((item) => item['id'] == _soilId);
    await _run(
      () => widget.onCreateAccount(
        name: _name.text,
        phone: _signupPhone.text,
        region: _region!,
        crop: crop,
        soil: soil,
        points: List.of(_points),
      ),
    );
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _error = null;
      _busy = true;
    });
    try {
      await action();
    } on Object catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic>? _detectRegion() {
    if (widget.regions.isEmpty || _points.isEmpty) return null;
    final latitude =
        _points.map((point) => point.latitude).reduce((a, b) => a + b) /
        _points.length;
    final longitude =
        _points.map((point) => point.longitude).reduce((a, b) => a + b) /
        _points.length;
    return widget.regions.reduce((nearest, region) {
      final distance =
          math.pow(latitude - _number(region['center_lat']), 2) +
          math.pow(longitude - _number(region['center_lng']), 2);
      final nearestDistance =
          math.pow(latitude - _number(nearest['center_lat']), 2) +
          math.pow(longitude - _number(nearest['center_lng']), 2);
      return distance < nearestDistance ? region : nearest;
    });
  }

  void _addPoint(TapPosition tap, LatLng point) {
    if (_polygonClosed) return;
    setState(() {
      _points.add(point);
      _region = null;
      _error = null;
    });
  }

  void _clearPoints() {
    setState(() {
      _points.clear();
      _region = null;
      _polygonClosed = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          controller: _scrollController,
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    const _Brand(height: 58),
                    const Spacer(),
                    IconButton(
                      tooltip: 'Toggle dark mode',
                      onPressed: widget.onThemeToggle,
                      icon: Icon(
                        widget.dark ? Icons.light_mode : Icons.dark_mode,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(child: _hero()),
            SliverToBoxAdapter(child: _howItWorks()),
            SliverToBoxAdapter(child: _accountSection()),
            SliverToBoxAdapter(child: _impactSection()),
            SliverToBoxAdapter(child: _supportedCrops()),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                child: Text(
                  'EcoRay · Smart Mulch Advisory · Tunisia',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: _muted.withValues(alpha: .8),
                    fontSize: 12,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero() {
    return SizedBox(
      height: 520,
      child: Stack(
        fit: StackFit.expand,
        children: [
          PageView.builder(
            controller: _slides,
            itemCount: _slidesData.length,
            onPageChanged: (index) => setState(() => _slide = index),
            itemBuilder: (context, index) => Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(
                  'assets/images/hero_${index + 1}.jpg',
                  fit: BoxFit.cover,
                  alignment: const Alignment(0, .35),
                ),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0x11000000), Color(0xDD000000)],
                    ),
                  ),
                ),
                Align(
                  alignment: Alignment.bottomLeft,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(26, 30, 26, 72),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _slidesData[index].$1,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 34,
                            height: 1.05,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -.8,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          _slidesData[index].$2,
                          style: const TextStyle(
                            color: Color(0xFFEAE7E1),
                            height: 1.5,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 20),
                        FilledButton(
                          onPressed: _jumpToLogin,
                          style: FilledButton.styleFrom(
                            backgroundColor: _green,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 14,
                            ),
                          ),
                          child: const Text('Get Started  →'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            bottom: 20,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                _slidesData.length,
                (index) => GestureDetector(
                  onTap: () => _slides.animateToPage(
                    index,
                    duration: const Duration(milliseconds: 250),
                    curve: Curves.easeOut,
                  ),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    width: index == _slide ? 20 : 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(
                        alpha: index == _slide ? .95 : .5,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title, String subtitle) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 32, 20, 18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title.toUpperCase(),
          style: const TextStyle(
            color: _ink,
            fontSize: 22,
            fontWeight: FontWeight.w800,
            letterSpacing: -.4,
          ),
        ),
        const SizedBox(height: 5),
        Text(subtitle, style: const TextStyle(color: _muted, height: 1.45)),
      ],
    ),
  );

  Widget _howItWorks() {
    const items = [
      (
        '01',
        Icons.public,
        'Satellite Data',
        'FAO WaPOR evaporation values for Kairouan, Jendouba, and Sfax.',
      ),
      (
        '02',
        Icons.memory,
        'Smart Calculation',
        'Mulch degradation, thickness, water, and electricity savings.',
      ),
      (
        '03',
        Icons.sms_outlined,
        'SMS Alert',
        'Plain SMS for any phone. Reply 1 to schedule an application.',
      ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle(
          'How it works',
          'From satellite data to your phone — no internet required.',
        ),
        SizedBox(
          height: 190,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final item = items[index];
              return Container(
                width: 265,
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.$1,
                      style: const TextStyle(
                        color: _green,
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Icon(item.$2, color: _green, size: 28),
                    const SizedBox(height: 7),
                    Text(
                      item.$3,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.$4,
                      style: const TextStyle(
                        color: _muted,
                        fontSize: 12,
                        height: 1.4,
                      ),
                      maxLines: 2,
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _accountSection() {
    final label = _signup ? 'Create account' : 'Account access';
    return Container(
      key: _loginKey,
      margin: const EdgeInsets.fromLTRB(20, 34, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Column(
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: _ink,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -.3,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  _signup
                      ? '3 simple steps to get started'
                      : 'Sign in with your phone number — no password needed',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _muted),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          if (widget.initialError != null && widget.regions.isEmpty)
            Column(
              children: [
                _notice(widget.initialError!, isError: true),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: widget.onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry connection'),
                ),
              ],
            ),
          if (!_signup) _loginForm() else _signupForm(),
        ],
      ),
    );
  }

  Widget _loginForm() {
    return _cardSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _label('Phone · رقم الهاتف'),
          const SizedBox(height: 8),
          _phoneField(_loginPhone, '71 000 001'),
          const SizedBox(height: 8),
          const Text.rich(
            TextSpan(
              style: TextStyle(color: _muted, fontSize: 12),
              children: [
                TextSpan(text: 'Demo — '),
                TextSpan(
                  text: '71000001',
                  style: TextStyle(color: _green, fontWeight: FontWeight.w700),
                ),
                TextSpan(text: ' (Ahmed · Kairouan) or '),
                TextSpan(
                  text: '71000002',
                  style: TextStyle(color: _green, fontWeight: FontWeight.w700),
                ),
                TextSpan(text: ' (Fatima · Jendouba)'),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            _notice(_error!, isError: true),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _login,
            style: _primaryButtonStyle(),
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Sign In  →'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => setState(() {
              _signup = true;
              _error = null;
            }),
            child: const Text('New farmer? Create account'),
          ),
        ],
      ),
    );
  }

  Widget _signupForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _stepIndicator(),
        _card(child: _signupStepContent()),
      ],
    );
  }

  Widget _stepIndicator() => Padding(
    padding: const EdgeInsets.fromLTRB(18, 8, 18, 16),
    child: Row(
      children: List.generate(5, (index) {
        if (index.isOdd) {
          return Expanded(
            child: Container(
              height: 2,
              color: _signupStep > (index + 1) ~/ 2 ? _green : _border,
            ),
          );
        }
        final number = index ~/ 2 + 1;
        final active = number == _signupStep;
        final done = number < _signupStep;
        return CircleAvatar(
          radius: 15,
          backgroundColor: active || done ? _green : const Color(0xFFE7E3DC),
          child: Text(
            done ? '✓' : '$number',
            style: TextStyle(
              color: active || done ? Colors.white : _muted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        );
      }),
    ),
  );

  Widget _signupStepContent() {
    switch (_signupStep) {
      case 1:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Your Identity',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text(
              'إنشاء حساب جديد · Créer un compte',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
            const SizedBox(height: 18),
            _label('Full Name · الاسم'),
            const SizedBox(height: 7),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(hintText: 'Ahmed Ben Ali'),
            ),
            const SizedBox(height: 14),
            _label('Phone · الهاتف'),
            const SizedBox(height: 7),
            _phoneField(_signupPhone, '71 XXX XXX'),
            const SizedBox(height: 7),
            const Text(
              'Your phone number is your login — no password needed.',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
          ],
        );
      case 2:
        return _fieldMapStep();
      default:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Plot Details',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text(
              'تفاصيل القطعة · Détails de la parcelle',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
            const SizedBox(height: 18),
            _label('Crop · المحصول'),
            const SizedBox(height: 7),
            DropdownButtonFormField<int>(
              initialValue: _cropId,
              isExpanded: true,
              hint: const Text('Select crop…'),
              items: widget.crops
                  .map(
                    (crop) => DropdownMenuItem<int>(
                      value: crop['id'] as int,
                      child: Text(_text(crop['name'])),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => _cropId = value),
            ),
            const SizedBox(height: 16),
            _label('Soil Type · التربة'),
            const SizedBox(height: 7),
            DropdownButtonFormField<int>(
              initialValue: _soilId,
              isExpanded: true,
              hint: const Text('Select soil…'),
              items: widget.soils
                  .map(
                    (soil) => DropdownMenuItem<int>(
                      value: soil['id'] as int,
                      child: Text(_text(soil['name'])),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => _soilId = value),
            ),
          ],
        );
    }
  }

  Widget _fieldMapStep() {
    final area = areaHectares(_points);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Your Field',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 4),
        const Text(
          'ارسم قطعتك · Dessinez votre parcelle',
          style: TextStyle(color: _muted, fontSize: 12),
        ),
        const SizedBox(height: 12),
        _notice(
          'Navigate to your field, then tap each corner of your plot. Close the polygon when done.',
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 280,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: FlutterMap(
              mapController: _mapController,
              options: MapOptions(
                initialCenter: const LatLng(34.0, 9.5),
                initialZoom: 7,
                onTap: _addPoint,
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.ecoray.mobile',
                ),
                if (_points.length > 1)
                  PolylineLayer(
                    polylines: [
                      Polyline(
                        points: _points,
                        color: _green,
                        strokeWidth: 2,
                        pattern: const StrokePattern.dotted(),
                      ),
                    ],
                  ),
                if (_points.length > 2 && _polygonClosed)
                  PolygonLayer(
                    polygons: [
                      Polygon(
                        points: _points,
                        color: _green.withValues(alpha: .22),
                        borderColor: _green,
                        borderStrokeWidth: 2,
                      ),
                    ],
                  ),
                MarkerLayer(
                  markers: _points
                      .map(
                        (point) => Marker(
                          point: point,
                          width: 15,
                          height: 15,
                          child: Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF2DA84A),
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
                const RichAttributionWidget(
                  attributions: [
                    TextSourceAttribution('© OpenStreetMap contributors'),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: _points.isEmpty
                  ? null
                  : () => setState(() {
                      if (_polygonClosed) {
                        _polygonClosed = false;
                      } else {
                        _points.removeLast();
                      }
                      _region = _detectRegion();
                    }),
              icon: const Icon(Icons.undo, size: 18),
              label: const Text('Undo'),
            ),
            OutlinedButton.icon(
              onPressed: _points.isEmpty ? null : _clearPoints,
              icon: const Icon(Icons.clear, size: 18),
              label: const Text('Clear'),
            ),
            FilledButton.icon(
              onPressed: _points.length < 3
                  ? null
                  : () => setState(() {
                      _polygonClosed = true;
                      _region = _detectRegion();
                    }),
              style: FilledButton.styleFrom(backgroundColor: _green),
              icon: const Icon(Icons.check_circle_outline, size: 18),
              label: const Text('Close polygon'),
            ),
          ],
        ),
        if (_points.length >= 3) ...[
          const SizedBox(height: 8),
          _notice(
            'Area: ${area.toStringAsFixed(2)} ha  ·  Region: ${_text(_region?['name'], 'Tap Close polygon')}',
            isSuccess: true,
          ),
        ],
        const SizedBox(height: 8),
        const Text(
          'Outside Kairouan / Jendouba / Sfax? The nearest region data will be used.',
          style: TextStyle(color: _muted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _impactSection() {
    const stats = [
      ('33%', 'Evaporation reduction'),
      ('1,599', 'm³ saved / season'),
      ('230', 'TND saved / season'),
      ('3', 'Regions covered'),
    ];
    return Column(
      children: [
        _sectionTitle('Impact', 'Better farming starts with better decisions.'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Text(
            "Mulch reduces soil evaporation by up to 33%, cutting irrigation needs and pumping costs. EcoRay calculates savings using your crop, local evaporation data, and Tunisia's STEG tariff.",
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              height: 1.55,
            ),
          ),
        ),
        GridView.builder(
          padding: const EdgeInsets.all(20),
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: stats.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: 1.55,
          ),
          itemBuilder: (context, index) => Container(
            decoration: BoxDecoration(
              color: _green,
              borderRadius: BorderRadius.circular(14),
            ),
            padding: const EdgeInsets.all(14),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  stats[index].$1,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  stats[index].$2,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _supportedCrops() {
    const crops = [
      ('Tomato · طماطم', '5 cm mulch · Kc 1.15'),
      ('Pepper · فلفل', '5 cm mulch · Kc 1.05'),
      ('Eggplant · باذنجان', '5 cm mulch · Kc 1.05'),
      ('Zucchini · كوسة', '5 cm mulch · Kc 0.95'),
      ('Potato · بطاطس', '6 cm mulch · Kc 1.10'),
      ('Watermelon · بطيخ', '6 cm mulch · Kc 1.00'),
      ('Strawberry · فراولة', '5 cm mulch · Kc 1.05'),
      ('Young Olive · زيتون شاب', '8 cm mulch · Kc 0.65'),
      ('Carrot · جزر', '5 cm mulch · Kc 1.05'),
      ('Onion · بصل', '4 cm mulch · Kc 1.00'),
      ('Garlic · ثوم', '4 cm mulch · Kc 1.00'),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle(
          'Supported crops',
          'Tailored mulch recommendations for each crop.',
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: crops.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.55,
            ),
            itemBuilder: (context, index) => Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: _border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  const Icon(Icons.grass, color: _green, size: 25),
                  const Spacer(),
                  Text(
                    crops[index].$1,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    crops[index].$2,
                    style: const TextStyle(color: _muted, fontSize: 10),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _card({required Widget child}) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(16),
      boxShadow: const [
        BoxShadow(
          color: Color(0x10000000),
          blurRadius: 16,
          offset: Offset(0, 4),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        child,
        if (_error != null && _signup) ...[
          const SizedBox(height: 12),
          _notice(_error!, isError: true),
        ],
        const SizedBox(height: 18),
        Row(
          children: [
            if (_signupStep > 1)
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => setState(() {
                        _signupStep--;
                        _error = null;
                      }),
                child: const Text('← Back'),
              )
            else if (_signup)
              OutlinedButton(
                onPressed: () => setState(() {
                  _signup = false;
                  _error = null;
                }),
                child: const Text('← Back'),
              ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                onPressed: _busy ? null : _continueSignup,
                style: _primaryButtonStyle(),
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        _signupStep == 1
                            ? 'Draw Your Plot  →'
                            : _signupStep == 2
                            ? 'Crop Details  →'
                            : '🌿  Create Account',
                      ),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _cardSurface({required Widget child}) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(16),
      boxShadow: const [
        BoxShadow(
          color: Color(0x10000000),
          blurRadius: 16,
          offset: Offset(0, 4),
        ),
      ],
    ),
    child: child,
  );

  Widget _phoneField(TextEditingController controller, String hint) => Row(
    children: [
      Container(
        height: 56,
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 13),
        decoration: BoxDecoration(
          color: _green,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Text(
          '+216',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
            letterSpacing: .5,
          ),
        ),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          maxLength: 8,
          decoration: InputDecoration(hintText: hint, counterText: ''),
        ),
      ),
    ],
  );

  Widget _label(String text) => Text(
    text.toUpperCase(),
    style: const TextStyle(
      color: _muted,
      fontWeight: FontWeight.w700,
      fontSize: 11,
      letterSpacing: .5,
    ),
  );

  ButtonStyle _primaryButtonStyle() => FilledButton.styleFrom(
    backgroundColor: _green,
    foregroundColor: Colors.white,
    minimumSize: const Size.fromHeight(48),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
  );

  Widget _notice(String text, {bool isError = false, bool isSuccess = false}) {
    final color = isError
        ? const Color(0xFFB03535)
        : isSuccess
        ? _green
        : const Color(0xFF2255A4);
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: .18)),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 12, height: 1.4),
      ),
    );
  }
}

class _AuthenticatedPage extends StatelessWidget {
  const _AuthenticatedPage({
    required this.page,
    required this.farmer,
    required this.dashboard,
    required this.error,
    required this.alerts,
    required this.busy,
    required this.onSelectPage,
    required this.onThemeToggle,
    required this.onLogout,
    required this.onSimulateDay,
    required this.onResetDemo,
    required this.onRequestApplication,
    required this.onEditPlot,
    required this.onReply,
    required this.onDismiss,
    required this.onRefresh,
  });

  final String page;
  final Map<String, dynamic> farmer;
  final Map<String, dynamic>? dashboard;
  final String? error;
  final List<Map<String, dynamic>> alerts;
  final bool busy;
  final ValueChanged<String> onSelectPage;
  final VoidCallback onThemeToggle;
  final VoidCallback onLogout;
  final VoidCallback onSimulateDay;
  final VoidCallback onResetDemo;
  final ValueChanged<int> onRequestApplication;
  final ValueChanged<Map<String, dynamic>> onEditPlot;
  final ValueChanged<int> onReply;
  final ValueChanged<int> onDismiss;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final unread = alerts
        .where(
          (alert) =>
              (alert['read'] == 0 || alert['read'] == false) &&
              (alert['replied'] == 0 || alert['replied'] == false),
        )
        .length;
    return Scaffold(
      appBar: AppBar(
        title: const _Brand(height: 46),
        actions: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 105),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Text(
                _text(farmer['name']),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: 'Toggle dark mode',
            onPressed: onThemeToggle,
            icon: Icon(
              Theme.of(context).brightness == Brightness.dark
                  ? Icons.light_mode
                  : Icons.dark_mode,
            ),
          ),
          PopupMenuButton<String>(
            tooltip: _text(farmer['name']),
            onSelected: (value) {
              if (value == 'logout') onLogout();
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'logout',
                child: Text('Exit · ${_text(farmer['name'])}'),
              ),
            ],
          ),
        ],
      ),
      body: page == 'alerts'
          ? _AlertsPage(alerts: alerts, onReply: onReply, onDismiss: onDismiss)
          : _DashboardPage(
              farmer: farmer,
              dashboard: dashboard,
              error: error,
              busy: busy,
              onSimulateDay: onSimulateDay,
              onResetDemo: onResetDemo,
              onRequestApplication: onRequestApplication,
              onEditPlot: onEditPlot,
              onRefresh: onRefresh,
            ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: page == 'alerts' ? 1 : 0,
        onDestinationSelected: (index) =>
            onSelectPage(index == 0 ? 'dashboard' : 'alerts'),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text('$unread'),
              child: const Icon(Icons.sms_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: unread > 0,
              label: Text('$unread'),
              child: const Icon(Icons.sms),
            ),
            label: 'Alerts',
          ),
        ],
      ),
    );
  }
}

class _DashboardPage extends StatelessWidget {
  const _DashboardPage({
    required this.farmer,
    required this.dashboard,
    required this.error,
    required this.busy,
    required this.onSimulateDay,
    required this.onResetDemo,
    required this.onRequestApplication,
    required this.onEditPlot,
    required this.onRefresh,
  });

  final Map<String, dynamic> farmer;
  final Map<String, dynamic>? dashboard;
  final String? error;
  final bool busy;
  final VoidCallback onSimulateDay;
  final VoidCallback onResetDemo;
  final ValueChanged<int> onRequestApplication;
  final ValueChanged<Map<String, dynamic>> onEditPlot;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final data = dashboard;
    if (data == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            if (error == null)
              const CircularProgressIndicator(color: _green)
            else ...[
              const Icon(Icons.cloud_off_outlined, color: _muted, size: 34),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Text(error!, textAlign: TextAlign.center),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: onRefresh,
                style: FilledButton.styleFrom(backgroundColor: _green),
                child: const Text('Retry'),
              ),
            ],
            if (error == null) ...[
              const SizedBox(height: 14),
              Text('Loading ${_text(farmer['name'])}’s farm…'),
            ],
          ],
        ),
      );
    }
    final plotCards = _maps(data['plotCards']);
    return RefreshIndicator(
      color: _green,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          Text(
            'Your Farm Dashboard',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: _ink,
              fontWeight: FontWeight.w800,
              letterSpacing: -.5,
            ),
          ),
          const Text(
            'Real-time mulch recommendations for your plots',
            style: TextStyle(color: _muted),
          ),
          const SizedBox(height: 16),
          _demoBanner(context, data),
          const SizedBox(height: 14),
          _PlotMap(plotCards: plotCards, data: data),
          const SizedBox(height: 14),
          if (plotCards.isEmpty)
            _emptyCard(
              context,
              '🌱',
              'No plots yet. Sign up and draw your plot to see recommendations.',
            )
          else
            ...plotCards.map(
              (card) => Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: _PlotRecommendationCard(
                  card: card,
                  onRequest: onRequestApplication,
                  onEdit: onEditPlot,
                ),
              ),
            ),
          const SizedBox(height: 4),
          const Text(
            'From field to insight.',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          _stepTile(
            '01',
            'Satellite data',
            'FAO WaPOR evaporation values for your region.',
          ),
          _stepTile(
            '02',
            'Smart calculation',
            'Mulch degradation, water savings, and energy costs.',
          ),
          _stepTile(
            '03',
            'SMS alert',
            'Works offline. Reply 1 to schedule an application.',
          ),
        ],
      ),
    );
  }

  Widget _demoBanner(BuildContext context, Map<String, dynamic> data) {
    final heatWave = data['isHeatWave'] == true;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'SIMULATION DATE',
                    style: TextStyle(
                      color: Color(0xFF888888),
                      fontSize: 9,
                      letterSpacing: 1,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _text(data['currentDate'], '—'),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              if (heatWave)
                const Chip(
                  label: Text('🔥 Heat Wave'),
                  visualDensity: VisualDensity.compact,
                  backgroundColor: Color(0xFF8C4B13),
                  labelStyle: TextStyle(color: Colors.white, fontSize: 11),
                  side: BorderSide.none,
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            _text(data['forecastLabel']),
            style: const TextStyle(color: Color(0xFFB6B6B6), fontSize: 12),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: busy ? null : onSimulateDay,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFFFC107),
                    foregroundColor: _ink,
                    padding: const EdgeInsets.symmetric(vertical: 11),
                  ),
                  icon: busy
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.skip_next, size: 18),
                  label: const Text('Next Day'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: onResetDemo,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Color(0xFF777777)),
                  padding: const EdgeInsets.symmetric(
                    vertical: 11,
                    horizontal: 12,
                  ),
                ),
                icon: const Icon(Icons.refresh, size: 17),
                label: const Text('Reset'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stepTile(String number, String title, String description) =>
      Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: _greenLight,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFC8E6D0)),
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: _green,
              child: Text(
                number,
                style: const TextStyle(color: Colors.white, fontSize: 11),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      color: _ink,
                    ),
                  ),
                  Text(
                    description,
                    style: const TextStyle(color: _muted, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _emptyCard(BuildContext context, String icon, String message) =>
      Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Text(icon, style: const TextStyle(fontSize: 30)),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      );
}

class _PlotMap extends StatefulWidget {
  const _PlotMap({required this.plotCards, required this.data});

  final List<Map<String, dynamic>> plotCards;
  final Map<String, dynamic> data;

  @override
  State<_PlotMap> createState() => _PlotMapState();
}

class _PlotMapState extends State<_PlotMap> {
  bool _thermal = false;

  @override
  Widget build(BuildContext context) {
    final region = _map(widget.data['region']);
    final center = LatLng(
      _number(region['center_lat'], 35.8),
      _number(region['center_lng'], 9.5),
    );
    final polygons = <Polygon>[];
    final markers = <Marker>[];
    final heatCircles = <CircleMarker>[];

    for (final card in widget.plotCards) {
      final plot = _map(card['plot']);
      final recommendation = _map(card['recommendation']);
      final points = _polygonPoints(plot['polygon_geojson']);
      if (points.length >= 3) {
        final apply = recommendation['applyMulch'] == true;
        polygons.add(
          Polygon(
            points: points,
            color: _thermal
                ? Colors.transparent
                : (apply ? const Color(0xFFC0392B) : const Color(0xFF2DA84A))
                      .withValues(alpha: .25),
            borderColor: _thermal
                ? Colors.white
                : (apply ? Colors.red : const Color(0xFF2DA84A)),
            borderStrokeWidth: 2,
          ),
        );
        final plotCenter = LatLng(
          points.map((point) => point.latitude).reduce((a, b) => a + b) /
              points.length,
          points.map((point) => point.longitude).reduce((a, b) => a + b) /
              points.length,
        );
        markers.add(
          Marker(
            point: plotCenter,
            width: 28,
            height: 28,
            child: const Icon(Icons.location_on, color: _green, size: 26),
          ),
        );
        if (_thermal) {
          heatCircles.add(
            CircleMarker(
              point: plotCenter,
              radius: 48,
              color: const Color(0xFFE85D04).withValues(alpha: .28),
              borderStrokeWidth: 0,
            ),
          );
        }
      }
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.circle, size: 9, color: _green),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'LIVE · YOUR PLOTS',
                  style: TextStyle(
                    color: _muted,
                    fontSize: 10,
                    letterSpacing: .8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              _mapModeButton('🗺 Normal', !_thermal, () {
                setState(() => _thermal = false);
              }),
              const SizedBox(width: 4),
              _mapModeButton('🌡 Thermal', _thermal, () {
                setState(() => _thermal = true);
              }),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 280,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Stack(
                children: [
                  FlutterMap(
                    options: MapOptions(initialCenter: center, initialZoom: 10),
                    children: [
                      TileLayer(
                        urlTemplate: _thermal
                            ? 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'
                            : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: 'com.ecoray.mobile',
                      ),
                      if (_thermal && _owmTileApiKey.isNotEmpty)
                        TileLayer(
                          urlTemplate:
                              'https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=$_owmTileApiKey',
                          tileBuilder: (context, tileWidget, tile) =>
                              Opacity(opacity: .75, child: tileWidget),
                          userAgentPackageName: 'com.ecoray.mobile',
                        ),
                      if (heatCircles.isNotEmpty && _owmTileApiKey.isEmpty)
                        CircleLayer(circles: heatCircles),
                      if (polygons.isNotEmpty) PolygonLayer(polygons: polygons),
                      if (markers.isNotEmpty && !_thermal)
                        MarkerLayer(markers: markers),
                      RichAttributionWidget(
                        attributions: [
                          TextSourceAttribution(
                            _thermal
                                ? '© CARTO, © OpenStreetMap contributors, © OpenWeatherMap'
                                : '© OpenStreetMap contributors',
                          ),
                        ],
                      ),
                    ],
                  ),
                  if (_thermal)
                    Positioned(
                      left: 10,
                      bottom: 10,
                      child: Container(
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(
                          color: const Color(0xE6101010),
                          borderRadius: BorderRadius.circular(9),
                        ),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'SURFACE TEMPERATURE',
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: 8,
                                letterSpacing: .5,
                              ),
                            ),
                            SizedBox(height: 5),
                            SizedBox(
                              width: 110,
                              height: 9,
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.all(
                                    Radius.circular(4),
                                  ),
                                  gradient: LinearGradient(
                                    colors: [
                                      Color(0xFF00B4D8),
                                      Color(0xFF06D6A0),
                                      Color(0xFFFFD166),
                                      Color(0xFFF77F00),
                                      Color(0xFFD62828),
                                      Color(0xFF7209B7),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 110,
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    '15°C',
                                    style: TextStyle(
                                      color: Colors.white70,
                                      fontSize: 8,
                                    ),
                                  ),
                                  Text(
                                    '45°C+',
                                    style: TextStyle(
                                      color: Colors.white70,
                                      fontSize: 8,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Sample data for demo — production uses FAO WaPOR satellite data at 20 m resolution',
            textAlign: TextAlign.center,
            style: TextStyle(color: _muted, fontSize: 10),
          ),
        ],
      ),
    );
  }

  Widget _mapModeButton(String label, bool active, VoidCallback onTap) =>
      TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(
          foregroundColor: active ? Colors.white : _muted,
          backgroundColor: active
              ? (label.contains('Thermal') ? const Color(0xFFD62828) : _green)
              : Colors.transparent,
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600),
        ),
        child: Text(label),
      );
}

class _PlotRecommendationCard extends StatelessWidget {
  const _PlotRecommendationCard({
    required this.card,
    required this.onRequest,
    required this.onEdit,
  });

  final Map<String, dynamic> card;
  final ValueChanged<int> onRequest;
  final ValueChanged<Map<String, dynamic>> onEdit;

  @override
  Widget build(BuildContext context) {
    final plot = _map(card['plot']);
    final crop = _map(card['crop']);
    final soil = _map(card['soil']);
    final rec = _map(card['recommendation']);
    final request = card['serviceRequest'] is Map
        ? _map(card['serviceRequest'])
        : null;
    final apply = rec['applyMulch'] == true;
    final heatWave = rec['isHeatWave'] == true;
    final degradation = _number(rec['degradationPct']).round();
    final progressColor = degradation < 40
        ? _green
        : degradation < 60
        ? const Color(0xFFB87820)
        : const Color(0xFFB03535);
    final statusColor = heatWave
        ? const Color(0xFFB87820)
        : apply
        ? const Color(0xFFB03535)
        : _green;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 110,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(_cropPhoto(_text(crop['name'])), fit: BoxFit.cover),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [Color(0xC8000000), Color(0x11000000)],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(15),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Text(
                        '${_text(crop['name'])} / ${_text(crop['name_ar'])}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 17,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${_text(rec['season'])} · 🪨 ${_text(soil['name'])} · 📐 ${_number(plot['area_ha']).toStringAsFixed(2)} ha',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        apply
                            ? '⚠️ Apply ${_number(rec['mulchThicknessCm']).round()} cm mulch'
                            : '✅ Mulch OK — no action needed',
                        style: TextStyle(
                          color: statusColor,
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                    ),
                    if (heatWave)
                      const Chip(
                        label: Text('🔥 Heat wave'),
                        visualDensity: VisualDensity.compact,
                        labelStyle: TextStyle(fontSize: 10),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Apply before ${_text(rec['deadlineDate'])}',
                  style: const TextStyle(color: _muted, fontSize: 11),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Expanded(child: Text('Mulch degradation')),
                    Text(
                      '$degradation%',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: (degradation / 100).clamp(0, 1),
                    minHeight: 8,
                    color: progressColor,
                    backgroundColor: const Color(0xFFE9E6E0),
                  ),
                ),
                const SizedBox(height: 13),
                Row(
                  children: [
                    Expanded(
                      child: _stat(
                        'Evaporation',
                        _text(rec['evapRate']),
                        'mm / day',
                      ),
                    ),
                    Expanded(
                      child: _stat(
                        'Thickness',
                        _text(rec['mulchThicknessCm']),
                        'cm recommended',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: _stat(
                        'Water saved',
                        _number(rec['waterSavedM3']).round().toString(),
                        'm³ / season',
                        highlighted: true,
                      ),
                    ),
                    Expanded(
                      child: _stat(
                        'Cost saved',
                        _text(rec['electricitySavedTND']),
                        'TND / season',
                        highlighted: true,
                      ),
                    ),
                  ],
                ),
                if (apply && request == null) ...[
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => onRequest(_number(plot['id']).round()),
                    style: FilledButton.styleFrom(backgroundColor: _green),
                    icon: const Icon(Icons.agriculture),
                    label: const Text('Request Mulch Application  →'),
                  ),
                ],
                if (request != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEAF1FF),
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Text(
                      '🚜 ${_text(request['status']).toUpperCase()}'
                      '${request['scheduled_at'] == null ? '' : ' · ${request['scheduled_at']}'}',
                      style: const TextStyle(
                        color: Color(0xFF2255A4),
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () => onEdit(card),
                    icon: const Icon(Icons.edit_outlined, size: 17),
                    label: const Text('Edit Plot'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _muted,
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Savings: 33% evap reduction (Univ. of Florida IFAS) · 0.45 kWh/m³ pumping · 0.320 TND/kWh STEG tariff',
                  style: TextStyle(color: _muted, fontSize: 9, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _stat(
    String label,
    String value,
    String unit, {
    bool highlighted = false,
  }) => Container(
    margin: const EdgeInsets.symmetric(horizontal: 3),
    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 5),
    decoration: BoxDecoration(
      color: highlighted ? const Color(0xFFEAF4ED) : const Color(0xFFF8F7F4),
      borderRadius: BorderRadius.circular(9),
      border: Border.all(
        color: highlighted ? const Color(0xFFD1E9D8) : _border,
      ),
    ),
    child: Column(
      children: [
        Text(
          label.toUpperCase(),
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _muted,
            fontSize: 8,
            fontWeight: FontWeight.w700,
            letterSpacing: .4,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          value,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: highlighted ? _green : _ink,
            fontSize: 18,
            fontWeight: FontWeight.w900,
          ),
        ),
        Text(
          unit,
          textAlign: TextAlign.center,
          style: const TextStyle(color: _muted, fontSize: 8),
        ),
      ],
    ),
  );
}

class _AlertsPage extends StatelessWidget {
  const _AlertsPage({
    required this.alerts,
    required this.onReply,
    required this.onDismiss,
  });

  final List<Map<String, dynamic>> alerts;
  final ValueChanged<int> onReply;
  final ValueChanged<int> onDismiss;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 26),
      children: [
        Text(
          'SMS Alerts',
          style: Theme.of(context).textTheme.headlineSmall
              ?.copyWith(color: _ink, fontWeight: FontWeight.w800),
        ),
        const Text(
          'Messages your phone would receive — no internet required',
          style: TextStyle(color: _muted),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: _greenLight,
            border: Border.all(color: const Color(0xFFC8E6D0)),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Text(
            'Plain SMS — no smartphone needed. Delivered even during internet outages and power cuts. Reply 1 to schedule a mulch application.',
            style: TextStyle(color: _green, height: 1.45, fontSize: 13),
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: const Color(0xFF111111),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'SMS — MULCH ADVISORY SERVICE',
                      style: TextStyle(
                        color: Colors.white54,
                        fontSize: 9,
                        letterSpacing: .6,
                      ),
                    ),
                  ),
                  Text(
                    '${alerts.length} message${alerts.length == 1 ? '' : 's'}',
                    style: const TextStyle(color: Colors.white54, fontSize: 10),
                  ),
                ],
              ),
              const Divider(color: Color(0xFF333333), height: 20),
              if (alerts.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 30),
                  child: Column(
                    children: [
                      Icon(
                        Icons.mark_email_unread_outlined,
                        color: Colors.white30,
                        size: 36,
                      ),
                      SizedBox(height: 10),
                      Text(
                        'No alerts yet.\nClick Next Day on the dashboard to trigger one.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white60, height: 1.5),
                      ),
                    ],
                  ),
                )
              else
                ...alerts.map((alert) => _alertBubble(context, alert)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _alertBubble(BuildContext context, Map<String, dynamic> alert) {
    final isHeat = alert['trigger_type'] == 'heat_wave';
    final replied = alert['replied'] == 1 || alert['replied'] == true;
    final read = alert['read'] == 1 || alert['read'] == true;
    final sentAt = DateTime.tryParse(_text(alert['sent_at']));
    final time = sentAt == null
        ? _text(alert['sent_at'])
        : '${sentAt.day.toString().padLeft(2, '0')} '
              '${_month(sentAt.month)} · '
              '${sentAt.hour.toString().padLeft(2, '0')}:'
              '${sentAt.minute.toString().padLeft(2, '0')}';
    return Opacity(
      opacity: replied ? .55 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isHeat ? const Color(0xFF2B1B06) : const Color(0xFF1C1C1E),
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(16),
            topRight: Radius.circular(16),
            bottomRight: Radius.circular(16),
            bottomLeft: Radius.circular(4),
          ),
          border: isHeat ? Border.all(color: const Color(0xFF6C4A1A)) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (!read && !replied)
                  Container(
                    width: 7,
                    height: 7,
                    margin: const EdgeInsets.only(right: 6),
                    decoration: const BoxDecoration(
                      color: Color(0xFF4A9E64),
                      shape: BoxShape.circle,
                    ),
                  ),
                Expanded(
                  child: Text(
                    '${isHeat ? '🔥 Heat wave alert' : '🌿 Degradation alert'} · Plot #${_text(alert['plot_id'])} (${_text(alert['crop_name'])}) · $time',
                    style: const TextStyle(color: Colors.white54, fontSize: 10),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              _text(alert['message']),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 12),
            if (replied)
              const Text(
                '✓ Scheduled',
                style: TextStyle(
                  color: Color(0xFF8CBF91),
                  fontWeight: FontWeight.w700,
                ),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  FilledButton(
                    onPressed: () => onReply(_number(alert['id']).round()),
                    style: FilledButton.styleFrom(
                      backgroundColor: _green,
                      minimumSize: const Size(10, 36),
                    ),
                    child: const Text('Reply 1 — Schedule'),
                  ),
                  TextButton(
                    onPressed: () => onDismiss(_number(alert['id']).round()),
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.white70,
                    ),
                    child: const Text('Dismiss'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  String _month(int value) => const [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][value - 1];
}
