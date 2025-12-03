export * from './youtube.js';
export * from './gemini.js';
export * from './state.js';
export * from './confluence.js';

export interface SummarizerConfig {
  playlistUrl?: string;
  videoUrl?: string;
  locale: string;
  outputDir: string;
  concurrency: number;
  withScreenshots: boolean;
  retryCount: number;
}
