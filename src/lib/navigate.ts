/**
 * A full page load, used on purpose when the signed-in person changes (sign
 * in, sign out, account deleted, session ended). It clears every cached API
 * response in the browser and lets the server choose the right area again.
 */
export function reloadTo(path: string): void {
  window.location.assign(path);
}
