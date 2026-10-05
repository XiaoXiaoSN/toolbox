INSERT INTO short_links (shorten, url) VALUES (?1, ?2)
ON CONFLICT (shorten) DO NOTHING RETURNING shorten;
