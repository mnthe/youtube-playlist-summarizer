import { GoogleGenAI } from '@google/genai';
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
          console.warn(
            `⚠️ Gemini API request failed (attempt ${attempt + 1}/${this.maxRetries + 1}): ${lastError.message}. Retrying in ${delayMs / 1000}s...`
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
    // Clean up the response - remove markdown code blocks if present
    let cleanText = text.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.slice(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.slice(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.slice(0, -3);
    }
    cleanText = cleanText.trim();

    // Check for HTML response (indicates API error)
    if (cleanText.startsWith('<!DOCTYPE') || cleanText.startsWith('<html')) {
      throw new Error('Received HTML instead of JSON - possible API authentication or permission error');
    }

    try {
      const parsed = JSON.parse(cleanText);

      // Validate and transform sections
      const sections: TimestampSection[] = (parsed.sections || []).map(
        (section: { timestamp: string; screenshotTimestamp?: string; title: string; content: string }) => {
          // screenshotTimestamp가 없으면 timestamp 사용 (fallback)
          const screenshotTs = section.screenshotTimestamp || section.timestamp;
          return {
            timestamp: section.timestamp,
            seconds: this.parseTimestamp(section.timestamp),
            screenshotTimestamp: screenshotTs,
            screenshotSeconds: this.parseTimestamp(screenshotTs),
            title: section.title,
            content: section.content,
          };
        }
      );

      return {
        overview: parsed.overview || '',
        sections,
        keyPoints: parsed.keyPoints || [],
      };
    } catch (error) {
      // Show first 200 chars of response for debugging
      const preview = cleanText.slice(0, 200);
      throw new Error(`Failed to parse Gemini response. Preview: "${preview}..."`);
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
