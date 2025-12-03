import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { Summarizer } from '../../../core/index.js';
import { ConfluenceUploader } from '../../../core/confluence/index.js';
import type { SummarizerConfig, ConfluenceConfig } from '../../../types/index.js';

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
    .option('--upload <wikiUrl>', 'Confluence 위키 페이지 URL (하위 페이지로 업로드)')
    .option('--test', '테스트 모드: 마지막 영상 1개만 처리')
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

      // Confluence 업로드 설정 확인
      let confluenceConfig: ConfluenceConfig | null = null;
      if (options.upload) {
        const confluenceEmail = process.env.CONFLUENCE_EMAIL;
        const confluenceApiToken = process.env.CONFLUENCE_API_TOKEN;

        if (!confluenceEmail || !confluenceApiToken) {
          console.error('❌ Confluence 업로드를 위해 CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN 환경변수가 필요합니다.');
          process.exit(1);
        }

        // Extract base URL from the wiki page URL
        const urlMatch = options.upload.match(/^(https:\/\/[^/]+)/);
        if (!urlMatch) {
          console.error('❌ 유효하지 않은 Confluence URL입니다.');
          process.exit(1);
        }

        confluenceConfig = {
          baseUrl: urlMatch[1],
          email: confluenceEmail,
          apiToken: confluenceApiToken,
        };
      }

      const config: SummarizerConfig = {
        playlistUrl: options.playlist,
        videoUrl: options.video,
        locale: options.locale,
        outputDir: options.output,
        concurrency: parseInt(options.concurrency, 10),
        withScreenshots: options.screenshots !== false,
        retryCount: parseInt(options.retry, 10),
        testMode: options.test || false,
      };

      if (options.test) {
        console.log('🧪 테스트 모드: 마지막 영상 1개만 처리합니다.');
      }

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
        onVideoError: (video: { title: string }, error: Error) => {
          console.error(`❌ 오류 (${video.title}): ${error.message}`);
          if (options.verbose && error.stack) {
            console.error(`📋 Stack trace:\n${error.stack}`);
          }
        },
      };

      try {
        let playlistInfo: { id: string; title: string; videos: Array<{ id: string; title: string; outputDir: string }> } | null = null;
        let singleVideoInfo: { title: string; outputDir: string } | null = null;

        if (options.playlist) {
          playlistInfo = await summarizer.summarizePlaylist(config, callbacks);
        } else if (options.video) {
          singleVideoInfo = await summarizer.summarizeVideo(options.video, config, callbacks);
        }

        // Confluence 업로드
        if (confluenceConfig && options.upload) {
          console.log('\n📤 Confluence 업로드 시작...');

          const uploader = new ConfluenceUploader(confluenceConfig);
          const uploadCallbacks = {
            onProgress: (message: string) => console.log(`ℹ️  ${message}`),
            onPageCreated: (title: string, pageId: string) =>
              console.log(`📄 페이지 생성됨: ${title} (${pageId})`),
            onPageUpdated: (title: string, pageId: string) =>
              console.log(`🔄 페이지 업데이트됨: ${title} (${pageId})`),
            onAttachmentUploaded: (fileName: string) =>
              options.verbose && console.log(`📎 첨부: ${fileName}`),
            onError: (message: string) => console.error(`⚠️  ${message}`),
          };

          if (playlistInfo) {
            const playlistDir = join(config.outputDir, `playlist-${playlistInfo.id}`);
            const result = await uploader.uploadPlaylist(
              options.upload,
              playlistDir,
              playlistInfo.title,
              playlistInfo.videos,
              uploadCallbacks
            );
            console.log(`\n🔗 인덱스 페이지: ${result.indexPageUrl}`);
          } else if (singleVideoInfo) {
            const result = await uploader.uploadSingleVideo(
              options.upload,
              singleVideoInfo.outputDir,
              singleVideoInfo.title,
              uploadCallbacks
            );
            console.log(`\n🔗 페이지: ${result.pageUrl}`);
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`❌ 오류: ${error.message}`);
          if (options.verbose && error.stack) {
            console.error(`📋 Stack trace:\n${error.stack}`);
          }
          if (error.cause) {
            console.error(`🔗 Cause: ${error.cause}`);
          }
        } else {
          console.error('❌ 오류:', error);
        }
        process.exit(1);
      }
    });

  return command;
}
