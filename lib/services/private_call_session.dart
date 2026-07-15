// ignore_for_file: implementation_imports

import 'dart:async';
import 'package:audioplayers/audioplayers.dart';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:mediasfu_mediasoup_client/mediasfu_mediasoup_client.dart'
    as mediasoup;
import 'package:mediasfu_mediasoup_client/src/handlers/handler_interface.dart'
    as mediasoup_types;
import 'package:socket_io_client/socket_io_client.dart' as io;

enum PrivateCallRole { caller, callee }

class PrivateCallSession extends ChangeNotifier {
  PrivateCallSession({
    required this.socket,
    required this.roomId,
    required this.currentUserId,
    required this.remoteUserId,
    required this.remoteName,
    required this.remoteAvatarUrl,
    required this.isVideo,
    required this.role,
  }) : _speakerEnabled = true,
       _cameraEnabled = isVideo;

  final io.Socket socket;
  final String roomId;
  final int currentUserId;
  final int remoteUserId;
  final String remoteName;
  final String remoteAvatarUrl;
  final bool isVideo;
  final PrivateCallRole role;

  final RTCVideoRenderer localRenderer = RTCVideoRenderer();
  final RTCVideoRenderer remoteRenderer = RTCVideoRenderer();

  final Map<String, mediasoup.Producer> _producers =
      <String, mediasoup.Producer>{};
  final Map<String, mediasoup.Consumer> _consumers =
      <String, mediasoup.Consumer>{};
  final Set<String> _pendingConsumerProducerIds = <String>{};
  static const Map<String, dynamic> _transportAdditionalSettings =
      <String, dynamic>{'encodedInsertableStreams': false};
  static const Map<String, dynamic> _transportProprietaryConstraints =
      <String, dynamic>{
        'optional': <Map<String, dynamic>>[
          <String, dynamic>{'googDscp': true},
        ],
      };

  mediasoup.Device? _device;
  mediasoup.Transport? _sendTransport;
  mediasoup.Transport? _recvTransport;
  MediaStream? _localStream;
  MediaStream? _remoteStream;

  List<mediasoup_types.RTCIceServer> _iceServers =
      const <mediasoup_types.RTCIceServer>[];
  Timer? _callTimer;
  Timer? _ringbackTimer;
  DateTime? _connectedAt;
  final AudioPlayer _ringbackPlayer = AudioPlayer();

  bool _initialized = false;
  bool _initializing = false;
  bool _disposed = false;
  bool _ending = false;
  bool _ended = false;
  bool _remoteAccepted = false;
  bool _connected = false;
  bool _remoteVideoAvailable = false;
  bool _microphoneMuted = false;
  bool _speakerEnabled;
  bool _cameraEnabled;
  String _statusText = '';
  String? _endingReason;
  String? _errorText;
  Duration _elapsed = Duration.zero;
  bool _mediaResourcesDisposed = false;
  bool _renderersDisposed = false;

  dynamic Function(dynamic)? _newProducerListener;
  dynamic Function(dynamic)? _producerClosedListener;
  dynamic Function(dynamic)? _callEndedListener;
  dynamic Function(dynamic)? _callConnectedListener;
  dynamic Function(dynamic)? _participantJoinedListener;
  dynamic Function(dynamic)? _callResponseListener;
  dynamic Function(dynamic)? _socketDisconnectListener;

  bool get isReady => _initialized;
  bool get isLoading => _initializing;
  bool get isConnected => _connected;
  bool get isEnding => _ending;
  bool get hasEnded => _ended;
  bool get remoteVideoAvailable => _remoteVideoAvailable;
  bool get microphoneMuted => _microphoneMuted;
  bool get speakerEnabled => _speakerEnabled;
  bool get cameraEnabled => _cameraEnabled;
  bool get shouldShowLocalVideo =>
      isVideo && _cameraEnabled && _localStream != null;
  bool get canSwitchCamera =>
      isVideo && (_localStream?.getVideoTracks().isNotEmpty ?? false);
  String get statusText => _statusText;
  String? get endingReason => _endingReason;
  String? get errorText => _errorText;
  Duration get elapsed => _elapsed;

