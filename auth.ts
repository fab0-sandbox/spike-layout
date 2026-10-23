// Signs in as the fab0 App: a JWT from the private key, then an installation
// token. The key is read from the file FAB0_APP_KEY_PATH names, and never printed.
import { App } from "octokit";

export const ORG = "fab0-sandbox";
export const APP_ID = 5437398;
export const INSTALLATION_ID = 174376509;

export function app(): App {
  const path = process.env.FAB0_APP_KEY_PATH;
  if (!path) throw new Error("FAB0_APP_KEY_PATH is not set: point it at the fab0-app private key (.pem)");
  const privateKey = require("node:fs").readFileSync(path.replace(/^~/, process.env.HOME!), "utf8");
  return new App({ appId: APP_ID, privateKey });
}

export async function installation() {
  return app().getInstallationOctokit(INSTALLATION_ID);
}
