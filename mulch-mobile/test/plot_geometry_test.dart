import 'package:ecoray/plot_geometry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  group('areaHectares', () {
    test('calculates the area of a small field polygon', () {
      final points = [
        const LatLng(0, 0),
        const LatLng(0, 0.001),
        const LatLng(0.001, 0.001),
        const LatLng(0.001, 0),
      ];

      expect(areaHectares(points), closeTo(1.236, 0.02));
    });

    test('returns zero when fewer than three corners are provided', () {
      expect(areaHectares([const LatLng(35, 10), const LatLng(35.001, 10)]), 0);
    });
  });
}
