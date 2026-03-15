const packageJson = require("../package.json") as { version?: string };

export const EXTENSION_VERSION =
  typeof packageJson.version === "string" && packageJson.version.trim()
    ? packageJson.version.trim()
    : "0.0.0";
