SELECT m.name as table_name, p.* 
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table'
ORDER BY m.name, p.cid;


DROP TABLE IF EXISTS song_playlist;
DROP TABLE IF EXISTS playlist;
DROP TABLE IF EXISTS song;
DROP TABLE IF EXISTS user;



SELECT sp.*, s.title as song_title, p.name as playlist_name, p.owner_id as playlist_owner
FROM song_playlist sp
JOIN song s ON sp.song_id = s.id 
JOIN playlist p ON sp.playlist_id = p.id;

SELECT * FROM song_playlist;
select * from user;
UPDATE user SET last_refresh = NULL WHERE user = 'arnaudsoltermann@gmail.com';

INSERT INTO user (user, last_refresh, last_refresh_spotify, last_refresh_youtube) VALUES ('arnaudsoltermann@gmail.com',  NULL, NULL, NULL);


SELECT * FROM 