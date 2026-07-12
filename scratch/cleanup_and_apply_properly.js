const fs = require('fs');
const path = require('path');

const mappings = {
  "- Ticket": {
    en: "- Ticket",
    fr: "- Ticket",
    es: "- Ticket"
  },
  "Ticket preview": {
    en: "Ticket preview",
    fr: "Aperçu du ticket",
    es: "Vista previa de la entrada"
  },
  "WeShare - Forgot Password": {
    en: "WeShare - Forgot Password",
    fr: "WeShare - Mot de passe oublié",
    es: "WeShare - Contraseña olvidada"
  },
  "Account recovery": {
    en: "Account recovery",
    fr: "Récupération de compte",
    es: "Recuperación de cuenta"
  },
  "Create a new password": {
    en: "Create a new password",
    fr: "Créer un nouveau mot de passe",
    es: "Crear una nueva contraseña"
  },
  "Forgot your password?": {
    en: "Forgot your password?",
    fr: "Mot de passe oublié ?",
    es: "¿Olvidaste tu contraseña?"
  },
  "Enter the code you received and choose your new password.": {
    en: "Enter the code you received and choose your new password.",
    fr: "Saisissez le code reçu et choisissez votre nouveau mot de passe.",
    es: "Introduce el código recibido y elige tu nueva contraseña."
  },
  "Enter your email address and we will send you a reset code.": {
    en: "Enter your email address and we will send you a reset code.",
    fr: "Saisissez votre adresse e-mail et nous vous enverrons un code de réinitialisation.",
    es: "Introduce tu correo electrónico y te enviaremos un código de restablecimiento."
  },
  "Email service unavailable.": {
    en: "Email service unavailable.",
    fr: "Service e-mail indisponible.",
    es: "Servicio de correo no disponible."
  },
  "Use this reset code for": {
    en: "Use this reset code for",
    fr: "Utilisez ce code de réinitialisation pour",
    es: "Usa este código de restablecimiento para"
  },
  "Reset code": {
    en: "Reset code",
    fr: "Code de réinitialisation",
    es: "Código de restablecimiento"
  },
  "6-digit code": {
    en: "6-digit code",
    fr: "Code à 6 chiffres",
    es: "Código de 6 dígitos"
  },
  "New password": {
    en: "New password",
    fr: "Nouveau mot de passe",
    es: "Nueva contraseña"
  },
  "Confirm password": {
    en: "Confirm password",
    fr: "Confirmer le mot de passe",
    es: "Confirmar contraseña"
  },
  "Update password": {
    en: "Update password",
    fr: "Mettre à jour le mot de passe",
    es: "Actualizar contraseña"
  },
  "Send reset code": {
    en: "Send reset code",
    fr: "Envoyer le code de réinitialisation",
    es: "Enviar código"
  },
  "Back to login": {
    en: "Back to login",
    fr: "Retour à la connexion",
    es: "Volver al inicio de sesión"
  },
  "Recover access safely.": {
    en: "Recover access safely.",
    fr: "Récupérez l'accès en toute sécurité.",
    es: "Recupera el acceso de forma segura."
  },
  "We send you a code so you can reset your password securely.": {
    en: "We send you a code so you can reset your password securely.",
    fr: "Nous vous envoyons un code pour réinitialiser votre mot de passe en toute sécurité.",
    es: "Te enviamos un código para que restablezcas tu contraseña de forma segura."
  },
  "Write a new post": {
    en: "Write a new post",
    fr: "Écrire une nouvelle publication",
    es: "Escribir nueva publicación"
  },
  "What's on your mind,": {
    en: "What's on your mind,",
    fr: "Qu'avez-vous en tête,",
    es: "¿Qué tienes en mente,"
  },
  "Share Post": {
    en: "Share Post",
    fr: "Partager la publication",
    es: "Compartir publicación"
  },
  "Photo/Video": {
    en: "Photo/Video",
    fr: "Photo/Vidéo",
    es: "Foto/Video"
  },
  "Text Style": {
    en: "Text Style",
    fr: "Style de texte",
    es: "Estilo de texto"
  },
  "Only Me": {
    en: "Only Me",
    fr: "Moi uniquement",
    es: "Solo yo"
  },
  "Autoriser le téléchargement de la vidéo": {
    en: "Allow video download",
    fr: "Autoriser le téléchargement de la vidéo",
    es: "Permitir descarga de video"
  },
  "Diffuser un Live": {
    en: "Broadcast Live",
    fr: "Diffuser un Live",
    es: "Transmitir en vivo"
  },
  "Partagez un live YouTube gratuit ou payant": {
    en: "Share a free or paid YouTube live",
    fr: "Partagez un live YouTube gratuit ou payant",
    es: "Comparte una transmisión en vivo de YouTube gratis o de pago"
  },
  "URL ou ID du Live YouTube": {
    en: "YouTube Live URL or ID",
    fr: "URL ou ID du Live YouTube",
    es: "URL o ID de la transmisión de YouTube"
  },
  "Ex: https://www.youtube.com/watch?v=...": {
    en: "Ex: https://www.youtube.com/watch?v=...",
    fr: "Ex : https://www.youtube.com/watch?v=...",
    es: "Ej: https://www.youtube.com/watch?v=..."
  },
  "Mode d'accès": {
    en: "Access Mode",
    fr: "Mode d'accès",
    es: "Modo de acceso"
  },
  "Prix d'accès (USD)": {
    en: "Access Price (USD)",
    fr: "Prix d'accès (USD)",
    es: "Precio de acceso (USD)"
  },
  "Ex: 2.50": {
    en: "Ex: 2.50",
    fr: "Ex : 2.50",
    es: "Ej: 2.50"
  },
  "Confirmer la configuration": {
    en: "Confirm Configuration",
    fr: "Confirmer la configuration",
    es: "Confirmar configuración"
  },
  "Annuler la diffusion": {
    en: "Cancel Broadcast",
    fr: "Annuler la diffusion",
    es: "Cancelar transmisión"
  },
  "Challenge Builder": {
    en: "Challenge Builder",
    fr: "Challenge Builder",
    es: "Creador de desafíos"
  },
  "Beaute, vote, miss et concours avec invitation ou participation libre": {
    en: "Beauty, vote, pageant, and contests with invite or free entry",
    fr: "Beaute, vote, miss et concours avec invitation ou participation libre",
    es: "Belleza, votación, reinas y concursos con invitación o participación libre"
  },
  "Nom du challenge": {
    en: "Challenge Name",
    fr: "Nom du challenge",
    es: "Nombre del desafío"
  },
  "Ex: Miss Summer 2026": {
    en: "Ex: Miss Summer 2026",
    fr: "Ex : Miss Summer 2026",
    es: "Ej: Miss Summer 2026"
  },
  "Participation libre": {
    en: "Free Participation",
    fr: "Participation libre",
    es: "Participación libre"
  },
  "Inviter une personne": {
    en: "Invite Someone",
    fr: "Inviter une personne",
    es: "Invitar a alguien"
  },
  "Vote gratuit": {
    en: "Free Vote",
    fr: "Vote gratuit",
    es: "Voto gratuito"
  },
  "Vote payant": {
    en: "Paid Vote",
    fr: "Vote payant",
    es: "Voto de pago"
  },
  "Montant du vote payant (USD)": {
    en: "Paid Vote Amount (USD)",
    fr: "Montant du vote payant (USD)",
    es: "Monto del voto de pago (USD)"
  },
  "Date et heure de fin (optionnel)": {
    en: "End Date & Time (Optional)",
    fr: "Date et heure de fin (optionnel)",
    es: "Fecha y hora de finalización (opcional)"
  },
  "Participer au challenge": {
    en: "Participate in Challenge",
    fr: "Participer au challenge",
    es: "Participar en el desafío"
  },
  "Votre photo pour le challenge": {
    en: "Your photo for the challenge",
    fr: "Votre photo pour le challenge",
    es: "Tu foto para el desafío"
  },
  "Choisir une photo": {
    en: "Choose a photo",
    fr: "Choisir une photo",
    es: "Elegir foto"
  },
  "Aucune photo choisie": {
    en: "No photo chosen",
    fr: "Aucune photo choisie",
    es: "Ninguna foto seleccionada"
  },
  "Rechercher un utilisateur a inviter": {
    en: "Search user to invite",
    fr: "Rechercher un utilisateur à inviter",
    es: "Buscar usuario para invitar"
  },
  "Créer et publier le challenge": {
    en: "Create & Publish Challenge",
    fr: "Créer et publier le challenge",
    es: "Crear y publicar el desafío"
  },
  "Search user to mention...": {
    en: "Search user to mention...",
    fr: "Rechercher un utilisateur à mentionner...",
    es: "Buscar usuario para mencionar..."
  },
  "'Outfit', sans-serif": {
    en: "'Outfit', sans-serif",
    fr: "'Outfit', sans-serif",
    es: "'Outfit', sans-serif"
  },
  "Outfit (Modern)": {
    en: "Outfit (Modern)",
    fr: "Outfit (Moderne)",
    es: "Outfit (Moderno)"
  },
  "'Inter', sans-serif": {
    en: "'Inter', sans-serif",
    fr: "'Inter', sans-serif",
    es: "'Inter', sans-serif"
  },
  "Inter (Clean)": {
    en: "Inter (Clean)",
    fr: "Inter (Épuré)",
    es: "Inter (Limpio)"
  },
  "'Georgia', serif": {
    en: "'Georgia', serif",
    fr: "'Georgia', serif",
    es: "'Georgia', serif"
  },
  "Georgia (Classic Serif)": {
    en: "Georgia (Classic Serif)",
    fr: "Georgia (Serif Classique)",
    es: "Georgia (Serif Clásico)"
  },
  "'Courier New', monospace": {
    en: "'Courier New', monospace",
    fr: "'Courier New', monospace",
    es: "'Courier New', monospace"
  },
  "Courier New (Monospace)": {
    en: "Courier New (Monospace)",
    fr: "Courier New (Monospace)",
    es: "Courier New (Monoespaciado)"
  },
  "'Playfair Display', serif": {
    en: "'Playfair Display', serif",
    fr: "'Playfair Display', serif",
    es: "'Playfair Display', serif"
  },
  "Playfair Display (Elegant)": {
    en: "Playfair Display (Elegant)",
    fr: "Playfair Display (Élégant)",
    es: "Playfair Display (Elegante)"
  },
  "Aucun favori pour le moment": {
    en: "No bookmarks yet",
    fr: "Aucun favori pour le moment",
    es: "Aún no hay marcadores"
  },
  "QUE DIEU VOUS BENISSE !": {
    en: "GOD BLESS YOU!",
    fr: "QUE DIEU VOUS BÉNISSE !",
    es: "¡DIOS TE BENDIGA!"
  },
  "Envoyer un cadeau": {
    en: "Send a gift",
    fr: "Envoyer un cadeau",
    es: "Enviar un regalo"
  },
  "Bouton cadeau": {
    en: "Gift button",
    fr: "Bouton cadeau",
    es: "Botón de regalo"
  },
  "Profitez de votre journée": {
    en: "Enjoy your day",
    fr: "Profitez de votre journée",
    es: "Disfruta tu día"
  },
  "Post settings": {
    en: "Post settings",
    fr: "Paramètres de la publication",
    es: "Ajustes de publicación"
  },
  "Invitation en attente": {
    en: "Pending invitation",
    fr: "Invitation en attente",
    es: "Invitación pendiente"
  },
  "En attente d'un candidat": {
    en: "Waiting for a candidate",
    fr: "En attente d'un candidat",
    es: "Esperando un candidato"
  },
  "Voir la participante précédente": {
    en: "View previous participant",
    fr: "Voir la participante précédente",
    es: "Ver participante anterior"
  },
  "Précédent": {
    en: "Previous",
    fr: "Précédent",
    es: "Anterior"
  },
  "Page 1 /": {
    en: "Page 1 /",
    fr: "Page 1 /",
    es: "Página 1 /"
  },
  "participantes)": {
    en: "participants)",
    fr: "participantes)",
    es: "participantes)"
  },
  "Voir la participante suivante": {
    en: "View next participant",
    fr: "Voir la participante suivante",
    es: "Ver siguiente participante"
  },
  "Accepter invitation": {
    en: "Accept invitation",
    fr: "Accepter l'invitation",
    es: "Aceptar invitación"
  },
  "Play/Pause": {
    en: "Play/Pause",
    fr: "Lecture/Pause",
    es: "Reproducir/Pausar"
  },
  "Diffusion Premium": {
    en: "Premium Broadcast",
    fr: "Diffusion Premium",
    es: "Transmisión Premium"
  },
  "Accédez au flux vidéo en direct de": {
    en: "Access the live video stream of",
    fr: "Accédez au flux vidéo en direct de",
    es: "Accede a la transmisión en vivo de"
  },
  "Play video": {
    en: "Play video",
    fr: "Lire la vidéo",
    es: "Reproducir video"
  },
  "Video progress": {
    en: "Video progress",
    fr: "Progression de la vidéo",
    es: "Progreso del video"
  },
  "Download video with watermark": {
    en: "Download video with watermark",
    fr: "Télécharger la vidéo avec filigrane",
    es: "Descargar video con marca de agua"
  },
  "Download with watermark": {
    en: "Download with watermark",
    fr: "Télécharger avec filigrane",
    es: "Descargar con marca de agua"
  },
  "Post attachment 1": {
    en: "Post attachment 1",
    fr: "Pièce jointe 1",
    es: "Adjunto de publicación 1"
  },
  "Post attachment 2": {
    en: "Post attachment 2",
    fr: "Pièce jointe 2",
    es: "Adjunto de publicación 2"
  },
  "Post attachment 3": {
    en: "Post attachment 3",
    fr: "Pièce jointe 3",
    es: "Adjunto de publicación 3"
  },
  "Post attachment 4": {
    en: "Post attachment 4",
    fr: "Pièce jointe 4",
    es: "Adjunto de publicación 4"
  },
  "Post attachment": {
    en: "Post attachment",
    fr: "Pièce jointe de publication",
    es: "Adjunto de publicación"
  },
  "Trade (": {
    en: "Trade (",
    fr: "Échange (",
    es: "Intercambio ("
  },
  "Bookmark post": {
    en: "Bookmark post",
    fr: "Enregistrer la publication",
    es: "Guardar publicación"
  },
  "Enregistrer une note vocale": {
    en: "Record a voice note",
    fr: "Enregistrer une note vocale",
    es: "Grabar una nota de voz"
  },
  "Ajouter un emoji": {
    en: "Add emoji",
    fr: "Ajouter un emoji",
    es: "Añadir emoji"
  },
  "Écrire un commentaire...": {
    en: "Write a comment...",
    fr: "Écrire un commentaire...",
    es: "Escribir un comentario..."
  },
  "Envoyer la note vocale": {
    en: "Send voice note",
    fr: "Envoyer la note vocale",
    es: "Enviar nota de voz"
  },
  "Retour au feed": {
    en: "Back to feed",
    fr: "Retour au fil d'actualité",
    es: "Volver al feed"
  },
  "Choisir la devise P2P": {
    en: "Choose P2P currency",
    fr: "Choisir la devise P2P",
    es: "Elegir moneda P2P"
  },
  "Ouvrir le menu P2P": {
    en: "Open P2P menu",
    fr: "Ouvrir le menu P2P",
    es: "Abrir menú P2P"
  },
  "Creer une annonce": {
    en: "Create ad",
    fr: "Créer une annonce",
    es: "Crear anuncio"
  },
  "Mes ordres": {
    en: "My orders",
    fr: "Mes ordres",
    es: "Mis órdenes"
  },
  "Mes annonces": {
    en: "My ads",
    fr: "Mes annonces",
    es: "Mis anuncios"
  },
  "Choisissez votre devise locale puis entrez vous-meme votre taux pour 1": {
    en: "Choose your local currency then enter your rate for 1",
    fr: "Choisissez votre devise locale puis entrez vous-même votre taux pour 1",
    es: "Elige tu moneda local e introduce tu tasa para 1"
  },
  "Fermer le panneau Creer une annonce": {
    en: "Close Create Ad panel",
    fr: "Fermer le panneau Créer une annonce",
    es: "Cerrar panel Crear Anuncio"
  },
  "Compte de retrait disponible": {
    en: "Withdrawal account balance",
    fr: "Compte de retrait disponible",
    es: "Saldo de la cuenta de retiro"
  },
  "Devise du pays": {
    en: "Country currency",
    fr: "Devise du pays",
    es: "Moneda del país"
  },
  "Taux de change (1 USD = ?": {
    en: "Exchange rate (1 USD = ?",
    fr: "Taux de change (1 USD = ?",
    es: "Tipo de cambio (1 USD = ?"
  },
  "ex: 133": {
    en: "ex: 133",
    fr: "ex : 133",
    es: "ej: 133"
  },
  "Saisissez le taux de votre devise locale pour 1 USD.": {
    en: "Enter your local currency rate for 1 USD.",
    fr: "Saisissez le taux de votre devise locale pour 1 USD.",
    es: "Introduce la tasa de tu moneda local por 1 USD."
  },
  "1 Token vaudra": {
    en: "1 Token will be worth",
    fr: "1 Token vaudra",
    es: "1 Token valdrá"
  },
  "Prix 1": {
    en: "Price 1",
    fr: "Prix 1",
    es: "Precio 1"
  },
  "Auto rempli depuis votre compte de retrait en temps reel et non modifiable.": {
    en: "Auto-filled from your withdrawal account in real time and non-editable.",
    fr: "Rempli automatiquement depuis votre compte de retrait en temps réel et non modifiable.",
    es: "Autocompletado desde tu cuenta de retiro en tiempo real y no editable."
  },
  "Max / ordre (": {
    en: "Max / order (",
    fr: "Max / ordre (",
    es: "Máx / orden ("
  },
  "Le maximum reste inclus dans le total disponible. Equivalent:": {
    en: "The maximum is included in the total available. Equivalent:",
    fr: "Le maximum reste inclus dans le total disponible. Équivalent :",
    es: "El máximo está incluido en el total disponible. Equivalente:"
  },
  "Min / ordre (": {
    en: "Min / order (",
    fr: "Min / ordre (",
    es: "Mín / orden ("
  },
  "Equivalent:": {
    en: "Equivalent:",
    fr: "Équivalent :",
    es: "Equivalente:"
  },
  "Moyen de paiement": {
    en: "Payment method",
    fr: "Moyen de paiement",
    es: "Método de pago"
  },
  "Ajoutez vous-meme le mode de paiement que vous acceptez.": {
    en: "Add the payment method you accept.",
    fr: "Ajoutez vous-même le mode de paiement que vous acceptez.",
    es: "Añade tú mismo el método de pago que aceptas."
  },
  "Nom du titulaire": {
    en: "Holder name",
    fr: "Nom du titulaire",
    es: "Nombre del titular"
  },
  "Nom du compte de reception": {
    en: "Receiving account name",
    fr: "Nom du compte de réception",
    es: "Nombre de la cuenta receptora"
  },
  "Nom de la personne ou du compte qui doit recevoir l argent.": {
    en: "Name of the person or account that should receive the money.",
    fr: "Nom de la personne ou du compte qui doit recevoir l'argent.",
    es: "Nombre de la persona o cuenta que debe recibir el dinero."
  },
  "Numero du compte": {
    en: "Account number",
    fr: "Numéro de compte",
    es: "Número de cuenta"
  },
  "Numero du compte / wallet / telephone": {
    en: "Account / wallet / phone number",
    fr: "Numéro de compte / portefeuille / téléphone",
    es: "Número de cuenta / billetera / teléfono"
  },
  "Numero du compte, wallet ou telephone ou vous voulez recevoir l argent.": {
    en: "Account, wallet or phone number where you want to receive the money.",
    fr: "Numéro de compte, portefeuille ou téléphone où vous souhaitez recevoir l'argent.",
    es: "Número de cuenta, billetera o teléfono donde quieres recibir el dinero."
  },
  "Verification du nom du payeur, preuve requise, aucun paiement tiers.": {
    en: "Payer name verification, proof required, no third-party payments.",
    fr: "Vérification du nom du payeur, preuve requise, aucun paiement tiers.",
    es: "Verificación del nombre del pagador, se requiere prueba, no se permiten pagos de terceros."
  },
  "Note :": {
    en: "Note:",
    fr: "Note :",
    es: "Nota:"
  },
  "les annonces": {
    en: "ads",
    fr: "les annonces",
    es: "los anuncios"
  },
  "bloquent les fonds depuis votre": {
    en: "lock funds from your",
    fr: "bloquent les fonds depuis votre",
    es: "bloquean los fondos de tu"
  },
  "compte de retrait": {
    en: "withdrawal account",
    fr: "compte de retrait",
    es: "cuenta de retiro"
  },
  ", puis les credits arrivent sur le": {
    en: ", then credits arrive in the",
    fr: ", puis les crédits arrivent sur le",
    es: ", luego los créditos llegan a la"
  },
  "compte de depot": {
    en: "deposit account",
    fr: "compte de dépôt",
    es: "cuenta de depósito"
  },
  "Aucune annonce disponible pour le moment.": {
    en: "No ads available at the moment.",
    fr: "Aucune annonce disponible pour le moment.",
    es: "No hay anuncios disponibles en este momento."
  },
  "Trade(s)": {
    en: "Trade(s)",
    fr: "Échange(s)",
    es: "Transacciones"
  },
  "(Taux : 1 USD =": {
    en: "(Rate: 1 USD =",
    fr: "(Taux : 1 USD =",
    es: "(Tasa: 1 USD ="
  },
  "Conditions :": {
    en: "Conditions:",
    fr: "Conditions :",
    es: "Condiciones:"
  },
  "Confirmer l ordre P2P": {
    en: "Confirm P2P order",
    fr: "Confirmer l'ordre P2P",
    es: "Confirmar orden P2P"
  },
  "Choisissez le montant de votre ordre.": {
    en: "Choose the amount for your order.",
    fr: "Choisissez le montant de votre ordre.",
    es: "Elige el monto de tu orden."
  },
  "Fermer le modal ordre P2P": {
    en: "Close P2P order modal",
    fr: "Fermer le modal d'ordre P2P",
    es: "Cerrar modal de orden P2P"
  },
  "Montant USDT": {
    en: "USDT Amount",
    fr: "Montant USDT",
    es: "Monto USDT"
  },
  "Total estime": {
    en: "Estimated total",
    fr: "Total estimé",
    es: "Total estimado"
  },
  "Confirmer le paiement": {
    en: "Confirm payment",
    fr: "Confirmer le paiement",
    es: "Confirmar pago"
  },
  "Ajoutez une note ou une reference avant d avertir le vendeur.": {
    en: "Add a note or reference before notifying the seller.",
    fr: "Ajoutez une note ou une référence avant d'avertir le vendeur.",
    es: "Añade una nota o referencia antes de notificar al vendedor."
  },
  "Fermer le modal de paiement P2P": {
    en: "Close P2P payment modal",
    fr: "Fermer le modal de paiement P2P",
    es: "Cerrar modal de pago P2P"
  },
  "Note de paiement": {
    en: "Payment note",
    fr: "Note de paiement",
    es: "Nota de pago"
  },
  "Reference du transfert, heure du paiement, nom du compte expediteur...": {
    en: "Transfer reference, payment time, sender account name...",
    fr: "Référence du transfert, heure du paiement, nom du compte expéditeur...",
    es: "Referencia de transferencia, hora de pago, nombre de cuenta del remitente..."
  },
  "J ai paye": {
    en: "I have paid",
    fr: "J'ai payé",
    es: "He pagado"
  },
  "Liberer les fonds": {
    en: "Release funds",
    fr: "Libérer les fonds",
    es: "Liberar fondos"
  },
  "Confirmez uniquement si vous avez bien recu le paiement du client.": {
    en: "Confirm only if you have received the customer's payment.",
    fr: "Confirmez uniquement si vous avez bien reçu le paiement du client.",
    es: "Confirma solo si has recibido el pago del cliente."
  },
  "Fermer le modal de liberation P2P": {
    en: "Close P2P release modal",
    fr: "Fermer le modal de libération P2P",
    es: "Cerrar modal de liberación P2P"
  },
  "Attention :": {
    en: "Warning:",
    fr: "Attention :",
    es: "Atención:"
  },
  "Fermer l'annonce": {
    en: "Close ad",
    fr: "Fermer l'annonce",
    es: "Cerrar anuncio"
  },
  "Le solde restant en escrow vous sera restitue.": {
    en: "The remaining escrow balance will be returned to you.",
    fr: "Le solde restant en escrow vous sera restitué.",
    es: "El saldo restante en custodia le será devuelto."
  },
  "Confirmation requise :": {
    en: "Confirmation required:",
    fr: "Confirmation requise :",
    es: "Confirmación requerida:"
  },
  "Annuler l'ordre": {
    en: "Cancel order",
    fr: "Annuler l'ordre",
    es: "Cancelar orden"
  },
  "Precisez un motif si vous le souhaitez.": {
    en: "Specify a reason if you wish.",
    fr: "Précisez un motif si vous le souhaitez.",
    es: "Especifica un motivo si lo deseas."
  },
  "Motif d'annulation": {
    en: "Cancellation reason",
    fr: "Motif d'annulation",
    es: "Motivo de cancelación"
  },
  "(optionnel)": {
    en: "(optional)",
    fr: "(optionnel)",
    es: "(opcional)"
  },
  "Expliquez brievement pourquoi vous annulez cet ordre...": {
    en: "Explain briefly why you cancel this order...",
    fr: "Expliquez brièvement pourquoi vous annulez cet ordre...",
    es: "Explica brevemente por qué cancelas esta orden..."
  },
  "Ouvrir un litige": {
    en: "Open dispute",
    fr: "Ouvrir un litige",
    es: "Abrir disputa"
  },
  "Decrivez le probleme pour que notre equipe puisse intervenir.": {
    en: "Describe the problem so our team can intervene.",
    fr: "Décrivez le problème pour que notre équipe puisse intervenir.",
    es: "Describe el problema para que nuestro equipo pueda intervenir."
  },
  "Description du probleme": {
    en: "Problem description",
    fr: "Description du problème",
    es: "Descripción del problema"
  },
  "(obligatoire)": {
    en: "(required)",
    fr: "(obligatoire)",
    es: "(obligatorio)"
  },
  "Ex : le vendeur ne repond plus, le paiement n a pas ete recu apres 24h...": {
    en: "Ex: the seller is not responding, payment not received after 24h...",
    fr: "Ex : le vendeur ne répond plus, le paiement n'a pas été reçu après 24h...",
    es: "Ej: el vendedor no responde, el pago no se recibió después de 24h..."
  },
  "Retour au marche P2P": {
    en: "Back to P2P market",
    fr: "Retour au marché P2P",
    es: "Volver al mercado P2P"
  },
  "Ouvrez un ordre pour voir son chat et toutes ses actions dans une page dediee.": {
    en: "Open an order to see its chat and actions on a dedicated page.",
    fr: "Ouvrez un ordre pour voir son chat et toutes ses actions sur une page dédiée.",
    es: "Abre una orden para ver su chat y acciones en una página dedicada."
  },
  "Vous n avez encore aucun ordre P2P.": {
    en: "You don't have any P2P orders yet.",
    fr: "Vous n'avez encore aucun ordre P2P.",
    es: "Aún no tienes ninguna orden P2P."
  },
  "Vous etes": {
    en: "You are",
    fr: "Vous êtes",
    es: "Eres"
  },
  "Valeur totale": {
    en: "Total value",
    fr: "Valeur totale",
    es: "Valor total"
  },
  "Reception :": {
    en: "Receiving:",
    fr: "Réception :",
    es: "Recepción:"
  },
  "Retour aux ordres P2P": {
    en: "Back to P2P orders",
    fr: "Retour aux ordres P2P",
    es: "Volver a órdenes P2P"
  },
  "Ordre P2P": {
    en: "P2P Order",
    fr: "Ordre P2P",
    es: "Orden P2P"
  },
  "Discutez avec votre contrepartie et gerez cet ordre ici.": {
    en: "Chat with your counterparty and manage this order here.",
    fr: "Discutez avec votre contrepartie et gérez cet ordre ici.",
    es: "Chatea con tu contraparte y gestiona esta orden aquí."
  },
  "Ordre #0": {
    en: "Order #0",
    fr: "Ordre #0",
    es: "Orden #0"
  },
  "Avec -": {
    en: "With -",
    fr: "Avec -",
    es: "Con -"
  },
  "Envoyez texte ou preuve image.": {
    en: "Send text or image proof.",
    fr: "Envoyez du texte ou une preuve image.",
    es: "Envía texto o comprobante de imagen."
  },
  "Aucun message pour le moment.": {
    en: "No messages yet.",
    fr: "Aucun message pour le moment.",
    es: "Aún no hay mensajes."
  },
  "Ecrivez votre message...": {
    en: "Write your message...",
    fr: "Écrivez votre message...",
    es: "Escribe tu mensaje..."
  },
  "Aucune image": {
    en: "No image",
    fr: "Aucune image",
    es: "Ninguna imagen"
  },
  "Fermez une annonce pour recuperer le reste de son escrow si c est une annonce sell.": {
    en: "Close an ad to recover the rest of its escrow if it is a sell ad.",
    fr: "Fermez une annonce pour récupérer le reste de son escrow s'il s'agit d'une annonce sell.",
    es: "Cierra un anuncio para recuperar el resto de su depósito si es un anuncio de venta."
  },
  "Fermer le panneau Mes annonces": {
    en: "Close My Ads panel",
    fr: "Fermer le panneau Mes annonces",
    es: "Cerrar panel Mis Anuncios"
  },
  "Escrow total gele :": {
    en: "Total frozen escrow:",
    fr: "Escrow total gelé :",
    es: "Garantía total congelada:"
  },
  "Vous n avez encore publie aucune annonce P2P.": {
    en: "You haven't published any P2P ads yet.",
    fr: "Vous n'avez encore publié aucune annonce P2P.",
    es: "Aún no has publicado ningún anuncio P2P."
  },
  "Statut :": {
    en: "Status:",
    fr: "Statut :",
    es: "Estado:"
  },
  "Aucun moyen precise": {
    en: "No method specified",
    fr: "Aucun moyen précisé",
    es: "Ningún método especificado"
  },
  "Fermer l annonce": {
    en: "Close ad",
    fr: "Fermer l'annonce",
    es: "Cerrar anuncio"
  },
  "Back to Feed": {
    en: "Back to Feed",
    fr: "Retour à l'accueil",
    es: "Volver al inicio"
  },
  "Music Track Short": {
    en: "Music Track Short",
    fr: "Piste de musique Short",
    es: "Pista musical de Short"
  },
  "Comments (": {
    en: "Comments (",
    fr: "Commentaires (",
    es: "Comentarios ("
  },
  "Annuler la reponse": {
    en: "Cancel reply",
    fr: "Annuler la réponse",
    es: "Cancelar respuesta"
  },
  "Add comment...": {
    en: "Add comment...",
    fr: "Ajouter un commentaire...",
    es: "Añadir comentario..."
  },
  "Choisir un jeu / Créer": {
    en: "Choose a Game / Create",
    fr: "Choisir un jeu / Créer",
    es: "Elegir un juego / Crear"
  },
  "Parties en cours": {
    en: "Active games",
    fr: "Parties en cours",
    es: "Partidas en curso"
  },
  "Puissance 4": {
    en: "Connect 4",
    fr: "Puissance 4",
    es: "Conecta 4"
  },
  "Football Table": {
    en: "Table Football",
    fr: "Baby-foot",
    es: "Futbolín"
  },
  "Robot AI": {
    en: "AI Robot",
    fr: "Robot IA",
    es: "Robot IA"
  },
  "Autre Joueur": {
    en: "Other Player",
    fr: "Autre Joueur",
    es: "Otro Jugador"
  },
  "Type de Partie": {
    en: "Game Type",
    fr: "Type de partie",
    es: "Tipo de partida"
  },
  "Partie Gratuite": {
    en: "Free Game",
    fr: "Partie gratuite",
    es: "Partida gratuita"
  },
  "Pari d'argent": {
    en: "Money wager",
    fr: "Pari d'argent",
    es: "Apuesta de dinero"
  },
  "Choisissez votre Robot Adversaire": {
    en: "Choose your Robot Opponent",
    fr: "Choisissez votre robot adversaire",
    es: "Elige tu robot oponente"
  },
  "Rechercher un adversaire": {
    en: "Search opponent",
    fr: "Rechercher un adversaire",
    es: "Buscar oponente"
  },
  "Saisissez un nom d'utilisateur...": {
    en: "Enter a username...",
    fr: "Saisissez un nom d'utilisateur...",
    es: "Introduce un nombre de usuario..."
  },
  "Mise des deux joueurs (Chacun) ($)": {
    en: "Wager of both players (Each) ($)",
    fr: "Mise des deux joueurs (Chacun) ($)",
    es: "Apuesta de ambos jugadores (Cada uno) ($)"
  },
  "Nombre de parties (impair, max 7)": {
    en: "Number of rounds (odd, max 7)",
    fr: "Nombre de parties (impair, max 7)",
    es: "Número de rondas (impar, máx 7)"
  },
  "1 partie (Unique)": {
    en: "1 round (Single)",
    fr: "1 partie (Unique)",
    es: "1 ronda (Única)"
  },
  "3 parties": {
    en: "3 rounds",
    fr: "3 parties",
    es: "3 rondas"
  },
  "5 parties": {
    en: "5 rounds",
    fr: "5 parties",
    es: "5 rondas"
  },
  "7 parties": {
    en: "7 rounds",
    fr: "7 parties",
    es: "7 rondas"
  },
  "Spectateurs (Live de la partie)": {
    en: "Spectators (Game Live)",
    fr: "Spectateurs (Live de la partie)",
    es: "Espectadores (Vivo de la partida)"
  },
  "Prix d'accès au Live ($)": {
    en: "Live Access Price ($)",
    fr: "Prix d'accès au Live ($)",
    es: "Precio de acceso al Vivo ($)"
  },
  "Créer la partie": {
    en: "Create game",
    fr: "Créer la partie",
    es: "Crear partida"
  },
  "Aucune partie disponible pour le moment. Créez-en une pour attendre un adversaire !": {
    en: "No games available at the moment. Create one to wait for an opponent!",
    fr: "Aucune partie disponible pour le moment. Créez-en une pour attendre un adversaire !",
    es: "No hay partidas disponibles en este momento. ¡Crea una para esperar a un oponente!"
  },
  "Aucun live en cours. Jouez contre un robot ou un autre joueur pour lancer le direct !": {
    en: "No live stream in progress. Play against a robot or another player to start the stream!",
    fr: "Aucun live en cours. Jouez contre un robot ou un autre joueur pour lancer le direct !",
    es: "No hay transmisiones en vivo. ¡Juega contra un robot o contra otro jugador para iniciar el vivo!"
  },
  "Quitter la partie": {
    en: "Leave game",
    fr: "Quitter la partie",
    es: "Salir de la partida"
  },
  "Partie en cours": {
    en: "Game in progress",
    fr: "Partie en cours",
    es: "Partida en curso"
  },
  "Mode Gratuit": {
    en: "Free Mode",
    fr: "Mode gratuit",
    es: "Modo gratuito"
  },
  "0 Spectateur": {
    en: "0 Spectators",
    fr: "0 spectateur",
    es: "0 Espectadores"
  },
  "Player 1": {
    en: "Player 1",
    fr: "Joueur 1",
    es: "Jugador 1"
  },
  "Joueur 1": {
    en: "Player 1",
    fr: "Joueur 1",
    es: "Jugador 1"
  },
  "Pions Noirs (X)": {
    en: "Black Checkers (X)",
    fr: "Pions noirs (X)",
    es: "Fichas negras (X)"
  },
  "Player 2": {
    en: "Player 2",
    fr: "Joueur 2",
    es: "Jugador 2"
  },
  "Pions Blancs (O)": {
    en: "White Checkers (O)",
    fr: "Pions blancs (O)",
    es: "Fichas blancas (O)"
  },
  "Pioche : 14": {
    en: "Draw pile: 14",
    fr: "Pioche : 14",
    es: "Pila para robar: 14"
  },
  "Piger une tuile": {
    en: "Draw a tile",
    fr: "Piger une tuile",
    es: "Robar una ficha"
  },
  "Votre main": {
    en: "Your hand",
    fr: "Votre main",
    es: "Tu mano"
  },
  "Placer colonne": {
    en: "Place column",
    fr: "Placer colonne",
    es: "Colocar columna"
  },
  "Phase d'attaque": {
    en: "Attack phase",
    fr: "Phase d'attaque",
    es: "Fase de ataque"
  },
  "Choisissez un couloir pour tirer.": {
    en: "Choose a lane to shoot.",
    fr: "Choisissez un couloir pour tirer.",
    es: "Elige un carril para disparar."
  },
  "Confirmer l'action": {
    en: "Confirm action",
    fr: "Confirmer l'action",
    es: "Confirmar acción"
  },
  "Chat de la partie": {
    en: "Game chat",
    fr: "Chat de la partie",
    es: "Chat de la partida"
  },
  "Le chat est ouvert ! Envoyez des encouragements en direct.": {
    en: "Chat is open! Send live cheers.",
    fr: "Le chat est ouvert ! Envoyez des encouragements en direct.",
    es: "¡El chat está abierto! Envía ánimos en vivo."
  },
  "Tapez un message...": {
    en: "Type a message...",
    fr: "Tapez un message...",
    es: "Escribe un mensaje..."
  },
  "Liste des personnes regardant le live": {
    en: "List of people watching the live stream",
    fr: "Liste des personnes regardant le direct",
    es: "Lista de personas que ven el vivo"
  },
  "Aucun spectateur pour le moment.": {
    en: "No spectators yet.",
    fr: "Aucun spectateur pour le moment",
    es: "Sin espectadores por el momento."
  },
  "Search messages": {
    en: "Search messages",
    fr: "Rechercher des messages",
    es: "Buscar mensajes"
  },
  "Filter messages": {
    en: "Filter messages",
    fr: "Filtrer les messages",
    es: "Filtrar mensajes"
  },
  "Close status modal": {
    en: "Close status modal",
    fr: "Fermer le modal de statut",
    es: "Cerrar modal de estado"
  },
  "Write status...": {
    en: "Write status...",
    fr: "Écrire un statut...",
    es: "Escribir estado..."
  },
  "Stays active for 24h": {
    en: "Stays active for 24h",
    fr: "Visible pendant 24h",
    es: "Permanece activo por 24h"
  },
  "Close short modal": {
    en: "Close short modal",
    fr: "Fermer le modal de short",
    es: "Cerrar modal de short"
  },
  "Creer un Short": {
    en: "Create Short",
    fr: "Créer un Short",
    es: "Crear Short"
  },
  "Affichage du media": {
    en: "Media display",
    fr: "Affichage du média",
    es: "Visualización de medios"
  },
  "Le choix sera garde pour ce short.": {
    en: "The choice will be kept for this short.",
    fr: "Le choix sera gardé pour ce short.",
    es: "La elección se mantendrá para este short."
  },
  "Remplit tout l'ecran": {
    en: "Fills entire screen",
    fr: "Remplit tout l'écran",
    es: "Llena toda la pantalla"
  },
  "Format initial": {
    en: "Format initial",
    fr: "Format initial",
    es: "Formato inicial"
  },
  "Pas de recadrage": {
    en: "No cropping",
    fr: "Pas de recadrage",
    es: "Sin recorte"
  },
  "Activer l'option Trade Short": {
    en: "Enable Trade Short option",
    fr: "Activer l'option Trade Short",
    es: "Activar opción de Trade Short"
  },
  "Option Trade Short active": {
    en: "Trade Short option active",
    fr: "Option Trade Short active",
    es: "Opción Trade Short activa"
  },
  "5 tokens": {
    en: "5 tokens",
    fr: "5 tokens",
    es: "5 tokens"
  },
  "Solde disponible :": {
    en: "Available balance:",
    fr: "Solde disponible :",
    es: "Saldo disponible:"
  },
  "Cout requis :": {
    en: "Required cost:",
    fr: "Coût requis :",
    es: "Costo requerido:"
  },
  "Solde insuffisant pour activer Trade Short.": {
    en: "Insufficient balance to activate Trade Short.",
    fr: "Solde insuffisant pour activer Trade Short.",
    es: "Saldo insuficiente para activar Trade Short."
  },
  "Choose file": {
    en: "Choose file",
    fr: "Choisir le fichier",
    es: "Elegir archivo"
  },
  "No file chosen": {
    en: "No file chosen",
    fr: "Aucun fichier choisi",
    es: "Ningún archivo seleccionado"
  },
  "Preview Trimmed Video": {
    en: "Preview Trimmed Video",
    fr: "Prévisualiser la vidéo coupée",
    es: "Previsualizar video recortado"
  },
  "Choose image": {
    en: "Choose image",
    fr: "Choisir l'image",
    es: "Elegir imagen"
  },
  "No image chosen": {
    en: "No image chosen",
    fr: "Aucune image choisie",
    es: "Ninguna imagen seleccionada"
  },
  "Choose audio": {
    en: "Choose audio",
    fr: "Choisir l'audio",
    es: "Elegir audio"
  },
  "No audio chosen": {
    en: "No audio chosen",
    fr: "Aucun audio choisi",
    es: "Ningún audio seleccionado"
  },
  "Preview Trimmed Audio": {
    en: "Preview Trimmed Audio",
    fr: "Prévisualiser l'audio coupé",
    es: "Previsualizar audio recortado"
  },
  "Sound Track Name": {
    en: "Sound Track Name",
    fr: "Nom de la piste sonore",
    es: "Nombre de pista de sonido"
  },
  "Original Sound": {
    en: "Original Sound",
    fr: "Son original",
    es: "Sonido original"
  },
  "Caption / Description": {
    en: "Caption / Description",
    fr: "Légende / Description",
    es: "Texto / Descripción"
  },
  "Write something about your short...": {
    en: "Write something about your short...",
    fr: "Écrivez quelque chose sur votre short...",
    es: "Escribe algo sobre tu short..."
  },
  "Upload Short": {
    en: "Upload Short",
    fr: "Publier le Short",
    es: "Subir Short"
  },
  "Close status viewer": {
    en: "Close status viewer",
    fr: "Fermer le lecteur de statut",
    es: "Cerrar visor de estado"
  },
  "Toggle Audio": {
    en: "Toggle Audio",
    fr: "Activer/Désactiver l'audio",
    es: "Activar/Desactivar audio"
  },
  "Choisissez un cadeau ou entrez votre montant.": {
    en: "Choose a gift or enter your amount.",
    fr: "Choisissez un cadeau ou entrez votre montant.",
    es: "Elige un regalo o introduce tu monto."
  },
  "Montant personnalise": {
    en: "Custom amount",
    fr: "Montant personnalisé",
    es: "Monto personalizado"
  },
  "Entrez un montant": {
    en: "Enter an amount",
    fr: "Entrez un montant",
    es: "Introduce un monto"
  },
  "Cadeau selectionne": {
    en: "Selected gift",
    fr: "Cadeau sélectionné",
    es: "Regalo seleccionado"
  },
  "Envoyer le cadeau": {
    en: "Send gift",
    fr: "Envoyer le cadeau",
    es: "Enviar regalo"
  },
  "Auteur de la publication": {
    en: "Post author",
    fr: "Auteur de la publication",
    es: "Autor de la publication"
  },
  "Personnes suivies": {
    en: "Following",
    fr: "Personnes suivies",
    es: "Siguiendo"
  },
  "Aucune personne suivie pour le moment.": {
    en: "Not following anyone yet.",
    fr: "Aucune personne suivie pour le moment.",
    es: "No sigues a nadie todavía."
  },
  "Réseaux sociaux": {
    en: "Social media",
    fr: "Réseaux sociaux",
    es: "Redes sociales"
  },
  "Partager le Short": {
    en: "Share Short",
    fr: "Partager le Short",
    es: "Compartir Short"
  },
  "Partager avec des amis": {
    en: "Share with friends",
    fr: "Partager avec des amis",
    es: "Compartir con amigos"
  },
  "Partager sur les réseaux": {
    en: "Share on social media",
    fr: "Partager sur les réseaux",
    es: "Compartir en redes"
  },
  "Enregistrer la vidéo": {
    en: "Save video",
    fr: "Enregistrer la vidéo",
    es: "Guardar video"
  },
  "Préparation du téléchargement": {
    en: "Preparing download",
    fr: "Préparation du téléchargement",
    es: "Preparando descarga"
  },
  "Ajout du filigrane WeShare...": {
    en: "Adding WeShare watermark...",
    fr: "Ajout du filigrane WeShare...",
    es: "Añadiendo marca de agua de WeShare..."
  },
  "WeShare - Login": {
    en: "WeShare - Login",
    fr: "WeShare - Connexion",
    es: "WeShare - Iniciar sesión"
  },
  "Social dashboard": {
    en: "Social dashboard",
    fr: "Tableau de bord social",
    es: "Panel social"
  },
  "Log in to your Account": {
    en: "Log in to your Account",
    fr: "Connectez-vous à votre compte",
    es: "Inicia sesión en tu cuenta"
  },
  "Welcome back! Select method to log in:": {
    en: "Welcome back! Select method to log in:",
    fr: "Bon retour ! Choisissez votre méthode de connexion :",
    es: "¡Bienvenido de nuevo! Selecciona el método para iniciar sesión:"
  },
  "Open a dispute with the admin": {
    en: "Open a dispute with the admin",
    fr: "Ouvrir un litige avec l'administrateur",
    es: "Abrir una disputa con el administrador"
  },
  "Télécharger Android": {
    en: "Download Android",
    fr: "Télécharger pour Android",
    es: "Descargar Android"
  },
  "Télécharger iPhone": {
    en: "Download iPhone",
    fr: "Télécharger pour iPhone",
    es: "Descargar iPhone"
  },
  "or continue with email": {
    en: "or continue with email",
    fr: "ou continuer avec l'e-mail",
    es: "o continuar con correo electrónico"
  },
  "Remember me": {
    en: "Remember me",
    fr: "Se souvenir de moi",
    es: "Recordarme"
  },
  "Forgot Password?": {
    en: "Forgot Password?",
    fr: "Mot de passe oublié ?",
    es: "¿Olvidaste tu contraseña?"
  },
  "Log in": {
    en: "Log in",
    fr: "Se connecter",
    es: "Iniciar sesión"
  },
  "Don’t have an account?": {
    en: "Don't have an account?",
    fr: "Vous n'avez pas de compte ?",
    es: "¿No tienes una cuenta?"
  },
  "Create an account": {
    en: "Create an account",
    fr: "Créer un compte",
    es: "Crear una cuenta"
  },
  "Connect with every application.": {
    en: "Connect with every application.",
    fr: "Connectez-vous à toutes les applications.",
    es: "Conéctate con cada aplicación."
  },
  "Everything you need in an easily customizable dashboard.": {
    en: "Everything you need in an easily customizable dashboard.",
    fr: "Tout ce dont vous avez besoin dans un tableau de bord facilement personnalisable.",
    es: "Todo lo que necesitas en un panel fácilmente personalizable."
  },
  "WeShare - Premium Social Dashboard": {
    en: "WeShare - Premium Social Dashboard",
    fr: "WeShare - Tableau de bord social premium",
    es: "WeShare - Panel social premium"
  },
  "Platform &copy; 2026": {
    en: "Platform &copy; 2026",
    fr: "Plateforme &copy; 2026",
    es: "Plataforma &copy; 2026"
  },
  "Close compose message modal": {
    en: "Close compose message modal",
    fr: "Fermer la boîte de message",
    es: "Cerrar modal de redactar mensaje"
  },
  "Search people to message": {
    en: "Search people to message",
    fr: "Rechercher des personnes à qui écrire",
    es: "Buscar personas para enviar mensaje"
  },
  "Ex. Découvrez nos nouveaux designs": {
    en: "Ex. Discover our new designs",
    fr: "Ex. Découvrez nos nouveaux designs",
    es: "Ej. Descubre nuestros nuevos diseños"
  },
  "Ex. Une courte description accrocheuse qui invite au clic...": {
    en: "Ex. A short catchy description that invites clicks...",
    fr: "Ex. Une courte description accrocheuse qui invite au clic...",
    es: "Ej. Una descripción corta y atractiva que invite a hacer clic..."
  },
  "Aperçu": {
    en: "Preview",
    fr: "Aperçu",
    es: "Vista previa"
  },
  "Envoyer des notifications à tous (+1.00 $)": {
    en: "Send notifications to everyone (+$1.00)",
    fr: "Envoyer des notifications à tous (+1.00 $)",
    es: "Enviar notificaciones a todos (+$1.00)"
  },
  "Afficher dans le flux de posts (+1.00 $)": {
    en: "Display in the post feed (+$1.00)",
    fr: "Afficher dans le flux de posts (+1.00 $)",
    es: "Mostrar en el feed de publicaciones (+$1.00)"
  },
  "Tarif unitaire :": {
    en: "Unit price:",
    fr: "Tarif unitaire :",
    es: "Tarifa unitaria:"
  },
  "$5.00 / 24h": {
    en: "$5.00 / 24h",
    fr: "5.00 $ / 24h",
    es: "$5.00 / 24h"
  },
  "Votre solde de dépôt :": {
    en: "Your deposit balance:",
    fr: "Votre solde de dépôt :",
    es: "Tu saldo de depósito:"
  },
  "Total à payer :": {
    en: "Total to pay:",
    fr: "Total à payer :",
    es: "Total a pagar:"
  },
  "Change Banner Theme": {
    en: "Change Banner Theme",
    fr: "Changer le thème de la bannière",
    es: "Cambiar tema del banner"
  },
  "Change Avatar": {
    en: "Change Avatar",
    fr: "Changer l'avatar",
    es: "Cambiar avatar"
  },
  "Votre profil de joueur": {
    en: "Your player profile",
    fr: "Votre profil de joueur",
    es: "Tu perfil de jugador"
  },
  "Live YouTube": {
    en: "YouTube Live",
    fr: "Live YouTube",
    es: "YouTube en vivo"
  },
  "Private Information": {
    en: "Private Information",
    fr: "Informations privées",
    es: "Información privada"
  },
  "Deposit Balance": {
    en: "Deposit Balance",
    fr: "Solde de dépôt",
    es: "Saldo de depósito"
  },
  "Withdrawal Balance": {
    en: "Withdrawal Balance",
    fr: "Solde de retrait",
    es: "Saldo de retiro"
  },
  "Bonus Balance": {
    en: "Bonus Balance",
    fr: "Solde bonus",
    es: "Saldo de bono"
  },
  "Token Balance": {
    en: "Token Balance",
    fr: "Solde de tokens",
    es: "Saldo de tokens"
  },
  ") est inférieur au montant minimum de retrait requis de": {
    en: ") is lower than the minimum required withdrawal of",
    fr: ") est inférieur au montant minimum de retrait requis de",
    es: ") es inferior al monto mínimo de retiro requerido de"
  },
  "Edit Profile Info": {
    en: "Edit Profile Info",
    fr: "Modifier les infos du profil",
    es: "Editar información del perfil"
  },
  "Save Changes": {
    en: "Save Changes",
    fr: "Enregistrer les modifications",
    es: "Guardar cambios"
  },
  "Choose Banner Theme": {
    en: "Choose Banner Theme",
    fr: "Choisir le thème de la bannière",
    es: "Elegir tema del banner"
  },
  "Apply Theme": {
    en: "Apply Theme",
    fr: "Appliquer le thème",
    es: "Aplicar tema"
  },
  "Update Avatar": {
    en: "Update Avatar",
    fr: "Mettre à jour l'avatar",
    es: "Actualizar avatar"
  },
  "Click to upload from PC": {
    en: "Click to upload from PC",
    fr: "Cliquez pour téléverser depuis le PC",
    es: "Haz clic para subir desde la PC"
  },
  "JPEG, PNG, GIF up to 5MB": {
    en: "JPEG, PNG, GIF up to 5MB",
    fr: "JPEG, PNG, GIF jusqu'à 5 Mo",
    es: "JPEG, PNG, GIF hasta 5MB"
  },
  "Save Avatar": {
    en: "Save Avatar",
    fr: "Enregistrer l'avatar",
    es: "Guardar avatar"
  },
  "Configurer Wallet BEP-20": {
    en: "Configure BEP-20 Wallet",
    fr: "Configurer le portefeuille BEP-20",
    es: "Configurar billetera BEP-20"
  },
  "Votre adresse BEP-20 (BSC)": {
    en: "Your BEP-20 (BSC) address",
    fr: "Votre adresse BEP-20 (BSC)",
    es: "Tu dirección BEP-20 (BSC)"
  },
  "Enregistrer & Continuer": {
    en: "Save & Continue",
    fr: "Enregistrer & Continuer",
    es: "Guardar y continuar"
  },
  "Déposer des USDT (BEP-20)": {
    en: "Deposit USDT (BEP-20)",
    fr: "Déposer des USDT (BEP-20)",
    es: "Depositar USDT (BEP-20)"
  },
  "QR Code": {
    en: "QR Code",
    fr: "Code QR",
    es: "Código QR"
  },
  "Adresse de la plateforme": {
    en: "Platform address",
    fr: "Adresse de la plateforme",
    es: "Dirección de la plataforma"
  },
  "uniquement des USDT (BEP-20)": {
    en: "only USDT (BEP-20)",
    fr: "uniquement des USDT (BEP-20)",
    es: "únicamente USDT (BEP-20)"
  },
  "depuis votre adresse enregistrée :": {
    en: "from your registered address:",
    fr: "depuis votre adresse enregistrée :",
    es: "desde tu dirección registrada:"
  },
  "Statut du dépôt en temps réel": {
    en: "Real-time deposit status",
    fr: "Statut du dépôt en temps réel",
    es: "Estado del depósito en tiempo real"
  },
  "Vérification KYC de Retrait": {
    en: "Withdrawal KYC Verification",
    fr: "Vérification KYC de retrait",
    es: "Verificación KYC de retiro"
  },
  "Étape 1 sur 2 : Reconnaissance visuelle. Prenez une photo de votre document d'identité et un selfie de comparaison en direct.": {
    en: "Step 1 of 2: Visual recognition. Take a photo of your identity document and a live comparison selfie.",
    fr: "Étape 1 sur 2 : Reconnaissance visuelle. Prenez une photo de votre document d'identité et un selfie de comparaison en direct.",
    es: "Paso 1 de 2: Reconocimiento visual. Toma una foto de tu documento de identidad y un selfie de comparación en vivo."
  },
  "Document d'identité (Image de votre carte d'identité ou passeport)": {
    en: "Identity document (Image of your ID card or passport)",
    fr: "Document d'identité (Image de votre carte d'identité ou passeport)",
    es: "Documento de identidad (Imagen de tu tarjeta de identidad o pasaporte)"
  },
  "Selfie en direct": {
    en: "Live selfie",
    fr: "Selfie en direct",
    es: "Selfie en vivo"
  },
  "Étape 2 sur 2 : Confirmation des informations. Les données ci-dessous doivent correspondre exactement à votre document d'identité pour que la vérification OCR automatique réussisse.": {
    en: "Step 2 of 2: Information confirmation. The data below must match your identity document exactly for automatic OCR verification to succeed.",
    fr: "Étape 2 sur 2 : Confirmation des informations. Les données ci-dessous doivent correspondre exactement à votre document d'identité pour que la vérification OCR automatique réussisse.",
    es: "Paso 2 de 2: Confirmación de información. Los datos a continuación deben coincidir exactamente con tu documento de identidad para que la verificación OCR automática tenga éxito."
  },
  "Prénom": {
    en: "First Name",
    fr: "Prénom",
    es: "Nombre"
  },
  "Date de Naissance": {
    en: "Date of Birth",
    fr: "Date de naissance",
    es: "Fecha de nacimiento"
  },
  "KYC Validé avec Succès !": {
    en: "KYC Successfully Validated!",
    fr: "KYC validé avec succès !",
    es: "¡KYC validado con éxito!"
  },
  "Félicitations ! L'IA a analysé votre document et confirmé que votre visage ainsi que vos informations (Nom, Prénom, Date de Naissance) correspondent parfaitement.": {
    en: "Congratulations! The AI analyzed your document and confirmed that your face and info (Name, First Name, Date of Birth) match perfectly.",
    fr: "Félicitations ! L'IA a analysé votre document et confirmé que votre visage ainsi que vos informations (Nom, Prénom, Date de Naissance) correspondent parfaitement.",
    es: "¡Felicitaciones! La IA analizó tu documento y confirmó que tu rostro y tus datos (Apellido, Nombre, Fecha de nacimiento) coinciden perfectamente."
  },
  "Code Secret de Retrait": {
    en: "Withdrawal Secret Code",
    fr: "Code secret de retrait",
    es: "Código secreto de retiro"
  },
  "Définir votre PIN (6 chiffres)": {
    en: "Set your PIN (6 digits)",
    fr: "Définir votre PIN (6 chiffres)",
    es: "Establecer tu PIN (6 dígitos)"
  },
  "Enregistrer le code secret": {
    en: "Save secret code",
    fr: "Enregistrer le code secret",
    es: "Guardar código secreto"
  },
  "Retrait USDT (BEP-20)": {
    en: "Withdraw USDT (BEP-20)",
    fr: "Retrait USDT (BEP-20)",
    es: "Retiro USDT (BEP-20)"
  },
  "Adresse de réception BEP-20": {
    en: "BEP-20 receiving address",
    fr: "Adresse de réception BEP-20",
    es: "Dirección de recepción BEP-20"
  },
  "Montant à retirer (USDT)": {
    en: "Amount to withdraw (USDT)",
    fr: "Montant à retirer (USDT)",
    es: "Monto a retirar (USDT)"
  },
  "Frais de retrait (30%) :": {
    en: "Withdrawal fee (30%):",
    fr: "Frais de retrait (30%) :",
    es: "Comisión de retiro (30%):"
  },
  "Montant à recevoir :": {
    en: "Amount to receive:",
    fr: "Montant à recevoir :",
    es: "Monto a recibir:"
  },
  "Code secret (6 chiffres)": {
    en: "Secret code (6 digits)",
    fr: "Code secret (6 chiffres)",
    es: "Código secreto (6 dígitos)"
  },
  "Confirmer le retrait": {
    en: "Confirm withdrawal",
    fr: "Confirmer le retrait",
    es: "Confirmar retiro"
  },
  "Demander de jouer": {
    en: "Request to play",
    fr: "Demander de jouer",
    es: "Solicitar jugar"
  },
  "WeShare - Register": {
    en: "WeShare - Register",
    fr: "WeShare - Inscription",
    es: "WeShare - Registro"
  },
  "Create your profile": {
    en: "Create your profile",
    fr: "Créez votre profil",
    es: "Crea tu perfil"
  },
  "Important:": {
    en: "Important:",
    fr: "Important :",
    es: "Importante:"
  },
  "Use real and consistent information. Incorrect data may lead to account suspension.": {
    en: "Use real and consistent information. Incorrect data may lead to account suspension.",
    fr: "utilisez des informations reelles et coherentes. Des donnees incorrectes peuvent entrainer la suspension du compte.",
    es: "Usa información real y coherente. Los datos incorrectos pueden provocar la suspensión de la cuenta."
  },
  "Create my account": {
    en: "Create my account",
    fr: "Créer mon compte",
    es: "Crear mi cuenta"
  },
  "Enter the 6-digit code sent to your email.": {
    en: "Enter the 6-digit code sent to your email.",
    fr: "Saisissez le code à 6 chiffres envoyé à votre e-mail.",
    es: "Introduce el código de 6 dígitos enviado a tu correo electrónico."
  }
};

