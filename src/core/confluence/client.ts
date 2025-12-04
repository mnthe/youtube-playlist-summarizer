import { readFile } from 'fs/promises';
import type {
  ConfluenceConfig,
  ConfluencePage,
  ConfluenceCreatePageRequest,
  ConfluenceAttachment,
} from '../../types/index.js';

export interface ConfluenceClientOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  onRetry?: (attempt: number, maxRetries: number, error: string, context?: string) => void;
}

export class ConfluenceClient {
  private baseUrl: string;
  private authHeader: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private onRetry?: (attempt: number, maxRetries: number, error: string, context?: string) => void;

  constructor(config: ConfluenceConfig, options: ConfluenceClientOptions = {}) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.onRetry = options.onRetry;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    context?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...options.headers,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`Confluence API error (${response.status}): ${errorText}`);

          if (this.isRetryableStatus(response.status) && attempt < this.maxRetries) {
            const delayMs = this.retryDelayMs * Math.pow(2, attempt);
            this.onRetry?.(attempt + 1, this.maxRetries + 1, error.message, context);
            await this.sleep(delayMs);
            lastError = error;
            continue;
          }

          throw error;
        }

        const text = await response.text();
        return text ? JSON.parse(text) : ({} as T);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Network errors - retry
        if (attempt < this.maxRetries && this.isNetworkError(lastError)) {
          const delayMs = this.retryDelayMs * Math.pow(2, attempt);
          this.onRetry?.(attempt + 1, this.maxRetries + 1, lastError.message, context);
          await this.sleep(delayMs);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private isNetworkError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up')
    );
  }

  parsePageUrl(url: string): { baseUrl: string; pageId: string } {
    // Confluence Cloud URL formats:
    // https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title
    // https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456
    const match = url.match(/^(https:\/\/[^/]+)\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
    if (!match) {
      throw new Error(`Invalid Confluence page URL: ${url}`);
    }
    return {
      baseUrl: match[1],
      pageId: match[2],
    };
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    const response = await this.request<{
      id: string;
      title: string;
      spaceId: string;
      parentId?: string;
      version: { number: number };
      body?: { storage: { value: string } };
    }>(`/wiki/api/v2/pages/${pageId}?body-format=storage`);

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.spaceId,
      parentId: response.parentId,
      body: response.body?.storage?.value,
      version: response.version?.number,
    };
  }

  async getSpaceIdFromPage(pageId: string): Promise<string> {
    const response = await this.request<{ spaceId: string }>(
      `/wiki/api/v2/pages/${pageId}`
    );
    return response.spaceId;
  }

  async createPage(request: ConfluenceCreatePageRequest): Promise<ConfluencePage> {
    const context = `createPage: "${request.title}" (body: ${request.body.length} chars)`;
    const response = await this.request<{
      id: string;
      title: string;
      spaceId: string;
      parentId: string;
      version: { number: number };
    }>('/wiki/api/v2/pages', {
      method: 'POST',
      body: JSON.stringify({
        spaceId: request.spaceId,
        parentId: request.parentId,
        title: request.title,
        status: 'current',
        body: {
          representation: 'atlas_doc_format',
          value: request.body,
        },
      }),
    }, context);

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.spaceId,
      parentId: response.parentId,
      version: response.version?.number,
    };
  }

  async updatePage(
    pageId: string,
    title: string,
    body: string,
    currentVersion: number
  ): Promise<ConfluencePage> {
    const context = `updatePage: "${title}" (pageId: ${pageId}, body: ${body.length} chars, version: ${currentVersion} -> ${currentVersion + 1})`;
    const response = await this.request<{
      id: string;
      title: string;
      spaceId: string;
      parentId: string;
      version: { number: number };
    }>(`/wiki/api/v2/pages/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify({
        id: pageId,
        title,
        status: 'current',
        body: {
          representation: 'atlas_doc_format',
          value: body,
        },
        version: {
          number: currentVersion + 1,
        },
      }),
    }, context);

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.spaceId,
      parentId: response.parentId,
      version: response.version?.number,
    };
  }

  async uploadAttachment(
    pageId: string,
    filePath: string,
    fileName: string
  ): Promise<ConfluenceAttachment> {
    const fileBuffer = await readFile(filePath);
    const url = `${this.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
    const context = `uploadAttachment: "${fileName}" (pageId: ${pageId}, size: ${fileBuffer.length} bytes)`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const blob = new Blob([fileBuffer]);
        const formData = new FormData();
        formData.append('file', blob, fileName);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'X-Atlassian-Token': 'nocheck',
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`Failed to upload attachment (${response.status}): ${errorText}`);

          if (this.isRetryableStatus(response.status) && attempt < this.maxRetries) {
            const delayMs = this.retryDelayMs * Math.pow(2, attempt);
            this.onRetry?.(attempt + 1, this.maxRetries + 1, error.message, context);
            await this.sleep(delayMs);
            lastError = error;
            continue;
          }

          throw error;
        }

        const result = (await response.json()) as {
          results?: Array<{ id: string; title: string; mediaType: string }>;
          id?: string;
          title?: string;
          mediaType?: string;
        };
        const attachment = result.results?.[0] || result;

        return {
          id: attachment.id || '',
          title: attachment.title || '',
          mediaType: attachment.mediaType || '',
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries && this.isNetworkError(lastError)) {
          const delayMs = this.retryDelayMs * Math.pow(2, attempt);
          this.onRetry?.(attempt + 1, this.maxRetries + 1, lastError.message, context);
          await this.sleep(delayMs);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Upload failed after retries');
  }

  async getChildPages(pageId: string): Promise<ConfluencePage[]> {
    const allPages: ConfluencePage[] = [];
    let cursor: string | null = null;

    // Paginate through all children
    do {
      const endpoint = cursor
        ? `/wiki/api/v2/pages/${pageId}/children?cursor=${encodeURIComponent(cursor)}&limit=100`
        : `/wiki/api/v2/pages/${pageId}/children?limit=100`;

      const response = await this.request<{
        results: Array<{
          id: string;
          title: string;
          spaceId: string;
          parentId: string;
        }>;
        _links?: {
          next?: string;
        };
      }>(endpoint);

      for (const page of response.results) {
        allPages.push({
          id: page.id,
          title: page.title,
          spaceKey: page.spaceId,
          parentId: page.parentId,
        });
      }

      // Extract cursor from next link if present
      cursor = null;
      if (response._links?.next) {
        const cursorMatch = response._links.next.match(/cursor=([^&]+)/);
        if (cursorMatch) {
          cursor = decodeURIComponent(cursorMatch[1]);
        }
      }
    } while (cursor);

    return allPages;
  }

  async findChildPageByTitle(
    parentId: string,
    title: string
  ): Promise<ConfluencePage | null> {
    const children = await this.getChildPages(parentId);
    // Normalize titles for comparison (collapse whitespace, trim)
    const normalizedTitle = title.replace(/\s+/g, ' ').trim();
    return children.find((page) =>
      page.title.replace(/\s+/g, ' ').trim() === normalizedTitle
    ) || null;
  }

  async findPageByTitleInSpace(
    spaceId: string,
    title: string
  ): Promise<ConfluencePage | null> {
    // Search for page by exact title in space
    const normalizedTitle = title.replace(/\s+/g, ' ').trim();

    try {
      const response = await this.request<{
        results: Array<{
          id: string;
          title: string;
          spaceId: string;
          parentId?: string;
          version?: { number: number };
        }>;
      }>(`/wiki/api/v2/spaces/${spaceId}/pages?title=${encodeURIComponent(normalizedTitle)}&limit=10`);

      // Find exact match (normalized)
      const match = response.results.find((page) =>
        page.title.replace(/\s+/g, ' ').trim() === normalizedTitle
      );

      if (match) {
        return {
          id: match.id,
          title: match.title,
          spaceKey: match.spaceId,
          parentId: match.parentId,
          version: match.version?.number,
        };
      }
    } catch {
      // Search failed, fall back to null
    }

    return null;
  }

  getPageUrl(pageId: string): string {
    return `${this.baseUrl}/wiki/pages/${pageId}`;
  }

  async getAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const response = await this.request<{
      results: Array<{
        id: string;
        title: string;
        mediaType: string;
      }>;
    }>(`/wiki/api/v2/pages/${pageId}/attachments`);

    return response.results.map((att) => ({
      id: att.id,
      title: att.title,
      mediaType: att.mediaType,
    }));
  }

  async attachmentExists(pageId: string, fileName: string): Promise<boolean> {
    const attachments = await this.getAttachments(pageId);
    return attachments.some((att) => att.title === fileName);
  }
}
