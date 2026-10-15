import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { pool } from '../embeddings.js';

export const kbStatsTool = tool(
  async () => {
    const { rows } = await pool.query(
      `SELECT
         COUNT(DISTINCT metadata->>'video_id') AS total_videos,
         COUNT(*)                              AS total_chunks,
         MIN(created_at)                       AS oldest_entry,
         MAX(created_at)                       AS newest_entry
       FROM transcripts`
    );
    return JSON.stringify(rows[0]);
  },
  {
    name: 'knowledge_base_stats',
    description: 'Return statistics about the indexed knowledge base: total videos, total chunks, date range.',
    schema: z.object({}),
  }
);