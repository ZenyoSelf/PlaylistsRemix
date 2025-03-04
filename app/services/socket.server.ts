import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

let io: Server;

export function initializeSocketIO(server: HttpServer) {
  io = new Server(server);

  io.on('connection', (socket: Socket) => {
    console.log('Client connected');

    socket.on('subscribe', (userId: string) => {
      socket.join(`user-${userId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });

  return io;
}

export function emitDownloadProgress(userId: string, jobId: string, progress: number) {
  if (io) {
    io.to(`user-${userId}`).emit('downloadProgress', { jobId, progress });
  }
}

export function emitDownloadComplete(userId: string, jobId: string, filePath: string) {
  if (io) {
    io.to(`user-${userId}`).emit('downloadComplete', { jobId, filePath });
  }
}

export function emitDownloadError(userId: string, jobId: string, error: string) {
  if (io) {
    io.to(`user-${userId}`).emit('downloadError', { jobId, error });
  }
} 