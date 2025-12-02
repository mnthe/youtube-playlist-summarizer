export interface PlaylistInfo {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  videoCount: number;
}

export interface VideoInfo {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  duration: string; // ISO 8601 duration (PT15M30S)
  durationSeconds: number;
  thumbnailUrl: string;
  url: string;
}
