import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getTranscript } from 'get-yt-transcript';
import { triggerYoutubeVideoScrape } from '../brightdata.js';
import { addYTVideoToVectorStore } from '../embeddings.js';

export const triggerScrapeTool = tool(
  async ({ url, force_timestamp_refresh = false }) => {
    console.log('[agent] triggering scrape for', url);
    const result = await triggerYoutubeVideoScrape(url);
    if (!result || result.length === 0) return JSON.stringify({ error: 'Scrape failed or timed out' });
    const videos = result.filter(v => typeof v.transcript === 'string' && v.transcript.trim());
    console.log('[scrape] total videos:', result.length, '| with transcript:', videos.length);
    const summaries = await Promise.all(videos.map(async (video) => {
      const videoUrl = video.input?.url || video.url || url;
      const videoId = video.id || video.video_id || new URL(videoUrl).searchParams.get('v');
      let segments = Array.isArray(video.segments) ? video.segments
        : Array.isArray(video.transcript_segments) ? video.transcript_segments
        : Array.isArray(video.transcript) ? video.transcript : [];
      if (!segments.length && videoId) {
        try {
          const timedTranscript = await getTranscript(videoId);
          if (timedTranscript.available && timedTranscript.segments?.length) {
            segments = timedTranscript.segments;
            console.log('[scrape] timestamped captions found:', videoId, segments.length);
          } else console.warn('[scrape] captions have no timestamp segments:', videoId);
        } catch (error) {
          console.warn('[scrape] timestamp extraction unavailable; indexing plain transcript:', error.message);
        }
      }
      const indexed = await addYTVideoToVectorStore({ transcript: video.transcript, segments, video_id: videoId, url: videoUrl, force: force_timestamp_refresh });
      return { video_id: videoId, title: video.title, ...indexed };
    }));
    return JSON.stringify({ success: true, message: 'Video processed. Timestamp links are available when caption segments were retrieved.', videos: summaries });
  },
  {
    name: 'trigger_youtube_scrape',
    description: 'Scrape and index a YouTube video. Use force_timestamp_refresh=true only when the video is already indexed without timestamps and the user specifically asks for timestamp citations. Existing chunks are replaced only after timestamped captions and embeddings are obtained.',
    schema: z.object({
      url: z.string().describe('Full YouTube URL'),
      force_timestamp_refresh: z.boolean().optional().default(false).describe('Refresh an existing index with timestamped captions when explicitly needed'),
    }),
  }
);