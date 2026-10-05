DELETE FROM short_links WHERE shorten = ?1 RETURNING shorten;
