import { GameManager } from "./GameManager.js";
import { loadGameData } from "./GameDataLoader.js";

const app = document.querySelector("#app");

if (window.__voidZeroGame) {
  window.__voidZeroGame.dispose();
}

let gameData;
try {
  gameData = await loadGameData();
  console.info(`[game-data] loaded ${gameData.enabledChunks.length} enabled chunks from ${gameData.dataSetName}`);
} catch (error) {
  console.error("[game-data] required game data load failed.", error);
  app.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#05070b;color:#f4f7fb;font:14px/1.5 system-ui,sans-serif;padding:24px;">
      <section style="max-width:560px;border:1px solid rgba(255,255,255,.18);padding:24px;background:rgba(255,255,255,.06);">
        <h1 style="margin:0 0 8px;font-size:20px;">Game data load failed</h1>
        <p style="margin:0;color:#c4ccd8;">The runtime requires exported files in <code>/gamedata</code>. Check the console for the failing file.</p>
      </section>
    </main>
  `;
  throw error;
}

const game = new GameManager({ root: app, gameData });

window.__voidZeroGame = game;
game.init();
