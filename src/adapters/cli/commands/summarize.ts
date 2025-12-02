import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { Summarizer } from '../../../core/index.js';
import type { SummarizerConfig } from '../../../types/index.js';

loadEnv();

export function createSummarizeCommand(): Command {
  const command = new Command('summarize')
    .description('YouTube 재생목록 또는 영상을 요약합니다')
    .option('-p, --playlist <url>', '재생목록 URL')
    .option('-v, --video <url>', '단일 영상 URL')
    .option('-l, --locale <locale>', '출력 언어', 'ko')
    .option('-o, --output <dir>', '출력 디렉토리', './output')
    .option('-c, --concurrency <number>', '동시 처리 수', '1')
    .option('--no-screenshots', '스크린샷 제외')
    .option('-r, --retry <number>', '재시도 횟수', '3')
    .option('--verbose', '상세 로그 출력')
    .action(async (options) => {
      const youtubeApiKey = process.env.YOUTUBE_API_KEY;
      const projectId = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      if (!youtubeApiKey) {
        console.error('❌ YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.');
        process.exit(1);
      }

      if (!projectId) {
        console.error('❌ GOOGLE_CLOUD_PROJECT 환경변수가 설정되지 않았습니다.');
        process.exit(1);
      }

      if (!options.playlist && !options.video) {
        console.error('❌ --playlist 또는 --video 옵션이 필요합니다.');
        process.exit(1);
      }

      const config: SummarizerConfig = {
        playlistUrl: options.playlist,
        videoUrl: options.video,
        locale: options.locale,
        outputDir: options.output,
        concurrency: parseInt(options.concurrency, 10),
        withScreenshots: options.screenshots !== false,
        retryCount: parseInt(options.retry, 10),
      };

      const summarizer = new Summarizer(youtubeApiKey, { projectId, location });

      const callbacks = {
        onProgress: (message: string) => console.log(`ℹ️  ${message}`),
        onDebug: options.verbose
          ? (message: string) => console.log(`🔍 ${message}`)
          : undefined,
        onVideoStart: (video: { title: string }, index: number, total: number) =>
          console.log(`\n🎬 [${index}/${total}] 시작: ${video.title}`),
        onVideoComplete: (video: { title: string }, index: number, total: number) =>
          console.log(`✅ [${index}/${total}] 완료: ${video.title}`),
        onVideoError: (video: { title: string }, error: Error) =>
          console.error(`❌ 오류 (${video.title}): ${error.message}`),
      };

      try {
        if (options.playlist) {
          await summarizer.summarizePlaylist(config, callbacks);
        } else if (options.video) {
          await summarizer.summarizeVideo(options.video, config, callbacks);
        }
      } catch (error) {
        console.error('❌ 오류:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return command;
}
