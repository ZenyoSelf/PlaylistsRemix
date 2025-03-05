# Welcome to Remix!

- 📖 [Remix docs](https://remix.run/docs)

## Development

Run the dev server:

```shellscript
npm run dev
```

## Deployment

First, build your app for production:

```sh
npm run build
```

Then run the app in production mode:

```sh
npm start
```

Now you'll need to pick a host to deploy it to.

### DIY

If you're familiar with deploying Node applications, the built-in Remix app server is production-ready.

Make sure to deploy the output of `npm run build`

- `build/server`
- `build/client`




## Next Steps

Redis + Bull Implementation Steps
1. Basic Setup
Install Redis & packages
Set environment variables
Test connection
2. Queue Structure
Download Queue
Configure retries & concurrency
Set job priorities
Basic rate limiting
Cleanup Queue
Simple temp file cleanup
Basic storage checks
3. Core Implementation
Download Worker
File downloads
Temp storage
Progress tracking
Basic error handling
Storage System
User directories
Simple quota check
File organization
Progress Updates
WebSocket setup
Basic progress events
Simple UI feedback
4. Monitoring
Basic Bull Board setup
2. Simple error logging
Priority Order
Queue setup
Basic downloads
Progress tracking
File management
Cleanup system
Success Goals
Downloads work reliably
Progress shows correctly
Files organized by user
System stays stable


DONE : FIX The delivery of the file (send response with file without redirect)
DONE : Change the update button to old css (icon ghost)
DONE : Add a component to the navbar, that shows every job ongoing (for current user).


DONE : Make the download button by case - If file present, download directly, if not, add to queue and do like right now.
DONE : Fix downloadmanager to get currently going jobs.
DONE : Add cron jobs for cleaning files (every 2 days or something)

Add a selector next to all platforms, to filter all local files, not downloaded file or all

