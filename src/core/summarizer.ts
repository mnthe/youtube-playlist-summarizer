import { join } from 'path';
import { YouTubeClient } from './youtube/index.js';
import { GeminiClient } from './gemini/index.js';
import { ScreenshotCapturer } from './screenshot/index.js';
import { StateManager } from './state/index.js';
import { MarkdownGenerator } from './output/index.js';
import type { SummarizerConfig, VideoInfo } from '../types/index.js';

export interface SummarizerCallbacks {
  onProgress?: (message: string) => void;
  onVideoStart?: (video: VideoInfo, index: number, total: number) => void;
  onVideoComplete?: (video: VideoInfo, index: number, total: number) => void;
  onVideoError?: (video: VideoInfo, error: Error) => void;
}

export class Summarizer {
  private youtube: YouTubeClient;
  private gemini: GeminiClient;
  private screenshotCapturer: ScreenshotCapturer;
  private markdownGenerator: MarkdownGenerator;

  constructor(
    youtubeApiKey: string,
    geminiConfig: { projectId: string; location: string }
  ) {
    this.youtube = new YouTubeClient(youtubeApiKey);
    this.gemini = new GeminiClient(geminiConfig);
    this.screenshotCapturer = new ScreenshotCapturer();
    this.markdownGenerator = new MarkdownGenerator();
  }

  async summarizePlaylist(
    config: SummarizerConfig,
    callbacks: SummarizerCallbacks = {}
  ): Promise<void> {
    const { onProgress, onVideoStart, onVideoComplete, onVideoError } = callbacks;

    if (!config.playlistUrl) {
      throw new Error('Playlist URL is required');
    }

    // Parse playlist ID
    const playlistId = this.youtube.parsePlaylistId(config.playlistUrl);
    onProgress?.(`재생목록 ID: ${playlistId}`);

    // Initialize state manager
    const stateManager = new StateManager(config.outputDir, playlistId);

    // Try to load existing state
    let state = await stateManager.load();

    if (!state) {
      // Fetch playlist info
      onProgress?.('재생목록 정보를 가져오는 중...');
      const playlistInfo = await this.youtube.getPlaylistInfo(playlistId);
      onProgress?.(`재생목록: ${playlistInfo.title} (${playlistInfo.videoCount}개 영상)`);

      // Fetch all videos
      onProgress?.('영상 목록을 가져오는 중...');
      const videos = await this.youtube.getPlaylistVideos(playlistId);
      onProgress?.(`${videos.length}개 영상 발견`);

      // Initialize state
      state = await stateManager.initialize(
        playlistId,
        playlistInfo.title,
        { locale: config.locale, withScreenshots: config.withScreenshots },
        videos.map((v) => ({ id: v.id, title: v.title }))
      );
    } else {
      onProgress?.(`기존 상태 로드됨: ${state.playlistTitle}`);
    }

    // Get pending videos
    const pendingVideoIds = stateManager.getPendingVideos();
    onProgress?.(`처리 대기 중: ${pendingVideoIds.length}개 영상`);

    if (pendingVideoIds.length === 0) {
      onProgress?.('모든 영상이 이미 처리되었습니다.');
      return;
    }

    // Get video details for pending videos
    const videos = await this.youtube.getVideoDetails(pendingVideoIds);

    // Process each video
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoState = stateManager.getVideoState(video.id);
      if (!videoState) continue;

      onVideoStart?.(video, i + 1, videos.length);

      try {
        const outputDir = join(
          config.outputDir,
          `playlist-${playlistId}`,
          videoState.outputDir
        );

        // Step 1: Summarize with Gemini (if not done)
        let timestamps: string[] = [];

        if (videoState.summary.status !== 'completed') {
          onProgress?.(`[${i + 1}/${videos.length}] Gemini로 요약 중: ${video.title}`);

          await stateManager.updateSummaryStatus(video.id, 'in_progress');

          const summary = await this.gemini.summarizeVideo(video.url, config.locale);
          timestamps = summary.sections.map((s) => s.timestamp);

          // Generate markdown
          const markdown = this.markdownGenerator.generate(video, summary, {
            locale: config.locale,
            withScreenshots: config.withScreenshots,
          });

          // Write markdown file
          const markdownPath = join(outputDir, 'README.md');
          await this.markdownGenerator.writeToFile(markdown, markdownPath);

          await stateManager.updateSummaryStatus(video.id, 'completed', timestamps);
          onProgress?.(`요약 완료: ${video.title}`);
        } else {
          timestamps = videoState.summary.timestamps || [];
          onProgress?.(`요약 이미 완료됨: ${video.title}`);
        }

        // Step 2: Capture screenshots (if enabled and not done)
        if (
          config.withScreenshots &&
          videoState.screenshots.status !== 'completed' &&
          timestamps.length > 0
        ) {
          onProgress?.(
            `[${i + 1}/${videos.length}] 스크린샷 캡처 중: ${timestamps.length}개`
          );

          await stateManager.updateScreenshotStatus(video.id, 'in_progress', 0, []);

          const screenshotDir = join(outputDir, 'screenshots');
          const results = await this.screenshotCapturer.captureMultiple(
            video.url,
            timestamps,
            screenshotDir
          );

          const successfulFiles = results
            .filter((r) => r.success)
            .map((r) => r.filePath.split('/').pop()!);

          const failedCount = results.filter((r) => !r.success).length;

          if (failedCount > 0) {
            const errors = results
              .filter((r) => !r.success)
              .map((r) => r.error)
              .join('; ');

            await stateManager.updateScreenshotStatus(
              video.id,
              failedCount === results.length ? 'failed' : 'completed',
              successfulFiles.length,
              successfulFiles,
              errors
            );
          } else {
            await stateManager.updateScreenshotStatus(
              video.id,
              'completed',
              successfulFiles.length,
              successfulFiles
            );
          }

          onProgress?.(
            `스크린샷 완료: ${successfulFiles.length}/${timestamps.length}`
          );
        }

        onVideoComplete?.(video, i + 1, videos.length);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onVideoError?.(video, err);

        // Update state with error
        if (videoState.summary.status !== 'completed') {
          await stateManager.updateSummaryStatus(video.id, 'failed', undefined, err.message);
        } else {
          await stateManager.updateScreenshotStatus(
            video.id,
            'failed',
            videoState.screenshots.completed,
            videoState.screenshots.files,
            err.message
          );
        }
      }
    }

