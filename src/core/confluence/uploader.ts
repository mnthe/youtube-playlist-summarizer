import { readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { ConfluenceClient } from './client.js';
import { MarkdownToConfluenceConverter } from './converter.js';
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

export class ConfluenceUploader {
  private client: ConfluenceClient;
  private converter: MarkdownToConfluenceConverter;
  private onRetry?: (attempt: number, maxRetries: number, error: string, context?: string) => void;

  constructor(
    config: ConfluenceConfig,
    options: { onRetry?: (attempt: number, maxRetries: number, error: string, context?: string) => void } = {}
  ) {
    this.onRetry = options.onRetry;
    this.client = new ConfluenceClient(config, {
      maxRetries: 3,
      retryDelayMs: 5000,
      onRetry: this.onRetry,
    });
    this.converter = new MarkdownToConfluenceConverter();
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

    // Check if playlist index page already exists
    let indexPage = await this.client.findChildPageByTitle(parentPageId, playlistTitle);

    if (!indexPage) {
      // Create playlist index page (will update with links later)
      onProgress?.(`인덱스 페이지 생성 중: ${playlistTitle}`);
      indexPage = await this.client.createPage({
        spaceId,
        parentId: parentPageId,
        title: playlistTitle,
        body: `<p>영상 목록을 불러오는 중...</p>`,
      });
      onPageCreated?.(playlistTitle, indexPage.id);
    } else {
      onProgress?.(`기존 인덱스 페이지 사용: ${playlistTitle}`);
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
    const indexContent = this.converter.convertToIndexPage(
      playlistTitle,
      videoPages.map((vp) => ({
        title: vp.title,
        pageId: vp.pageId,
        pageTitle: vp.title,
        videoId: vp.videoId,
        summary: vp.summary,
      }))
    );

    const currentIndexPage = await this.client.getPage(indexPage.id);
    await this.client.updatePage(
      indexPage.id,
      playlistTitle,
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

    // Read and convert markdown
    const markdown = await readFile(markdownPath, 'utf-8');
    const confluenceContent = this.converter.convert(markdown);

    // Extract summary from markdown (text after ## 요약 until next heading)
    const summaryMatch = markdown.match(/## 요약\s*\n\n([^\n#]+)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

    // Normalize title: collapse multiple spaces, trim
    const normalizedTitle = video.title.replace(/\s+/g, ' ').trim();

    // Check if page already exists
    let page = await this.client.findChildPageByTitle(parentPageId, normalizedTitle);

    if (!page) {
      // Create video page
      page = await this.client.createPage({
        spaceId,
        parentId: parentPageId,
        title: normalizedTitle,
        body: confluenceContent,
      });
      callbacks.onPageCreated?.(normalizedTitle, page.id);
    } else {
      // Update existing page
      const currentPage = await this.client.getPage(page.id);
      await this.client.updatePage(
        page.id,
        normalizedTitle,
        confluenceContent,
        currentPage.version || 1
      );
      callbacks.onPageUpdated?.(normalizedTitle, page.id);
    }

    // Upload screenshots as attachments
    const attachments: string[] = [];
    try {
      const screenshotFiles = await readdir(screenshotDir);
      callbacks.onProgress?.(`스크린샷 ${screenshotFiles.length}개 발견: ${screenshotDir}`);

      for (const fileName of screenshotFiles) {
        if (!fileName.endsWith('.png') && !fileName.endsWith('.jpg')) {
          continue;
        }

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
    } catch (error) {
      // Screenshots directory might not exist
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ENOENT')) {
        callbacks.onError?.(`스크린샷 디렉토리 읽기 실패: ${message}`);
      }
    }

    // Re-update page content after attachments are uploaded
    // This ensures Confluence can properly resolve image references
    if (attachments.length > 0) {
      callbacks.onProgress?.(`페이지 내용 재업데이트 중 (첨부파일 참조 갱신)...`);
      const currentPage = await this.client.getPage(page.id);
      await this.client.updatePage(
        page.id,
        video.title,
        confluenceContent,
        currentPage.version || 1
      );
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
