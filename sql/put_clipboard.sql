INSERT INTO clipboard (id, text) VALUES (1, ?1)
ON CONFLICT (id) DO UPDATE SET text = excluded.text;
