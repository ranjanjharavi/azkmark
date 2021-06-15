const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "dist");
const publicDirectory = path.join(projectRoot, "public");

function removeDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  fs.readdirSync(directory).forEach((name) => {
    const entry = path.join(directory, name);
    if (fs.statSync(entry).isDirectory()) {
      removeDirectory(entry);
    } else {
      fs.unlinkSync(entry);
    }
  });

  fs.rmdirSync(directory);
}

removeDirectory(outputDirectory);
fs.mkdirSync(outputDirectory, { recursive: true });

[
  "manifest.json",
  "popup.html",
  "library.html",
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
