import 'dart:async';
import 'dart:convert';
import 'dart:developer';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_callkit_incoming/entities/android_params.dart';
import 'package:flutter_callkit_incoming/entities/ios_params.dart';
import 'package:flutter_callkit_incoming/entities/notification_params.dart';
import 'package:flutter_callkit_incoming/entities/call_kit_params.dart';
import 'package:flutter_callkit_incoming/entities/call_event.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:http/http.dart' as http;

// Global background message handler for Firebase Messaging
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  log('[PushNotificationService] Background message received: ${message.data}');
  
  if (message.data['type'] == 'incoming-call') {
    await PushNotificationService.showIncomingCallKit(message.data);
  }
}

class PushNotificationService {
  static final _onCallAccepted = StreamController<Map<String, dynamic>>.broadcast();
  static final _onCallDeclined = StreamController<Map<String, dynamic>>.broadcast();

  // Streams to listen to in the UI (e.g. in DashboardPage)
  static Stream<Map<String, dynamic>> get onCallAccepted => _onCallAccepted.stream;
  static Stream<Map<String, dynamic>> get onCallDeclined => _onCallDeclined.stream;

  static Future<void> initialize(int currentUserId) async {
    try {
      // 1. Initialize Firebase
      await Firebase.initializeApp();

      // 2. Request notification permissions
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: true,
        provisional: false,
        sound: true,
      );
      log('[PushNotificationService] Permission status: ${settings.authorizationStatus}');

      // 3. Set up background messaging handler
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

      // 4. Set up foreground messaging listener
      FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
        log('[PushNotificationService] Foreground message received: ${message.data}');
        if (message.data['type'] == 'incoming-call') {
          await showIncomingCallKit(message.data);
        }
      });

      // 5. Get Token and register it on the server
      final token = await messaging.getToken();
      if (token != null) {
        log('[PushNotificationService] FCM Token: $token');
        await _registerTokenOnServer(currentUserId, token);
      }

      // Listen for token updates
      messaging.onTokenRefresh.listen((newToken) async {
        log('[PushNotificationService] FCM Token Refreshed: $newToken');
        await _registerTokenOnServer(currentUserId, newToken);
      });

      // 6. Listen to CallKit events
      FlutterCallkitIncoming.onEvent.listen((CallEvent? event) {
        if (event == null) return;
        log('[PushNotificationService] CallKit event: ${event.event}');
        
        switch (event.event) {
          case Event.actionCallAccept:
            final extra = Map<String, dynamic>.from(event.body['extra'] ?? {});
            _onCallAccepted.add(extra);
            break;
          case Event.actionCallDecline:
            final extra = Map<String, dynamic>.from(event.body['extra'] ?? {});
            _onCallDeclined.add(extra);
            break;
          default:
            break;
        }
      });

    } catch (e) {
      log('[PushNotificationService] Error initializing push notifications: $e');
    }
  }

  static Future<void> showIncomingCallKit(Map<String, dynamic> data) async {
    final roomId = data['roomId'] ?? '';
    final callerId = data['callerId'] ?? '';
    final callerName = data['callerName'] ?? 'Appelant';
    final callerAvatar = data['callerAvatar'] ?? '';
    final isVideo = data['isVideo'] == 'true';

    final params = CallKitParams(
      id: roomId.isNotEmpty ? roomId : DateTime.now().millisecondsSinceEpoch.toString(),
      nameCaller: callerName,
      appName: 'TrasX',
      avatar: callerAvatar,
      handle: isVideo ? 'Appel vidéo' : 'Appel audio',
      type: isVideo ? 1 : 0, // 0 - audio, 1 - video
      duration: 35000,
      textAccept: 'Répondre',
      textDecline: 'Refuser',
      missedCallNotification: const NotificationParams(
        showNotification: true,
        title: 'Appel manqué',
        body: 'Vous avez manqué un appel.',
      ),
      extra: <String, dynamic>{
        'roomId': roomId,
        'callerId': callerId,
        'callerName': callerName,
        'callerAvatar': callerAvatar,
        'isVideo': isVideo.toString(),
      },
      android: const AndroidParams(
        isCustomNotification: true,
        isShowLogo: false,
        ringtonePath: 'system_ringtone_default',
        backgroundColor: '#090A10',
        actionColor: '#FE2C55',
        incomingCallNotificationChannelName: 'Appels entrants',
        missedCallNotificationChannelName: 'Appels manqués',
      ),
      ios: const IOSParams(
        iconName: 'AppIcon',
        handleType: 'generic',
        supportsVideo: true,
        maximumCallGroups: 1,
        maximumCallsPerCallGroup: 1,
        audioSessionMode: 'default',
        audioSessionActive: true,
        audioSessionPreferredSampleRate: 44100.0,
        audioSessionPreferredIOBufferDuration: 0.005,
        supportsDTMF: true,
        supportsHolding: false,
        supportsGrouping: false,
        supportsUngrouping: false,
        ringtonePath: 'system_ringtone_default',
      ),
    );

    await FlutterCallkitIncoming.showCallkitIncoming(params);
  }

  static Future<void> _registerTokenOnServer(int userId, String token) async {
    try {
      final response = await http.post(
        Uri.parse('https://trasx.com/api/notifications/fcm-token'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$userId',
        },
        body: jsonEncode({
          'token': token,
          'platform': 'mobile',
        }),
      );
      if (response.statusCode == 200) {
        log('[PushNotificationService] FCM token registered on server successfully.');
      } else {
        log('[PushNotificationService] Failed to register FCM token. Status code: ${response.statusCode}');
      }
    } catch (e) {
      log('[PushNotificationService] Error registering token on server: $e');
    }
  }

  static Future<void> unregisterTokenOnServer(int userId) async {
    try {
      final response = await http.delete(
        Uri.parse('https://trasx.com/api/notifications/fcm-token'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$userId',
        },
      );
      if (response.statusCode == 200) {
        log('[PushNotificationService] FCM token unregistered from server.');
      }
    } catch (e) {
      log('[PushNotificationService] Error unregistering token: $e');
    }
  }
}
