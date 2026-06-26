import { config } from "dotenv";
import { resolve } from "node:path";

const root = process.cwd();
config({ path: resolve(root, ".env") });
config({ path: resolve(root, ".env.local"), override: true });
