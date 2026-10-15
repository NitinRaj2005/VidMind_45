import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { triggerYoutubeVideoScrape } from '../brightdata.js';
import { addYTVideoToVectorStore } from '../embeddings.js';

export const triggerScrapeTool = tool(
  async ({ url }) => {
    console.log('[agent] triggering scrape for', url);
    const result = await triggerYoutubeVideoScrape(url);

    if (!result || result.length === 0) {
      return JSON.stringify({ error: 'Scrape failed or timed out' });
    }

    const videos = result.filter(v => v.transcript?.trim());
     console.log('[scrape] total videos:', result.length, '| with transcript:', videos.length);
    console.log('[scrape] transcript preview:', result[0]?.transcript?.slice(0, 100));
    await Promise.allSettled(
      videos.map(video => addYTVideoToVectorStore({
        transcript: video.transcript,
        video_id: video.id || video.video_id,
        url: video.input?.url || video.url,
      }))
    );

    return JSON.stringify({
      success: true,
      message: 'Video indexed successfully. You can now answer questions about it.',
      title: result[0]?.title,
    });
  },
  {
    name: 'trigger_youtube_scrape',
    description: `Trigger scraping of a YouTube video by URL and index it. Always call check_video_indexed first to avoid re-scraping.`,
    schema: z.object({
      url: z.string().describe('Full YouTube URL'),
    }),
  }
);