import { google, youtube_v3 } from 'googleapis';
import type { PlaylistInfo, VideoInfo } from '../../types/index.js';

export class YouTubeClient {
  private youtube: youtube_v3.Youtube;

  constructor(apiKey: string) {
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });
  }

  parsePlaylistId(url: string): string {
    const patterns = [
      /[?&]list=([a-zA-Z0-9_-]+)/,
      /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    throw new Error('Invalid playlist URL');
  }

  parseVideoId(url: string): string {
    const patterns = [
      /youtu\.be\/([a-zA-Z0-9_-]+)/,
      /[?&]v=([a-zA-Z0-9_-]+)/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    throw new Error('Invalid video URL');
  }

  parseDuration(isoDuration: string): number {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async getPlaylistInfo(playlistId: string): Promise<PlaylistInfo> {
    const response = await this.youtube.playlists.list({
      part: ['snippet', 'contentDetails'],
      id: [playlistId],
    });

    const playlist = response.data.items?.[0];
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    return {
      id: playlist.id!,
      title: playlist.snippet?.title || '',
      description: playlist.snippet?.description || '',
      channelTitle: playlist.snippet?.channelTitle || '',
      videoCount: playlist.contentDetails?.itemCount || 0,
    };
  }

  async getPlaylistVideos(playlistId: string): Promise<VideoInfo[]> {
    const videos: VideoInfo[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults: 50,
        pageToken,
      });

      const videoIds = response.data.items
        ?.map((item) => item.contentDetails?.videoId)
        .filter((id): id is string => !!id) || [];

      if (videoIds.length > 0) {
        const videoDetails = await this.getVideoDetails(videoIds);
        videos.push(...videoDetails);
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return videos;
  }

  async getVideoDetails(videoIds: string[]): Promise<VideoInfo[]> {
    const response = await this.youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: videoIds,
    });

    return (response.data.items || []).map((video) => ({
      id: video.id!,
      title: video.snippet?.title || '',
      description: video.snippet?.description || '',
      channelTitle: video.snippet?.channelTitle || '',
      publishedAt: video.snippet?.publishedAt || '',
      duration: video.contentDetails?.duration || 'PT0S',
      durationSeconds: this.parseDuration(video.contentDetails?.duration || 'PT0S'),
      thumbnailUrl: video.snippet?.thumbnails?.high?.url || '',
      url: `https://www.youtube.com/watch?v=${video.id}`,
    }));
  }

  async getVideo(videoId: string): Promise<VideoInfo> {
    const videos = await this.getVideoDetails([videoId]);
    if (videos.length === 0) {
      throw new Error(`Video not found: ${videoId}`);
    }
    return videos[0];
  }
}
