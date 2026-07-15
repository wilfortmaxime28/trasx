import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

class KycCameraPage extends StatefulWidget {
  const KycCameraPage({super.key});

  @override
  State<KycCameraPage> createState() => _KycCameraPageState();
}

class _KycCameraPageState extends State<KycCameraPage> {
  static const Color _accentColor = Color(0xFF0A84FF);
  static const Color _successColor = Color(0xFF34C759);
  static const Color _textColor = Color(0xFF111827);
  static const Color _mutedColor = Color(0xFF6B7280);

  List<CameraDescription> _cameras = [];
  CameraController? _cameraController;
  File? _capturedSelfieFile;
  bool _isPreparing = true;
  bool _isSavingCapture = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_initializeCamera());
  }

  Future<void> _initializeCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        throw Exception('Aucune caméra disponible.');
      }

      // Find the front camera
      final frontCamera = _cameras.firstWhere(
        (camera) => camera.lensDirection == CameraLensDirection.front,
        orElse: () => _cameras.first,
      );

      _cameraController = CameraController(
        frontCamera,
        ResolutionPreset.medium,
        enableAudio: false,
      );

      await _cameraController!.initialize();
      if (!mounted) return;

      setState(() {
        _isPreparing = false;
        _errorMessage = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isPreparing = false;
        _errorMessage = 'Impossible d\'ouvrir la caméra : $e';
      });
    }
  }

  Future<void> _takePicture() async {
    final controller = _cameraController;
    if (controller == null || !controller.value.isInitialized || _isSavingCapture) {
      return;
    }

    setState(() {
      _isSavingCapture = true;
    });

    try {
      final file = await controller.takePicture();
      final tempDir = await getTemporaryDirectory();
      final destinationPath =
          '${tempDir.path}/kyc_selfie_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final savedFile = await File(file.path).copy(destinationPath);

      if (!mounted) return;
      setState(() {
        _capturedSelfieFile = savedFile;
        _isSavingCapture = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSavingCapture = false;
        _errorMessage = 'Échec de la prise de photo : $e';
      });
    }
  }

  Future<void> _retakeCapture() async {
    setState(() {
      _capturedSelfieFile = null;
      _errorMessage = null;
    });
  }

  void _completeCapture() {
    final selfie = _capturedSelfieFile;
    if (selfie == null) return;
    Navigator.of(context).pop(selfie);
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          child: _errorMessage != null
              ? _buildErrorState()
              : _capturedSelfieFile != null
              ? _buildCapturedState()
              : _buildCameraState(),
        ),
      ),
    );
  }

  Widget _buildCameraState() {
    final controller = _cameraController;

    if (_isPreparing || controller == null || !controller.value.isInitialized) {
      return _buildLoadingState();
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        // Camera Preview
        CameraPreview(controller),
        
        // Semi-transparent cutout overlay
        ClipPath(
          clipper: OvalCutoutClipper(),
          child: Container(
            color: Colors.black.withOpacity(0.72),
          ),
        ),
        
        // Oval border outline
        CustomPaint(
          size: Size.infinite,
          painter: OvalBorderPainter(color: _accentColor.withOpacity(0.85)),
        ),

        // Custom Top Bar with Back Button
        Positioned(
          left: 0,
          right: 0,
          top: 0,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withOpacity(0.65),
                  Colors.transparent,
                ],
              ),
            ),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
                  onPressed: () => Navigator.of(context).pop(),
                ),
                const Spacer(),
                const Text(
                  'Scan Visage',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                const SizedBox(width: 48), // Balancing spacer
              ],
            ),
          ),
        ),

        // Capture Controls at the bottom
        Positioned(
          left: 24,
          right: 24,
          bottom: 34,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.76),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Alignez votre visage dans le cadre ovale',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              GestureDetector(
                onTap: _takePicture,
                child: Container(
                  width: 76,
                  height: 76,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.white,
                      width: 4,
                    ),
                    color: Colors.white.withOpacity(0.16),
                  ),
                  padding: const EdgeInsets.all(6),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white,
                    ),
                    child: const Center(
                      child: Icon(
                        Icons.camera_alt_rounded,
                        color: Colors.black,
                        size: 26,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        
        if (_isSavingCapture) _buildSavingOverlay(),
      ],
    );
  }

  Widget _buildCapturedState() {
    final selfie = _capturedSelfieFile!;

    return Container(
      color: Colors.white,
      child: Column(
        key: const ValueKey('captured'),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _textColor),
                  onPressed: _retakeCapture,
                ),
                const Spacer(),
                const Text(
                  'Aperçu du selfie',
                  style: TextStyle(
                    color: _textColor,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                const SizedBox(width: 48),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 18),
              child: Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: _successColor.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.check_rounded,
                      color: _successColor,
                      size: 48,
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Photo capturée !',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: _textColor,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Assurez-vous que votre visage est parfaitement visible et net.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: _mutedColor,
                      fontSize: 14,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(28),
                      child: Image.file(
                        selfie,
                        width: double.infinity,
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 18),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _retakeCapture,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _textColor,
                      side: const BorderSide(color: Color(0xFFD1D5DB)),
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: const Text(
                      'Reprendre',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: _completeCapture,
                    style: FilledButton.styleFrom(
                      backgroundColor: _accentColor,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: const Text(
                      'Continuer',
                      style: TextStyle(fontWeight: FontWeight.w800),
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

  Widget _buildLoadingState() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 30,
            height: 30,
            child: CircularProgressIndicator(
              strokeWidth: 2.8,
              color: Colors.white,
            ),
          ),
          SizedBox(height: 18),
          Text(
            'Préparation de la caméra...',
            style: TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildSavingOverlay() {
    return Container(
      color: Colors.black54,
      child: const Center(
        child: SizedBox(
          width: 34,
          height: 34,
          child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white),
        ),
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      key: const ValueKey('error'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 74,
              height: 74,
              decoration: const BoxDecoration(
                color: Color(0xFF1F1F1F),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.camera_alt_outlined,
                color: Colors.white30,
                size: 34,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              _errorMessage ?? 'La caméra KYC est indisponible.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              style: FilledButton.styleFrom(
                backgroundColor: _accentColor,
                foregroundColor: Colors.white,
                minimumSize: const Size(170, 50),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Text('Retour'),
            ),
          ],
        ),
      ),
    );
  }
}

class OvalCutoutClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    
    final cutoutWidth = size.width * 0.70;
    final cutoutHeight = cutoutWidth * 1.35;
    final cutoutRect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2 - 40),
      width: cutoutWidth,
      height: cutoutHeight,
    );
    
    path.addOval(cutoutRect);
    path.fillType = PathFillType.evenOdd;
    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

class OvalBorderPainter extends CustomPainter {
  final Color color;
  OvalBorderPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final cutoutWidth = size.width * 0.70;
    final cutoutHeight = cutoutWidth * 1.35;
    final cutoutRect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2 - 40),
      width: cutoutWidth,
      height: cutoutHeight,
    );

    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5;
    
    canvas.drawOval(cutoutRect, paint);
  }

  @override
  bool shouldRepaint(covariant OvalBorderPainter oldDelegate) =>
      oldDelegate.color != color;
}
