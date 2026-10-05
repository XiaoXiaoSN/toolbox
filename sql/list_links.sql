SELECT url, shorten FROM short_links WHERE shorten > ?1
ORDER BY shorten COLLATE BINARY LIMIT ?2;
