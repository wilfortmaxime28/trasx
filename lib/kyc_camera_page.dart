import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:face_camera/face_camera.dart';
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

  FaceCameraController? _controller;
  File? _capturedSelfieFile;
  bool _isPreparing = true;
  bool _isSavingCapture = false;
  bool _isRetaking = false;
  bool _hasHandledCapture = false;
  String? _errorMessage;

  Timer? _faceLostTimer;
  Timer? _stabilityTimer;
  bool _hasFace = false;
  bool _isReady = false;
  bool _isCapturing = false;

  @override
  void initState() {
    super.initState();
    unawaited(_prepareCamera());
  }

  Future<void> _prepareCamera() async {
    try {
      await FaceCamera.initialize();
      if (!mounted) return;

      if (FaceCamera.cameras.isEmpty) {
        throw Exception('Aucune caméra disponible.');
      }

      _controller = _createController();
      _setupControllerListener();
      setState(() {
        _isPreparing = false;
        _errorMessage = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isPreparing = false;
        _errorMessage = 'Impossible d ouvrir la caméra KYC : $error';
      });
    }
  }

  FaceCameraController _createController() {
    return FaceCameraController(
      autoCapture: false,
      ignoreFacePositioning: false,
      enableAudio: false,
      imageResolution: ImageResolution.medium,
      defaultCameraLens: CameraLens.front,
      defaultFlashMode: CameraFlashMode.off,
      orientation: CameraOrientation.portraitUp,
      performanceMode: FaceDetectorMode.fast,
      onCapture: _handleCapture,
    );
  }

  void _setupControllerListener() {
    _faceLostTimer?.cancel();
    _stabilityTimer?.cancel();
    _controller?.addListener(_onCameraControllerChanged);
  }

  void _onCameraControllerChanged() {
    if (!mounted || _isCapturing) return;
    final state = _controller?.value;
    if (state == null) return;

    final detectedFace = state.detectedFace as DetectedFace?;
    final currentHasFace = detectedFace?.face != null;
    final currentIsReady = detectedFace?.wellPositioned == true;

    if (currentHasFace) {
      _faceLostTimer?.cancel();
      if (!_hasFace || _isReady != currentIsReady) {
        setState(() {
          _hasFace = true;
          _isReady = currentIsReady;
        });
      }

      // Stability-based auto-capture
      if (currentIsReady) {
        if (_stabilityTimer == null || !_stabilityTimer!.isActive) {
          _stabilityTimer = Timer(const Duration(milliseconds: 1500), () {
            if (mounted && _isReady && !_isCapturing) {
              _triggerCapture();
            }
          });
        }
      } else {
        _stabilityTimer?.cancel();
      }
    } else {
      _stabilityTimer?.cancel();
      // Debounce face loss slightly to reduce flickering on momentary losses
      if (_faceLostTimer == null || !_faceLostTimer!.isActive) {
        _faceLostTimer = Timer(const Duration(milliseconds: 400), () {
          if (mounted) {
            setState(() {
              _hasFace = false;
              _isReady = false;
            });
          }
        });
      }
    }
  }

  void _triggerCapture() {
    if (_isCapturing || _controller == null) return;
    setState(() {
      _isCapturing = true;
    });
    _controller?.captureImage();
  }

  Future<void> _handleCapture(File? image) async {
    if (image == null || _isSavingCapture || _hasHandledCapture || !mounted) {
      return;
    }

    _hasHandledCapture = true;

    setState(() {
      _isSavingCapture = true;
    });

    try {
      final activeController = _controller;
      activeController?.removeListener(_onCameraControllerChanged);
      _faceLostTimer?.cancel();
      _stabilityTimer?.cancel();

      final tempDir = await getTemporaryDirectory();
      final destinationPath =
          '${tempDir.path}/kyc_selfie_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final savedFile = await image.copy(destinationPath);

      if (!mounted) return;
      setState(() {
        _capturedSelfieFile = savedFile;
        _controller = null;
        _isSavingCapture = false;
        _isCapturing = false;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        unawaited(activeController?.dispose());
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _hasHandledCapture = false;
        _isSavingCapture = false;
        _isCapturing = false;
        _errorMessage = 'La capture du selfie a échoué : $error';
      });
    }
  }

  Future<void> _retakeCapture() async {
    if (_isRetaking) return;
    final previousController = _controller;
    previousController?.removeListener(_onCameraControllerChanged);
    _faceLostTimer?.cancel();
    _stabilityTimer?.cancel();

    final nextController = _createController();

    setState(() {
      _isRetaking = true;
      _capturedSelfieFile = null;
      _errorMessage = null;
      _hasHandledCapture = false;
      _hasFace = false;
      _isReady = false;
      _isCapturing = false;
      _controller = nextController;
    });

    _setupControllerListener();

    unawaited(previousController?.dispose());
    if (mounted) {
      setState(() {
        _isRetaking = false;
      });
    }
  }

  void _completeCapture() {
    final selfie = _capturedSelfieFile;
    if (selfie == null) return;
    Navigator.of(context).pop(selfie);
  }

  @override
  void dispose() {
    _faceLostTimer?.cancel();
    _stabilityTimer?.cancel();
    _controller?.removeListener(_onCameraControllerChanged);
    unawaited(_controller?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
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
    final controller = _controller;

    return Column(
      key: const ValueKey('camera'),
      children: [
        _buildTopBar(),
        Expanded(
          child: _isPreparing || controller == null
              ? _buildLoadingState()
              : Stack(
                  fit: StackFit.expand,
                  children: [
                    SmartFaceCamera(
                      controller: controller,
                      showControls: false,
                      showCaptureControl: false,
                      showFlashControl: false,
                      showCameraLensControl: false,
                      autoDisableCaptureControl: true,
                      indicatorShape: IndicatorShape.none,
                      messageBuilder: _buildCameraMessage,
                    ),
                    _buildPersistentFaceFrame(controller),
                    Positioned(
                      left: 24,
                      right: 24,
                      bottom: 34,
                      child: _buildBottomControls(),
                    ),
                    if (_isSavingCapture) _buildSavingOverlay(),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildTopBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 2, 14, 4),
      child: Row(
        children: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            style: TextButton.styleFrom(
              foregroundColor: _accentColor,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              textStyle: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w500,
              ),
            ),
            child: const Text('Annuler'),
          ),
          const Spacer(),
          const Text(
            'Scan visage',
            style: TextStyle(
              color: _textColor,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
          const Spacer(),
          const SizedBox(width: 76),
        ],
      ),
    );
  }

  Widget _buildCameraMessage(BuildContext context, DetectedFace? detectedFace) {
    final message = !_hasFace
        ? 'Placez votre visage dans le cadre'
        : _isReady
        ? 'Parfait. Capture automatique...'
        : 'Centrez votre visage et gardez la tête droite';

    return Align(
      alignment: Alignment.topCenter,
      child: Container(
        margin: const EdgeInsets.fromLTRB(22, 18, 22, 0),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.12),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _textColor,
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  Widget _buildPersistentFaceFrame(FaceCameraController controller) {
    final screenSize = MediaQuery.sizeOf(context);
    final frameWidth = math.min(screenSize.width - 64, 286.0);
    final frameHeight = frameWidth * 1.16;

    final frameColor = _isReady
        ? _successColor
        : _hasFace
        ? _accentColor
        : Colors.white;
    final label = _isReady
        ? 'Ne bougez plus'
        : _hasFace
        ? 'Ajustez légèrement'
        : 'Cadrez votre visage';

    return IgnorePointer(
      child: Center(
        child: Transform.translate(
          offset: const Offset(0, -12),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            width: frameWidth,
            height: frameHeight,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(34),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.92),
                width: 6,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.22),
                  blurRadius: 24,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: Container(
              margin: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: frameColor, width: 3),
              ),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: -20,
                    child: Center(
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: frameColor.withValues(alpha: 0.96),
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.18),
                              blurRadius: 12,
                              offset: const Offset(0, 5),
                            ),
                          ],
                        ),
                        child: Text(
                          label,
                          style: TextStyle(
                            color: _hasFace || _isReady
                                ? Colors.white
                                : _textColor,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBottomControls() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.76),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            _isReady
                ? 'Restez immobile pendant la capture...'
                : _hasFace
                ? 'Centrez votre visage dans le cercle bleu...'
                : 'Placez votre visage au centre du cadre',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(height: 20),
        GestureDetector(
          onTap: _isReady && !_isCapturing ? _triggerCapture : null,
          child: Container(
            width: 76,
            height: 76,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: Colors.white,
                width: 4,
              ),
              color: Colors.white.withValues(alpha: 0.16),
            ),
            padding: const EdgeInsets.all(6),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _isReady
                    ? _successColor
                    : Colors.white.withValues(alpha: 0.45),
              ),
              child: Center(
                child: _isCapturing
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : Icon(
                        Icons.camera_alt_rounded,
                        color: _isReady ? Colors.white : Colors.white.withValues(alpha: 0.7),
                        size: 26,
                      ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSavingOverlay() {
    return Container(
      color: Colors.white.withValues(alpha: 0.72),
      child: const Center(
        child: SizedBox(
          width: 34,
          height: 34,
          child: CircularProgressIndicator(strokeWidth: 3, color: _accentColor),
        ),
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
              color: _accentColor,
            ),
          ),
          SizedBox(height: 18),
          Text(
            'Préparation de la caméra...',
            style: TextStyle(color: _mutedColor, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildCapturedState() {
    final selfie = _capturedSelfieFile!;

    return Column(
      key: const ValueKey('captured'),
      children: [
        _buildTopBar(),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 18),
            child: Column(
              children: [
                const SizedBox(height: 10),
                Container(
                  width: 112,
                  height: 112,
                  decoration: BoxDecoration(
                    color: _successColor.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    color: _successColor,
                    size: 58,
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Scan facial terminé.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: _textColor,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Vérifiez que votre visage est clair avant de continuer.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: _mutedColor,
                    fontSize: 14,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 26),
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
                  onPressed: _isRetaking ? null : _retakeCapture,
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
                color: Color(0xFFF3F4F6),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.camera_alt_outlined,
                color: _mutedColor,
                size: 34,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              _errorMessage ?? 'La caméra KYC est indisponible.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textColor,
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
