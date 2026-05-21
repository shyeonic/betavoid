import { GameManager } from "./GameManager.js";

const app = document.querySelector("#app");

if (window.__voidZeroGame) {
  window.__voidZeroGame.dispose();
}

const game = new GameManager({ root: app });

window.__voidZeroGame = game;
game.init();
