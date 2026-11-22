import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

double areaHectares(List<LatLng> points) {
  if (points.length < 3) return 0;
  const earthRadius = 6371000.0;
  final latitude =
      points.map((point) => point.latitude).reduce((a, b) => a + b) /
      points.length *
      math.pi /
      180;
  final projected = points
      .map(
        (point) => <double>[
          earthRadius * point.longitude * math.pi / 180 * math.cos(latitude),
          earthRadius * point.latitude * math.pi / 180,
        ],
      )
      .toList();
  var area = 0.0;
  for (var index = 0; index < projected.length; index++) {
    final next = (index + 1) % projected.length;
    area +=
        projected[index][0] * projected[next][1] -
        projected[next][0] * projected[index][1];
  }
  return area.abs() / 2 / 10000;
}
