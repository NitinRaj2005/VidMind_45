import { ChatGroq } from "@langchain/groq";
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import checkpointer from './checkpointer.js';
import { retrieveTool, findSimilarVideosTool, checkVideoIndexedTool, triggerScrapeTool, kbStatsTool } from './tools/tools.js';

const SYSTEM_PROMPT = `You are VidMind, a YouTube transcript RAG assistant.
Always ground video answers in hybrid_retrieve. Use only retrieved transcript evidence; never invent facts or timestamps.
When a retrieved chunk has timestamp_url, cite the related point with that exact clickable URL. Never estimate timestamps.
If the user requests timestamps but chunks lack timestamp_url, check whether the video is indexed. If already indexed, call trigger_youtube_scrape with force_timestamp_refresh=true, then retrieve again. If real caption timestamps remain unavailable, say so.
Write concise, clear Markdown with headings and bullets when useful. Avoid tables.
End with confidence: High, Medium, or Low, based on retrieved evidence.
If a video is not indexed, check first and offer or trigger scraping as appropriate.`;

const llm = new ChatGroq({
  model: "openai/gpt-oss-120b",
  apiKey: process.env.GROQ_API_KEY,
  temperature: 0.2,
});

export const agent = createReactAgent({
  llm,
  tools: [retrieveTool, findSimilarVideosTool, checkVideoIndexedTool, triggerScrapeTool, kbStatsTool],
  checkpointer,
  prompt: SYSTEM_PROMPT,
});