INSERT INTO short_links (shorten, url) VALUES (?1, ?2)
ON CONFLICT (shorten) DO UPDATE SET url = excluded.url;