  Future<void> initialize() async {
    if (_initialized || _initializing || _disposed) return;
    _initializing = true;
    _statusText = role == PrivateCallRole.caller
        ? 'Ca sonne...'
        : 'Connexion a l appel...';
    notifyListeners();

    try {
      await localRenderer.initialize();
      await remoteRenderer.initialize();
      if (_shouldAbortOperations) return;

      _attachSocketListeners();
      if (role == PrivateCallRole.caller) {
        await _ringbackPlayer.setSource(AssetSource('sounds/ringback.wav'));
        _startRingbackTone();
      }

      await _ensureSocketConnected();
      if (_shouldAbortOperations) return;
      await _configureAudioRoute();
      if (_shouldAbortOperations) return;
      await _loadIceServers();
      if (_shouldAbortOperations) return;
      final activeProducers = await _joinCallSession();
      if (_shouldAbortOperations) return;
      await _loadDevice();
      if (_shouldAbortOperations) return;
      await _createSendTransport();
      if (_shouldAbortOperations) return;
      await _createReceiveTransport();
      if (_shouldAbortOperations) return;
      await _captureLocalMedia();
      if (_shouldAbortOperations) return;
      await _produceLocalTracks();
      if (_shouldAbortOperations) return;

      for (final dynamic producer in activeProducers) {
        if (_shouldAbortOperations) break;
        await _consumeProducer(producer);
      }

      if (_shouldAbortOperations) return;
      _initialized = true;
      if (role == PrivateCallRole.caller && !_remoteAccepted) {
        _statusText = 'Ca sonne...';
      } else if (!_connected) {
        _statusText = 'Connexion media...';
      }
    } catch (error) {
      _errorText = error.toString().replaceFirst('Exception: ', '');
      await _finishLocally(
        reason: _errorText ?? 'Impossible de demarrer cet appel.',
        notifyRemote: true,
      );
    } finally {
      _initializing = false;
      if (!_disposed) {
        notifyListeners();
      }
    }
  }

  Future<void> toggleMicrophone() async {
    if (_shouldAbortOperations) return;
    final audioProducer = _findProducerByKind('audio');
    if (audioProducer == null) return;

    _microphoneMuted = !_microphoneMuted;
    for (final track
        in _localStream?.getAudioTracks() ?? const <MediaStreamTrack>[]) {
      track.enabled = !_microphoneMuted;
    }
    if (_microphoneMuted) {
      audioProducer.pause();
    } else {
      audioProducer.resume();
    }
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    if (_shouldAbortOperations) return;
    _speakerEnabled = !_speakerEnabled;
    await _applyAudioRoute();
    notifyListeners();
  }

  Future<void> toggleCamera() async {
    if (!isVideo || _shouldAbortOperations) return;
    final videoProducer = _findProducerByKind('video');
    if (videoProducer == null) return;

    _cameraEnabled = !_cameraEnabled;
    for (final track
        in _localStream?.getVideoTracks() ?? const <MediaStreamTrack>[]) {
      track.enabled = _cameraEnabled;
    }
    if (_cameraEnabled) {
      videoProducer.resume();
    } else {
      videoProducer.pause();
    }
    notifyListeners();
  }

  Future<void> switchCamera() async {
    if (!canSwitchCamera || _shouldAbortOperations) return;
    final tracks = _localStream?.getVideoTracks() ?? const <MediaStreamTrack>[];
    if (tracks.isEmpty) return;
    await Helper.switchCamera(tracks.first);
  }

  Future<void> endCall() async {
    if (_ending || _ended) return;
    await _finishLocally(reason: 'Appel termine.', notifyRemote: true);
  }

  Future<void> release() async {
    await _disposeResources(disposeRenderers: true);
    try {
      _ringbackPlayer.dispose();
    } catch (_) {}
    if (!_disposed) {
      _disposed = true;
      super.dispose();
    }
  }

  bool get _shouldAbortOperations => _disposed || _ending || _ended;

