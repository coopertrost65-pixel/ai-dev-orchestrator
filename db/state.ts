const STATE_ID = "default";

function getDesktopStateFile(): string | null {
  const filePath = process.env.AI_DEV_ORCHESTRATOR_STATE_FILE?.trim();
  return filePath || null;
}

async function readDesktopState(filePath: string): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeDesktopState(filePath: string, payload: string): Promise<void> {
  const { mkdir, rename, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const directory = dirname(filePath);
  const temporaryFile = `${filePath}.${process.pid}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(temporaryFile, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, filePath);
}

async function getDatabase(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("D1 binding DB is unavailable.");
  return database;
}

async function ensureTable(database: D1Database): Promise<void> {
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function readPersistedState(): Promise<string | null> {
  const desktopStateFile = getDesktopStateFile();
  if (desktopStateFile) return readDesktopState(desktopStateFile);

  const database = await getDatabase();
  await ensureTable(database);
  const row = await database
    .prepare("SELECT payload FROM app_state WHERE id = ?")
    .bind(STATE_ID)
    .first<{ payload: string }>();
  return row?.payload ?? null;
}

export async function writePersistedState(payload: string): Promise<void> {
  const desktopStateFile = getDesktopStateFile();
  if (desktopStateFile) return writeDesktopState(desktopStateFile, payload);

  const database = await getDatabase();
  await ensureTable(database);
  await database
    .prepare(`
      INSERT INTO app_state (id, payload, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(STATE_ID, payload)
    .run();
}
