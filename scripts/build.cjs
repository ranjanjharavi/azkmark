const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "dist");
const publicDirectory = path.join(projectRoot, "public");

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.cpSync(publicDirectory, outputDirectory, { recursive: true });
