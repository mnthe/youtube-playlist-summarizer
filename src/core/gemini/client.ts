import { GoogleGenAI, Type } from '@google/genai';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { VideoSummary, TimestampSection } from '../../types/index.js';
import { createSystemPrompt, createUserPrompt } from './prompts.js';

export interface GeminiClientConfig {
  projectId: string;
  location: string;
  model?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class GeminiClient {
  private client: GoogleGenAI;
  private modelName: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: GeminiClientConfig) {
    this.client = new GoogleGenAI({
      vertexai: true,
      project: config.projectId,
      location: config.location,
    });
    this.modelName = config.model || 'gemini-2.5-flash';
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 5000;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    return (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('429') ||
      message.includes('rate limit')
    );
  }

  private getErrorDetail(error: Error): string {
    const parts: string[] = [error.message];

    // Check for cause (nested error)
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      parts.push(`[cause: ${cause.message}]`);
      // Check for deeper cause
      const deepCause = (cause as Error & { cause?: unknown }).cause;
      if (deepCause instanceof Error) {
        parts.push(`[root: ${deepCause.message}]`);
      }
    } else if (cause) {
      parts.push(`[cause: ${String(cause)}]`);
    }

    // Check for error code
    const code = (error as Error & { code?: string }).code;
    if (code) {
      parts.push(`[code: ${code}]`);
    }

    return parts.join(' ');
  }

  async summarizeVideo(videoUrl: string, locale: string): Promise<VideoSummary> {
    const systemPrompt = createSystemPrompt();
    const userPrompt = createUserPrompt(locale);

    const ytVideo = {
      fileData: {
        fileUri: videoUrl,
        mimeType: 'video/mp4',
      },
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.models.generateContent({
          model: this.modelName,
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: 65536,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                overview: {
                  type: Type.STRING,
                  description: 'Brief overview of the video content',
                },
                sections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      timestamp: {
                        type: Type.STRING,
                        description: 'Section start timestamp in HH:MM:SS or MM:SS format',
                      },
                      screenshotTimestamp: {
                        type: Type.STRING,
                        description: 'Best moment for screenshot in HH:MM:SS or MM:SS format',
                      },
                      title: {
                        type: Type.STRING,
                        description: 'Section title',
                      },
                      content: {
                        type: Type.STRING,
                        description: 'Detailed section content',
                      },
                    },
                    required: ['timestamp', 'screenshotTimestamp', 'title', 'content'],
                  },
                  description: 'Video sections with timestamps',
                },
                keyPoints: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.STRING,
                  },
                  description: 'Key points from the video',
                },
              },
              required: ['overview', 'sections', 'keyPoints'],
            },
          },
          contents: [ytVideo, { text: userPrompt }],
        });

        const text = response.text;
        if (!text) {
          throw new Error('No text content in Gemini response');
        }

        return this.parseResponse(text);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a non-retryable error
        if (lastError.message.startsWith('Content blocked') ||
            lastError.message.startsWith('No candidates') ||
            lastError.message.startsWith('Gemini stopped') ||
            lastError.message.startsWith('No text content') ||
            lastError.message.startsWith('Failed to parse')) {
          throw lastError;
        }

        // Check if we should retry
        if (attempt < this.maxRetries && this.isRetryableError(error)) {
          const delayMs = this.retryDelayMs * Math.pow(2, attempt);
          const errorDetail = this.getErrorDetail(lastError);
          console.warn(
            `⚠️ Gemini API request failed (attempt ${attempt + 1}/${this.maxRetries + 1}): ${errorDetail}. Retrying in ${delayMs / 1000}s...`
          );
          await this.sleep(delayMs);
          continue;
        }

        // No more retries, throw the error
        throw new Error(`Gemini API error for ${videoUrl}: ${lastError.message}`);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error(`Gemini API error for ${videoUrl}: ${lastError?.message || 'Unknown error'}`);
  }

  private parseResponse(text: string): VideoSummary {
    try {
      const parsed = JSON.parse(text);

      // Transform sections to add computed seconds fields
      const sections: TimestampSection[] = (parsed.sections || []).map(
        (section: { timestamp: string; screenshotTimestamp: string; title: string; content: string }) => ({
          timestamp: section.timestamp,
          seconds: this.parseTimestamp(section.timestamp),
          screenshotTimestamp: section.screenshotTimestamp,
          screenshotSeconds: this.parseTimestamp(section.screenshotTimestamp),
          title: section.title,
          content: section.content,
        })
      );

      return {
        overview: parsed.overview || '',
        sections,
        keyPoints: parsed.keyPoints || [],
      };
    } catch (error) {
      // Dump response to temp file for debugging
      const debugDir = '/tmp/yt-summarize/debug';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugFile = join(debugDir, `gemini-response-${timestamp}.txt`);

      try {
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(debugFile, text, 'utf-8');
      } catch {
        // Ignore write errors
      }

      throw new Error(`Failed to parse Gemini response. Debug file: ${debugFile}`);
    }
  }

  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }
}
