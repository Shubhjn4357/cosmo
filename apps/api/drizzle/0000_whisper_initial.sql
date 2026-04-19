PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT,
    avatar_url TEXT,
    theme TEXT DEFAULT 'system',
    notifications_enabled INTEGER NOT NULL DEFAULT 1,
    nsfw_enabled INTEGER NOT NULL DEFAULT 0,
    hf_model_preference TEXT,
    hf_api_key TEXT,
    consent_given INTEGER NOT NULL DEFAULT 0,
    consent_given_at TEXT,
    data_collection_consent INTEGER NOT NULL DEFAULT 0,
    terms_accepted_at TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    tokens_used REAL NOT NULL DEFAULT 0,
    tokens_limit REAL NOT NULL DEFAULT 20,
    last_token_refresh TEXT,
    last_active TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    messages TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    session_id TEXT,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    model_used TEXT,
    backend TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS token_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    feature TEXT NOT NULL,
    tokens_used REAL NOT NULL DEFAULT 0,
    is_local INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    session_id TEXT,
    prompt TEXT NOT NULL,
    model_id TEXT,
    image_url TEXT NOT NULL,
    is_local INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS autoresearch_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    objective TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    editable_paths TEXT,
    setup_command TEXT,
    experiment_command TEXT NOT NULL,
    metric_pattern TEXT NOT NULL,
    metric_goal TEXT NOT NULL DEFAULT 'min',
    backend TEXT NOT NULL DEFAULT 'server',
    agent_profile_id TEXT NOT NULL,
    max_steps INTEGER NOT NULL DEFAULT 6,
    max_tokens INTEGER NOT NULL DEFAULT 384,
    baseline_metric REAL,
    best_metric REAL,
    best_run_id TEXT,
    last_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    notes TEXT,
    setup_completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS autoresearch_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    iteration INTEGER NOT NULL DEFAULT 1,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    hypothesis TEXT,
    metric_value REAL,
    accepted INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    stdout_tail TEXT,
    stderr_tail TEXT,
    changed_paths TEXT,
    command_ran TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES autoresearch_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles(last_active);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_generated_images_user_id ON generated_images(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_created_at ON generated_images(created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_autoresearch_projects_status ON autoresearch_projects(status);
CREATE INDEX IF NOT EXISTS idx_autoresearch_runs_project_id ON autoresearch_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_autoresearch_runs_project_iteration ON autoresearch_runs(project_id, iteration);
