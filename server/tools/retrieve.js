import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { hybridSearch } from '../embeddings.js';

export const retrieveTool = tool(
  async ({ query, video_id, top_k }) => {
    const results = await hybridSearch(query, top_k ?? 5, video_id ?? null);

    if (results.length === 0) {
      return JSON.stringify({ chunks: [], message: 'No relevant content found.' });
    }

    const chunks = results.map((r, i) => ({
      rank:      i + 1,
      content:   r.content,
      video_id:  r.metadata?.video_id,
      rrf_score: r.rrfScore.toFixed(4),
      start_seconds: r.metadata?.start_seconds ?? null,
      end_seconds: r.metadata?.end_seconds ?? null,
      source_url: r.metadata?.url ?? null,
      timestamp_url: Number.isFinite(Number(r.metadata?.start_seconds)) && r.metadata?.url
        ? r.metadata.url + (r.metadata.url.includes('?') ? '&' : '?') + 't=' + Math.floor(Number(r.metadata.start_seconds)) + 's'
        : null,
      vec_rank:  r.vecRank  ?? 'N/A',
      bm25_rank: r.bm25Rank ?? 'N/A',
    }));

    return JSON.stringify({ chunks });
  },
  {
    name: 'hybrid_retrieve',
    description: `
      Retrieve the most relevant transcript chunks for a query using Hybrid Search
      (BM25 full-text + cosine vector similarity, fused with Reciprocal Rank Fusion).
      Always prefer this over any other retrieval method. When timestamps are present, return start_seconds, end_seconds, and timestamp_url exactly as provided.
      If video_id is known, pass it to scope the search to that video.
    `,
schema: z.object({
  query: z.coerce.string().describe('Search query text'),
  top_k: z.coerce.number().int().default(5).describe('Number of results'),
  video_id: z.string().optional().describe('Filter by video ID'),
}),  }
);