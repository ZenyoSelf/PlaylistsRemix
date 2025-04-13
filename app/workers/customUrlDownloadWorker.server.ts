import { downloadQueue } from '~/services/queue.server';
import path from 'path';
import { downloadFromCustomUrl } from '~/services/ytDownload.server';
import { getSongById, updateSongDownloadStatus, updateSongLocalStatus } from '~/services/db.server';

// Instead of registering a new processor, we'll extend the existing one
// by adding a listener for completed jobs to handle custom URL downloads
downloadQueue.on('completed', async (job) => {
  try {
    const { songId, userId } = job.data;
    const song = await getSongById(songId);
    
    // Only process custom URL songs
    // Check if the song is from a custom URL (not Spotify or Youtube)
    if (!song || song.platform === 'Spotify' || song.platform === 'Youtube') {
      return;
    }
    
    console.log(`Processing custom URL download for song: ${song.title}`);
    
    // Get the first playlist name or use 'default' if none exists
    const playlistName = song.playlists && song.playlists.length > 0 
      ? song.playlists[0].name 
      : (Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default');
    
    // Download the song
    await downloadFromCustomUrl(
      song.url,
      path.join(process.cwd(), "tmp"),
      userId,
      playlistName
    );
    
    // Update song status in database
    await updateSongDownloadStatus(songId, true);
    await updateSongLocalStatus(songId, true);
    
    console.log(`Custom URL download completed: ${song.title}`);
  } catch (error) {
    console.error('Error in custom URL download handler:', error);
  }
}); 