ALTER TABLE game_rooms
ADD COLUMN IF NOT EXISTS host_client_id TEXT;

ALTER TABLE game_rooms
ADD COLUMN IF NOT EXISTS controller_client_id TEXT;

CREATE INDEX IF NOT EXISTS game_rooms_host_client_idx
ON game_rooms(host_client_id);

CREATE INDEX IF NOT EXISTS game_rooms_controller_client_idx
ON game_rooms(controller_client_id);
