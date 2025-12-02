export function createSummaryPrompt(locale: string): string {
  const localeInstructions: Record<string, string> = {
    ko: '한국어로 응답해주세요.',
    en: 'Please respond in English.',
    ja: '日本語で回答してください。',
    zh: '请用中文回答。',
  };

  const langInstruction = localeInstructions[locale] || localeInstructions.en;

  return `
You are a video content analyzer. Analyze the provided YouTube video and create a structured summary.

${langInstruction}

Please provide your response in the following JSON format:
{
  "overview": "A 2-3 sentence overview of the entire video content",
  "sections": [
    {
      "timestamp": "MM:SS or HH:MM:SS format",
      "title": "Section title",
      "content": "Detailed explanation of what happens at this timestamp (2-3 sentences)"
    }
  ],
  "keyPoints": [
    "Key point 1",
    "Key point 2",
    "Key point 3"
  ]
}

Guidelines:
1. Identify 5-10 key timestamps where important content changes or key points are made
2. For each section, note the exact timestamp and provide a meaningful title
3. The content should explain what is being discussed or demonstrated at that timestamp
4. Key points should be actionable takeaways from the video
5. Be specific and detailed, not generic

IMPORTANT: Return ONLY valid JSON, no markdown code blocks or additional text.
`;
}
