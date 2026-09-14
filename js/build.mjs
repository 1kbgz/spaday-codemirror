import { bundle } from "./tools/bundle.mjs";
import { bundle_css } from "./tools/css.mjs";
import { node_modules_external } from "./tools/externals.mjs";

import fs from "fs";
import cpy from "cpy";

const BUNDLES = [
  {
    entryPoints: ["src/ts/index.ts"],
    plugins: [node_modules_external()],
    outfile: "dist/esm/index.js",
  },
  {
    entryPoints: ["src/ts/index.ts"],
    outfile: "dist/cdn/index.js",
  },
];

async function build() {
  fs.rmSync("dist", { recursive: true, force: true });
  fs.rmSync("../spaday_codemirror/extension", {
    recursive: true,
    force: true,
  });

  // Bundle css
  await bundle_css();

  // Copy HTML
  await cpy("src/html/*", "dist/");

  // Copy images
  if (fs.existsSync("src/img")) {
    fs.mkdirSync("dist/img", { recursive: true });
    await cpy("src/img/*", "dist/img");
  }

  await Promise.all(BUNDLES.map(bundle)).catch(() => process.exit(1));

  const { dependencies = {} } = JSON.parse(
    fs.readFileSync("package.json", "utf8"),
  );
  const served = Object.fromEntries(
    Object.keys(dependencies).map((name) => [
      name,
      JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, "utf8"))
        .version,
    ]),
  );
  fs.writeFileSync(
    "dist/versions.json",
    `${JSON.stringify(served, null, 2)}\n`,
  );

  // Copy servable assets to python extension (exclude esm/)
  fs.mkdirSync("../spaday_codemirror/extension", { recursive: true });
  await cpy("dist/**/*", "../spaday_codemirror/extension", {
    filter: (file) =>
      !file.relativePath.startsWith("esm/") &&
      !file.relativePath.startsWith("dist/esm/"),
  });
}

await build();
