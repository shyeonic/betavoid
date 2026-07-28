const FIREBASE_APP_MODULE = "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
const FIREBASE_AUTH_MODULE = "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

export async function installFirebaseAuthMock(page, { signedIn = true } = {}) {
  await page.route(FIREBASE_APP_MODULE, (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      export function initializeApp(config) {
        return { config, name: "[PLAYWRIGHT]" };
      }
    `
  }));

  await page.route(FIREBASE_AUTH_MODULE, (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      export const browserLocalPersistence = { type: "LOCAL" };

      const listeners = new Set();
      const testUser = {
        uid: "playwright-google-user",
        displayName: "Playwright Pilot",
        email: "pilot@example.test",
        photoURL: null,
        isAnonymous: false,
        providerData: [{ providerId: "google.com" }],
        async getIdToken() { return "playwright.firebase.id-token"; }
      };
      const auth = { currentUser: ${signedIn ? "testUser" : "null"} };

      function notify() {
        for (const listener of listeners) listener(auth.currentUser);
      }

      export class GoogleAuthProvider {
        setCustomParameters(parameters) {
          this.customParameters = parameters;
        }
      }

      export function getAuth() {
        return auth;
      }

      export function setPersistence() {
        return Promise.resolve();
      }

      export function onAuthStateChanged(_auth, next) {
        listeners.add(next);
        queueMicrotask(() => next(auth.currentUser));
        return () => listeners.delete(next);
      }

      export async function signInWithPopup() {
        auth.currentUser = testUser;
        notify();
        return { user: testUser };
      }

      export async function signOut() {
        auth.currentUser = null;
        notify();
      }
    `
  }));
}
