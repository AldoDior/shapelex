import fs from "node:fs";

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

const packageUrl = new URL("../../package.json", import.meta.url);

export const PACKAGE_VERSION = readPackageVersion();

function readPackageVersion(): string {
  const metadata = JSON.parse(fs.readFileSync(packageUrl, "utf8")) as PackageMetadata;
  if (metadata.name !== "shapelex-mcp" || typeof metadata.version !== "string") {
    throw new Error("ShapeLex package metadata is missing a valid version");
  }
  return metadata.version;
}
