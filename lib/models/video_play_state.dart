// lib/models/video_play_state.dart

/// Représente les différents états de lecture d'une vidéo dans le lecteur Shorts.
enum VideoPlayState {
  /// Le lecteur n'est pas initialisé ou est inactif.
  idle,

  /// La vidéo est en cours de chargement/initialisation initiale.
  loading,

  /// La vidéo est initialisée et prête à être jouée.
  ready,

  /// La vidéo est activement en cours de lecture.
  playing,

  /// La vidéo est en lecture mais attend des données (buffering).
  buffering,

  /// La lecture est en pause.
  paused,

  /// Une erreur est survenue lors de l'initialisation ou de la lecture.
  error,
}
