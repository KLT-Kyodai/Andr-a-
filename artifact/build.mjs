// Assemble la page « Andréa dans Claude » en un seul fichier : artifact/dist/andrea.html
//   npm install && npm run build:artifact
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

const bundle = await build({
  entryPoints: [here("main.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  write: false,
});
const script = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
const style = (await readFile(here("../docs/style.css"), "utf8")) + (await readFile(here("overrides.css"), "utf8"));
const page = (await readFile(here("page.html"), "utf8"))
  .replace("/*STYLE*/", () => style)
  .replace("/*SCRIPT*/", () => script);

await mkdir(here("dist"), { recursive: true });
await writeFile(here("dist/andrea.html"), page);
console.log(`artifact/dist/andrea.html : ${(page.length / 1024).toFixed(0)} Ko`);
