import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { FIREBASE_CONFIG } from "./firebaseConfig.js";

const SIGNED_OUT_IDENTITY = {
  mode: "signed-out",
  uid: null,
  characterId: null,
  displayName: null,
  email: null,
  photoURL: null,
  isAnonymous: false,
  idToken: null
};

export class OnlineIdentityManager {
  constructor({ config = FIREBASE_CONFIG } = {}) {
    this.config = config;
    this.app = null;
    this.auth = null;
    this.identity = { ...SIGNED_OUT_IDENTITY };
    this.available = false;
    this.error = null;
    this._authRevision = 0;
    this._unsubscribeAuth = null;
    this._listeners = new Set();
  }

  async init() {
    try {
      this.app = initializeApp(this.config);
      this.auth = getAuth(this.app);
      await setPersistence(this.auth, browserLocalPersistence);
      this.available = true;
      await this.waitForInitialAuthState();
    } catch (error) {
      this.handleAuthError(error);
      console.error("[online-auth] Firebase Auth initialization failed.", error);
    }

    return this.identity;
  }

  waitForInitialAuthState() {
    return new Promise((resolve, reject) => {
      let initialStatePending = true;

      this._unsubscribeAuth = onAuthStateChanged(this.auth, async (user) => {
        try {
          const identity = await this.applyAuthUser(user);
          if (initialStatePending) {
            initialStatePending = false;
            resolve(identity);
          }
        } catch (error) {
          if (initialStatePending) {
            initialStatePending = false;
            reject(error);
          } else {
            this.handleAuthError(error);
          }
        }
      }, (error) => {
        if (initialStatePending) {
          initialStatePending = false;
          reject(error);
        } else {
          this.handleAuthError(error);
        }
      });
    });
  }

  async applyAuthUser(user) {
    const revision = ++this._authRevision;

    if (user && !isGoogleUser(user)) {
      await firebaseSignOut(this.auth);
      if (revision !== this._authRevision) return this.identity;
      return this.setIdentity({ ...SIGNED_OUT_IDENTITY });
    }

    const identity = user
      ? await this.identityFromUser(user)
      : { ...SIGNED_OUT_IDENTITY };

    if (revision !== this._authRevision) return this.identity;
    this.error = null;
    return this.setIdentity(identity);
  }

  async identityFromUser(user) {
    return {
      mode: "firebase",
      uid: user.uid,
      characterId: characterIdFromFirebaseUid(user.uid),
      displayName: user.displayName || "Pilot",
      email: user.email || null,
      photoURL: user.photoURL || null,
      isAnonymous: false,
      idToken: await user.getIdToken()
    };
  }

  async signInWithGoogle() {
    if (!this.auth || !this.available) {
      throw this.error || new Error("Firebase Auth is unavailable.");
    }

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await signInWithPopup(this.auth, provider);
    return this.applyAuthUser(result.user);
  }

  async signOut() {
    if (!this.auth) return;
    await firebaseSignOut(this.auth);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  setIdentity(identity) {
    this.identity = identity;
    this._listeners.forEach((listener) => {
      try {
        listener(this.identity);
      } catch (error) {
        console.error("[online-auth] Identity listener failed.", error);
      }
    });
    return this.identity;
  }

  handleAuthError(error) {
    this.error = error;
    this.available = false;
    this.setIdentity({ ...SIGNED_OUT_IDENTITY });
  }

  dispose() {
    this._unsubscribeAuth?.();
    this._unsubscribeAuth = null;
    this._listeners.clear();
  }

  get isAuthenticated() {
    return this.identity.mode === "firebase"
      && Boolean(this.identity.uid)
      && !this.identity.isAnonymous;
  }

  get characterId() {
    return this.identity.characterId;
  }

  get idToken() {
    return this.identity.idToken || null;
  }

  async getIdToken(forceRefresh = false) {
    if (!this.auth?.currentUser || !this.isAuthenticated) return null;
    const idToken = await this.auth.currentUser.getIdToken(forceRefresh);
    this.identity = { ...this.identity, idToken };
    return idToken;
  }
}

export function characterIdFromFirebaseUid(uid) {
  return `firebase-${String(uid || "").replace(/[^\w-]/g, "_")}`;
}

function isGoogleUser(user) {
  return !user.isAnonymous
    && Array.isArray(user.providerData)
    && user.providerData.some((provider) => provider?.providerId === "google.com");
}
