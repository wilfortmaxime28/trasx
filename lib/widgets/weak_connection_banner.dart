// lib/widgets/weak_connection_banner.dart
import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../services/network_quality_service.dart';

class WeakConnectionBanner extends StatefulWidget {
  final VoidCallback? onRetry;

  const WeakConnectionBanner({Key? key, this.onRetry}) : super(key: key);

  @override
  State<WeakConnectionBanner> createState() => _WeakConnectionBannerState();
}

class _WeakConnectionBannerState extends State<WeakConnectionBanner> {
  NetworkQuality _currentQuality = NetworkQuality.good;
  bool _dismissed = false;
  Timer? _dismissTimer;
  StreamSubscription<NetworkQuality>? _subscription;

  @override
  void initState() {
    super.initState();
    _currentQuality = NetworkQualityService().currentQuality;
    _resetTimerForQuality(_currentQuality);

    _subscription = NetworkQualityService().onQualityChanged.listen((quality) {
      if (mounted) {
        setState(() {
          _currentQuality = quality;
          _dismissed = false;
        });
        _resetTimerForQuality(quality);
      }
    });
  }

  void _resetTimerForQuality(NetworkQuality quality) {
    _dismissTimer?.cancel();
    if (quality == NetworkQuality.weak || quality == NetworkQuality.offline) {
      _dismissTimer = Timer(const Duration(seconds: 4), () {
        if (mounted) {
          setState(() {
            _dismissed = true;
          });
        }
      });
    }
  }

  @override
  void dispose() {
    _dismissTimer?.cancel();
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool showBanner = (_currentQuality == NetworkQuality.weak || _currentQuality == NetworkQuality.offline) && !_dismissed;
    final bool isOffline = _currentQuality == NetworkQuality.offline;
    final String message = isOffline
        ? 'Aucune connexion Internet. Vérifiez votre réseau puis réessayez.'
        : 'Votre connexion Internet est faible. La lecture peut être interrompue.';

    final double topPosition = showBanner ? (MediaQuery.of(context).padding.top + 50) : -120.0;
    final double opacity = showBanner ? 1.0 : 0.0;

    return AnimatedPositioned(
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeInOut,
      top: topPosition,
      left: 16,
      right: 16,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 300),
        opacity: opacity,
        child: Material(
          color: Colors.transparent,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: isOffline ? Colors.redAccent.withOpacity(0.9) : Colors.black87.withOpacity(0.85),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: isOffline ? Colors.red : Colors.white24,
                width: 1,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Colors.black54,
                  blurRadius: 8,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              children: [
                Icon(
                  isOffline ? CupertinoIcons.wifi_slash : CupertinoIcons.exclamationmark_triangle_fill,
                  color: Colors.white,
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    message,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (isOffline && widget.onRetry != null) ...[
                  const SizedBox(width: 8),
                  TextButton(
                    style: TextButton.styleFrom(
                      backgroundColor: Colors.white24,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                    onPressed: () {
                      setState(() {
                        _dismissed = false;
                      });
                      _resetTimerForQuality(_currentQuality);
                      widget.onRetry?.call();
                    },
                    child: const Text(
                      'Réessayer',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
