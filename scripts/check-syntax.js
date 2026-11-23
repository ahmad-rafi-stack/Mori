#!/usr/bin/env node
/**
 * Mori Automated Syntax & Integrity Checker
 * Usage: node scripts/check-syntax.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function collectJsFiles(dir, ignoreDirs = ["vendor", "node_modules"]) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.includes(entry.name)) {
        results = results.concat(collectJsFiles(fullPath, ignoreDirs));
      }
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

let failed = 0;
let checked = 0;

// 1. Check ES Modules in public/js and landing/js
for (const dir of ["public/js", "landing/js"]) {
  for (const file of collectJsFiles(dir)) {
    const src = fs.readFileSync(file, "utf8");
    const res = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: src,
      encoding: "utf8",
    });
    checked++;
    if (res.status !== 0) {
      console.error(`[FAIL] ${file}:\n${res.stderr}`);
      failed++;
    }
  }
}

// 2. Check CommonJS scripts in cli/
for (const file of collectJsFiles("cli")) {
  const res = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  checked++;
  if (res.status !== 0) {
    console.error(`[FAIL] ${file}:\n${res.stderr}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\nSyntax check failed on ${failed} of ${checked} files.`);
  process.exit(1);
} else {
  console.log(`All ${checked} JavaScript files passed syntax verification!`);
}
