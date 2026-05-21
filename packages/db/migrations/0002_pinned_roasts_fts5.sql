-- FTS5 index over pinned_roasts.roast_text. External-content table — only the
-- inverted index is stored here; the original text stays in pinned_roasts.
-- Drizzle can't model FTS5 virtual tables, so this migration is hand-written
-- and lives outside the schema-generated migration chain.

CREATE VIRTUAL TABLE `pinned_roasts_fts` USING fts5(
  roast_text,
  content='pinned_roasts',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `pinned_roasts_ai` AFTER INSERT ON `pinned_roasts` BEGIN
  INSERT INTO `pinned_roasts_fts`(rowid, roast_text) VALUES (new.rowid, new.roast_text);
END;
--> statement-breakpoint
CREATE TRIGGER `pinned_roasts_ad` AFTER DELETE ON `pinned_roasts` BEGIN
  INSERT INTO `pinned_roasts_fts`(pinned_roasts_fts, rowid, roast_text)
    VALUES ('delete', old.rowid, old.roast_text);
END;
--> statement-breakpoint
CREATE TRIGGER `pinned_roasts_au` AFTER UPDATE ON `pinned_roasts` BEGIN
  INSERT INTO `pinned_roasts_fts`(pinned_roasts_fts, rowid, roast_text)
    VALUES ('delete', old.rowid, old.roast_text);
  INSERT INTO `pinned_roasts_fts`(rowid, roast_text) VALUES (new.rowid, new.roast_text);
END;
