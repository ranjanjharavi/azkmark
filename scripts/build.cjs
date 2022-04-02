const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "dist");
const publicDirectory = path.join(projectRoot, "public");

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

[
  "manifest.json",
  "popup.html",
  "library.html",
  "library-preferences.js",
  "styles/tokens.css",
  "styles/shared.css",
  "styles/popup.css",
  "styles/library.css",
].forEach((name) => {
  const source = path.join(publicDirectory, name);
  const destination = path.join(outputDirectory, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
});
