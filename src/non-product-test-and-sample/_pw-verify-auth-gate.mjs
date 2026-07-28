import { chromium } from "playwright";
import { installFirebaseAuthMock } from "./_pw-firebase-auth-mock.mjs";

const URL = "http://localhost:8123/index.html";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));

await installFirebaseAuthMock(page, { signedIn: false });
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".auth-gate[data-state='ready']", { timeout: 30000 });

const signedOut = await page.evaluate(() => ({
  authState: document.body.dataset.authState,
  gameStarted: Boolean(window.__betaVoidGame),
  buttonLabel: document.querySelector("[data-auth-button-label]")?.textContent,
  hudVisible: getComputedStyle(document.querySelector(".hud")).visibility
}));

await page.click("[data-auth-sign-in]");
await page.waitForFunction(() => Boolean(window.__betaVoidGame), { timeout: 60000 });

const signedIn = await page.evaluate(() => ({
  authState: document.body.dataset.authState,
  characterId: window.__betaVoidGame?.characterId,
  accountMenuVisible: Boolean(document.querySelector(".auth-session"))
}));

let fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) fail++;
};

check("signed-out visitor sees the auth gate", signedOut.authState === "signed-out");
check("game is not created before login", signedOut.gameStarted === false);
check("Google is the only visible login action", signedOut.buttonLabel === "Google로 로그인");
check("game HUD is hidden before login", signedOut.hudVisible === "hidden");
check("Google login starts the game", signedIn.authState === "authenticated");
check("Firebase UID owns the player character", signedIn.characterId === "firebase-playwright-google-user");
check("authenticated player has an account menu", signedIn.accountMenuVisible === true);

await browser.close();
process.exit(fail === 0 ? 0 : 1);
