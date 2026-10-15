import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { hybridSearch } from '../embeddings.js';

export const findSimilarVideosTool = tool(
  async ({ query }) => {
    const results = await hybridSearch(query, 30, null);
    const seen = new Set();
    const videos = [];

    for (const r of results) {
      const vid = r.metadata?.video_id;
      if (vid && !seen.has(vid)) {
        seen.add(vid);
        videos.push({ video_id: vid, rrf_score: r.rrfScore.toFixed(4) });
      }
    }

    return JSON.stringify({ videos });
  },
  {
    name: 'find_similar_videos',
    description: 'Find YouTube video IDs whose transcripts are most semantically relevant to a query.',
    schema: z.object({
      query: z.string(),
    }),
  }
);