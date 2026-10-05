-- Atomic replacement is safe here: the row has only the key and destination,
-- and there are no foreign keys, triggers or row-identity consumers.
INSERT OR REPLACE INTO short_links (shorten, url) VALUES (?1, ?2)
RETURNING url, shorten;
