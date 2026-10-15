import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DB_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

setInterval(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('[pool] keepalive ping');
  } catch (e) {
    console.error('[pool] keepalive failed:', e.message);
  }
}, 4 * 60 * 1000);

pool.on('error', (err) => {
  console.error('[pool] idle client error:', err.message);
});

// ── Embeddings model (gemini-embedding-001, 3072 dims) ────────────────────────
const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export const embedTexts = async (texts) => {
  const response = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: texts,
    config: { outputDimensionality: 768 },
  });
  return response.embeddings.map(e => e.values);
};

// ── Hybrid search via Postgres hybrid_search() function ───────────────────────
export const hybridSearch = async (queryText, topK = 5, videoIdFilter = null) => {
  const [queryVector] = await embedTexts([queryText]);
  const vectorLiteral = `[${queryVector.join(',')}]`;

  const { rows } = await pool.query(
    `SELECT
       id,
       content,
       metadata,
       rrf_score,
       vec_rank,
       bm25_rank
     FROM hybrid_search($1, $2::vector, $3, $4, 60, 0.7, 0.3)`,
    [queryText, vectorLiteral, topK, videoIdFilter]
  );

  return rows.map((r) => ({
    content:  r.content,
    metadata: r.metadata,
    rrfScore: parseFloat(r.rrf_score),
    vecRank:  r.vec_rank,
    bm25Rank: r.bm25_rank,
  }));
};

export const isVideoIndexed = async (videoId) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM transcripts WHERE metadata->>'video_id' = $1 LIMIT 1`,
    [videoId]
  );
  return rows.length > 0;
};

// ── Ingest a YouTube video into the vector store ──────────────────────────────
export const addYTVideoToVectorStore = async (videoData) => {
  const { transcript, video_id, url } = videoData;

  if (await isVideoIndexed(video_id)) {
    console.log(`[embeddings] video ${video_id} already indexed — skipping`);
    return { skipped: true, video_id };
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const doc = new Document({
    pageContent: transcript,
    metadata: { video_id, url: url ?? '' },
  });

  const chunks = await splitter.splitDocuments([doc]);

  // Embed all chunks and insert into pgvector manually
  const texts = chunks.map(c => c.pageContent);
  const vectors = await embedTexts(texts);
console.log('[embeddings] got vectors:', vectors.length, 'first dim:', vectors[0]?.length);

  for (let i = 0; i < chunks.length; i++) {
    const vectorLiteral = `[${vectors[i].join(',')}]`;
    await pool.query(
      `INSERT INTO transcripts (content, metadata, vector)
       VALUES ($1, $2, $3)`,
      [chunks[i].pageContent, JSON.stringify(chunks[i].metadata), vectorLiteral]
    );
  }

  console.log(`[embeddings] indexed ${chunks.length} chunks for video ${video_id}`);
  return { skipped: false, video_id, chunks: chunks.length };
};