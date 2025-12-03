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
  onRetry?: (attempt: number, maxRetries: number, error: string) => void;
}

export class ConfluenceClient {
  private baseUrl: string;
  private authHeader: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private onRetry?: (attempt: number, maxRetries: number, error: string) => void;

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
    options: RequestInit = {}
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
            this.onRetry?.(attempt + 1, this.maxRetries + 1, error.message);
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
          this.onRetry?.(attempt + 1, this.maxRetries + 1, lastError.message);
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
          representation: 'storage',
          value: request.body,
        },
      }),
    });

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
          representation: 'storage',
          value: body,
        },
        version: {
          number: currentVersion + 1,
        },
      }),
    });

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
            this.onRetry?.(attempt + 1, this.maxRetries + 1, error.message);
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
          this.onRetry?.(attempt + 1, this.maxRetries + 1, lastError.message);
          await this.sleep(delayMs);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Upload failed after retries');
  }

  async getChildPages(pageId: string): Promise<ConfluencePage[]> {
    const response = await this.request<{
      results: Array<{
        id: string;
        title: string;
        spaceId: string;
        parentId: string;
      }>;
    }>(`/wiki/api/v2/pages/${pageId}/children`);

    return response.results.map((page) => ({
      id: page.id,
      title: page.title,
      spaceKey: page.spaceId,
      parentId: page.parentId,
    }));
  }

  async findChildPageByTitle(
    parentId: string,
    title: string
  ): Promise<ConfluencePage | null> {
    const children = await this.getChildPages(parentId);
    return children.find((page) => page.title === title) || null;
  }

  getPageUrl(pageId: string): string {
    return `${this.baseUrl}/wiki/pages/${pageId}`;
  }
}
