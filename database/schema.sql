BEGIN;

CREATE TABLE IF NOT EXISTS game_rooms (
    id UUID PRIMARY KEY,
    room_code VARCHAR(6) NOT NULL UNIQUE,

    mode VARCHAR(20) NOT NULL
        CHECK (mode IN ('coop', 'versus', 'solophone')),

    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (
            status IN (
                'waiting',
                'ready',
                'active',
                'finished',
                'cancelled'
            )
        ),

    map_id VARCHAR(40) NOT NULL DEFAULT 'frontier',

    host_socket_id VARCHAR(120),
    controller_socket_id VARCHAR(120),

    host_name VARCHAR(20) NOT NULL DEFAULT 'Warden 1',
    controller_name VARCHAR(20),

    host_ready BOOLEAN NOT NULL DEFAULT FALSE,
    controller_ready BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS game_rooms_code_idx
    ON game_rooms(room_code);

CREATE INDEX IF NOT EXISTS game_rooms_status_idx
    ON game_rooms(status);

CREATE INDEX IF NOT EXISTS game_rooms_expiry_idx
    ON game_rooms(expires_at);


CREATE TABLE IF NOT EXISTS match_results (
    id UUID PRIMARY KEY,
    room_id UUID REFERENCES game_rooms(id) ON DELETE SET NULL,

    mode VARCHAR(20) NOT NULL
        CHECK (mode IN ('solo', 'coop', 'versus')),

    map_id VARCHAR(40) NOT NULL DEFAULT 'frontier',

    duration_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0,
    waves_cleared INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    perfect_waves INTEGER NOT NULL DEFAULT 0,
    final_integrity NUMERIC(6, 2) NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0,

    played_on DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS match_results_score_idx
    ON match_results(total_score DESC);

CREATE INDEX IF NOT EXISTS match_results_day_idx
    ON match_results(played_on);


CREATE TABLE IF NOT EXISTS player_results (
    id UUID PRIMARY KEY,
    match_id UUID NOT NULL
        REFERENCES match_results(id)
        ON DELETE CASCADE,

    player_slot SMALLINT NOT NULL
        CHECK (player_slot IN (1, 2)),

    display_name VARCHAR(20) NOT NULL,

    kills INTEGER NOT NULL DEFAULT 0,
    shots INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,

    weapon_id VARCHAR(40) NOT NULL DEFAULT 'watch_bow',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(match_id, player_slot)
);

CREATE INDEX IF NOT EXISTS player_results_match_idx
    ON player_results(match_id);


CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id UUID PRIMARY KEY,
    match_id UUID REFERENCES match_results(id) ON DELETE SET NULL,

    display_name VARCHAR(20) NOT NULL,

    mode VARCHAR(20) NOT NULL
        CHECK (mode IN ('solo', 'coop', 'versus')),

    map_id VARCHAR(40) NOT NULL DEFAULT 'frontier',

    score INTEGER NOT NULL DEFAULT 0,
    duration_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0,
    waves_cleared INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,

    event_day DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leaderboard_day_score_idx
    ON leaderboard_entries(event_day, score DESC);

-- device the score was set on (for per-device history / "your best")
ALTER TABLE leaderboard_entries
    ADD COLUMN IF NOT EXISTS device_id TEXT;

CREATE INDEX IF NOT EXISTS leaderboard_device_idx
    ON leaderboard_entries(device_id);

-- Event naming convention: "[Company name] - [Player name]". display_name keeps
-- the combined label; company / player_name keep the parts for CSV export.
ALTER TABLE leaderboard_entries
    ALTER COLUMN display_name TYPE VARCHAR(120);

ALTER TABLE leaderboard_entries
    ADD COLUMN IF NOT EXISTS company VARCHAR(60);

ALTER TABLE leaderboard_entries
    ADD COLUMN IF NOT EXISTS player_name VARCHAR(60);


-- Persistent per-device player profile (coins, level, unlocks, ammo, settings).
-- The whole evolving profile is stored as JSONB and keyed by the browser's
-- stable device id, so a device loads "its" data straight from Neon.
CREATE TABLE IF NOT EXISTS player_profiles (
    device_id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    best_score INTEGER NOT NULL DEFAULT 0,
    display_name VARCHAR(40),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS player_profiles_best_idx
    ON player_profiles(best_score DESC);

COMMIT;