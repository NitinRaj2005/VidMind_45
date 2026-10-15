import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { isVideoIndexed } from '../embeddings.js';

export const checkVideoIndexedTool = tool(
  async ({ video_id }) => {
    const indexed = await isVideoIndexed(video_id);
    return JSON.stringify({ video_id, indexed });
  },
  {
    name: 'check_video_indexed',
    description: 'Check if a YouTube video is already indexed in the knowledge base before triggering a scrape.',
    schema: z.object({
      video_id: z.string().describe('The YouTube video ID (not full URL)'),
    }),
  }
);