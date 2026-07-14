import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:mediasfu_mediasoup_client/mediasfu_mediasoup_client.dart'
    as mediasoup;
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
  }) : _speakerEnabled = isVideo,
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

  mediasoup.Device? _device;
  mediasoup.Transport? _sendTransport;
  mediasoup.Transport? _recvTransport;
  MediaStream? _localStream;

  List<dynamic> _iceServers = const <dynamic>[];
  Timer? _callTimer;
  DateTime? _connectedAt;

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
        ? 'Appel en cours...'
        : 'Connexion a l appel...';
    notifyListeners();

    try {
      await localRenderer.initialize();
      await remoteRenderer.initialize();
      _attachSocketListeners();
      await _ensureSocketConnected();
      await _configureAudioRoute();
      await _loadIceServers();
      final activeProducers = await _joinCallSession();
      await _loadDevice();
      await _createSendTransport();
      await _createReceiveTransport();
      await _captureLocalMedia();
      await _produceLocalTracks();

      for (final dynamic producer in activeProducers) {
        await _consumeProducer(producer);
      }

      _initialized = true;
      if (role == PrivateCallRole.caller && !_remoteAccepted) {
        _statusText = 'Appel en cours...';
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
    final audioProducer = _findProducerByKind('audio');
    if (audioProducer == null) return;

    _microphoneMuted = !_microphoneMuted;
    if (_microphoneMuted) {
      audioProducer.pause();
    } else {
      audioProducer.resume();
    }
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    _speakerEnabled = !_speakerEnabled;
    try {
      await Helper.setSpeakerphoneOn(_speakerEnabled);
    } catch (_) {}
    notifyListeners();
  }

  Future<void> toggleCamera() async {
    if (!isVideo) return;
    final videoProducer = _findProducerByKind('video');
    if (videoProducer == null) return;

    _cameraEnabled = !_cameraEnabled;
    if (_cameraEnabled) {
      videoProducer.resume();
    } else {
      videoProducer.pause();
    }
    notifyListeners();
  }

  Future<void> switchCamera() async {
    if (!canSwitchCamera) return;
    final tracks = _localStream?.getVideoTracks() ?? const <MediaStreamTrack>[];
    if (tracks.isEmpty) return;
    await Helper.switchCamera(tracks.first);
  }

  Future<void> endCall() async {
    await _finishLocally(reason: 'Appel termine.', notifyRemote: true);
  }

  Future<void> release() async {
    await _disposeResources();
    if (!_disposed) {
      _disposed = true;
      super.dispose();
    }
  }

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

    try {
      await Helper.setSpeakerphoneOn(_speakerEnabled);
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
          .whereType<Map>()
          .map<dynamic>((server) => Map<String, dynamic>.from(server))
          .toList(growable: false);
    } else {
      _iceServers = const <dynamic>[];
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
      iceServers: _iceServers.cast(),
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
      iceServers: _iceServers.cast(),
      appData: const {'scope': 'call'},
      consumerCallback: (dynamic consumer, dynamic accept) async {
        if (consumer is! mediasoup.Consumer) return;
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
      'audio': true,
      'video': isVideo
          ? <String, dynamic>{
              'facingMode': 'user',
              'width': <String, dynamic>{'ideal': 720},
              'height': <String, dynamic>{'ideal': 1280},
              'frameRate': <String, dynamic>{'ideal': 30},
            }
          : false,
    };

    final stream = await navigator.mediaDevices.getUserMedia(constraints);
    _localStream = stream;

    if (isVideo) {
      localRenderer.srcObject = stream;
    }
  }

  Future<void> _produceLocalTracks() async {
    final stream = _localStream;
    final transport = _sendTransport;
    if (stream == null || transport == null) return;

    final audioTracks = stream.getAudioTracks();
    if (audioTracks.isNotEmpty) {
      transport.produce(
        track: audioTracks.first,
        stream: stream,
        source: 'microphone',
        appData: const {'mediaTag': 'audio', 'scope': 'call'},
      );
    }

    if (isVideo) {
      final videoTracks = stream.getVideoTracks();
      if (videoTracks.isNotEmpty) {
        transport.produce(
          track: videoTracks.first,
          stream: stream,
          source: 'webcam',
          appData: const {'mediaTag': 'camera', 'scope': 'call'},
        );
      }
    }
  }

  Future<void> _consumeProducer(dynamic rawProducer) async {
    if (_recvTransport == null || _device == null) return;
    if (rawProducer is! Map) return;

    final producerId = (rawProducer['producerId'] ?? '').toString();
    final peerId = (rawProducer['peerId'] ?? '').toString();
    final kind = (rawProducer['kind'] ?? '').toString();

    if (producerId.isEmpty || peerId == '$currentUserId') return;
    if (_consumers.values.any(
      (consumer) => consumer.producerId == producerId,
    )) {
      return;
    }

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
  }

  Future<void> _attachConsumer(mediasoup.Consumer consumer) async {
    if (consumer.kind == 'video') {
      _remoteVideoAvailable = true;
      remoteRenderer.srcObject = consumer.stream;
    }

    _remoteAccepted = true;
    if (!_connected) {
      _setConnectedState();
    }
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
      _setConnectedState();
    }

    _callConnectedListener = callConnectedListener;
    socket.on('call:connected', callConnectedListener);

    void participantJoinedListener(dynamic data) {
      if (data is! Map || data['roomId']?.toString() != roomId) return;
      _remoteAccepted = true;
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

    await _disposeResources();
    _ended = true;
    _ending = false;
    if (!_disposed) {
      notifyListeners();
    }
  }

  Future<void> _disposeResources() async {
    _callTimer?.cancel();
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
    try {
      await localRenderer.dispose();
    } catch (_) {}
    try {
      await remoteRenderer.dispose();
    } catch (_) {}
  }

  void _removeConsumerByProducerId(String producerId) {
    final entry = _consumers.entries
        .where((item) => item.value.producerId == producerId)
        .toList();
    for (final item in entry) {
      item.value.close();
      _consumers.remove(item.key);
    }

    _remoteVideoAvailable = _consumers.values.any(
      (consumer) => consumer.kind == 'video',
    );
    if (!_remoteVideoAvailable) {
      remoteRenderer.srcObject = null;
    }
    notifyListeners();
  }

  Map<String, dynamic> _extractTransportParams(dynamic response) {
    if (response is! Map || response['params'] is! Map) {
      throw Exception('Transport WebRTC indisponible.');
    }
    return Map<String, dynamic>.from(response['params'] as Map);
  }
}
