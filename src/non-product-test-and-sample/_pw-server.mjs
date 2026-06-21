import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";

const ROOT = process.cwd();
const PORT = 8123;
const TYPES = {
  ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".svg":"image/svg+xml",
  ".png":"image/png", ".jpg":"image/jpeg", ".glb":"model/gltf-binary",
  ".ogg":"audio/ogg", ".wasm":"application/wasm"
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(ROOT, safe === "/" ? "/index.html" : safe);
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": TYPES[extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
