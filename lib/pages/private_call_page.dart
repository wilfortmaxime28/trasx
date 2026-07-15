import 'dart:async';
import 'dart:ui';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../services/private_call_session.dart';

class PrivateCallPage extends StatefulWidget {
  const PrivateCallPage({super.key, required this.session});

  final PrivateCallSession session;
  static bool isCallActive = false;

  @override
  State<PrivateCallPage> createState() => _PrivateCallPageState();
}

class _PrivateCallPageState extends State<PrivateCallPage> {
  bool _popScheduled = false;
  bool _endingActionInFlight = false;

  PrivateCallSession get _session => widget.session;

  @override
  void initState() {
    super.initState();
    PrivateCallPage.isCallActive = true;
    _session.addListener(_handleSessionUpdate);
    unawaited(_session.initialize());
  }

  @override
  void dispose() {
    PrivateCallPage.isCallActive = false;
    _session.removeListener(_handleSessionUpdate);
    unawaited(_session.release());
    super.dispose();
  }

  void _handleSessionUpdate() {
    if (!mounted || _popScheduled || !_session.hasEnded) return;
    _popScheduled = true;
    Future<void>.delayed(const Duration(milliseconds: 260), () async {
      if (!mounted) return;
      Navigator.of(context).maybePop(_session.endingReason);
    });
  }

  Future<bool> _handleWillPop() async {
    if (_session.hasEnded) {
      return true;
    }
    if (_session.isEnding || _endingActionInFlight) {
      return false;
    }

    if (mounted) {
      setState(() {
        _endingActionInFlight = true;
      });
    }
    try {
      await _session.endCall();
    } finally {
      if (mounted) {
        setState(() {
          _endingActionInFlight = false;
        });
      }
    }
    return false;
  }

