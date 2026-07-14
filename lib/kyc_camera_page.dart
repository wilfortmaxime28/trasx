import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:path_provider/path_provider.dart';

class KycCameraPage extends StatefulWidget {
  const KycCameraPage({super.key});

  @override
  State<KycCameraPage> createState() => _KycCameraPageState();
}

enum _LivenessStage { position, blink, turn, capture, done }

enum _BlinkPhase { waitingOpen, waitingClose, waitingReopen }

class _FaceFrameState {
  const _FaceFrameState({
    required this.isAligned,
    required this.tooFar,
    required this.tooClose,
    required this.tilted,
  });

  final bool isAligned;
  final bool tooFar;
  final bool tooClose;
  final bool tilted;
}

class _KycCameraPageState extends State<KycCameraPage>
    with TickerProviderStateMixin {
  static const Color _accentColor = Color(0xFF66D47E);
  static const Color _iosBlue = Color(0xFF0A84FF);
  static const int _alignmentFramesNeeded = 12;
  static const int _blinkOpenFramesNeeded = 3;
  static const int _blinkReopenFramesNeeded = 2;
  static const int _recenterFramesNeeded = 4;
  static const double _leftTurnAngle = -14;
  static const double _rightTurnAngle = 14;

  static const Map<DeviceOrientation, int> _orientations = {
    DeviceOrientation.portraitUp: 0,
    DeviceOrientation.landscapeLeft: 90,
    DeviceOrientation.portraitDown: 180,
    DeviceOrientation.landscapeRight: 270,
  };

  final FaceDetector _faceDetector = FaceDetector(
    options: FaceDetectorOptions(
      performanceMode: FaceDetectorMode.fast,
      enableClassification: true,
      enableTracking: true,
    ),
  );

  CameraController? _controller;
  CameraDescription? _selectedCamera;
  List<CameraDescription> _cameras = const [];

  bool _isInitialized = false;
  bool _hasError = false;
  bool _isProcessingFrame = false;
  bool _isCapturing = false;
  String _errorMessage = '';

  _LivenessStage _stage = _LivenessStage.position;
  _BlinkPhase _blinkPhase = _BlinkPhase.waitingOpen;

  Face? _currentFace;
  bool _multipleFacesDetected = false;
  bool _faceTooFar = false;
  bool _faceTooClose = false;
  bool _faceTilted = false;

  int _alignedFrames = 0;
  int _blinkStableFrames = 0;
  bool _hasTurnedLeft = false;
  bool _hasTurnedRight = false;
  int _recenterFrames = 0;

  bool _showManualFallback = false;
  int _secondsInStage = 0;
  Timer? _stageFallbackTimer;
  File? _capturedSelfieFile;

  late final AnimationController _successController;

  @override
  void initState() {
    super.initState();
    _successController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _initializeCamera();
  }

  Future<void> _initializeCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        throw Exception('Aucune caméra disponible.');
      }

      _selectedCamera = _cameras.firstWhere(
        (camera) => camera.lensDirection == CameraLensDirection.front,
        orElse: () => _cameras.first,
      );

      _controller = CameraController(
        _selectedCamera!,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: Platform.isAndroid
            ? ImageFormatGroup.nv21
            : ImageFormatGroup.bgra8888,
      );

      await _controller!.initialize();
      try {
        await _controller!.setFlashMode(FlashMode.off);
        await _controller!.setFocusMode(FocusMode.auto);
        await _controller!.setExposureMode(ExposureMode.auto);
        await _controller!.lockCaptureOrientation(DeviceOrientation.portraitUp);
      } catch (_) {}

      if (!mounted) return;

      setState(() {
        _isInitialized = true;
        _hasError = false;
      });

      _enterStage(_LivenessStage.position);
      await _controller!.startImageStream(_processCameraImage);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _errorMessage = 'Impossible d\'ouvrir la caméra KYC : $error';
      });
    }
  }

  void _enterStage(_LivenessStage stage) {
    _stageFallbackTimer?.cancel();

    setState(() {
      _stage = stage;
      _secondsInStage = 0;
      _showManualFallback = false;
      _capturedSelfieFile = null;

      if (stage == _LivenessStage.position) {
        _alignedFrames = 0;
      }
      if (stage == _LivenessStage.blink) {
        _blinkPhase = _BlinkPhase.waitingOpen;
        _blinkStableFrames = 0;
      }
      if (stage == _LivenessStage.turn) {
        _hasTurnedLeft = false;
        _hasTurnedRight = false;
        _recenterFrames = 0;
      }
    });

    if (stage == _LivenessStage.capture || stage == _LivenessStage.done) {
      return;
    }

    _stageFallbackTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        _secondsInStage++;
        if (_secondsInStage >= 12) {
          _showManualFallback = true;
          timer.cancel();
        }
      });
    });
  }

  Future<void> _processCameraImage(CameraImage image) async {
    if (_controller == null ||
        !_controller!.value.isInitialized ||
        _isProcessingFrame ||
        _isCapturing ||
        _stage == _LivenessStage.capture ||
        _stage == _LivenessStage.done) {
      return;
    }

    final inputImage = _inputImageFromCameraImage(image);
    if (inputImage == null) return;

    _isProcessingFrame = true;

    try {
      final faces = await _faceDetector.processImage(inputImage);
      if (!mounted) return;
      _handleDetectedFaces(
        faces,
        Size(image.width.toDouble(), image.height.toDouble()),
      );
    } catch (error) {
      debugPrint('[KYC] Erreur face detection: $error');
    } finally {
      _isProcessingFrame = false;
    }
  }

  void _handleDetectedFaces(List<Face> faces, Size imageSize) {
    if (!mounted) return;

    if (faces.isEmpty) {
      setState(() {
        _currentFace = null;
        _multipleFacesDetected = false;
        _faceTooFar = false;
        _faceTooClose = false;
        _faceTilted = false;
        _alignedFrames = 0;
        _blinkStableFrames = 0;
        _recenterFrames = 0;
      });
      return;
    }

    if (faces.length > 1) {
      setState(() {
        _currentFace = null;
        _multipleFacesDetected = true;
        _alignedFrames = 0;
        _blinkStableFrames = 0;
        _recenterFrames = 0;
      });
      return;
    }

    final face = faces.first;
    final frameState = _analyzeFaceFrame(face, imageSize);
    final eyesOpen = _eyesAreOpen(face);

    setState(() {
      _currentFace = face;
      _multipleFacesDetected = false;
      _faceTooFar = frameState.tooFar;
      _faceTooClose = frameState.tooClose;
      _faceTilted = frameState.tilted;
    });

    switch (_stage) {
      case _LivenessStage.position:
        if (frameState.isAligned && eyesOpen) {
          _alignedFrames++;
          if (_alignedFrames >= _alignmentFramesNeeded) {
            _enterStage(_LivenessStage.blink);
          } else {
            setState(() {});
          }
        } else if (_alignedFrames > 0) {
          setState(() {
            _alignedFrames = (_alignedFrames - 2)
                .clamp(0, _alignmentFramesNeeded)
                .toInt();
          });
        }
        break;
      case _LivenessStage.blink:
        _handleBlinkStep(face, frameState.isAligned);
        break;
      case _LivenessStage.turn:
        _handleHeadTurnStep(face, frameState.isAligned);
        break;
      case _LivenessStage.capture:
      case _LivenessStage.done:
        break;
    }
  }

  void _handleBlinkStep(Face face, bool isAligned) {
    final leftEye = face.leftEyeOpenProbability;
    final rightEye = face.rightEyeOpenProbability;
    if (!isAligned || leftEye == null || rightEye == null) {
      if (_blinkStableFrames != 0) {
        setState(() {
          _blinkStableFrames = 0;
        });
      }
      return;
    }

    final eyesOpen = leftEye > 0.72 && rightEye > 0.72;
    final eyesClosed = leftEye < 0.35 && rightEye < 0.35;

    switch (_blinkPhase) {
      case _BlinkPhase.waitingOpen:
        if (eyesOpen) {
          setState(() {
            _blinkStableFrames++;
          });
          if (_blinkStableFrames >= _blinkOpenFramesNeeded) {
            setState(() {
              _blinkPhase = _BlinkPhase.waitingClose;
              _blinkStableFrames = 0;
            });
          }
        } else if (_blinkStableFrames != 0) {
          setState(() {
            _blinkStableFrames = 0;
          });
        }
        break;
      case _BlinkPhase.waitingClose:
        if (eyesClosed) {
          setState(() {
            _blinkPhase = _BlinkPhase.waitingReopen;
            _blinkStableFrames = 0;
          });
        }
        break;
      case _BlinkPhase.waitingReopen:
        if (eyesOpen) {
          setState(() {
            _blinkStableFrames++;
          });
          if (_blinkStableFrames >= _blinkReopenFramesNeeded) {
            _enterStage(_LivenessStage.turn);
          }
        } else if (_blinkStableFrames != 0) {
          setState(() {
            _blinkStableFrames = 0;
          });
        }
        break;
    }
  }

  void _handleHeadTurnStep(Face face, bool isAligned) {
    final yaw = face.headEulerAngleY ?? 0;

    var seenLeft = _hasTurnedLeft;
    var seenRight = _hasTurnedRight;
    var recenteredFrames = _recenterFrames;

    if (yaw <= _leftTurnAngle) {
      seenLeft = true;
    }
    if (yaw >= _rightTurnAngle) {
      seenRight = true;
    }

    final readyForCapture =
        seenLeft &&
        seenRight &&
        isAligned &&
        yaw.abs() < 6 &&
        _eyesAreOpen(face);

    if (readyForCapture) {
      recenteredFrames++;
    } else if (recenteredFrames > 0) {
      recenteredFrames = 0;
    }

    if (seenLeft != _hasTurnedLeft ||
        seenRight != _hasTurnedRight ||
        recenteredFrames != _recenterFrames) {
      setState(() {
        _hasTurnedLeft = seenLeft;
        _hasTurnedRight = seenRight;
        _recenterFrames = recenteredFrames;
      });
    }

    if (readyForCapture && recenteredFrames >= _recenterFramesNeeded) {
      _capturePhoto();
    }
  }

  _FaceFrameState _analyzeFaceFrame(Face face, Size imageSize) {
    final centerX = face.boundingBox.center.dx / imageSize.width;
    final centerY = face.boundingBox.center.dy / imageSize.height;
    final faceWidth = face.boundingBox.width / imageSize.width;
    final faceHeight = face.boundingBox.height / imageSize.height;
    final tilt = (face.headEulerAngleZ ?? 0).abs();

    final inHorizontalZone = centerX >= 0.34 && centerX <= 0.66;
    final inVerticalZone = centerY >= 0.27 && centerY <= 0.69;
    final largeEnough = faceWidth >= 0.18 && faceHeight >= 0.18;
    final notTooClose = faceWidth <= 0.52 && faceHeight <= 0.72;
    final straightEnough = tilt <= 12;

    return _FaceFrameState(
      isAligned:
          inHorizontalZone &&
          inVerticalZone &&
          largeEnough &&
          notTooClose &&
          straightEnough,
      tooFar: !largeEnough,
      tooClose: !notTooClose,
      tilted: !straightEnough,
    );
  }

  bool _eyesAreOpen(Face face) {
    final leftEye = face.leftEyeOpenProbability;
    final rightEye = face.rightEyeOpenProbability;
    if (leftEye == null || rightEye == null) return false;
    return leftEye > 0.65 && rightEye > 0.65;
  }

  Future<void> _capturePhoto() async {
    if (_controller == null ||
        !_controller!.value.isInitialized ||
        _isCapturing) {
      return;
    }

    _isCapturing = true;
    _stageFallbackTimer?.cancel();

    setState(() {
      _stage = _LivenessStage.capture;
    });

    try {
      if (_controller!.value.isStreamingImages) {
        await _controller!.stopImageStream();
      }

      await Future<void>.delayed(const Duration(milliseconds: 220));

      final photo = await _controller!.takePicture();
      final tempDir = await getTemporaryDirectory();
      final destinationPath =
          '${tempDir.path}/kyc_selfie_${DateTime.now().millisecondsSinceEpoch}.jpg';

      await File(photo.path).copy(destinationPath);

      if (!mounted) return;

      _successController.forward(from: 0);
      setState(() {
        _stage = _LivenessStage.done;
        _capturedSelfieFile = File(destinationPath);
      });
    } catch (error) {
      _isCapturing = false;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('La capture KYC a échoué : $error')),
      );
      _enterStage(_LivenessStage.position);
      try {
        await _controller!.startImageStream(_processCameraImage);
      } catch (_) {}
    }
  }

  void _captureManually() {
    _capturePhoto();
  }

  void _completeCapture() {
    final capturedFile = _capturedSelfieFile;
    if (capturedFile == null) return;
    Navigator.of(context).pop(capturedFile);
  }

  InputImage? _inputImageFromCameraImage(CameraImage image) {
    if (_controller == null || _selectedCamera == null) return null;

    final rotation = _inputImageRotation();
    if (rotation == null) return null;

    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null ||
        (Platform.isAndroid && format != InputImageFormat.nv21) ||
        (Platform.isIOS && format != InputImageFormat.bgra8888)) {
      return null;
    }

    if (image.planes.length != 1) return null;
    final plane = image.planes.first;

    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: plane.bytesPerRow,
      ),
    );
  }

  InputImageRotation? _inputImageRotation() {
    if (_controller == null || _selectedCamera == null) return null;

    final sensorOrientation = _selectedCamera!.sensorOrientation;
    if (Platform.isIOS) {
      return InputImageRotationValue.fromRawValue(sensorOrientation);
    }

    if (!Platform.isAndroid) return null;

    final rotationCompensation =
        _orientations[_controller!.value.deviceOrientation];
    if (rotationCompensation == null) return null;

    final adjustedCompensation =
        _selectedCamera!.lensDirection == CameraLensDirection.front
        ? (sensorOrientation + rotationCompensation) % 360
        : (sensorOrientation - rotationCompensation + 360) % 360;

    return InputImageRotationValue.fromRawValue(adjustedCompensation);
  }

  @override
  void dispose() {
    _stageFallbackTimer?.cancel();
    _successController.dispose();
    _faceDetector.close();

    final controller = _controller;
    _controller = null;
    if (controller != null) {
      if (controller.value.isStreamingImages) {
        controller.stopImageStream().catchError((_) {});
      }
      controller.dispose();
    }

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: _hasError
          ? SafeArea(child: _buildErrorState())
          : !_isInitialized
          ? SafeArea(child: _buildLoadingState())
          : _buildCameraSurface(),
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: const [
          SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2.6,
              color: _accentColor,
            ),
          ),
          SizedBox(height: 18),
          Text(
            'Préparation du contrôle KYC...',
            style: TextStyle(color: Color(0xFF4B5563), fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: const Color(0xFFF3F4F6),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.camera_alt_outlined,
                color: Color(0xFF6B7280),
                size: 34,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              _errorMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF4B5563),
                fontSize: 14,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              style: FilledButton.styleFrom(
                backgroundColor: _iosBlue,
                foregroundColor: Colors.white,
                minimumSize: const Size(160, 48),
              ),
              child: const Text('Retour'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCameraSurface() {
    final mediaQuery = MediaQuery.of(context);

    return Container(
      color: Colors.white,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 4, 14, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: TextButton.styleFrom(
                    foregroundColor: _iosBlue,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    textStyle: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  child: const Text('Annuler'),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildFaceIdScanner(mediaQuery),
                    const SizedBox(height: 30),
                    Text(
                      _faceIdPrimaryText(),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Color(0xFF111827),
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      _faceIdSecondaryText(),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: const Color(0xFF6B7280),
                        fontSize: 13,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                24,
                0,
                24,
                mediaQuery.padding.bottom + 16,
              ),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 220),
                child: _stage == _LivenessStage.done
                    ? SizedBox(
                        key: const ValueKey('continue-button'),
                        width: double.infinity,
                        height: 52,
                        child: FilledButton(
                          onPressed: _completeCapture,
                          style: FilledButton.styleFrom(
                            backgroundColor: _iosBlue,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          child: const Text(
                            'Continuer',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      )
                    : SizedBox(
                        key: const ValueKey('accessibility-button'),
                        width: double.infinity,
                        child: TextButton(
                          onPressed: _showManualFallback
                              ? _captureManually
                              : () {},
                          style: TextButton.styleFrom(
                            foregroundColor: _iosBlue,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            textStyle: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          child: Text(
                            _showManualFallback
                                ? 'Capturer manuellement'
                                : 'Options d\'accessibilité',
                          ),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFaceIdScanner(MediaQueryData mediaQuery) {
    final ringSize = math.min(mediaQuery.size.width - 72, 292.0);
    final circleSize = ringSize - 36;
    final progress = _overallProgress();

    return AnimatedBuilder(
      animation: _successController,
      builder: (context, child) {
        final successScale = Curves.easeOutBack.transform(
          _successController.value,
        );
        final scale = _stage == _LivenessStage.done
            ? 0.97 + (successScale * 0.05)
            : 1.0;
        return Transform.scale(scale: scale, child: child);
      },
      child: SizedBox(
        width: ringSize,
        height: ringSize,
        child: Stack(
          alignment: Alignment.center,
          children: [
            CustomPaint(
              size: Size.square(ringSize),
              painter: _FaceIdProgressPainter(
                progress: progress,
                isComplete: _stage == _LivenessStage.done,
              ),
            ),
            _buildFacePreviewCircle(circleSize),
          ],
        ),
      ),
    );
  }

  Widget _buildFacePreviewCircle(double size) {
    final controller = _controller;
    final showPreview =
        controller != null &&
        controller.value.isInitialized &&
        (_currentFace != null || _stage == _LivenessStage.done);

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: const Color(0xFFF3F4F6),
        border: Border.all(
          color: _stage == _LivenessStage.done
              ? _accentColor
              : const Color(0xFFD1D5DB),
          width: _stage == _LivenessStage.done ? 2.4 : 1.2,
        ),
      ),
      child: ClipOval(
        child: showPreview
            ? Stack(
                fit: StackFit.expand,
                children: [
                  _buildPreview(),
                  Container(
                    color: Colors.white.withValues(
                      alpha: _stage == _LivenessStage.done ? 0.02 : 0.10,
                    ),
                  ),
                ],
              )
            : Container(color: const Color(0xFFE5E7EB)),
      ),
    );
  }

  Widget _buildPreview() {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return const SizedBox.shrink();
    }

    final previewSize = controller.value.previewSize;
    if (previewSize == null) {
      return CameraPreview(controller);
    }

    final previewWidth = math.max(previewSize.width, previewSize.height);
    final previewHeight = math.min(previewSize.width, previewSize.height);

    return Center(
      child: FittedBox(
        fit: BoxFit.contain,
        child: SizedBox(
          width: previewWidth,
          height: previewHeight,
          child: CameraPreview(controller),
        ),
      ),
    );
  }

  String _faceIdPrimaryText() {
    switch (_stage) {
      case _LivenessStage.position:
        return 'Placez votre visage dans le cercle.';
      case _LivenessStage.blink:
        return 'Clignez doucement des yeux pour continuer.';
      case _LivenessStage.turn:
        return 'Tournez lentement la tête pour compléter le cercle.';
      case _LivenessStage.capture:
        return 'Restez immobile pendant la capture.';
      case _LivenessStage.done:
        return 'Scan facial terminé.';
    }
  }

  String _faceIdSecondaryText() {
    if (_multipleFacesDetected) {
      return 'Un seul visage doit être visible pendant la vérification.';
    }

    switch (_stage) {
      case _LivenessStage.position:
        if (_currentFace == null) {
          return 'Regardez la caméra bien en face et gardez le visage centré.';
        }
        if (_faceTooFar) {
          return 'Rapprochez-vous un peu du téléphone.';
        }
        if (_faceTooClose) {
          return 'Reculez légèrement pour entrer correctement dans le cercle.';
        }
        if (_faceTilted) {
          return 'Gardez la tête droite pour un scan plus propre.';
        }
        return 'Restez immobile un instant pour démarrer le scan.';
      case _LivenessStage.blink:
        return 'Fermez les deux yeux une fois, puis rouvrez-les naturellement.';
      case _LivenessStage.turn:
        if (!_hasTurnedLeft || !_hasTurnedRight) {
          return 'Tournez à gauche puis à droite en restant dans le cercle.';
        }
        return 'Revenez au centre pour terminer le scan.';
      case _LivenessStage.capture:
        return 'Ne bougez plus pendant une seconde.';
      case _LivenessStage.done:
        return 'Votre selfie est prêt pour la comparaison avec votre pièce.';
    }
  }

  double _overallProgress() {
    switch (_stage) {
      case _LivenessStage.position:
        return ((_alignedFrames / _alignmentFramesNeeded) * 0.34)
            .clamp(0.02, 0.34)
            .toDouble();
      case _LivenessStage.blink:
        return (0.34 + (_blinkProgress() * 0.33)).clamp(0.34, 0.67).toDouble();
      case _LivenessStage.turn:
        return (0.67 + (_turnProgress() * 0.28)).clamp(0.67, 0.95).toDouble();
      case _LivenessStage.capture:
        return 0.97;
      case _LivenessStage.done:
        return 1.0;
    }
  }

  double _blinkProgress() {
    switch (_blinkPhase) {
      case _BlinkPhase.waitingOpen:
        return (_blinkStableFrames / _blinkOpenFramesNeeded)
            .clamp(0.0, 0.25)
            .toDouble();
      case _BlinkPhase.waitingClose:
        return 0.56;
      case _BlinkPhase.waitingReopen:
        return (0.7 + (_blinkStableFrames / _blinkReopenFramesNeeded) * 0.3)
            .clamp(0.7, 1.0)
            .toDouble();
    }
  }

  double _turnProgress() {
    double progress = 0;
    if (_hasTurnedLeft) progress += 0.35;
    if (_hasTurnedRight) progress += 0.35;
    if (_hasTurnedLeft && _hasTurnedRight) {
      progress += ((_recenterFrames / _recenterFramesNeeded) * 0.3)
          .clamp(0.0, 0.3)
          .toDouble();
    }
    return progress.clamp(0.05, 1.0).toDouble();
  }
}

class _FaceIdProgressPainter extends CustomPainter {
  const _FaceIdProgressPainter({
    required this.progress,
    required this.isComplete,
  });

  final double progress;
  final bool isComplete;

  @override
  void paint(Canvas canvas, Size size) {
    const totalSegments = 52;
    const strokeWidth = 3.1;
    final center = size.center(Offset.zero);
    final radius = size.width / 2 - 8;
    final startAngle = -math.pi * 0.88;
    const sweep = math.pi * 1.76;
    final coloredSegments = (progress * totalSegments).round();

    final inactivePaint = Paint()
      ..color = const Color(0xFF9CA3AF)
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    final activePaint = Paint()
      ..color = const Color(0xFF66D47E)
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    for (int i = 0; i < totalSegments; i++) {
      final ratio = i / (totalSegments - 1);
      final angle = startAngle + (sweep * ratio);
      final innerPoint = Offset(
        center.dx + math.cos(angle) * (radius - 12),
        center.dy + math.sin(angle) * (radius - 12),
      );
      final outerPoint = Offset(
        center.dx + math.cos(angle) * radius,
        center.dy + math.sin(angle) * radius,
      );

      final shouldHighlight = isComplete || i < coloredSegments;
      canvas.drawLine(
        innerPoint,
        outerPoint,
        shouldHighlight ? activePaint : inactivePaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _FaceIdProgressPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.isComplete != isComplete;
  }
}
