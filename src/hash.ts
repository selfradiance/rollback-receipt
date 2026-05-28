import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface FileHash {
  sha256: string;
  sizeBytes: number;
}

export async function sha256File(filePath: string): Promise<FileHash> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      sizeBytes += buffer.length;
      hash.update(buffer);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve({
        sha256: `sha256:${hash.digest("hex")}`,
        sizeBytes
      });
    });
  });
}
