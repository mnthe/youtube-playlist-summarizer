import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YouTubeClient } from '../../../src/core/youtube/client.js';

describe('YouTubeClient', () => {
  describe('parsePlaylistId', () => {
    it('should extract playlist ID from full URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      expect(client.parsePlaylistId(url)).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('should extract playlist ID from short URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://youtube.com/playlist?list=PLtest123';
      expect(client.parsePlaylistId(url)).toBe('PLtest123');
    });

    it('should throw error for invalid URL', () => {
      const client = new YouTubeClient('fake-api-key');
      expect(() => client.parsePlaylistId('invalid-url')).toThrow('Invalid playlist URL');
    });
  });

  describe('parseVideoId', () => {
    it('should extract video ID from watch URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(client.parseVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from short URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      expect(client.parseVideoId(url)).toBe('dQw4w9WgXcQ');
    });
  });

  describe('parseDuration', () => {
    it('should parse ISO 8601 duration to seconds', () => {
      const client = new YouTubeClient('fake-api-key');
      expect(client.parseDuration('PT15M30S')).toBe(930);
      expect(client.parseDuration('PT1H30M')).toBe(5400);
      expect(client.parseDuration('PT45S')).toBe(45);
    });
  });
});
