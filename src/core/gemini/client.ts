import { VertexAI, GenerativeModel } from '@google-cloud/vertexai';
import type { VideoSummary, TimestampSection } from '../../types/index.js';
import { createSummaryPrompt } from './prompts.js';

export interface GeminiClientConfig {
  projectId: string;
  location: string;
  model?: string;
}

export class GeminiClient {
  private model: GenerativeModel;

  constructor(config: GeminiClientConfig) {
    const vertexAI = new VertexAI({
      project: config.projectId,
      location: config.location,
    });

    this.model = vertexAI.getGenerativeModel({
      model: config.model || 'gemini-2.5-flash',
    });
  }

  async summarizeVideo(videoUrl: string, locale: string): Promise<VideoSummary> {
    const prompt = createSummaryPrompt(locale);

    const request = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: videoUrl,
                mimeType: 'video/mp4',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = await this.model.generateContent(request);
    const result = response.response;
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No response from Gemini');
    }

    return this.parseResponse(text);
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
      throw new Error(`Failed to parse Gemini response: ${error}`);
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
