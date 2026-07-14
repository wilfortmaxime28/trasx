// lib/services/network_quality_service.dart
import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

enum NetworkQuality { good, average, weak, offline }

class NetworkQualityService {
  static final NetworkQualityService _instance = NetworkQualityService._internal();
  factory NetworkQualityService() => _instance;
  NetworkQualityService._internal();

  final _qualityController = StreamController<NetworkQuality>.broadcast();
  Stream<NetworkQuality> get onQualityChanged => _qualityController.stream;

  NetworkQuality _currentQuality = NetworkQuality.good;
  NetworkQuality get currentQuality => _currentQuality;

  final List<double> _initSpeedsMs = [];
  int _bufferingCount = 0;
  DateTime? _lastBufferingTime;
  int _errorCount = 0;
  StreamSubscription? _connectivitySubscription;

  void initialize() {
    if (_connectivitySubscription != null) return;

    // Check initial connectivity status
    Connectivity().checkConnectivity().then((results) {
      _handleConnectivityResults(results);
    });

    // Listen to network changes
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((results) {
      _handleConnectivityResults(results);
    });
  }

  void _handleConnectivityResults(dynamic results) {
    if (results is List) {
      final isOffline = results.isEmpty || results.contains(ConnectivityResult.none);
      if (isOffline) {
        _updateQuality(NetworkQuality.offline);
      } else {
        _evaluateQuality();
      }
    } else if (results is ConnectivityResult) {
      if (results == ConnectivityResult.none) {
        _updateQuality(NetworkQuality.offline);
      } else {
        _evaluateQuality();
      }
    }
  }

  void recordInitialization(Duration duration) {
    _initSpeedsMs.add(duration.inMilliseconds.toDouble());
    if (_initSpeedsMs.length > 5) {
      _initSpeedsMs.removeAt(0);
    }
    _evaluateQuality();
  }

  void recordBuffering() {
    final now = DateTime.now();
    if (_lastBufferingTime != null && now.difference(_lastBufferingTime!) < const Duration(seconds: 15)) {
      _bufferingCount++;
    } else {
      _bufferingCount = 1;
    }
    _lastBufferingTime = now;
    _evaluateQuality();
  }

  void recordError() {
    _errorCount++;
    _evaluateQuality();
  }

  void recordOffline() {
    _updateQuality(NetworkQuality.offline);
  }

  void recordSuccess() {
    _errorCount = 0;
    _bufferingCount = 0;
    if (_currentQuality == NetworkQuality.offline) {
      _currentQuality = NetworkQuality.good;
    }
    _evaluateQuality();
  }

  void _updateQuality(NetworkQuality newQuality) {
    if (_currentQuality != newQuality) {
      _currentQuality = newQuality;
      _qualityController.add(newQuality);
    }
  }

  void _evaluateQuality() {
    if (_currentQuality == NetworkQuality.offline) {
      // Don't override offline state unless a success occurs or connectivity triggers.
      return;
    }

    double avgInit = 0.0;
    if (_initSpeedsMs.isNotEmpty) {
      avgInit = _initSpeedsMs.reduce((a, b) => a + b) / _initSpeedsMs.length;
    }

    if (_errorCount >= 3) {
      _updateQuality(NetworkQuality.weak);
    } else if (avgInit > 3000 || _bufferingCount >= 3) {
      _updateQuality(NetworkQuality.weak);
    } else if (avgInit > 1500 || _bufferingCount >= 1) {
      _updateQuality(NetworkQuality.average);
    } else {
      _updateQuality(NetworkQuality.good);
    }
  }

  void dispose() {
    _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
  }
}
