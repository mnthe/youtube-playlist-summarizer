import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  PlaylistState,
  VideoState,
  ProcessStatus,
  SummaryState,
  ScreenshotState,
} from '../../types/index.js';

export class StateManager {
  private statePath: string;
  private state: PlaylistState | null = null;

  constructor(outputDir: string, playlistId: string) {
    this.statePath = join(outputDir, `playlist-${playlistId}`, 'state.json');
  }

  async load(): Promise<PlaylistState | null> {
    try {
      await access(this.statePath);
      const content = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content);
      return this.state;
    } catch {
      return null;
    }
  }

  async initialize(
    playlistId: string,
    playlistTitle: string,
    config: { locale: string; withScreenshots: boolean },
    videos: Array<{ id: string; title: string }>
  ): Promise<PlaylistState> {
    const now = new Date().toISOString();

    this.state = {
      playlistId,
      playlistTitle,
      config,
      totalVideos: videos.length,
      createdAt: now,
      updatedAt: now,
      videos: {},
    };

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const paddedIndex = String(i + 1).padStart(2, '0');
      const safeTitle = this.sanitizeFilename(video.title);
      const outputDir = `${paddedIndex}-${safeTitle}`;

      this.state.videos[video.id] = {
        title: video.title,
        outputDir,
        summary: { status: 'pending' },
        screenshots: { status: 'pending', total: 0, completed: 0, files: [] },
      };
    }

    await this.save();
    return this.state;
  }

  async save(): Promise<void> {
    if (!this.state) return;

    this.state.updatedAt = new Date().toISOString();

    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2));
  }

  getState(): PlaylistState | null {
    return this.state;
  }

  getVideoState(videoId: string): VideoState | null {
    return this.state?.videos[videoId] || null;
  }

  async updateSummaryStatus(
    videoId: string,
    status: ProcessStatus,
    timestamps?: string[],
    error?: string
  ): Promise<void> {
    if (!this.state?.videos[videoId]) return;

    const summary: SummaryState = {
      status,
      ...(status === 'completed' && { completedAt: new Date().toISOString() }),
      ...(timestamps && { timestamps }),
      ...(error && { error }),
    };

    this.state.videos[videoId].summary = summary;

    if (timestamps) {
      this.state.videos[videoId].screenshots.total = timestamps.length;
    }

    await this.save();
  }

  async updateScreenshotStatus(
    videoId: string,
    status: ProcessStatus,
    completedCount: number,
    files: string[],
    error?: string
  ): Promise<void> {
    if (!this.state?.videos[videoId]) return;

    const screenshots: ScreenshotState = {
      status,
      total: this.state.videos[videoId].screenshots.total,
      completed: completedCount,
      files,
      ...(error && { error }),
    };

    this.state.videos[videoId].screenshots = screenshots;
    await this.save();
  }

  getPendingVideos(): string[] {
    if (!this.state) return [];

    return Object.entries(this.state.videos)
      .filter(([_, video]) => {
        const summaryDone = video.summary.status === 'completed';
        const screenshotsDone =
          !this.state!.config.withScreenshots ||
          video.screenshots.status === 'completed';
        return !(summaryDone && screenshotsDone);
      })
      .map(([id]) => id);
  }

  getFailedVideos(): string[] {
    if (!this.state) return [];

    return Object.entries(this.state.videos)
      .filter(
        ([_, video]) =>
          video.summary.status === 'failed' || video.screenshots.status === 'failed'
      )
      .map(([id]) => id);
  }

  async addNewVideos(
    videos: Array<{ id: string; title: string }>
  ): Promise<string[]> {
    if (!this.state) return [];

    const newVideoIds: string[] = [];
    const existingCount = Object.keys(this.state.videos).length;

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];

      // Skip if video already exists in state
      if (this.state.videos[video.id]) {
        continue;
      }

      // Add new video
      const newIndex = existingCount + newVideoIds.length + 1;
      const paddedIndex = String(newIndex).padStart(2, '0');
      const safeTitle = this.sanitizeFilename(video.title);
      const outputDir = `${paddedIndex}-${safeTitle}`;

      this.state.videos[video.id] = {
        title: video.title,
        outputDir,
        summary: { status: 'pending' },
        screenshots: { status: 'pending', total: 0, completed: 0, files: [] },
      };

      newVideoIds.push(video.id);
    }

    if (newVideoIds.length > 0) {
      this.state.totalVideos = Object.keys(this.state.videos).length;
      await this.save();
    }

    return newVideoIds;
  }

  getStats(): {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    pending: number;
  } {
    if (!this.state) {
      return { total: 0, completed: 0, inProgress: 0, failed: 0, pending: 0 };
    }

    let completed = 0;
    let inProgress = 0;
    let failed = 0;
    let pending = 0;

    for (const video of Object.values(this.state.videos)) {
      const summaryDone = video.summary.status === 'completed';
      const screenshotsDone =
        !this.state.config.withScreenshots ||
        video.screenshots.status === 'completed';

      if (video.summary.status === 'failed' || video.screenshots.status === 'failed') {
        failed++;
      } else if (summaryDone && screenshotsDone) {
        completed++;
      } else if (
        video.summary.status === 'in_progress' ||
        video.screenshots.status === 'in_progress'
      ) {
        inProgress++;
      } else {
        pending++;
      }
    }

    return {
      total: this.state.totalVideos,
      completed,
      inProgress,
      failed,
      pending,
    };
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50);
  }
}
