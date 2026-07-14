// lib/services/video_preload_manager.dart
import 'package:flutter/foundation.dart';
import 'package:video_player/video_player.dart';
import 'video_cache_manager.dart';
import 'network_quality_service.dart';
import '../models/video_play_state.dart';

class VideoPlaybackControllerState extends ChangeNotifier {
  final String url;
  final String? thumbnailUrl;
  VideoPlayerController? _controller;
  VideoPlayState _playState = VideoPlayState.idle;
  bool _isDisposed = false;

  VideoPlaybackControllerState({required this.url, this.thumbnailUrl});

  VideoPlayerController? get controller => _controller;
  VideoPlayState get playState => _playState;

  void updateState(VideoPlayState newState) {
    if (_playState != newState) {
      _playState = newState;
      if (!_isDisposed) {
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _isDisposed = true;
    _controller?.dispose();
    super.dispose();
  }
}

class VideoPreloadManager {
  static final VideoPreloadManager _instance = VideoPreloadManager._internal();
  factory VideoPreloadManager() => _instance;
  VideoPreloadManager.createIndependent();
  VideoPreloadManager._internal();

  final Map<int, VideoPlaybackControllerState> _states = {};
  int _focusedIndex = 0;
  List<dynamic> _currentReels = [];

  Map<int, VideoPlaybackControllerState> get activeStates => _states;

  void setReels(List<dynamic> reels) {
    _currentReels = reels;
  }

  VideoPlaybackControllerState getOrCreateState(int index, String url, String? thumbnailUrl) {
    if (_states.containsKey(index)) {
      return _states[index]!;
    }
    final state = VideoPlaybackControllerState(url: url, thumbnailUrl: thumbnailUrl);
    _states[index] = state;
    return state;
  }

  void setFocusedIndex(int index) {
    _focusedIndex = index;

    final quality = NetworkQualityService().currentQuality;
    final int prevWindow = 1;
    final int nextWindow = (quality == NetworkQuality.weak) ? 1 : 2;

    final activeRange = <int>{};
    for (int i = index - prevWindow; i <= index + nextWindow; i++) {
      if (i >= 0 && i < _currentReels.length) {
        activeRange.add(i);
      }
    }

    // 1. Libérer les contrôleurs en dehors de la fenêtre active
    final toRemove = <int>[];
    _states.forEach((key, state) {
      if (!activeRange.contains(key)) {
        state.dispose();
        toRemove.add(key);
      }
    });
    for (var key in toRemove) {
      _states.remove(key);
    }

    // 2. Initialiser/Jouer/Mettre en pause
    for (final idx in activeRange) {
      final reel = _currentReels[idx];
      var videoUrl = reel['video_url']?.toString() ?? '';
      if (videoUrl.isEmpty) continue;
      if (!videoUrl.startsWith('http')) {
        videoUrl = 'https://trasx.com$videoUrl';
      }
      final thumbnailUrl = reel['thumbnail_url'] ?? reel['thumbnail'];

      final state = getOrCreateState(idx, videoUrl, thumbnailUrl);

      if (idx == index) {
        _initializeAndPlay(state, idx, isFocused: true);
      } else {
        _initializeAndPlay(state, idx, isFocused: false);
      }
    }
  }

  Future<void> _initializeAndPlay(VideoPlaybackControllerState state, int index, {required bool isFocused}) async {
    if (state._isDisposed) return;

    if (isFocused) {
      if (state.controller != null) {
        if (state.controller!.value.isInitialized) {
          if (!state.controller!.value.isPlaying) {
            state.controller!.play();
            state.updateState(VideoPlayState.playing);
          }
        }
        return;
      }
    } else {
      if (state.controller != null && state.controller!.value.isPlaying) {
        state.controller!.pause();
        state.updateState(VideoPlayState.paused);
      }
      if (state.controller != null) return;

      // Évite le double téléchargement : si le Short n'est pas encore en cache,
      // on lance le téléchargement en arrière-plan sans initialiser de contrôleur réseau.
      final cachedFile = await VideoCacheManager.getCachedFile(state.url);
      if (state._isDisposed) return;

      if (cachedFile == null) {
        if (NetworkQualityService().currentQuality != NetworkQuality.weak) {
          VideoCacheManager.prefetchVideo(state.url);
        }
        state.updateState(VideoPlayState.idle);
        return;
      }
    }

    state.updateState(VideoPlayState.loading);

    try {
      final startTime = DateTime.now();
      final cachedFile = await VideoCacheManager.getCachedFile(state.url);

      if (state._isDisposed) return;

      VideoPlayerController controller;
      if (cachedFile != null) {
        controller = VideoPlayerController.file(cachedFile);
      } else {
        controller = VideoPlayerController.networkUrl(Uri.parse(state.url));
        if (NetworkQualityService().currentQuality != NetworkQuality.weak) {
          VideoCacheManager.prefetchVideo(state.url);
        }
      }

      state._controller = controller;

      controller.addListener(() {
        if (state._isDisposed) return;

        final val = controller.value;
        if (!val.isInitialized) return;

        if (val.hasError) {
          state.updateState(VideoPlayState.error);
          final errStr = val.errorDescription?.toLowerCase() ?? '';
          if (errStr.contains('unknownhostexception') || errStr.contains('socketexception') || errStr.contains('network') || errStr.contains('no address')) {
            NetworkQualityService().recordOffline();
          } else {
            NetworkQualityService().recordError();
          }
        } else if (val.isBuffering) {
          state.updateState(VideoPlayState.buffering);
          NetworkQualityService().recordBuffering();
        } else if (val.isPlaying) {
          state.updateState(VideoPlayState.playing);
        } else {
          state.updateState(VideoPlayState.paused);
        }
      });

      await controller.initialize();
      controller.setLooping(true);

      final initDuration = DateTime.now().difference(startTime);
      NetworkQualityService().recordInitialization(initDuration);
      NetworkQualityService().recordSuccess();

      if (state._isDisposed) return;

      state.updateState(VideoPlayState.ready);

      if (isFocused && _focusedIndex == index) {
        controller.play();
        state.updateState(VideoPlayState.playing);
      } else {
        controller.pause();
        state.updateState(VideoPlayState.paused);
      }
    } catch (e) {
      if (!state._isDisposed) {
        state.updateState(VideoPlayState.error);
        final errStr = e.toString().toLowerCase();
        if (errStr.contains('socketexception') || errStr.contains('handshake') || errStr.contains('failed host lookup') || errStr.contains('network')) {
          NetworkQualityService().recordOffline();
        } else {
          NetworkQualityService().recordError();
        }
      }
    }
  }

  void pauseCurrentVideo() {
    final state = _states[_focusedIndex];
    if (state != null && state.controller != null && state.controller!.value.isPlaying) {
      state.controller!.pause();
      state.updateState(VideoPlayState.paused);
    }
  }

  void resumeCurrentVideo() {
    final state = _states[_focusedIndex];
    if (state != null && state.controller != null && !state.controller!.value.isPlaying) {
      if (state.controller!.value.isInitialized) {
        state.controller!.play();
        state.updateState(VideoPlayState.playing);
      }
    }
  }

  void dispose() {
    _states.forEach((_, state) => state.dispose());
    _states.clear();
  }
}
