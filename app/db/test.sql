UPDATE user SET last_refresh = null WHERE user = 'arnaudsoltermann@gmail.com';

DELETE FROM user WHERE user IS NULL;
DELETE FROM song ;
select * from user;