    const stats = stateManager.getStats();
    onProgress?.(
      `완료! 성공: ${stats.completed}, 실패: ${stats.failed}, 대기: ${stats.pending}`
    );
  }

  async summarizeVideo(
    videoUrl: string,
    config: Omit<SummarizerConfig, 'playlistUrl'>,
    callbacks: SummarizerCallbacks = {}
  ): Promise<void> {
    const { onProgress } = callbacks;

    const videoId = this.youtube.parseVideoId(videoUrl);
    onProgress?.(`영상 ID: ${videoId}`);

    const video = await this.youtube.getVideo(videoId);
    onProgress?.(`영상: ${video.title}`);

    // Summarize
    onProgress?.('Gemini로 요약 중...');
    const summary = await this.gemini.summarizeVideo(video.url, config.locale);
    const timestamps = summary.sections.map((s) => s.timestamp);
    onProgress?.(`요약 완료: ${timestamps.length}개 타임스탬프`);

    // Create output directory
    const safeTitle = video.title
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50);

    const outputDir = join(config.outputDir, safeTitle);

    // Generate and write markdown
    const markdown = this.markdownGenerator.generate(video, summary, {
      locale: config.locale,
      withScreenshots: config.withScreenshots,
    });

    const markdownPath = join(outputDir, 'README.md');
    await this.markdownGenerator.writeToFile(markdown, markdownPath);
    onProgress?.(`마크다운 저장됨: ${markdownPath}`);

    // Capture screenshots
    if (config.withScreenshots && timestamps.length > 0) {
      onProgress?.(`스크린샷 캡처 중: ${timestamps.length}개`);
      const screenshotDir = join(outputDir, 'screenshots');
      const results = await this.screenshotCapturer.captureMultiple(
        video.url,
        timestamps,
        screenshotDir
      );

      const successCount = results.filter((r) => r.success).length;
      onProgress?.(`스크린샷 완료: ${successCount}/${timestamps.length}`);
    }

    onProgress?.('완료!');
  }
}
