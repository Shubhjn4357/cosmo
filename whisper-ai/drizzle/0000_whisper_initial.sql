CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT,
    avatar_url TEXT,
    theme TEXT DEFAULT 'system',
    notifications_enabled INTEGER DEFAULT 1,
    nsfw_enabled INTEGER DEFAULT 0,
    hf_model_preference TEXT,
    hf_api_key TEXT,
    consent_given INTEGER DEFAULT 0,
    consent_given_at TEXT,
    data_collection_consent INTEGER DEFAULT 0,
    terms_accepted_at TEXT,
    subscription_tier TEXT DEFAULT 'free',
    tokens_used REAL DEFAULT 0,
    tokens_limit REAL DEFAULT 20,
    last_token_refresh TEXT,
    last_active TEXT,
    is_admin INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    messages TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    razorpay_subscription_id TEXT,
    razorpay_payment_id TEXT,
    amount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS token_purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tokens_purchased INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    razorpay_payment_id TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS token_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    feature TEXT NOT NULL,
    tokens_used REAL NOT NULL,
    is_local INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    session_id TEXT,
    prompt TEXT NOT NULL,
    response TEXT,
    model_used TEXT,
    backend TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    session_id TEXT,
    prompt TEXT NOT NULL,
    model_id TEXT,
    image_url TEXT,
    is_local INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS autoresearch_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    objective TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    editable_paths TEXT NOT NULL,
    setup_command TEXT,
    setup_completed_at TEXT,
    experiment_command TEXT NOT NULL,
    metric_pattern TEXT NOT NULL,
    metric_goal TEXT DEFAULT 'min',
    backend TEXT DEFAULT 'server',
    agent_profile_id TEXT DEFAULT 'autonomous-researcher',
    max_steps INTEGER DEFAULT 6,
    max_tokens INTEGER DEFAULT 384,
    baseline_metric REAL,
    best_metric REAL,
    best_run_id TEXT,
    last_run_id TEXT,
    status TEXT DEFAULT 'idle',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS autoresearch_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    session_id TEXT,
    iteration INTEGER DEFAULT 1,
    status TEXT DEFAULT 'queued',
    hypothesis TEXT,
    metric_value REAL,
    accepted INTEGER DEFAULT 0,
    summary TEXT,
    stdout_tail TEXT,
    stderr_tail TEXT,
    changed_paths TEXT,
    command_ran TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES autoresearch_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON profiles(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles(last_active);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_purchases_user_id ON token_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_user_id ON generated_images(user_id);
CREATE INDEX IF NOT EXISTS idx_autoresearch_projects_status ON autoresearch_projects(status);
CREATE INDEX IF NOT EXISTS idx_autoresearch_runs_project_id ON autoresearch_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_autoresearch_runs_status ON autoresearch_runs(status);
