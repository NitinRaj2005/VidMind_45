import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { hybridSearch } from '../embeddings.js';

export const retrieveTool = tool(
  async ({ query, video_id, top_k }) => {
    // Keep tool context small enough for Groq's on-demand TPM limit.
    const limit = Math.min(Math.max(Number(top_k) || 3, 1), 3);
    const results = await hybridSearch(query, limit, video_id ?? null);
    if (results.length === 0) return JSON.stringify({ chunks: [], message: 'No relevant content found.' });
    const chunks = results.map((r, i) => {
      const start = r.metadata?.start_seconds;
      const url = r.metadata?.url;
      return {
        rank: i + 1,
        content: String(r.content ?? '').slice(0, 700),
        video_id: r.metadata?.video_id,
        timestamp_url: Number.isFinite(Number(start)) && url
          ? url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Number(start)) + 's'
          : null,
      };
    });
    return JSON.stringify({ chunks });
  },
  {
    name: 'hybrid_retrieve',
    description: 'Search transcript chunks using hybrid semantic and keyword search. Return up to 3 concise chunks. Use exact timestamp_url links when provided. Pass video_id when known.',
    schema: z.object({
      query: z.string().describe('Search query'),
      top_k: z.number().int().min(1).max(3).default(3).describe('Maximum number of chunks (up to 3)'),
      video_id: z.string().optional().describe('Optional YouTube video ID filter'),
    }),
  }
);