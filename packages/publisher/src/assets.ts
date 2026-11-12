import path from "node:path";
import { SaxesParser } from "saxes";
import { Failure } from "./errors.js";

const svgElements = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "title",
  "desc",
  "text",
  "tspan",
]);
const svgAttributes = new Set([
  "xmlns",
  "width",
  "height",
  "viewBox",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
  "font-size",
  "text-anchor",
  "dx",
  "dy",
  "preserveAspectRatio",
]);

export function validateAsset(filename: string, bytes: Buffer): void {
  const reject = () => {
    throw new Failure("UNSUPPORTED_ASSET", 3);
  };
  const ext = path.extname(filename).toLowerCase();
  // Raster header checks identify supported formats; they are not a full image decoder.
  if (
    ext === ".png" &&
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return;
  if (
    [".jpg", ".jpeg"].includes(ext) &&
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return;
  if (
    ext === ".gif" &&
    bytes.length >= 14 &&
    ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) &&
    bytes.at(-1) === 59
  )
    return;
  if (
    ext === ".webp" &&
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  )
    return;
  if (ext !== ".svg") return reject();
  try {
    const parser = new SaxesParser({ xmlns: true });
    let root = false;
    parser.on("opentag", (tag) => {
      if (!root && tag.name !== "svg") reject();
      root = true;
      if (
        !svgElements.has(tag.name) ||
        tag.uri !== "http://www.w3.org/2000/svg"
      )
        reject();
      for (const [key, attr] of Object.entries(tag.attributes)) {
        if (!svgAttributes.has(key)) reject();
        if (key === "xmlns") {
          if (attr.value !== "http://www.w3.org/2000/svg") reject();
        } else if (/[&<>\\]|url\s*\(|[a-z][a-z0-9+.-]*:/i.test(attr.value))
          reject();
      }
    });
    parser.on("doctype", reject);
    parser.on("processinginstruction", reject);
    parser.on("error", reject);
    parser
      .write(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      .close();
    if (!root) reject();
  } catch {
    reject();
  }
}
