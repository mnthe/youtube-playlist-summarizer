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

export interface PlaylistSummaryResult {
  id: string;
  title: string;
  videos: Array<{
    id: string;
    title: string;
    outputDir: string;
  }>;
}

export interface VideoSummaryResult {
  title: string;
  outputDir: string;
}

export class Summarizer {
  private youtube: YouTubeClient;
  private gemini: GeminiClient;
  private markdownGenerator: MarkdownGenerator;

  constructor(
    youtubeApiKey: string,
    geminiConfig: { projectId: string; location: string; model?: string }
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
  ): Promise<PlaylistSummaryResult> {
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

    // Build result with all videos (not just pending)
    const allVideoStates = Object.entries(state.videos).map(([id, vs]) => ({
      id,
      title: vs.title,
      outputDir: vs.outputDir,
    }));

    if (pendingVideoIds.length === 0) {
      onProgress?.('모든 영상이 이미 처리되었습니다.');
      return {
        id: playlistId,
        title: playlistInfo.title,
        videos: allVideoStates,
      };
    }

    // Get video details for pending videos
    let videoIdsToProcess = pendingVideoIds;

    // Test mode: only process the last video
    if (config.testMode) {
      videoIdsToProcess = [pendingVideoIds[pendingVideoIds.length - 1]];
      onProgress?.(`🧪 테스트 모드: 마지막 영상만 처리 (${videoIdsToProcess[0]})`);
    }

    const videos = await this.youtube.getVideoDetails(videoIdsToProcess);

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
        let screenshotTimestamps: string[] = [];

        if (videoState.summary.status !== 'completed') {
          onProgress?.(`[${index + 1}/${videos.length}] Gemini로 요약 중: ${video.title}`);

          await stateManager.updateSummaryStatus(video.id, 'in_progress');

          // Fetch manual captions if available
          const captionResult = await this.youtube.getCaptions(video.id, [config.locale, 'en']);
          let captionText: string | null = null;

          if (captionResult.isManual && captionResult.text) {
            onProgress?.(`  📝 수동 자막 발견 (${captionResult.caption?.language})`);
            captionText = captionResult.text;
          } else if (captionResult.available) {
            onProgress?.(`  ⚠️ 자동 생성 자막만 있음 (Gemini 내부 ASR 사용)`);
          }

          const summary = await this.gemini.summarizeVideo(video.url, config.locale, captionText);
          timestamps = summary.sections.map((s) => s.timestamp);
          screenshotTimestamps = summary.sections.map((s) => s.screenshotTimestamp);

          // Generate markdown
          const markdown = this.markdownGenerator.generate(video, summary, {
            locale: config.locale,
            withScreenshots: config.withScreenshots,
          });

          // Write markdown file
          const markdownPath = join(outputDir, 'README.md');
          await this.markdownGenerator.writeToFile(markdown, markdownPath);

          await stateManager.updateSummaryStatus(video.id, 'completed', timestamps, undefined, screenshotTimestamps);
          onProgress?.(`요약 완료: ${video.title}`);
        } else {
          timestamps = videoState.summary.timestamps || [];
          screenshotTimestamps = videoState.summary.screenshotTimestamps || timestamps;
          onProgress?.(`요약 이미 완료됨: ${video.title}`);
        }

        // Step 2: Capture screenshots (if enabled and not all done)
        // Filter out already successful timestamps for retry
        const existingFiles = videoState.screenshots.files || [];
        const existingTimestamps = new Set(
          existingFiles.map((f) => f.replace('.png', '').replace(/-/g, ':'))
        );
        const pendingTimestamps = screenshotTimestamps.filter(
          (ts) => !existingTimestamps.has(ts)
        );

        if (
          config.withScreenshots &&
          pendingTimestamps.length > 0
        ) {
          onProgress?.(
            `[${index + 1}/${videos.length}] 스크린샷 캡처 중: ${pendingTimestamps.length}개 (기존 ${existingFiles.length}개)`
          );

          await stateManager.updateScreenshotStatus(
            video.id,
            'in_progress',
            existingFiles.length,
            existingFiles
          );

          const screenshotDir = join(outputDir, 'screenshots');
          const screenshotCapturer = this.createScreenshotCapturer(callbacks);
          const results = await screenshotCapturer.captureMultiple(
            video.url,
            pendingTimestamps,
            screenshotDir
          );

          const newSuccessfulFiles = results
            .filter((r) => r.success)
            .map((r) => r.filePath.split('/').pop()!);

          // Merge existing files with newly successful files
          const allSuccessfulFiles = [...existingFiles, ...newSuccessfulFiles];

          const failedResults = results.filter((r) => !r.success);

          if (failedResults.length > 0) {
            onProgress?.(`⚠️ 스크린샷 실패: ${failedResults.length}개`);
            for (const failed of failedResults) {
              onProgress?.(`  - [${failed.timestamp}] ${failed.error}`);
            }

            const errors = failedResults.map((r) => r.error).join('; ');

            await stateManager.updateScreenshotStatus(
              video.id,
              'failed',  // Keep as failed so retry will pick up remaining
              allSuccessfulFiles.length,
              allSuccessfulFiles,
              errors
            );
          } else {
            await stateManager.updateScreenshotStatus(
              video.id,
              'completed',
              allSuccessfulFiles.length,
              allSuccessfulFiles
            );
          }

          onProgress?.(
            `스크린샷 완료: ${allSuccessfulFiles.length}/${screenshotTimestamps.length}`
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

    // Get updated state for return value
    const finalState = stateManager.getState()!;
    return {
      id: playlistId,
      title: playlistInfo.title,
      videos: Object.entries(finalState.videos).map(([id, vs]) => ({
        id,
        title: vs.title,
        outputDir: vs.outputDir,
      })),
    };
  }

  async summarizeVideo(
    videoUrl: string,
    config: Omit<SummarizerConfig, 'playlistUrl'>,
    callbacks: SummarizerCallbacks = {}
  ): Promise<VideoSummaryResult> {
    const { onProgress } = callbacks;

    const videoId = this.youtube.parseVideoId(videoUrl);
    onProgress?.(`영상 ID: ${videoId}`);

    const video = await this.youtube.getVideo(videoId);
    onProgress?.(`영상: ${video.title}`);

    // Fetch manual captions if available
    const captionResult = await this.youtube.getCaptions(videoId, [config.locale, 'en']);
    let captionText: string | null = null;

    if (captionResult.isManual && captionResult.text) {
      onProgress?.(`📝 수동 자막 발견 (${captionResult.caption?.language})`);
      captionText = captionResult.text;
    } else if (captionResult.available) {
      onProgress?.(`⚠️ 자동 생성 자막만 있음 (Gemini 내부 ASR 사용)`);
    }

    // Summarize
    onProgress?.('Gemini로 요약 중...');
    const summary = await this.gemini.summarizeVideo(video.url, config.locale, captionText);
    const screenshotTimestamps = summary.sections.map((s) => s.screenshotTimestamp);
    onProgress?.(`요약 완료: ${screenshotTimestamps.length}개 섹션`);

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
    if (config.withScreenshots && screenshotTimestamps.length > 0) {
      onProgress?.(`스크린샷 캡처 중: ${screenshotTimestamps.length}개`);
      const screenshotDir = join(outputDir, 'screenshots');
      const screenshotCapturer = this.createScreenshotCapturer(callbacks);
      const results = await screenshotCapturer.captureMultiple(
        video.url,
        screenshotTimestamps,
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

      onProgress?.(`스크린샷 완료: ${successCount}/${screenshotTimestamps.length}`);
    }

    onProgress?.('완료!');

    return {
      title: video.title,
      outputDir,
    };
  }
}
