-- migrate:up
-- Baseline DDL from SRS §11.3. Connection pragmas (foreign_keys, WAL, busy_timeout) are set by the Go DSN, not here.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'officer' CHECK (role = 'officer'),
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_expiry ON auth_sessions(expires_at);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE zones (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE monitoring_sessions (
  id INTEGER PRIMARY KEY,
  session_key TEXT NOT NULL UNIQUE,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  started_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('browser_webcam','manual_entry')),
  mode TEXT NOT NULL CHECK (mode IN ('real','simulated','manual')),
  status TEXT NOT NULL CHECK (status IN ('active','stopped','interrupted')),
  model_version TEXT,
  engine_instance_id TEXT,
  config_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  last_frame_at TEXT,
  CHECK ((mode='manual' AND source='manual_entry')
      OR (mode IN ('real','simulated') AND source='browser_webcam')),
  CHECK ((status = 'active' AND ended_at IS NULL)
      OR (status IN ('stopped','interrupted') AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_one_active_camera
  ON monitoring_sessions(status) WHERE status = 'active';
CREATE INDEX idx_sessions_zone_time ON monitoring_sessions(zone_id, started_at);

CREATE TABLE findings (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES monitoring_sessions(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  track_id INTEGER,
  track_key TEXT,
  detected_violation TEXT CHECK (detected_violation IN ('NO_HELMET','NO_VEST')),
  violation_type TEXT NOT NULL CHECK (violation_type IN ('NO_HELMET','NO_VEST')),
  confidence REAL CHECK (confidence BETWEEN 0 AND 1),
  person_bbox_json TEXT,
  violation_bbox_json TEXT,
  raw_detection_json TEXT,
  model_version TEXT,
  frame_sequence INTEGER,
  frame_width INTEGER NOT NULL CHECK (frame_width > 0),
  frame_height INTEGER NOT NULL CHECK (frame_height > 0),
  evidence_path TEXT NOT NULL UNIQUE,
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','confirmed','rejected')),
  verified_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  action_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (action_status IN ('pending','in_progress','completed')),
  action_notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, track_key, detected_violation),
  CHECK ((source='auto' AND track_key IS NOT NULL AND track_id IS NOT NULL
          AND detected_violation IS NOT NULL AND confidence IS NOT NULL
          AND frame_sequence IS NOT NULL AND model_version IS NOT NULL)
      OR (source='manual' AND track_key IS NULL AND track_id IS NULL
          AND detected_violation IS NULL AND confidence IS NULL
          AND frame_sequence IS NULL AND model_version IS NULL)),
  CHECK ((verification_status='pending' AND verified_by IS NULL AND verified_at IS NULL)
      OR (verification_status IN ('confirmed','rejected')
          AND verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (verification_status != 'rejected' OR length(trim(notes)) > 0),
  CHECK (verification_status = 'confirmed' OR action_status = 'pending'),
  CHECK (action_status != 'completed' OR length(trim(action_notes)) > 0)
);
CREATE INDEX idx_findings_session ON findings(session_id);
CREATE INDEX idx_findings_review_time ON findings(verification_status, captured_at)
  WHERE deleted_at IS NULL;

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES monitoring_sessions(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  generated_by TEXT NOT NULL CHECK (generated_by IN ('gemini','manual','template')),
  gemini_model TEXT,
  prompt_version TEXT,
  generation_request_key TEXT UNIQUE,
  generation_payload_hash TEXT,
  findings_snapshot_json TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status='draft' AND approved_by IS NULL AND approved_at IS NULL)
      OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status != 'approved' OR deleted_at IS NULL),
  CHECK (generated_by != 'gemini' OR (gemini_model IS NOT NULL AND prompt_version IS NOT NULL))
);
CREATE UNIQUE INDEX uq_report_per_session ON reports(session_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_reports_status ON reports(status, created_at) WHERE deleted_at IS NULL;

-- migrate:down
DROP TABLE reports;
DROP TABLE findings;
DROP TABLE monitoring_sessions;
DROP TABLE zones;
DROP TABLE projects;
DROP TABLE auth_sessions;
DROP TABLE users;