  Future<void> _ensureSocketConnected({
    Duration timeout = const Duration(seconds: 10),
  }) async {
    if (socket.connected) return;

    final completer = Completer<void>();
    Timer? timer;
    Function(dynamic)? onConnect;
    Function(dynamic)? onError;

    void cleanup() {
      timer?.cancel();
      if (onConnect != null) {
        socket.off('connect', onConnect);
      }
      if (onError != null) {
        socket.off('connect_error', onError);
      }
    }

    onConnect = (_) {
      cleanup();
      if (!completer.isCompleted) {
        completer.complete();
      }
    };

    onError = (_) {
      cleanup();
      if (!completer.isCompleted) {
        completer.completeError(Exception('Connexion d appel impossible.'));
      }
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.connect();

    timer = Timer(timeout, () {
      cleanup();
      if (!completer.isCompleted) {
        completer.completeError(Exception('Connexion d appel trop lente.'));
      }
    });

    return completer.future;
  }

  Future<dynamic> _emitSocketAck(
    String event,
    Map<String, dynamic> payload, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    await _ensureSocketConnected(timeout: timeout);

    final completer = Completer<dynamic>();
    late Timer timer;
    timer = Timer(timeout, () {
      if (!completer.isCompleted) {
        completer.completeError(
          Exception('Le serveur ne repond pas pour $event.'),
        );
      }
    });

    socket.emitWithAck(
      event,
      payload,
      ack: (dynamic response) {
        timer.cancel();
        if (!completer.isCompleted) {
          completer.complete(response);
        }
      },
    );

    return completer.future;
  }

  Future<void> _configureAudioRoute() async {
    try {
      await Helper.ensureAudioSession();
    } catch (_) {}

    await _applyAudioRoute();
  }

  Future<void> _applyAudioRoute() async {
    try {
      if (_speakerEnabled) {
        await Helper.setSpeakerphoneOnButPreferBluetooth();
      } else {
        await Helper.setSpeakerphoneOn(false);
      }
    } catch (_) {}
  }

  Future<void> _loadIceServers() async {
    final dynamic response = await _emitSocketAck('call:getConfig', {});
    if (response is! Map || response['success'] != true) {
      throw Exception('Configuration d appel indisponible.');
    }

    final rawServers = response['iceServers'];
    if (rawServers is List) {
      _iceServers = rawServers
          .map<mediasoup_types.RTCIceServer?>(_parseIceServer)
          .whereType<mediasoup_types.RTCIceServer>()
          .toList(growable: false);
    } else {
      _iceServers = const <mediasoup_types.RTCIceServer>[];
    }
  }

  Future<List<Map<String, dynamic>>> _joinCallSession() async {
    final payload = <String, dynamic>{'roomId': roomId};
    if (role == PrivateCallRole.caller) {
      payload['callerId'] = '$currentUserId';
    } else {
      payload['peerId'] = '$currentUserId';
    }

    final dynamic response = await _emitSocketAck(
      role == PrivateCallRole.caller ? 'call:start' : 'call:join',
      payload,
      timeout: const Duration(seconds: 12),
    );

    if (response is! Map) {
      throw Exception('Session d appel invalide.');
    }
    if (response['success'] != true) {
      throw Exception(
        (response['error'] ?? 'Impossible de rejoindre cet appel.').toString(),
      );
    }

    final rawActiveProducers = response['activeProducers'];
    if (rawActiveProducers is! List) return const <Map<String, dynamic>>[];

    return rawActiveProducers
        .whereType<Map>()
        .map<Map<String, dynamic>>((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }

  Future<void> _loadDevice() async {
    final dynamic response = await _emitSocketAck(
      'mediasoup:getRtpCapabilities',
      {'roomId': roomId},
    );

    if (response is! Map || response['rtpCapabilities'] is! Map) {
      throw Exception('Capacites RTP indisponibles.');
    }

    final device = mediasoup.Device();
    await device.load(
      routerRtpCapabilities: mediasoup.RtpCapabilities.fromMap(
        Map<String, dynamic>.from(response['rtpCapabilities'] as Map),
      ),
    );
    _device = device;
  }

  Future<void> _createSendTransport() async {
    final dynamic response = await _emitSocketAck('mediasoup:createTransport', {
      'roomId': roomId,
      'peerId': '$currentUserId',
    });
    final params = _extractTransportParams(response);

    final transport = _device!.createSendTransport(
      id: params['id'] as String,
      iceParameters: mediasoup.IceParameters.fromMap(
        Map<String, dynamic>.from(params['iceParameters'] as Map),
      ),
      iceCandidates: List<mediasoup.IceCandidate>.from(
        (params['iceCandidates'] as List<dynamic>).map(
          (candidate) => mediasoup.IceCandidate.fromMap(
            Map<String, dynamic>.from(candidate as Map),
          ),
        ),
      ),
      dtlsParameters: mediasoup.DtlsParameters.fromMap(
        Map<String, dynamic>.from(params['dtlsParameters'] as Map),
      ),
      iceServers: _iceServers,
      additionalSettings: _transportAdditionalSettings,
      proprietaryConstraints: _transportProprietaryConstraints,
      appData: const {'scope': 'call'},
      producerCallback: (dynamic producer) {
        if (producer is mediasoup.Producer) {
          _producers[producer.id] = producer;
          notifyListeners();
        }
      },
    );

    transport.on('connect', (dynamic data) async {
      try {
        await _emitSocketAck('mediasoup:connectTransport', {
          'roomId': roomId,
          'peerId': '$currentUserId',
          'transportId': transport.id,
          'dtlsParameters': data['dtlsParameters'].toMap(),
        });
        data['callback']();
      } catch (error) {
        data['errback'](error);
      }
    });

    transport.on('produce', (dynamic data) async {
      try {
        final dynamic produceResponse = await _emitSocketAck(
          'mediasoup:produce',
          {
            'roomId': roomId,
            'peerId': '$currentUserId',
            'transportId': transport.id,
            'kind': data['kind'],
            'rtpParameters': data['rtpParameters'].toMap(),
            'appData': {
              'scope': 'call',
              ...(data['appData'] is Map
                  ? Map<String, dynamic>.from(data['appData'] as Map)
                  : const <String, dynamic>{}),
            },
          },
        );

        if (produceResponse is! Map || produceResponse['id'] == null) {
          throw Exception('Publication du media impossible.');
        }
        data['callback'](produceResponse['id']);
      } catch (error) {
        data['errback'](error);
      }
    });

    transport.on('connectionstatechange', (dynamic state) {
      _handleTransportState('$state');
    });

    _sendTransport = transport;
  }

  Future<void> _createReceiveTransport() async {
    final dynamic response = await _emitSocketAck('mediasoup:createTransport', {
      'roomId': roomId,
      'peerId': '$currentUserId',
    });
    final params = _extractTransportParams(response);

    final transport = _device!.createRecvTransport(
      id: params['id'] as String,
      iceParameters: mediasoup.IceParameters.fromMap(
        Map<String, dynamic>.from(params['iceParameters'] as Map),
      ),
      iceCandidates: List<mediasoup.IceCandidate>.from(
        (params['iceCandidates'] as List<dynamic>).map(
          (candidate) => mediasoup.IceCandidate.fromMap(
            Map<String, dynamic>.from(candidate as Map),
          ),
        ),
      ),
      dtlsParameters: mediasoup.DtlsParameters.fromMap(
        Map<String, dynamic>.from(params['dtlsParameters'] as Map),
      ),
      iceServers: _iceServers,
      additionalSettings: _transportAdditionalSettings,
      proprietaryConstraints: _transportProprietaryConstraints,
      appData: const {'scope': 'call'},
      consumerCallback: (dynamic consumer, dynamic accept) async {
        if (consumer is! mediasoup.Consumer) return;
        _pendingConsumerProducerIds.remove(consumer.producerId);
        _consumers[consumer.id] = consumer;
        await _attachConsumer(consumer);
        if (accept is Function) {
          await Future.sync(() => accept());
        }
        notifyListeners();
      },
    );

    transport.on('connect', (dynamic data) async {
      try {
        await _emitSocketAck('mediasoup:connectTransport', {
          'roomId': roomId,
          'peerId': '$currentUserId',
          'transportId': transport.id,
          'dtlsParameters': data['dtlsParameters'].toMap(),
        });
        data['callback']();
      } catch (error) {
        data['errback'](error);
      }
    });

    transport.on('connectionstatechange', (dynamic state) {
      _handleTransportState('$state');
    });

    _recvTransport = transport;
  }

  Future<void> _captureLocalMedia() async {
    final constraints = <String, dynamic>{
      'audio': <String, dynamic>{
        'echoCancellation': true,
        'noiseSuppression': true,
        'autoGainControl': true,
      },
      'video': isVideo
          ? <String, dynamic>{
              'facingMode': 'user',
              'width': <String, dynamic>{'ideal': 720},
              'height': <String, dynamic>{'ideal': 1280},
              'frameRate': <String, dynamic>{'ideal': 30},
            }
          : false,
    };

    final stream = await navigator.mediaDevices
        .getUserMedia(constraints)
        .timeout(
          const Duration(seconds: 12),
          onTimeout: () =>
              throw Exception('La camera ou le microphone ne repond pas.'),
        );
    if (_shouldAbortOperations) {
      for (final track in stream.getTracks()) {
        try {
          await track.stop();
        } catch (_) {}
      }
      try {
        await stream.dispose();
      } catch (_) {}
      return;
    }

    for (final track in stream.getAudioTracks()) {
      track.enabled = !_microphoneMuted;
    }
    for (final track in stream.getVideoTracks()) {
      track.enabled = _cameraEnabled;
    }
    _localStream = stream;

    if (isVideo) {
      localRenderer.srcObject = null;
      localRenderer.srcObject = stream;
    }
    notifyListeners();
  }

  Future<void> _produceLocalTracks() async {
    final stream = _localStream;
    final transport = _sendTransport;
    if (stream == null || transport == null) return;

    final audioTracks = stream.getAudioTracks();
    if (audioTracks.isNotEmpty) {
      final audioTrack = audioTracks.first;
      if (audioTrack.kind != 'audio') {
        throw Exception('La piste audio locale est invalide.');
      }
      transport.produce(
        track: audioTrack,
        stream: stream,
        source: 'microphone',
        appData: const {'mediaTag': 'audio', 'scope': 'call'},
      );
    }

    if (isVideo) {
      final videoTracks = stream.getVideoTracks();
      if (videoTracks.isNotEmpty) {
        final videoTrack = videoTracks.first;
        if (videoTrack.kind != 'video') {
          throw Exception('La piste video locale est invalide.');
        }
        transport.produce(
          track: videoTrack,
          stream: stream,
          source: 'webcam',
          appData: const {'mediaTag': 'camera', 'scope': 'call'},
        );
      }
    }
  }

  Future<void> _consumeProducer(dynamic rawProducer) async {
    if (_recvTransport == null || _device == null || _shouldAbortOperations) {
      return;
    }
    if (rawProducer is! Map) return;

    final producerId = (rawProducer['producerId'] ?? '').toString();
    final peerId = (rawProducer['peerId'] ?? '').toString();
    final kind = (rawProducer['kind'] ?? '').toString();

    if (producerId.isEmpty ||
        peerId == '$currentUserId' ||
        _pendingConsumerProducerIds.contains(producerId)) {
      return;
    }
    if (_consumers.values.any(
      (consumer) => consumer.producerId == producerId,
    )) {
      return;
    }

    _pendingConsumerProducerIds.add(producerId);

    try {
      final dynamic response = await _emitSocketAck('mediasoup:consume', {
        'roomId': roomId,
        'peerId': '$currentUserId',
        'transportId': _recvTransport!.id,
        'producerId': producerId,
        'rtpCapabilities': _device!.rtpCapabilities.toMap(),
      });

      if (response is! Map || response['params'] is! Map) {
        return;
      }

      final params = Map<String, dynamic>.from(response['params'] as Map);
      _recvTransport!.consume(
        id: (params['id'] ?? '').toString(),
        producerId: producerId,
        peerId: peerId,
        kind: mediasoup.RTCRtpMediaTypeExtension.fromString(kind),
        rtpParameters: mediasoup.RtpParameters.fromMap(
          Map<String, dynamic>.from(params['rtpParameters'] as Map),
        ),
        appData: rawProducer['appData'] is Map
            ? Map<String, dynamic>.from(rawProducer['appData'] as Map)
            : const <String, dynamic>{},
        accept: () => _emitSocketAck('mediasoup:resumeConsumer', {
          'roomId': roomId,
          'peerId': '$currentUserId',
          'consumerId': params['id'],
        }),
      );
    } catch (_) {
      _pendingConsumerProducerIds.remove(producerId);
      rethrow;
    }
  }

  Future<void> _attachConsumer(mediasoup.Consumer consumer) async {
    if (_shouldAbortOperations) return;
    _pendingConsumerProducerIds.remove(consumer.producerId);
    await _syncRemoteStream();

    _remoteAccepted = true;
    if (!_connected) {
      _setConnectedState();
    }
  }

  Future<void> _syncRemoteStream() async {
    if (_shouldAbortOperations) return;
    final nextStream = await createLocalMediaStream(
      'private-call-remote-$roomId',
    );
    final addedTrackIds = <String>{};

    for (final consumer in _consumers.values) {
      final track = consumer.track;
      final trackId = track.id ?? '';
      if (trackId.isEmpty || addedTrackIds.contains(trackId)) {
        continue;
      }
      await nextStream.addTrack(track);
      addedTrackIds.add(trackId);
    }

    final previousStream = _remoteStream;
    _remoteStream = nextStream;
    _remoteVideoAvailable = nextStream.getVideoTracks().isNotEmpty;

    remoteRenderer.srcObject = addedTrackIds.isEmpty ? null : nextStream;
    if (nextStream.getAudioTracks().isNotEmpty) {
      try {
        await remoteRenderer.setVolume(1.0);
      } catch (_) {}
      await _applyAudioRoute();
    }

    if (previousStream != null && previousStream.id != nextStream.id) {
      try {
        await previousStream.dispose();
      } catch (_) {}
    }

    notifyListeners();
  }

  void _handleTransportState(String state) {
    if (_ended) return;

    if (state.contains('failed') || state.contains('closed')) {
      _errorText = 'La connexion d appel a ete interrompue.';
      _finishLocally(reason: _errorText!, notifyRemote: true);
      return;
    }

    if (!_connected) {
      _statusText = 'Connexion media...';
      notifyListeners();
    }
  }

  mediasoup.Producer? _findProducerByKind(String kind) {
    for (final producer in _producers.values) {
      if (producer.kind == kind) {
        return producer;
      }
    }
    return null;
  }

  void _attachSocketListeners() {
    void newProducerListener(dynamic data) {
      if (_ended) return;
      if (data is! Map || data['roomId']?.toString() != roomId) return;
      _consumeProducer(Map<String, dynamic>.from(data));
    }

    _newProducerListener = newProducerListener;
    socket.on('mediasoup:newProducer', newProducerListener);

    void producerClosedListener(dynamic data) {
      if (data is! Map || data['roomId']?.toString() != roomId) return;
      final producerId = data['producerId']?.toString() ?? '';
      if (producerId.isEmpty) return;
      _removeConsumerByProducerId(producerId);
    }

    _producerClosedListener = producerClosedListener;
    socket.on('mediasoup:producerClosed', producerClosedListener);

    void callEndedListener(dynamic data) {
      if (data is! Map || data['roomId']?.toString() != roomId) return;
      _finishLocally(reason: 'Appel termine.', notifyRemote: false);
    }

    _callEndedListener = callEndedListener;
    socket.on('call:end', callEndedListener);
    socket.on('call-ended', callEndedListener);

    void callConnectedListener(dynamic data) {
      if (data is! Map || data['roomId']?.toString() != roomId) return;
      _remoteAccepted = true;
      _stopRingbackTone();
      _setConnectedState();
    }

    _callConnectedListener = callConnectedListener;
    socket.on('call:connected', callConnectedListener);

    void participantJoinedListener(dynamic data) {
      if (data is! Map || data['roomId']?.toString() != roomId) return;
      _remoteAccepted = true;
      _stopRingbackTone();
      if (!_connected) {
        _statusText = 'Connexion media...';
        notifyListeners();
      }
    }

    _participantJoinedListener = participantJoinedListener;
    socket.on('call:participant-joined', participantJoinedListener);

    void callResponseListener(dynamic data) {
      if (role != PrivateCallRole.caller || data is! Map) return;
      if (data['roomId']?.toString() != roomId) return;

      final status = (data['status'] ?? '').toString().toLowerCase();
      if (status == 'accepted') {
        _remoteAccepted = true;
        _stopRingbackTone();
        if (!_connected) {
          _statusText = 'Connexion media...';
          notifyListeners();
        }
        return;
      }

      if (status == 'declined') {
        _finishLocally(reason: 'Appel refuse.', notifyRemote: false);
        return;
      }

      if (status == 'missed') {
        _finishLocally(reason: 'Aucune reponse.', notifyRemote: false);
        return;
      }

      if (status == 'busy') {
        _finishLocally(
          reason: 'Utilisateur deja en appel.',
          notifyRemote: false,
        );
      }
    }

    _callResponseListener = callResponseListener;
    socket.on('call-response-received', callResponseListener);

    void socketDisconnectListener(dynamic _) {
      _finishLocally(
        reason: 'Connexion reseau interrompue.',
        notifyRemote: false,
      );
    }

    _socketDisconnectListener = socketDisconnectListener;
    socket.on('disconnect', socketDisconnectListener);
  }

  void _removeSocketListeners() {
    if (_newProducerListener case final listener?) {
      socket.off('mediasoup:newProducer', listener);
    }
    if (_producerClosedListener case final listener?) {
      socket.off('mediasoup:producerClosed', listener);
    }
    if (_callEndedListener case final listener?) {
      socket.off('call:end', listener);
      socket.off('call-ended', listener);
    }
    if (_callConnectedListener case final listener?) {
      socket.off('call:connected', listener);
    }
    if (_participantJoinedListener case final listener?) {
      socket.off('call:participant-joined', listener);
    }
    if (_callResponseListener case final listener?) {
      socket.off('call-response-received', listener);
    }
    if (_socketDisconnectListener case final listener?) {
      socket.off('disconnect', listener);
    }
  }

  void _setConnectedState() {
    if (_connected) return;
    _connected = true;
    _stopRingbackTone();
    _statusText = 'En appel';
    _connectedAt = DateTime.now();
    _callTimer?.cancel();
    _callTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_disposed || _connectedAt == null) return;
      _elapsed = DateTime.now().difference(_connectedAt!);
      notifyListeners();
    });
    notifyListeners();
  }

