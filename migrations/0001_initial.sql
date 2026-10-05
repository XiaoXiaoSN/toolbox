CREATE TABLE clipboard (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    text TEXT NOT NULL CHECK (length(CAST(text AS BLOB)) <= 10000)
) STRICT;

CREATE TABLE short_links (
    shorten TEXT PRIMARY KEY COLLATE BINARY NOT NULL,
    url TEXT NOT NULL,
    CHECK (length(shorten) BETWEEN 1 AND 64),
    CHECK (shorten NOT GLOB '*[^A-Za-z0-9_-]*'),
    CHECK (lower(shorten) NOT IN ('api', 'pb', 'marquee', 'surl', 'assets', 'index', 'healthz')),
    CHECK (length(CAST(url AS BLOB)) BETWEEN 1 AND 8192)
) STRICT;
