import { join } from 'path';
import { YouTubeClient } from './youtube/index.js';
import { GeminiClient } from './gemini/index.js';
import { ScreenshotCapturer } from './screenshot/index.js';
import { StateManager } from './state/index.js';
import { MarkdownGenerator } from './output/index.js';
import type { SummarizerConfig, VideoInfo } from '../types/index.js';

export interface SummarizerCallbacks {
  onProgress?: (message: string) => void;
  onDebug?: (message: string) => void;
  onVideoStart?: (video: VideoInfo, index: number, total: number) => void;
  onVideoComplete?: (video: VideoInfo, index: number, total: number) => void;
  onVideoError?: (video: VideoInfo, error: Error) => void;
}

export class Summarizer {
  private youtube: YouTubeClient;
  private gemini: GeminiClient;
  private markdownGenerator: MarkdownGenerator;

  constructor(
    youtubeApiKey: string,
    geminiConfig: { projectId: string; location: string }
  ) {
    this.youtube = new YouTubeClient(youtubeApiKey);
    this.gemini = new GeminiClient(geminiConfig);
    this.markdownGenerator = new MarkdownGenerator();
  }

  private createScreenshotCapturer(
    callbacks: SummarizerCallbacks,
    timestampOffset: number = 3
  ): ScreenshotCapturer {
    return new ScreenshotCapturer(
      '/tmp/yt-summarize',
      {
        debug: callbacks.onDebug,
        error: callbacks.onProgress, // 에러도 progress로 출력
      },
      timestampOffset
    );
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

    // Fetch playlist info
    onProgress?.('재생목록 정보를 가져오는 중...');
    const playlistInfo = await this.youtube.getPlaylistInfo(playlistId);

    // Fetch all current videos from playlist
    onProgress?.('영상 목록을 가져오는 중...');
    const currentVideos = await this.youtube.getPlaylistVideos(playlistId);
    onProgress?.(`재생목록: ${playlistInfo.title} (${currentVideos.length}개 영상)`);

    // Try to load existing state
    let state = await stateManager.load();

    if (!state) {
      // Initialize new state
      state = await stateManager.initialize(
        playlistId,
        playlistInfo.title,
        { locale: config.locale, withScreenshots: config.withScreenshots },
        currentVideos.map((v) => ({ id: v.id, title: v.title }))
      );
      onProgress?.(`새 재생목록 초기화됨: ${currentVideos.length}개 영상`);
    } else {
      onProgress?.(`기존 상태 로드됨: ${state.playlistTitle}`);

      // Check for new videos added to the playlist
      const newVideoIds = await stateManager.addNewVideos(
        currentVideos.map((v) => ({ id: v.id, title: v.title }))
      );

      if (newVideoIds.length > 0) {
        onProgress?.(`🆕 새 영상 ${newVideoIds.length}개 발견!`);
        state = stateManager.getState()!;
      }
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

    // Process videos with concurrency control
    const concurrency = config.concurrency || 1;
    let completedCount = 0;

    const processVideo = async (video: VideoInfo, index: number): Promise<void> => {
      const videoState = stateManager.getVideoState(video.id);
      if (!videoState) return;

      onVideoStart?.(video, index + 1, videos.length);

      try {
        const outputDir = join(
          config.outputDir,
          `playlist-${playlistId}`,
          videoState.outputDir
        );

        // Step 1: Summarize with Gemini (if not done)
        let timestamps: string[] = [];

        if (videoState.summary.status !== 'completed') {
          onProgress?.(`[${index + 1}/${videos.length}] Gemini로 요약 중: ${video.title}`);

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
            `[${index + 1}/${videos.length}] 스크린샷 캡처 중: ${timestamps.length}개`
          );

          await stateManager.updateScreenshotStatus(video.id, 'in_progress', 0, []);

          const screenshotDir = join(outputDir, 'screenshots');
          const screenshotCapturer = this.createScreenshotCapturer(callbacks);
          const results = await screenshotCapturer.captureMultiple(
            video.url,
            timestamps,
            screenshotDir
          );

          const successfulFiles = results
            .filter((r) => r.success)
            .map((r) => r.filePath.split('/').pop()!);

          const failedResults = results.filter((r) => !r.success);

          if (failedResults.length > 0) {
            onProgress?.(`⚠️ 스크린샷 실패: ${failedResults.length}개`);
            for (const failed of failedResults) {
              onProgress?.(`  - [${failed.timestamp}] ${failed.error}`);
            }

            const errors = failedResults.map((r) => r.error).join('; ');

            await stateManager.updateScreenshotStatus(
              video.id,
              failedResults.length === results.length ? 'failed' : 'completed',
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

        completedCount++;
        onVideoComplete?.(video, completedCount, videos.length);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onVideoError?.(video, err);

        // Update state with error
        const currentVideoState = stateManager.getVideoState(video.id);
        if (currentVideoState && currentVideoState.summary.status !== 'completed') {
          await stateManager.updateSummaryStatus(video.id, 'failed', undefined, err.message);
        } else if (currentVideoState) {
          await stateManager.updateScreenshotStatus(
            video.id,
            'failed',
            currentVideoState.screenshots.completed,
            currentVideoState.screenshots.files,
            err.message
          );
        }
      }
    };

    // Run with concurrency control
    if (concurrency <= 1) {
      // Sequential processing
      for (let i = 0; i < videos.length; i++) {
        await processVideo(videos[i], i);
      }
    } else {
      // Parallel processing with pool
      const pool: Promise<void>[] = [];
      let nextIndex = 0;

      const runNext = async (): Promise<void> => {
        while (nextIndex < videos.length) {
          const currentIndex = nextIndex++;
          await processVideo(videos[currentIndex], currentIndex);
        }
      };

      // Start initial workers
      for (let i = 0; i < Math.min(concurrency, videos.length); i++) {
        pool.push(runNext());
      }

      await Promise.all(pool);
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
      const screenshotCapturer = this.createScreenshotCapturer(callbacks);
      const results = await screenshotCapturer.captureMultiple(
        video.url,
        timestamps,
        screenshotDir
      );

      const successCount = results.filter((r) => r.success).length;
      const failedResults = results.filter((r) => !r.success);

      if (failedResults.length > 0) {
        onProgress?.(`⚠️ 스크린샷 실패: ${failedResults.length}개`);
        for (const failed of failedResults) {
          onProgress?.(`  - [${failed.timestamp}] ${failed.error}`);
        }
      }

      onProgress?.(`스크린샷 완료: ${successCount}/${timestamps.length}`);
    }

    onProgress?.('완료!');
  }
}
