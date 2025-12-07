import { google, youtube_v3 } from 'googleapis';
import type { PlaylistInfo, VideoInfo, CaptionInfo, CaptionResult, CaptionTrackKind } from '../../types/index.js';

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

  private async randomDelay(minMs: number = 3000, maxMs: number = 6000): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async getCaptions(videoId: string, preferredLanguages: string[] = ['ko', 'en']): Promise<CaptionResult> {
    try {
      // Use official YouTube Data API to list captions (works with API key)
      const response = await this.youtube.captions.list({
        part: ['snippet'],
        videoId,
      });

      const captionTracks = response.data.items;

      if (!captionTracks || captionTracks.length === 0) {
        return { available: false, isManual: false, caption: null, text: null };
      }

      // Parse caption tracks from API response
      const parsedTracks: CaptionInfo[] = captionTracks.map((track) => {
        const trackKind = track.snippet?.trackKind as CaptionTrackKind || 'standard';
        const isAsr = trackKind === 'ASR' || track.snippet?.trackKind === 'asr';
        return {
          id: track.id!,
          videoId,
          language: track.snippet?.name || track.snippet?.language || '',
          languageCode: track.snippet?.language || '',
          trackKind: isAsr ? 'ASR' : 'standard',
          isAutoGenerated: isAsr,
        };
      });

      // Priority: manual caption in preferred language > manual in any language > none (skip ASR)
      let selectedCaption: CaptionInfo | null = null;

      // First, try to find manual caption in preferred languages
      for (const lang of preferredLanguages) {
        const manual = parsedTracks.find(
          (t) => !t.isAutoGenerated && t.languageCode.startsWith(lang)
        );
        if (manual) {
          selectedCaption = manual;
          break;
        }
      }

      // If no preferred language manual caption, try any manual caption
      if (!selectedCaption) {
        selectedCaption = parsedTracks.find((t) => !t.isAutoGenerated) || null;
      }

      // If only ASR available, return without text (as discussed, ASR adds no value)
      if (!selectedCaption) {
        return {
          available: true,
          isManual: false,
          caption: parsedTracks[0] || null,
          text: null,
        };
      }

      // Download the manual caption text via timedtext API (requires scraping)
      // Random delay before scraping to avoid rate limiting
      await this.randomDelay();
      const captionText = await this.downloadCaptionByLanguage(videoId, selectedCaption.languageCode);

      return {
        available: true,
        isManual: true,
        caption: selectedCaption,
        text: captionText,
      };
    } catch (error) {
      console.warn(`Failed to fetch captions for ${videoId}:`, error);
      return { available: false, isManual: false, caption: null, text: null };
    }
  }

  private async downloadCaptionByLanguage(videoId: string, lang: string): Promise<string | null> {
    try {
      // Use YouTube's timedtext API to download caption
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as {
        events?: Array<{
          segs?: Array<{ utf8: string }>;
          tStartMs?: number;
        }>;
      };

      // Parse JSON3 format and extract text with timestamps
      const segments: string[] = [];
      for (const event of data.events || []) {
        if (event.segs) {
          const text = event.segs.map((seg) => seg.utf8).join('');
          if (text.trim()) {
            const timeMs = event.tStartMs || 0;
            const timeStr = this.formatTimestamp(timeMs);
            segments.push(`[${timeStr}] ${text.trim()}`);
          }
        }
      }

      return segments.length > 0 ? segments.join('\n') : null;
    } catch (error) {
      console.warn('Failed to download caption:', error);
      return null;
    }
  }

  private formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
