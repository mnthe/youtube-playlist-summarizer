export type ProcessStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface SummaryState {
  status: ProcessStatus;
  completedAt?: string;
  timestamps?: string[];
  error?: string;
}

export interface ScreenshotState {
  status: ProcessStatus;
  total: number;
  completed: number;
  files: string[];
  error?: string;
}

export interface VideoState {
  title: string;
  outputDir: string;
  summary: SummaryState;
  screenshots: ScreenshotState;
}

export interface PlaylistState {
  playlistId: string;
  playlistTitle: string;
  config: {
    locale: string;
    withScreenshots: boolean;
  };
  totalVideos: number;
  createdAt: string;
  updatedAt: string;
  videos: Record<string, VideoState>;
}
