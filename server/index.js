import express from 'express';
import cors from 'cors';
import { agent } from './agent.js';
import { addYTVideoToVectorStore, pool } from './embeddings.js';

const port = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '200mb' }));
app.use(cors());

app.get('/', (req, res) => res.json({ status: 'ok', service: 'VidMind API' }));

// ── Chat / RAG endpoint ───────────────────────────────────────────────────────
/**
 * POST /generate
 * Body: { query: string, thread_id: string|number }
 * Returns: { answer: string, thread_id: string }
 */
app.post('/generate', async (req, res) => {
  const { query, thread_id } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: 'query is required' });
  }

  const threadId = String(thread_id ?? Date.now());

  try {
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: query }] },
      { configurable: { thread_id: threadId } }
    );

    const answer = result.messages.at(-1)?.content ?? '';
    res.json({ answer: answer || 'The video is being indexed. Please ask your question again in a few seconds.', thread_id: threadId });
  } catch (err) {
    console.error('[/generate]', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ── BrightData webhook — receives scraped transcript ──────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const videos = req.body.filter(video => video.transcript?.trim());  // ← skip empty

    const results = await Promise.allSettled(
      req.body.map((video) => addYTVideoToVectorStore(video))
    );

    const summary = results.map((r, i) =>
      r.status === 'fulfilled'
        ? { index: i, ...r.value }
        : { index: i, error: r.reason?.message }
    );

    res.json({ ok: true, summary });
  } catch (err) {
    console.error('[/webhook]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Knowledge base stats ──────────────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(DISTINCT metadata->>'video_id') AS total_videos,
        COUNT(*)                              AS total_chunks,
        MIN(created_at)                       AS oldest_entry,
        MAX(created_at)                       AS newest_entry
      FROM transcripts
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List indexed videos ───────────────────────────────────────────────────────
app.get('/videos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        video_id,
        chunk_count,
        added_at,
        url,
        title,
        metadata
      FROM videos
      ORDER BY added_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/threads', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM thread_activity LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`[VidMind] Server running on port ${port}`);
});