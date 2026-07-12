import 'dart:async';
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

/// A full-screen professional camera page for KYC selfie capture with
/// real-time liveness challenges (blink + head turn).
class KycCameraPage extends StatefulWidget {
  const KycCameraPage({super.key});

  @override
  State<KycCameraPage> createState() => _KycCameraPageState();
}

enum _LivenessStep {
  position,  // Align face in oval
  blink,     // Blink eyes
  turn,      // Turn head
  capturing, // Capturing photo
  done,
}

class _KycCameraPageState extends State<KycCameraPage>
    with TickerProviderStateMixin {
  CameraController? _controller;
  List<CameraDescription> _cameras = [];
  bool _isInitialized = false;
  bool _hasError = false;
  String _errorMessage = '';

  _LivenessStep _step = _LivenessStep.position;
  int _stepProgress = 0; // 0-100
  Timer? _challengeTimer;

  // Animations
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  late AnimationController _checkController;
  late Animation<double> _checkAnimation;

  // Step durations (ms)
  static const _positionDelay = 2500;
  static const _blinkDuration = 3000;
  static const _turnDuration = 3500;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.06).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    _checkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _checkAnimation = CurvedAnimation(parent: _checkController, curve: Curves.elasticOut);

    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        setState(() {
          _hasError = true;
          _errorMessage = 'Aucune caméra disponible.';
        });
        return;
      }

      // Prefer front camera
      CameraDescription selectedCamera = _cameras.first;
      for (final cam in _cameras) {
        if (cam.lensDirection == CameraLensDirection.front) {
          selectedCamera = cam;
          break;
        }
      }

      _controller = CameraController(
        selectedCamera,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );

      await _controller!.initialize();
      if (!mounted) return;

      setState(() => _isInitialized = true);
      _startLivenessFlow();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _errorMessage = 'Erreur caméra : ${e.toString()}';
      });
    }
  }

  void _startLivenessFlow() {
    // Step 1: Position (2.5s)
    setState(() {
      _step = _LivenessStep.position;
      _stepProgress = 0;
    });
    _runProgressTimer(_positionDelay, () => _advanceToBlink());
  }

  void _advanceToBlink() {
    setState(() {
      _step = _LivenessStep.blink;
      _stepProgress = 0;
    });
    _runProgressTimer(_blinkDuration, () => _advanceToTurn());
  }

  void _advanceToTurn() {
    setState(() {
      _step = _LivenessStep.turn;
      _stepProgress = 0;
    });
    _runProgressTimer(_turnDuration, () => _capturePhoto());
  }

  void _runProgressTimer(int durationMs, VoidCallback onComplete) {
    _challengeTimer?.cancel();
    const tickMs = 50;
    final ticks = durationMs ~/ tickMs;
    int current = 0;
    _challengeTimer = Timer.periodic(const Duration(milliseconds: tickMs), (t) {
      current++;
      final pct = ((current / ticks) * 100).clamp(0, 100).toInt();
      if (mounted) setState(() => _stepProgress = pct);
      if (current >= ticks) {
        t.cancel();
        onComplete();
      }
    });
  }

  Future<void> _capturePhoto() async {
    if (!mounted || _controller == null || !_controller!.value.isInitialized) {
      return;
    }
    setState(() {
      _step = _LivenessStep.capturing;
      _stepProgress = 100;
    });

    try {
      final XFile photo = await _controller!.takePicture();
      final dir = await getTemporaryDirectory();
      final destPath = '${dir.path}/kyc_selfie_${DateTime.now().millisecondsSinceEpoch}.jpg';
      await File(photo.path).copy(destPath);

      _checkController.forward();
      setState(() => _step = _LivenessStep.done);

      await Future.delayed(const Duration(milliseconds: 700));
      if (mounted) {
        Navigator.of(context).pop(File(destPath));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur de capture : $e')),
        );
        _startLivenessFlow();
      }
    }
  }

  @override
  void dispose() {
    _challengeTimer?.cancel();
    _controller?.dispose();
    _pulseController.dispose();
    _checkController.dispose();
    super.dispose();
  }

  // ──────────────────────────────────────────────────────────── BUILD ──────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: _hasError
            ? _buildError()
            : !_isInitialized
                ? _buildLoading()
                : _buildCamera(),
      ),
    );
  }

  Widget _buildLoading() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Color(0xFFFE2C55)),
          SizedBox(height: 20),
          Text('Initialisation de la caméra...', style: TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.camera_alt_outlined, color: Colors.white38, size: 64),
            const SizedBox(height: 20),
            Text(
              _errorMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 15),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.arrow_back),
              label: const Text('Retour'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFE2C55),
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCamera() {
    return Stack(
      fit: StackFit.expand,
      children: [
        // ── Full-screen camera preview ──────────────────────────────
        _buildCameraPreview(),

        // ── Dark vignette overlay ───────────────────────────────────
        Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment.center,
              radius: 0.85,
              colors: [Colors.transparent, Color(0xBB000000)],
            ),
          ),
        ),

        // ── Oval face guide + animated border ──────────────────────
        Center(child: _buildOvalOverlay()),

        // ── Top header ─────────────────────────────────────────────
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: _buildHeader(),
        ),

        // ── Bottom instruction card ─────────────────────────────────
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: _buildBottomCard(),
        ),
      ],
    );
  }

  Widget _buildCameraPreview() {
    final size = MediaQuery.of(context).size;
    // Mirror front camera
    return ClipRect(
      child: Transform.scale(
        scale: 1.0,
        child: SizedBox(
          width: size.width,
          height: size.height,
          child: CameraPreview(_controller!),
        ),
      ),
    );
  }

  Widget _buildOvalOverlay() {
    final isDone = _step == _LivenessStep.done;
    final borderColor = isDone ? Colors.green : const Color(0xFFFE2C55);
    final glowColor = isDone ? Colors.green : const Color(0xFFFE2C55);

    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (_, __) {
        final scale = isDone ? 1.0 : _pulseAnimation.value;
        return Transform.scale(
          scale: scale,
          child: Container(
            width: 260,
            height: 330,
            decoration: BoxDecoration(
              shape: BoxShape.rectangle,
              borderRadius: BorderRadius.circular(150),
              border: Border.all(
                color: borderColor,
                width: 3,
              ),
              boxShadow: [
                BoxShadow(
                  color: glowColor.withValues(alpha: 0.45),
                  blurRadius: 24,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: isDone
                ? ScaleTransition(
                    scale: _checkAnimation,
                    child: const Icon(
                      Icons.check_rounded,
                      color: Colors.green,
                      size: 80,
                    ),
                  )
                : null,
          ),
        );
      },
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xDD000000), Colors.transparent],
        ),
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
            ),
          ),
          const SizedBox(width: 16),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Vérification de Vivacité',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 17,
                  ),
                ),
                Text(
                  'KYC • Caméra Frontale',
                  style: TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xFFFE2C55).withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFFE2C55).withValues(alpha: 0.5)),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.fiber_manual_record, color: Color(0xFFFE2C55), size: 8),
                SizedBox(width: 5),
                Text('LIVE', style: TextStyle(color: Color(0xFFFE2C55), fontSize: 11, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomCard() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0xFF000000), Color(0xAA000000), Colors.transparent],
          stops: [0.0, 0.7, 1.0],
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Step dots
          _buildStepDots(),
          const SizedBox(height: 20),

          // Instruction box
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.07),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: Column(
              children: [
                Icon(
                  _stepIcon(),
                  color: _step == _LivenessStep.done ? Colors.green : const Color(0xFFFE2C55),
                  size: 32,
                ),
                const SizedBox(height: 12),
                Text(
                  _stepTitle(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 17,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 6),
                Text(
                  _stepSubtitle(),
                  style: const TextStyle(color: Colors.white60, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                // Progress bar
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: _stepProgress / 100,
                    minHeight: 6,
                    backgroundColor: Colors.white12,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      _step == _LivenessStep.done ? Colors.green : const Color(0xFFFE2C55),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepDots() {
    final steps = [
      _LivenessStep.position,
      _LivenessStep.blink,
      _LivenessStep.turn,
    ];
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: steps.map((s) {
        final isActive = _stepIndex(s) == _stepIndex(_step);
        final isDone = _stepIndex(_step) > _stepIndex(s);
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 5),
          width: isActive ? 24 : 8,
          height: 8,
          decoration: BoxDecoration(
            color: isDone
                ? Colors.green
                : isActive
                    ? const Color(0xFFFE2C55)
                    : Colors.white24,
            borderRadius: BorderRadius.circular(4),
          ),
        );
      }).toList(),
    );
  }

  int _stepIndex(_LivenessStep step) {
    switch (step) {
      case _LivenessStep.position:   return 0;
      case _LivenessStep.blink:      return 1;
      case _LivenessStep.turn:       return 2;
      case _LivenessStep.capturing:
      case _LivenessStep.done:       return 3;
    }
  }

  IconData _stepIcon() {
    switch (_step) {
      case _LivenessStep.position:  return Icons.face_rounded;
      case _LivenessStep.blink:     return Icons.remove_red_eye_rounded;
      case _LivenessStep.turn:      return Icons.rotate_left_rounded;
      case _LivenessStep.capturing: return Icons.camera_rounded;
      case _LivenessStep.done:      return Icons.check_circle_rounded;
    }
  }

  String _stepTitle() {
    switch (_step) {
      case _LivenessStep.position:  return 'Positionnez votre visage';
      case _LivenessStep.blink:     return 'Clignez des yeux lentement';
      case _LivenessStep.turn:      return 'Tournez la tête de gauche à droite';
      case _LivenessStep.capturing: return 'Capture en cours...';
      case _LivenessStep.done:      return 'Selfie capturé !';
    }
  }

  String _stepSubtitle() {
    switch (_step) {
      case _LivenessStep.position:
        return 'Centrez votre visage dans l\'ovale et regardez la caméra.';
      case _LivenessStep.blink:
        return 'Fermez et rouvrez lentement les yeux deux fois.';
      case _LivenessStep.turn:
        return 'Tournez doucement la tête de gauche à droite pour confirmer la vivacité.';
      case _LivenessStep.capturing:
        return 'Restez immobile...';
      case _LivenessStep.done:
        return 'Parfait ! Votre selfie est en cours d\'analyse.';
    }
  }
}
