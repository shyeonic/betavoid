import { GameManager } from "./GameManager.js";
import { loadGameData } from "./GameDataLoader.js";
import { createAuthGate, createAuthSessionMenu } from "./AuthView.js";
import { OnlineApiClient } from "./OnlineApiClient.js";
import { OnlineIdentityManager } from "./OnlineIdentityManager.js";

const app = document.querySelector("#app");

if (window.__betaVoidGame) {
  window.__betaVoidGame.dispose();
}

const identity = new OnlineIdentityManager();
const onlineApi = new OnlineApiClient({ identity });
window.__betaVoidAuth = identity;

let game = null;
let sessionMenu = null;
let startPromise = null;
let activeUid = null;
let gameDataPromise = null;
let hasStartedGame = false;

document.body.dataset.authState = "checking";

const authGate = createAuthGate({
  root: app,
  onSignIn: async () => {
    if (!identity.available) {
      window.location.reload();
      return;
    }
    await identity.signInWithGoogle();
    await startAuthenticatedGame();
  }
});
authGate.setState({ checking: true, message: "저장된 로그인 세션을 확인하고 있습니다." });

identity.subscribe((nextIdentity) => {
  if (nextIdentity.mode === "firebase" && nextIdentity.uid) {
    if (game && activeUid !== nextIdentity.uid) {
      window.location.reload();
      return;
    }
    void startAuthenticatedGame();
    return;
  }

  if (hasStartedGame) {
    window.location.reload();
  }
});

await identity.init();

if (identity.isAuthenticated) {
  await startAuthenticatedGame();
} else {
  document.body.dataset.authState = "signed-out";
  authGate.setState({
    error: identity.error,
    message: identity.available ? "로그인할 Google 계정을 선택해 주세요." : ""
  });
}

async function startAuthenticatedGame() {
  if (!identity.isAuthenticated) return null;
  if (game) return game;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    document.body.dataset.authState = "starting";
    authGate.setState({ starting: true, message: "멀티플레이 세션을 준비하고 있습니다." });

    try {
      gameDataPromise ||= loadGameData();
      const [gameData, worldBootstrap, playerState] = await Promise.all([
        gameDataPromise,
        onlineApi.getWorldBootstrap(),
        onlineApi.getPlayerState()
      ]);
      console.info(`[game-data] loaded ${gameData.enabledChunks.length} enabled chunks from ${gameData.dataSetName}`);

      game = new GameManager({
        root: app,
        gameData,
        identity,
        onlineApi,
        playerState,
        worldBootstrap
      });
      activeUid = identity.identity.uid;
      await game.init();

      hasStartedGame = true;
      window.__betaVoidGame = game;
      authGate.destroy();
      sessionMenu = createAuthSessionMenu({
        identity: identity.identity,
        onSignOut: async () => {
          await identity.signOut();
          window.location.reload();
        }
      });
      document.body.dataset.authState = "authenticated";
      return game;
    } catch (error) {
      console.error("[game-boot] authenticated game startup failed.", error);
      game?.dispose();
      game = null;
      activeUid = null;
      window.__betaVoidGame = null;
      document.body.dataset.authState = "signed-out";
      authGate.setState({ error });
      return null;
    } finally {
      startPromise = null;
    }
  })();

  return startPromise;
}

window.addEventListener("pagehide", () => {
  sessionMenu?.destroy();
  identity.dispose();
}, { once: true });