const i18nPath = path.join(__dirname, '../utils/i18n.js');
let i18nContent = fs.readFileSync(i18nPath, 'utf8');

// 1. Clean up mistakenly injected lines in TRANSLATIONS
function escapeSingleQuotes(str) {
  return str.replace(/'/g, "\\'");
}

const enLines = [];
const frLines = [];
const esLines = [];

for (const [key, trans] of Object.entries(mappings)) {
  const escKey = escapeSingleQuotes(key);
  enLines.push(`    '${escKey}': '${escapeSingleQuotes(trans.en)}',`);
  frLines.push(`    '${escKey}': '${escapeSingleQuotes(trans.fr)}',`);
  esLines.push(`    '${escKey}': '${escapeSingleQuotes(trans.es)}',`);
}

const cleanEn = enLines.join('\n') + '\n';
const cleanFr = frLines.join('\n') + '\n';
const cleanEs = esLines.join('\n') + '\n';

// Remove the mistaken injections (we only replace the first occurrence)
i18nContent = i18nContent.replace(cleanEn, '');
i18nContent = i18nContent.replace(cleanFr, '');
i18nContent = i18nContent.replace(cleanEs, '');

// 2. Properly inject into SOURCE_TEXT_TRANSLATIONS
// We locate "const SOURCE_TEXT_TRANSLATIONS = {"
// And then search for "en: {", "fr: {", "es: {" within that block.
const sourceTextStartIndex = i18nContent.indexOf('const SOURCE_TEXT_TRANSLATIONS = {');
if (sourceTextStartIndex === -1) {
  console.error("Could not find const SOURCE_TEXT_TRANSLATIONS!");
  process.exit(1);
}

// Find "en: {" starting from sourceTextStartIndex
const enAnchor = '  en: {\n';
const enPos = i18nContent.indexOf(enAnchor, sourceTextStartIndex);
if (enPos === -1) {
  console.error("Could not find en: { in SOURCE_TEXT_TRANSLATIONS!");
  process.exit(1);
}
const enInsertIndex = enPos + enAnchor.length;
i18nContent = i18nContent.slice(0, enInsertIndex) + enLines.join('\n') + '\n' + i18nContent.slice(enInsertIndex);

// Re-evaluate positions because we modified the content length
const newSourceTextStartIndex = i18nContent.indexOf('const SOURCE_TEXT_TRANSLATIONS = {');

// Find "fr: {" starting from newSourceTextStartIndex
const frAnchor = '  fr: {\n';
const frPos = i18nContent.indexOf(frAnchor, newSourceTextStartIndex);
if (frPos === -1) {
  console.error("Could not find fr: { in SOURCE_TEXT_TRANSLATIONS!");
  process.exit(1);
}
const frInsertIndex = frPos + frAnchor.length;
i18nContent = i18nContent.slice(0, frInsertIndex) + frLines.join('\n') + '\n' + i18nContent.slice(frInsertIndex);

// Re-evaluate positions again
const finalSourceTextStartIndex = i18nContent.indexOf('const SOURCE_TEXT_TRANSLATIONS = {');

// Find "es: {" starting from finalSourceTextStartIndex
const esAnchor = '  es: {\n';
const esPos = i18nContent.indexOf(esAnchor, finalSourceTextStartIndex);
if (esPos === -1) {
  console.error("Could not find es: { in SOURCE_TEXT_TRANSLATIONS!");
  process.exit(1);
}
const esInsertIndex = esPos + esAnchor.length;
i18nContent = i18nContent.slice(0, esInsertIndex) + esLines.join('\n') + '\n' + i18nContent.slice(esInsertIndex);

fs.writeFileSync(i18nPath, i18nContent, 'utf8');
console.log("Successfully cleaned up TRANSLATIONS and injected into SOURCE_TEXT_TRANSLATIONS!");
