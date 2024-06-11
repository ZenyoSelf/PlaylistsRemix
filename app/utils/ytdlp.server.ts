import * as child from "child_process";

export const dl = async (directory: string, trackUrl: string) => {
  const ls: child.ChildProcess = child.exec(
    `"./yt-dlp.exe" -o "C:\\Users\\arnau\\Desktop\\Projets\\MusicAuto\\${directory}\\%(title)s.%(ext)s" --extract-audio --audio-format flac --audio-quality 0 --yes-playlist --add-metadata --rm-cache-dir ${trackUrl}`
  );
  if (ls.stdout != null) {
    ls.stdout.on("data", (data: string) => {
      console.log(`stdout: ${data}`);
    });
    ls.stdout.on("disconnect", (data: string) => {
      console.log(`DISCONNECTED: ${data}`);
    });
  }
};