  Future<void> _runControlAction(Future<void> Function() action) async {
    if (_session.hasEnded || _session.isEnding) return;
    try {
      await action();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<void>(
      canPop: _session.hasEnded,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        final shouldPop = await _handleWillPop();
        if (shouldPop && mounted) {
          navigator.maybePop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF06070A),
        body: AnimatedBuilder(
          animation: _session,
          builder: (context, _) {
            final sessionEnded = _session.hasEnded || _session.isEnding;
            final hasRemoteVideo =
                !sessionEnded &&
                _session.remoteVideoAvailable &&
                _session.remoteRenderer.srcObject != null;

            return Stack(
              children: [
                if (!sessionEnded &&
                    !hasRemoteVideo &&
                    _session.remoteRenderer.srcObject != null)
                  Positioned(
                    left: 0,
                    top: 0,
                    width: 1,
                    height: 1,
                    child: IgnorePointer(
                      child: _RemoteAudioAnchor(
                        renderer: _session.remoteRenderer,
                      ),
                    ),
                  ),
                Positioned.fill(
                  child: sessionEnded
                      ? _buildEndedState()
                      : hasRemoteVideo
                      ? RTCVideoView(
                          key: ValueKey<String>(
                            'remote-${_session.remoteRenderer.srcObject?.id ?? 'empty'}',
                          ),
                          _session.remoteRenderer,
                          objectFit:
                              RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                        )
                      : _buildBackdrop(),
                ),
                Positioned.fill(
                  child: sessionEnded
                      ? const SizedBox.shrink()
                      : DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [
                                Colors.black.withValues(alpha: 0.18),
                                Colors.black.withValues(alpha: 0.08),
                                Colors.black.withValues(alpha: 0.28),
                              ],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                          ),
                        ),
                ),
                if (!sessionEnded)
                  SafeArea(
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                          child: Row(
                            children: [
                              _topPill(
                                icon: CupertinoIcons.chevron_down,
                                onTap: _handleWillPop,
                              ),
                              const Spacer(),
                              _typeChip(),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        Expanded(
                          child: Stack(
                            children: [
                              Positioned.fill(
                                child: IgnorePointer(
                                  child: AnimatedOpacity(
                                    duration: const Duration(milliseconds: 220),
                                    opacity: hasRemoteVideo ? 0 : 1,
                                    child: _buildIdentityPanel(),
                                  ),
                                ),
                              ),
                              if (hasRemoteVideo)
                                Positioned(
                                  left: 18,
                                  top: 10,
                                  child: _buildLiveStatusCard(),
                                ),
                              if (_session.shouldShowLocalVideo)
                                Positioned(
                                  right: 16,
                                  top: 10,
                                  child: _buildLocalPreview(),
                                ),
                            ],
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 0, 14, 18),
                          child: _buildControls(),
                        ),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildBackdrop() {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF090A10), Color(0xFF14172A), Color(0xFF090A10)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -80,
            left: -70,
            child: _glowBlob(
              size: 220,
              color: const Color(0xFF25F4EE).withValues(alpha: 0.18),
            ),
          ),
          Positioned(
            right: -50,
            bottom: 120,
            child: _glowBlob(
              size: 240,
              color: const Color(0xFFFE2C55).withValues(alpha: 0.18),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEndedState() {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF090A10), Color(0xFF121525), Color(0xFF090A10)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            // Bouton fermer en haut à gauche
            Align(
              alignment: Alignment.topLeft,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: GestureDetector(
                  onTap: () => Navigator.of(context).maybePop(),
                  child: Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.14),
                      ),
                    ),
                    child: const Icon(
                      CupertinoIcons.chevron_down,
                      color: Colors.white,
                      size: 18,
                    ),
                  ),
                ),
              ),
            ),
            // Contenu centré
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _avatar(size: 98),
                      const SizedBox(height: 22),
                      Text(
                        _session.remoteName,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        _session.endingReason ?? 'Appel termine.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.76),
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 40),
                      // Bouton Fermer principal
                      GestureDetector(
                        onTap: () => Navigator.of(context).maybePop(),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 40,
                            vertical: 16,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.18),
                            ),
                          ),
                          child: const Text(
                            'Fermer',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }


  Widget _glowBlob({required double size, required Color color}) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color,
          boxShadow: [
            BoxShadow(color: color, blurRadius: 70, spreadRadius: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildIdentityPanel() {
    final theme = Theme.of(context);
    final status = _session.isConnected
        ? _formatDuration(_session.elapsed)
        : _session.statusText;

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        TweenAnimationBuilder<double>(
          tween: Tween<double>(begin: 0.94, end: 1),
          duration: const Duration(milliseconds: 1200),
          curve: Curves.easeInOut,
          builder: (context, scale, child) {
            return Transform.scale(scale: scale, child: child);
          },
          child: Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.18),
                width: 1.4,
              ),
            ),
            child: _avatar(size: 116),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          _session.remoteName,
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall?.copyWith(
            color: Colors.white,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.4,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_session.isLoading) ...[
                const CupertinoActivityIndicator(
                  color: Colors.white,
                  radius: 8,
                ),
                const SizedBox(width: 8),
              ],
              Text(
                status,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        if ((_session.errorText ?? '').isNotEmpty) ...[
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Text(
              _session.errorText!,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.74),
                fontSize: 12.5,
                height: 1.35,
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildLiveStatusCard() {
    final label = _session.isConnected
        ? _formatDuration(_session.elapsed)
        : _session.statusText;

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 220),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.34),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _session.remoteName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.76),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLocalPreview() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: Container(
        width: 112,
        height: 164,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.28),
              blurRadius: 30,
              offset: const Offset(0, 18),
            ),
          ],
        ),
        child: RTCVideoView(
          key: ValueKey<String>(
            'local-${_session.localRenderer.srcObject?.id ?? 'empty'}-${_session.cameraEnabled}',
          ),
          _session.localRenderer,
          mirror: true,
          objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
        ),
      ),
    );
  }

  Widget _buildControls() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(30),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.32),
            borderRadius: BorderRadius.circular(30),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Wrap(
            alignment: WrapAlignment.center,
            spacing: 12,
            runSpacing: 12,
            children: [
              _controlButton(
                icon: _session.microphoneMuted
                    ? CupertinoIcons.mic_slash_fill
                    : CupertinoIcons.mic_fill,
                label: _session.microphoneMuted ? 'Micro off' : 'Micro',
                active: !_session.microphoneMuted,
                onTap: _session.hasEnded ? null : _session.toggleMicrophone,
              ),
              _controlButton(
                icon: _session.speakerEnabled
                    ? CupertinoIcons.speaker_3_fill
                    : CupertinoIcons.speaker_slash_fill,
                label: _session.speakerEnabled ? 'Haut-parleur' : 'Ecouteur',
                active: _session.speakerEnabled,
                onTap: _session.hasEnded ? null : _session.toggleSpeaker,
              ),
              if (_session.isVideo)
                _controlButton(
                  icon: Icons.flip_camera_android_rounded,
                  label: 'Retourner',
                  active: _session.canSwitchCamera,
                  onTap: (_session.canSwitchCamera && !_session.hasEnded)
                      ? _session.switchCamera
                      : null,
                ),
              if (_session.isVideo)
                _controlButton(
                  icon: _session.cameraEnabled
                      ? CupertinoIcons.videocam_fill
                      : Icons.videocam_off_rounded,
                  label: _session.cameraEnabled ? 'Camera' : 'Camera off',
                  active: _session.cameraEnabled,
                  onTap: _session.hasEnded ? null : _session.toggleCamera,
                ),
              _controlButton(
                icon: CupertinoIcons.phone_down_fill,
                label: 'Raccrocher',
                active: true,
                destructive: true,
                onTap: _handleHangup,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _controlButton({
    required IconData icon,
    required String label,
    required bool active,
    required Future<void> Function()? onTap,
    bool destructive = false,
  }) {
    final background = destructive
        ? const Color(0xFFFE2C55)
        : active
        ? Colors.white.withValues(alpha: 0.16)
        : Colors.white.withValues(alpha: 0.08);

    return GestureDetector(
      onTap: onTap == null ? null : () => unawaited(_runControlAction(onTap)),
      child: SizedBox(
        width: 88,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                color: background,
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(
                    alpha: destructive ? 0.1 : 0.08,
                  ),
                ),
              ),
              child: Icon(
                icon,
                color: Colors.white,
                size: destructive ? 24 : 22,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white.withValues(
                  alpha: onTap == null ? 0.42 : 0.9,
                ),
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _topPill({
    required IconData icon,
    required Future<bool> Function() onTap,
  }) {
    return GestureDetector(
      onTap: () async {
        final shouldPop = await onTap();
        if (shouldPop && mounted) {
          Navigator.of(context).maybePop();
        }
      },
      child: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.26),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Icon(icon, color: Colors.white, size: 18),
      ),
    );
  }

  Future<void> _handleHangup() async {
    await _handleWillPop();
  }

  Widget _typeChip() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.26),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Text(
        _session.isVideo ? 'Appel video' : 'Appel audio',
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.86),
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  Widget _avatar({required double size}) {
    final resolvedUrl = _resolveUrl(_session.remoteAvatarUrl);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          colors: [Color(0xFF25F4EE), Color(0xFFFE2C55)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      padding: const EdgeInsets.all(2.4),
      child: ClipOval(
        child: resolvedUrl == null
            ? Container(
                color: Colors.white.withValues(alpha: 0.14),
                alignment: Alignment.center,
                child: Text(
                  _initialLetter(),
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: size * 0.32,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              )
            : Image.network(
                resolvedUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, error, stackTrace) {
                  return Container(
                    color: Colors.white.withValues(alpha: 0.14),
                    alignment: Alignment.center,
                    child: Text(
                      _initialLetter(),
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: size * 0.32,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }

  String? _resolveUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    if (trimmed.startsWith('http')) return trimmed;
    return 'https://trasx.com$trimmed';
  }

  String _initialLetter() {
    final trimmed = _session.remoteName.trim();
    if (trimmed.isEmpty) return 'U';
    return trimmed.substring(0, 1).toUpperCase();
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    final hours = duration.inHours;
    if (hours > 0) {
      return '${hours.toString().padLeft(2, '0')}:$minutes:$seconds';
    }
    return '$minutes:$seconds';
  }
}

class _RemoteAudioAnchor extends StatelessWidget {
  const _RemoteAudioAnchor({required this.renderer});

  final RTCVideoRenderer renderer;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: 0,
      child: RTCVideoView(
        renderer,
        objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
      ),
    );
  }
}
