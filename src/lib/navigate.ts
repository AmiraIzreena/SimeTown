/**
 * A full page load, used on purpose when the signed-in person changes (sign
 * in, sign out, account deleted, session ended). It clears every cached API
 * response in the browser and lets the server choose the right area again.
 */
export function reloadTo(path: string): void {
  window.location.assign(path);
}

/**
 * Pages drawn inside the signed-in frame (the Shell): its top bar carries the language switch, and on phones
 * its bottom bar takes the lower edge, so floating extras must sit above it. Keep in step with the Shell's layouts.
 */
export const isSignedInFrame = (pathname: string) => /^\/(app|console|merchant|sponsor|guard|courier|notifications)(\/|$)/.test(pathname);
