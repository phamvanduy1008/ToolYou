import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { LOG_DIR } from "../config/constants.js";

const streams: Array<{ stream: NodeJS.WritableStream }> = [{ stream: process.stdout }];

if (process.env.LOG_TO_FILE === "true") {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `crawler-${date}-${process.pid}.log`);
  const fileStream = fs.createWriteStream(logFile, { flags: "a" });

  fileStream.on("error", (error) => {
    process.stderr.write(`File logging disabled: ${error.message}\n`);
  });
  streams.push({ stream: fileStream });
}

export const logger = pino(
  { level: "info", redact: ["cookie", "cookies", "authorization"] },
  pino.multistream(streams)
);
