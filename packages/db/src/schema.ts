export const NEWT_DB_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  limb_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('standalone-ui', 'salamanda-limb')),
  base_target TEXT NOT NULL,
  current_snapshot_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS vfs_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_snapshot_id INTEGER REFERENCES vfs_snapshots(id) ON DELETE SET NULL,
  files_json TEXT NOT NULL,
  compiled_bundle_json TEXT,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project ON vfs_snapshots(project_id, id DESC);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content_json TEXT NOT NULL,
  snapshot_id INTEGER REFERENCES vfs_snapshots(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at ASC);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_id INTEGER NOT NULL REFERENCES vfs_snapshots(id) ON DELETE CASCADE,
  principal_uid TEXT NOT NULL,
  environment TEXT NOT NULL,
  published_digest TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'quarantined')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gallery_listings (
  limb_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  base_target TEXT NOT NULL,
  published_digest TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('unlisted', 'public')),
  monetization_mode TEXT NOT NULL CHECK (monetization_mode IN ('free', 'allowlist', 'ledger_gate')),
  price_label TEXT,
  permissions_summary_json TEXT NOT NULL,
  installs_count INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gallery_visibility ON gallery_listings(visibility, base_target, published_at DESC);

CREATE TABLE IF NOT EXISTS entitlement_grants (
  id TEXT PRIMARY KEY,
  limb_id TEXT NOT NULL REFERENCES gallery_listings(limb_id) ON DELETE CASCADE,
  consumer_uid TEXT NOT NULL,
  grant_source TEXT NOT NULL CHECK (grant_source IN ('author_invite', 'payment_receipt', 'free_install')),
  external_receipt_id TEXT,
  granted_at INTEGER NOT NULL,
  UNIQUE(limb_id, consumer_uid)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_lookup ON entitlement_grants(limb_id, consumer_uid);
`;
