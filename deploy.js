import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import FtpDeploy from "ftp-deploy";

dotenv.config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "dist");

const required = ["FTP_HOST", "FTP_USER", "FTP_PASSWORD"];
for (const key of required) {
  if (!process.env[key]?.trim()) {
    console.error(`Missing or empty ${key} in .env.local`);
    process.exit(1);
  }
}

if (!fs.existsSync(distPath)) {
  console.error("dist/ not found. Run npm run build first.");
  process.exit(1);
}

const remoteRoot = (process.env.FTP_REMOTE_ROOT || "/public_html/").trim();
const normalizedRemote =
  remoteRoot.endsWith("/") ? remoteRoot : `${remoteRoot}/`;

const ftpDeploy = new FtpDeploy();

ftpDeploy.on("uploading", (data) => {
  const n = data.transferredFileCount + 1;
  const total = data.totalFilesCount;
  console.log(`[${n}/${total}] Uploading: ${data.filename}`);
});

ftpDeploy.on("uploaded", (data) => {
  console.log(`  done: ${data.filename}`);
});

ftpDeploy.on("log", (msg) => {
  console.log(`[ftp-deploy] ${msg}`);
});

ftpDeploy.on("upload-error", (data) => {
  console.error(
    "Upload error:",
    data.err?.message || data.err,
    data.filename ? `(${data.filename})` : ""
  );
});

const config = {
  user: process.env.FTP_USER.trim(),
  password: process.env.FTP_PASSWORD,
  host: process.env.FTP_HOST.trim(),
  port: process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21,
  localRoot: distPath,
  remoteRoot: normalizedRemote,
  deleteRemote: true,
  // minimatch does not treat * as matching dotfiles, so .htaccess was never uploaded
  // and deleteRemote removed it from the server each deploy.
  include: ["*", "**/*", ".htaccess", "**/.htaccess"],
  exclude: [],
  forcePasv: true,
  sftp: false,
};

ftpDeploy
  .deploy(config)
  .then((res) => {
    console.log("Deploy finished:", res);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Deploy failed:", err?.message || err);
    process.exit(1);
  });
