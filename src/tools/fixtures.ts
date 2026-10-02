import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DIR = join(process.cwd(), "data", "fixtures");

function key(path: string): string {
  return createHash("sha1").update(path).digest("hex").slice(0, 12);
}

/**
 * Replays a recorded GitHub response.
 * Record fixtures once before the talk with: RECORD_FIXTURES=1 npm run ask -- "..."
 */
export async function readFixture(path: string): Promise<unknown> {
  const file = join(DIR, `${key(path)}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      `No fixture for ${path}. Re-record with RECORD_FIXTURES=1 and USE_FIXTURES unset.`,
    );
  }
}

export async function writeFixture(path: string, data: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${key(path)}.json`), JSON.stringify(data, null, 2));
}
