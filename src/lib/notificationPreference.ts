// Même schéma que theme.ts/a11y.ts/sortPreference.ts : préférence persistée
// en localStorage, propre à cet appareil. Ne garantit pas à elle seule que
// des notifications s'afficheront : encore faut-il que la permission
// navigateur (Notification.permission) soit accordée — voir wireNotifications
// dans src/views/list.ts, qui combine les deux avant d'en afficher une.
const KEY = "omq:notifications";

export function getNotificationPreference(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function setNotificationPreference(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // stockage indisponible, la préférence ne persistera pas au rechargement
  }
}
