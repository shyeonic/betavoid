import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-pages");
const files = ["index.html", "auth.css", "_headers"];
const directories = ["admin", "gamedata", "js", "rss"];

if (path.dirname(output) !== root || path.basename(output) !== "dist-pages") {
  throw new Error("Refusing to build outside the project workspace.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(path.join(root, file), path.join(output, file));
}
for (const directory of directories) {
  await cp(path.join(root, directory), path.join(output, directory), {
    recursive: true
  });
}

console.log(`Cloudflare Pages artifact: ${output}`);
