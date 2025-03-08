SELECT m.name as table_name, p.* 
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table'
ORDER BY m.name, p.cid;


DROP TABLE IF EXISTS song_playlist;
DROP TABLE IF EXISTS playlist;
DROP TABLE IF EXISTS song;
DROP TABLE IF EXISTS user;

DELETE FROM user;

SELECT sp.*, s.title as song_title, p.name as playlist_name, p.owner_id as playlist_owner
FROM song_playlist sp
JOIN song s ON sp.song_id = s.id 
JOIN playlist p ON sp.playlist_id = p.id;

SELECT * FROM song_playlist;
select * from user;
UPDATE user SET last_refresh = NULL WHERE user = 'arnaudsoltermann@gmail.com';

INSERT INTO user (user, last_refresh, last_refresh_spotify, last_refresh_youtube) VALUES ('arnaudsoltermann@gmail.com',  NULL, NULL, NULL);

select * from playlist;
SELECT * FROM user;
SELECT * FROM song;



delete FROM song;
delete FROM playlist;
delete FROM user where id = 2;
delete FROM user where id = 3;

select * from playlist where name = "YouTubeLikedVideos";

UPDATE user SET last_refresh_spotify = NULL;
UPDATE user SET last_refresh_youtube = NULL;

delete from song_playlist where playlist_id = 190;


DELETE FROM song_playlist 
WHERE playlist_id IN (
    SELECT id FROM playlist WHERE name = 'YouTubeLikedVideos'
);

DELETE FROM song 
WHERE id IN (
    SELECT s.id 
    FROM song s
    JOIN song_playlist sp ON s.id = sp.song_id
    JOIN playlist p ON sp.playlist_id = p.id
    WHERE p.name = 'YouTubeLikedVideos'
);


-- Delete song_playlist entries for YouTube songs
DELETE FROM song_playlist 
WHERE song_id IN (
    SELECT id FROM song WHERE platform = 'Youtube'
);

-- Delete YouTube songs
DELETE FROM song WHERE platform = 'Youtube';


select * from song where id IN (3962,3930,3765,2845,1294,141,50,49)