  Future<void> _finishLocally({
    required String reason,
    required bool notifyRemote,
  }) async {
    if (_ending || _disposed || _ended) return;
    _ending = true;
    _ended = true;
    _connected = false;
    _stopRingbackTone();
    _statusText = reason;
    _endingReason = reason;
    notifyListeners();

    if (notifyRemote) {
      try {
        await _emitSocketAck('call:end', {
          'roomId': roomId,
          'peerId': '$currentUserId',
        }, timeout: const Duration(seconds: 4));
      } catch (_) {}
    }

    await _disposeResources(disposeRenderers: false);
    _ending = false;
    if (!_disposed) {
      notifyListeners();
    }
  }

  void _startRingbackTone() {
    if (role != PrivateCallRole.caller || _connected || _ended) return;
    _ringbackTimer?.cancel();
    unawaited(_playRingbackTone());
    _ringbackTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (_connected || _ended || _disposed) {
        _stopRingbackTone();
        return;
      }
      unawaited(_playRingbackTone());
    });
  }

  void _stopRingbackTone() {
    _ringbackTimer?.cancel();
    _ringbackTimer = null;
    try {
      _ringbackPlayer.stop();
    } catch (_) {}
  }

  Future<void> _playRingbackTone() async {
    try {
      await _ringbackPlayer.seek(Duration.zero);
      await _ringbackPlayer.resume();
    } catch (_) {}
  }

  Future<void> _disposeResources({required bool disposeRenderers}) async {
    if (!_mediaResourcesDisposed) {
      _mediaResourcesDisposed = true;
      _callTimer?.cancel();
      _callTimer = null;
      _stopRingbackTone();
      _removeSocketListeners();

      for (final producer in _producers.values) {
        try {
          producer.close();
        } catch (_) {}
      }
      _producers.clear();

      for (final consumer in _consumers.values) {
        try {
          await consumer.close();
        } catch (_) {}
      }
      _consumers.clear();
      _pendingConsumerProducerIds.clear();

      try {
        await _sendTransport?.close();
      } catch (_) {}
      _sendTransport = null;

      try {
        await _recvTransport?.close();
      } catch (_) {}
      _recvTransport = null;

      final stream = _localStream;
      _localStream = null;
      if (stream != null) {
        for (final track in stream.getTracks()) {
          try {
            await track.stop();
          } catch (_) {}
        }
        try {
          await stream.dispose();
        } catch (_) {}
      }

      try {
        localRenderer.srcObject = null;
      } catch (_) {}
      try {
        remoteRenderer.srcObject = null;
      } catch (_) {}
      final remoteStream = _remoteStream;
      _remoteStream = null;
      if (remoteStream != null) {
        try {
          await remoteStream.dispose();
        } catch (_) {}
      }
    }

    if (disposeRenderers && !_renderersDisposed) {
      _renderersDisposed = true;
      try {
        await localRenderer.dispose();
      } catch (_) {}
      try {
        await remoteRenderer.dispose();
      } catch (_) {}
    }
  }

  void _removeConsumerByProducerId(String producerId) {
    _pendingConsumerProducerIds.remove(producerId);
    final entry = _consumers.entries
        .where((item) => item.value.producerId == producerId)
        .toList();
    for (final item in entry) {
      unawaited(item.value.close());
      _consumers.remove(item.key);
    }
    unawaited(_syncRemoteStream());
  }

  mediasoup_types.RTCIceServer? _parseIceServer(dynamic rawServer) {
    if (rawServer is! Map) return null;

    final server = Map<String, dynamic>.from(rawServer);
    final urls = _extractIceServerUrls(server['urls'] ?? server['url']);
    if (urls.isEmpty) return null;

    final rawCredential = server['credential'];
    final credentialTypeName = (server['credentialType'] ?? '')
        .toString()
        .toLowerCase();
    final isOAuthCredential =
        credentialTypeName == 'oauth' && rawCredential is Map;

    return mediasoup_types.RTCIceServer(
      credential: isOAuthCredential
          ? mediasoup_types.RTCOAuthCredential(
              accessToken: (rawCredential['accessToken'] ?? '').toString(),
              macKey: (rawCredential['macKey'] ?? '').toString(),
            )
          : rawCredential,
      credentialType: isOAuthCredential
          ? mediasoup_types.RTCIceCredentialType.oauth
          : mediasoup_types.RTCIceCredentialType.password,
      urls: urls,
      username: (server['username'] ?? '').toString(),
    );
  }

  List<String> _extractIceServerUrls(dynamic rawUrls) {
    if (rawUrls is String) {
      final url = rawUrls.trim();
      return url.isEmpty ? const <String>[] : <String>[url];
    }
    if (rawUrls is List) {
      return rawUrls
          .map((dynamic value) => value.toString().trim())
          .where((String value) => value.isNotEmpty)
          .toList(growable: false);
    }
    return const <String>[];
  }

  Map<String, dynamic> _extractTransportParams(dynamic response) {
    if (response is! Map || response['params'] is! Map) {
      throw Exception('Transport WebRTC indisponible.');
    }
    return Map<String, dynamic>.from(response['params'] as Map);
  }
}
