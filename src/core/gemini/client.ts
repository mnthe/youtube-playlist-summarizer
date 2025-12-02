import { GoogleGenAI } from '@google/genai';
import type { VideoSummary, TimestampSection } from '../../types/index.js';
import { createSystemPrompt, createUserPrompt } from './prompts.js';

export interface GeminiClientConfig {
  projectId: string;
  location: string;
  model?: string;
}

export class GeminiClient {
  private client: GoogleGenAI;
  private modelName: string;

  constructor(config: GeminiClientConfig) {
    this.client = new GoogleGenAI({
      vertexai: true,
      project: config.projectId,
      location: config.location,
    });
    this.modelName = config.model || 'gemini-2.5-flash';
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
      if (error instanceof Error) {
        // Re-throw our custom errors
        if (error.message.startsWith('Content blocked') ||
            error.message.startsWith('No candidates') ||
            error.message.startsWith('Gemini stopped') ||
            error.message.startsWith('No text content') ||
            error.message.startsWith('Failed to parse')) {
          throw error;
        }
        // Wrap other errors with more context
        throw new Error(`Gemini API error for ${videoUrl}: ${error.message}`);
      }
      throw new Error(`Gemini API error for ${videoUrl}: ${String(error)}`);
    }
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
        (section: { timestamp: string; title: string; content: string }) => ({
          timestamp: section.timestamp,
          seconds: this.parseTimestamp(section.timestamp),
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
