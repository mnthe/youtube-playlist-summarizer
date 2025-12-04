import { readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { ConfluenceClient } from './client.js';
import { MarkdownToADFConverter } from './adf-converter.js';
import type { ConfluenceConfig, ConfluencePage } from '../../types/index.js';

export interface UploadCallbacks {
  onProgress?: (message: string) => void;
  onPageCreated?: (title: string, pageId: string) => void;
  onPageUpdated?: (title: string, pageId: string) => void;
  onAttachmentUploaded?: (fileName: string) => void;
  onError?: (message: string) => void;
  onRetry?: (attempt: number, maxRetries: number, error: string) => void;
}

export interface UploadResult {
  indexPageId: string;
  indexPageUrl: string;
  videoPages: Array<{
    videoId: string;
    title: string;
    pageId: string;
    pageUrl: string;
    attachments: string[];
    summary?: string;
  }>;
}

// Upload attachments in batches to prevent API timeout
const ATTACHMENT_BATCH_SIZE = 5;
const ATTACHMENT_BATCH_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConfluenceUploader {
  private client: ConfluenceClient;
  private converter: MarkdownToADFConverter;
  private baseUrl: string;
  private maxImages?: number;
  private onRetry?: (attempt: number, maxRetries: number, error: string, context?: string) => void;

  constructor(
    config: ConfluenceConfig,
    options: {
      onRetry?: (attempt: number, maxRetries: number, error: string, context?: string) => void;
      maxImages?: number; // Limit images per page to prevent Confluence API timeout
    } = {}
  ) {
    this.onRetry = options.onRetry;
    this.maxImages = options.maxImages;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.client = new ConfluenceClient(config, {
      maxRetries: 3,
      retryDelayMs: 5000,
      onRetry: this.onRetry,
    });
    this.converter = new MarkdownToADFConverter();
  }

  private async hasScreenshotDir(screenshotDir: string): Promise<boolean> {
    try {
      await access(screenshotDir);
      return true;
    } catch {
      return false;
    }
  }

  async uploadPlaylist(
    parentPageUrl: string,
    playlistDir: string,
    playlistTitle: string,
    videos: Array<{
      id: string;
      title: string;
      outputDir: string;
    }>,
    callbacks: UploadCallbacks = {}
  ): Promise<UploadResult> {
    const { onProgress, onPageCreated, onPageUpdated, onError } = callbacks;

    // Parse parent page URL
    const { baseUrl, pageId: parentPageId } = this.client.parsePageUrl(parentPageUrl);
    onProgress?.(`부모 페이지 ID: ${parentPageId}`);

    // Get space ID from parent page
    const spaceId = await this.client.getSpaceIdFromPage(parentPageId);
    onProgress?.(`Space ID: ${spaceId}`);

    // Normalize playlist title
    const normalizedPlaylistTitle = playlistTitle.replace(/\s+/g, ' ').trim();

    // Check if playlist index page already exists - first under parent, then in whole space
    let indexPage = await this.client.findChildPageByTitle(parentPageId, normalizedPlaylistTitle);

    if (!indexPage) {
      // Not under parent, check if exists anywhere in space
      indexPage = await this.client.findPageByTitleInSpace(spaceId, normalizedPlaylistTitle);
    }

    if (!indexPage) {
      // Create playlist index page (will update with links later)
      onProgress?.(`인덱스 페이지 생성 중: ${normalizedPlaylistTitle}`);
      indexPage = await this.client.createPage({
        spaceId,
        parentId: parentPageId,
        title: normalizedPlaylistTitle,
        body: `<p>영상 목록을 불러오는 중...</p>`,
      });
      onPageCreated?.(normalizedPlaylistTitle, indexPage.id);
    } else {
      onProgress?.(`기존 인덱스 페이지 사용: ${normalizedPlaylistTitle}`);
    }

    // Upload each video
    const videoPages: UploadResult['videoPages'] = [];

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      onProgress?.(`[${i + 1}/${videos.length}] 업로드 중: ${video.title}`);

      try {
        const videoPageResult = await this.uploadVideoPage(
          spaceId,
          indexPage.id,
          playlistDir,
          video,
          callbacks
        );
        videoPages.push(videoPageResult);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError?.(`영상 업로드 실패 (${video.title}): ${message}`);
      }
    }

    // Update index page with links to all video pages
    onProgress?.('인덱스 페이지 업데이트 중...');
    const indexAdf = this.converter.convertToIndexPage(
      normalizedPlaylistTitle,
      videoPages.map((vp) => ({
        title: vp.title,
        pageId: vp.pageId,
        pageUrl: vp.pageUrl,
        pageTitle: vp.title,
        videoId: vp.videoId,
        summary: vp.summary,
      }))
    );
    const indexContent = this.converter.toJsonString(indexAdf);

    const currentIndexPage = await this.client.getPage(indexPage.id);
    await this.client.updatePage(
      indexPage.id,
      normalizedPlaylistTitle,
      indexContent,
      currentIndexPage.version || 1
    );
    onPageUpdated?.(playlistTitle, indexPage.id);

    onProgress?.('업로드 완료!');

    return {
      indexPageId: indexPage.id,
      indexPageUrl: this.client.getPageUrl(indexPage.id),
      videoPages,
    };
  }

  private async uploadVideoPage(
    spaceId: string,
    parentPageId: string,
    playlistDir: string,
    video: { id: string; title: string; outputDir: string },
    callbacks: UploadCallbacks
  ): Promise<UploadResult['videoPages'][0]> {
    const { onPageCreated, onAttachmentUploaded } = callbacks;

    const videoDir = join(playlistDir, video.outputDir);
    const markdownPath = join(videoDir, 'README.md');
    const screenshotDir = join(videoDir, 'screenshots');

    // Check if README.md exists (video might not be summarized yet)
    try {
      await access(markdownPath);
    } catch {
      throw new Error(`요약 파일이 없습니다 (아직 처리되지 않음): ${markdownPath}`);
    }

    // Read and convert markdown to ADF
    const markdown = await readFile(markdownPath, 'utf-8');
    const adfDocument = this.converter.convert(markdown, {
      maxImages: this.maxImages,
    });
    const confluenceContent = this.converter.toJsonString(adfDocument);

    // Extract summary from markdown (text after ## 요약 until next heading)
    const summaryMatch = markdown.match(/## 요약\s*\n\n([^\n#]+)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

    // Normalize title: collapse multiple spaces, trim
    const normalizedTitle = video.title.replace(/\s+/g, ' ').trim();

    // Check if page already exists - first under parent, then in whole space
    let page = await this.client.findChildPageByTitle(parentPageId, normalizedTitle);

    if (!page) {
      // Not under parent, check if exists anywhere in space
      page = await this.client.findPageByTitleInSpace(spaceId, normalizedTitle);
    }

    // For large content with many images, we'll update with full content after attachments are uploaded
    // Here we just create/check the page exists with placeholder content
    const hasScreenshots = await this.hasScreenshotDir(screenshotDir);
    const needsDeferredUpdate = hasScreenshots && confluenceContent.length > 30000;

    if (!page) {
      // Create video page
      if (needsDeferredUpdate) {
        callbacks.onProgress?.(`[Step 1/4] 새 페이지 생성 중 (플레이스홀더): ${normalizedTitle}`);
        page = await this.client.createPage({
          spaceId,
          parentId: parentPageId,
          title: normalizedTitle,
          body: '<p>콘텐츠 업로드 중...</p>',
        });
      } else {
        callbacks.onProgress?.(`[Step 1/4] 새 페이지 생성 중: ${normalizedTitle}`);
        page = await this.client.createPage({
          spaceId,
          parentId: parentPageId,
          title: normalizedTitle,
          body: confluenceContent,
        });
      }
      callbacks.onPageCreated?.(normalizedTitle, page.id);
    } else {
      // Update existing page - skip if we'll update later with full content
      if (needsDeferredUpdate) {
        callbacks.onProgress?.(`[Step 1/4] 기존 페이지 확인됨 (첨부파일 업로드 후 업데이트 예정): ${normalizedTitle}`);
      } else {
        callbacks.onProgress?.(`[Step 1/4] 기존 페이지 업데이트: ${normalizedTitle} (body: ${confluenceContent.length} chars)`);
        const currentPage = await this.client.getPage(page.id);
        callbacks.onProgress?.(`[Step 1/4] 페이지 버전 확인 완료: v${currentPage.version}`);
        await this.client.updatePage(
          page.id,
          normalizedTitle,
          confluenceContent,
          currentPage.version || 1
        );
        callbacks.onPageUpdated?.(normalizedTitle, page.id);
      }
    }

    // Upload screenshots as attachments (in batches to prevent API timeout)
    callbacks.onProgress?.(`[Step 2/4] 스크린샷 첨부파일 처리 시작`);
    const attachments: string[] = [];
    try {
        const screenshotFiles = await readdir(screenshotDir);
        callbacks.onProgress?.(`[Step 2/4] 스크린샷 ${screenshotFiles.length}개 발견`);

        // Get existing attachments to avoid re-uploading
        const existingAttachments = await this.client.getAttachments(page.id);
        const existingFileNames = new Set(existingAttachments.map((att) => att.title));

        // Filter files to upload
        const filesToUpload: string[] = [];
        for (const fileName of screenshotFiles) {
          if (!fileName.endsWith('.png') && !fileName.endsWith('.jpg')) {
            continue;
          }

          // Skip if already exists
          if (existingFileNames.has(fileName)) {
            callbacks.onProgress?.(`스크린샷 이미 존재 (건너뜀): ${fileName}`);
            attachments.push(fileName);
            continue;
          }

          filesToUpload.push(fileName);
        }

        // Upload in batches to prevent API timeout
        if (filesToUpload.length > 0) {
          const totalBatches = Math.ceil(filesToUpload.length / ATTACHMENT_BATCH_SIZE);
          callbacks.onProgress?.(`[Step 2/4] 스크린샷 ${filesToUpload.length}개 업로드 시작 (${totalBatches}개 배치)`);

          for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const start = batchIndex * ATTACHMENT_BATCH_SIZE;
            const end = Math.min(start + ATTACHMENT_BATCH_SIZE, filesToUpload.length);
            const batchFiles = filesToUpload.slice(start, end);

            callbacks.onProgress?.(`배치 ${batchIndex + 1}/${totalBatches} 업로드 중 (${batchFiles.length}개 파일)`);

            for (const fileName of batchFiles) {
              const filePath = join(screenshotDir, fileName);
              try {
                await this.client.uploadAttachment(page.id, filePath, fileName);
                attachments.push(fileName);
                onAttachmentUploaded?.(fileName);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // Attachment might already exist, continue
                if (message.includes('already exists') || message.includes('Cannot add a new attachment with same file name')) {
                  callbacks.onProgress?.(`스크린샷 이미 존재: ${fileName}`);
                  attachments.push(fileName);
                } else {
                  callbacks.onError?.(`스크린샷 업로드 실패 (${fileName}): ${message}`);
                }
              }
            }

            // Add delay between batches (except after the last batch)
            if (batchIndex < totalBatches - 1) {
              await delay(ATTACHMENT_BATCH_DELAY_MS);
            }
          }
        }
    } catch (error) {
      // Screenshots directory might not exist
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ENOENT')) {
        callbacks.onError?.(`스크린샷 디렉토리 읽기 실패: ${message}`);
      }
    }

    // Re-update page content after attachments are uploaded
    // Regenerate ADF with proper image URLs now that we have pageId
    // Also update if we deferred the initial update due to large content
    if (attachments.length > 0 || needsDeferredUpdate) {
      callbacks.onProgress?.(`[Step 3/4] ADF 재생성 중 (이미지 URL 갱신, ${attachments.length}개 이미지)...`);

      // Regenerate ADF with baseUrl and pageId for proper image references
      const updatedAdfDocument = this.converter.convert(markdown, {
        baseUrl: this.baseUrl,
        pageId: page.id,
        maxImages: this.maxImages,
      });
      const updatedContent = this.converter.toJsonString(updatedAdfDocument);
      callbacks.onProgress?.(`[Step 3/4] ADF 재생성 완료 (body: ${updatedContent.length} chars)`);

      callbacks.onProgress?.(`[Step 4/4] 페이지 최종 업데이트 시작...`);
      const currentPage = await this.client.getPage(page.id);
      callbacks.onProgress?.(`[Step 4/4] 현재 버전: v${currentPage.version}, 업데이트 요청 중...`);
      await this.client.updatePage(
        page.id,
        normalizedTitle,
        updatedContent,
        currentPage.version || 1
      );
      callbacks.onProgress?.(`[Step 4/4] 페이지 업데이트 완료`);
    }

    return {
      videoId: video.id,
      title: normalizedTitle,
      pageId: page.id,
      pageUrl: this.client.getPageUrl(page.id),
      attachments,
      summary,
    };
  }

  async uploadSingleVideo(
    parentPageUrl: string,
    videoDir: string,
    videoTitle: string,
    callbacks: UploadCallbacks = {}
  ): Promise<{ pageId: string; pageUrl: string; attachments: string[] }> {
    const { onProgress, onPageCreated, onAttachmentUploaded } = callbacks;

    const { pageId: parentPageId } = this.client.parsePageUrl(parentPageUrl);
    const spaceId = await this.client.getSpaceIdFromPage(parentPageId);

    onProgress?.(`영상 페이지 업로드 중: ${videoTitle}`);

    const result = await this.uploadVideoPage(
      spaceId,
      parentPageId,
      '', // No playlist dir
      { id: '', title: videoTitle, outputDir: videoDir },
      callbacks
    );

    onProgress?.('업로드 완료!');

    return {
      pageId: result.pageId,
      pageUrl: result.pageUrl,
      attachments: result.attachments,
    };
  }
}
