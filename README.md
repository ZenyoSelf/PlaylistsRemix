# Zenyo's Playlix

Zenyo's Playlix is a powerful music library manager that allows you to consolidate and download your music from multiple streaming platforms. Currently supporting Spotify and YouTube, the application helps you manage your playlists, download your favorite tracks, and maintain a personal music library.

## Features

- **Multi-platform Support**: Connect your Spotify and YouTube accounts to access all your playlists in one place
- **Playlist Management**: View and filter your music by platform, playlist, or download status
- **Download Queue**: Efficiently singe or bulk download tracks with a background queue system
- **Local Library**: Maintain a local copy of your favorite music
- **Real-time Updates**: Track download progress with real-time notifications

## Development Setup

### Prerequisites

- Node.js (v20 or higher)
- Redis server (for the download queue)
- SQLite (for the database)
- External utilities (to be placed in the `app/utils` folder):
  - ffmpeg.exe
  - ffplay.exe
  - ffprobe.exe
  - yt-dlp.exe

### Getting Started

1. **Clone the repository**

```bash
git clone https://github.com/ZenyoSelf/PlaylistsRemix.git
cd PlaylistsRemix
```

2. **Install dependencies**

```bash
npm install
```

3. **Add required utilities**

Download the following utilities and place them in the `app/utils` folder:
- [ffmpeg, ffplay, ffprobe](https://ffmpeg.org/download.html) - Download the Windows builds
- [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) - Download the Windows executable

4. **Initialize the database**

```bash
npm run init-db
```

5. **Start Redis server (using Docker)**

```bash
docker run -d -p 6379:6379 --name playlix-redis redis:alpine
```

6. **Start the development server**

```bash
npm run dev
```

The application will be available at http://localhost:3000.

## Configuration

Create a `.env` file in the root directory with the following variables:

```
# Authentication
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_CALLBACK_URL=http://localhost:3000/auth/spotify/callback

YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
YOUTUBE_CALLBACK_URL=http://localhost:3000/auth/youtube/callback

# Session
SESSION_SECRET=your_session_secret
```

## Production Deployment

1. **Build the application**

```bash
npm run build
```

2. **Start the production server**

```bash
npm start
```

## Project Structure

- `app/`: Main application code
  - `components/`: React components
  - `db/`: Database files and migrations
  - `routes/`: Remix routes
  - `services/`: Backend services
  - `utils/`: Utility functions
  - `workers/`: Background workers
- `scripts/`: Utility scripts
- `public/`: Static assets

## Task Tracking

DONE : FIX The delivery of the file (send response with file without redirect)
DONE : Change the update button to old css (icon ghost)
DONE : Add a component to the navbar, that shows every job ongoing (for current user).
DONE : Make the download button by case - If file present, download directly, if not, add to queue and do like right now.
DONE : Fix downloadmanager to get currently going jobs.
DONE : Add cron jobs for cleaning files (every 2 days or something)
DONE : Add a selector next to all platforms, to filter all local files, not downloaded file or all

DONE : Add multiple platforms. implement some kind of account manager thing.
DONE : Implement playlists fetch.
DONE : Fix the multiple playlists thing. Only one track must be shown, even if in multiple playlists.
DONE : Add a new selector for playlists.




TODO THINK : Spotify liked songs limit

DONE : Overhaul the populatesongsforuser method : accurate email, fix the youtube forbidden (scope probably), only get music.youtube.com playlists, etc...
REMOVED : Add true auth to the app : user need to create account or get created to access it, so that the user can have different emails for spotify and youtube, while having one email in the DB.
DONE : Add a column in the db and on relevant screens, that get the date of the song added to the playlist (not added to the app).

DONE : Add one click download for all not downloaded file (new-additions)



DONE : Remove the is-local api, only taken by the normal retrieval system.
DONE : Add a tool to set which songs were downloaded (as users could have downloaded songs elsewhere, we need to add the option to set which songs have been already downloaded. )

DONE : Add more options than "only my playlist", as for example "Radar des sorties" or "Découverte de la semaine" is taken into my playlist account.

DONE : Add a better tracking on the zipping (logs of progress, and enhance it to be faster.)

DONE : Also set the songs from batch download to download when download is done (click on button and served folder)

Treat the batch download songs into sub process. (5 songs by 5 songs in 5 process) -> makes the bulk dl faster
ABORTED : Add accurate metadata to file (right artist, right album name, ...)
DONE Add a file type options (flac, wav, kbps ) for songs.

Album art fetching and embedding

Scheduled Downloads
Set up automatic downloads at specific times
Periodic playlist synchronization

UI/UX Improvements
Responsive design for all screen sizes
Keyboard shortcuts for power users

ADD playlist download (either custom-url)

Bulk DL should be one CMD -> all url's passed as parameter directly. (WAY FASTER PROCESSING)