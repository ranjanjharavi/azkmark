const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "dist");
const publicDirectory = path.join(projectRoot, "public");

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.cpSync(publicDirectory, outputDirectory, { recursive: true });

const vendorDirectory = path.join(outputDirectory, "vendor");
fs.mkdirSync(vendorDirectory, { recursive: true });
for (const [source, target] of [
	["marked/lib/marked.umd.js", "marked.js"],
	["dompurify/dist/purify.min.js", "purify.js"],
	["lucide/dist/umd/lucide.min.js", "lucide.js"]
]) {
	fs.copyFileSync(path.join(projectRoot, "node_modules", source), path.join(vendorDirectory, target));
}
