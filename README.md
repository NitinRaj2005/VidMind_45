# VidMind

A production-grade YouTube RAG (Retrieval-Augmented Generation) system that lets you ask questions about any YouTube video using hybrid search.

## 🚀 Live Demo

[https://vid-mind-seven.vercel.app/](https://vid-mind-seven.vercel.app/)

> Note: the backend runs on Render's free tier, which spins down after 15 minutes of inactivity. The first request after idle may take 30-50s to respond while it wakes up.

## 🎥 Project Demo

[▶ Watch Demo Video](https://drive.google.com/file/d/1I4jxmepFoZvp2ZlaI6AQn8hK5ekBkF8-/view?usp=sharing)

## Tech Stack

**Backend**
- Node.js + Express
- LangChain + LangGraph (ReAct agent)
- PostgreSQL + pgvector
- Google `gemini-embedding-001` (768-dim)
- Groq `qwen/qwen3-32b`
- BrightData (YouTube transcript scraping)

**Frontend**
- React 19 + TypeScript + Vite
- Minimal markdown renderer (no external dep)

---

## Architecture

### Hybrid Search (BM25 + Vector + RRF)

Pure vector search misses exact keyword matches. Pure BM25 misses semantic meaning. VidMind combines both using **Reciprocal Rank Fusion**:

```
Query
  ├── BM25 leg    → ts_rank_cd(fts_vector, plainto_tsquery(...))   ranked list A
  └── Vector leg  → vector <=> query_embedding (HNSW cosine)       ranked list B
            ↓
   RRF score = Σ weight_i / (k + rank_i)   [k=60, vec=0.7, bm25=0.3]
            ↓
        Top-K results with provenance metadata
```

### HNSW Indexing

```sql
CREATE INDEX transcripts_vector_hnsw_idx
  ON transcripts USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

Chosen over IVFFlat because:
- Supports incremental inserts without index rebuild
- `O(log n)` query time vs `O(√n)` for IVFFlat
- ~99% recall@10 vs ~95% for IVFFlat
- No need to pre-specify cluster count

### Persistent Conversation Threads (PostgresSaver)

```js
const checkpointer = PostgresSaver.fromConnString(process.env.DB_URL);
```

Every LangGraph agent invocation is checkpointed to Postgres. Threads are identified by `thread_id` and persisted across sessions.

### Complete Flow

```
User Query
    │
    ▼
POST /generate → agent.invoke()
    │
    ▼
PostgresSaver loads thread history
    │
    ▼
ReAct Loop
    │
    ├─── Turn 1: check_video_indexed
    │         │
    │         ├── indexed: true
    │         │       │
    │         │       ▼
    │         │   Turn 2: hybrid_retrieve
    │         │       │
    │         │       ▼
    │         │   Turn 3: synthesize answer → END
    │         │
    │         └── indexed: false
    │                 │
    │                 ▼
    │             Turn 2: trigger_youtube_scrape
    │                 │
    │                 ▼
    │             Return "scrape triggered, wait ~10s"→ END
    │                 │
    │          [async — BrightData]
    │                 │
    │                 ▼
    │             POST /webhook
    │                 │
    │                 ▼
    │             chunk → embed → INSERT transcripts
    │                 │
    │                 ▼
    │             trigger fires → upsert videos table
    │                 │
    │          [user sends query again]
    │                 │
    │                 ▼
    │             Turn 1: hybrid_retrieve
    │                 │
    │                 ▼
    │             Turn 2: synthesize answer → END
    │
    ▼
PostgresSaver saves checkpoint
    │
    ▼
res.json({ answer, thread_id })
```

## Database Schema

### `transcripts` table
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `content` | TEXT | Raw transcript chunk |
| `metadata` | JSONB | `{ video_id, url }` |
| `vector` | vector(768) | Gemini `gemini-embedding-001` |
| `fts_vector` | tsvector | Generated column — auto-synced with content |
| `created_at` | TIMESTAMPTZ | |

### Indexes
| Index | Type | Purpose |
|---|---|---|
| `transcripts_vector_hnsw_idx` | HNSW | ANN cosine similarity search |
| `transcripts_fts_gin_idx` | GIN | BM25 full-text search |
| `transcripts_video_id_idx` | B-tree | Filter pushdown by video_id |

### Key DB objects
- **`hybrid_search()`** — SQL function implementing BM25 + vector RRF fusion
- **`sync_video_chunk_count`** — trigger keeping `videos.chunk_count` accurate
- **`video_retrieval_stats`** — analytical view for per-video indexing stats
- **`thread_activity`** — view over checkpointer tables for session analytics

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/generate` | Chat with the agent |
| `POST` | `/webhook` | BrightData callback — receives scraped transcript |
| `GET` | `/stats` | Knowledge base stats (videos, chunks) |
| `GET` | `/videos` | List all indexed videos |
| `GET` | `/threads` | List recent conversation threads |

### POST `/generate`
```json
// Request
{ "query": "What did the speaker say about transformers?", "thread_id": "1234" }

// Response
{ "answer": "...", "thread_id": "1234" }
```

---

## Agent Tools

| Tool | Description |
|---|---|
| `hybrid_retrieve` | Retrieves top-K chunks using BM25 + cosine RRF |
| `find_similar_videos` | Finds video IDs semantically relevant to a query |
| `check_video_indexed` | Checks if a video is already in the knowledge base |
| `trigger_youtube_scrape` | Kicks off a BrightData scrape job for a YouTube URL |
| `knowledge_base_stats` | Returns total videos, chunks, and date range |

---

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL with `pgvector` extension
- Groq API key
- Google AI (Gemini) API key
- BrightData account (for scraping)

### 1. Clone and install

```bash
# Server
cd server && npm install

# Client
cd client && npm install
```

### 2. Environment variables

Create `server/.env`:

```env
DB_URL=postgresql://user:password@host:5432/vidmind
GROQ_API_KEY=gsk_...
GOOGLE_API_KEY=AIza...
BRIGHTDATA_API_KEY=...
PORT=3000
```

Create `client/.env`:
```env
VITE_API_URL=http://localhost:3000
```

### 3. Run database migration

```bash
cd server
psql $DB_URL -f schema.sql
```

### 4. Start

```bash
# Server
cd server && node index.js

# Client (separate terminal)
cd client && npm run dev
```

---

## How It Works

1. **Indexing** — paste a YouTube URL into the chat. The agent calls `check_video_indexed`, then `trigger_youtube_scrape` if needed. BrightData fetches the transcript and POSTs it to `/webhook`. The webhook chunks the transcript, embeds it with Gemini's `gemini-embedding-001`, and stores vectors + raw text in Postgres.

2. **Retrieval** — on every query, `hybrid_retrieve` embeds the query, runs two parallel Postgres queries (HNSW cosine + GIN full-text), and fuses their ranked results using RRF inside a single SQL function call.

3. **Generation** — the ReAct agent receives the retrieved chunks with provenance metadata (RRF score, vector rank, BM25 rank) and synthesizes a grounded answer with a confidence indicator (🟢/🟡/🔴).

4. **Memory** — every conversation turn is checkpointed to Postgres via `PostgresSaver`, so threads persist across server restarts.
