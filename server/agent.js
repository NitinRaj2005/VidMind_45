import { ChatGroq } from "@langchain/groq";
import { createReactAgent } from '@langchain/langgraph/prebuilt';

import checkpointer from './checkpointer.js';
import {
  retrieveTool,
  findSimilarVideosTool,
  checkVideoIndexedTool,
  triggerScrapeTool,
  kbStatsTool,
} from './tools/tools.js';

const SYSTEM_PROMPT = `You are VidMind, an intelligent YouTube knowledge assistant.

## Your capabilities
- Answer questions about any indexed YouTube video using **hybrid search** (semantic + keyword).
- Discover relevant videos from the knowledge base.
- Trigger indexing of new YouTube videos on demand.

## How to answer
1. Always use \`hybrid_retrieve\` to ground your answer in actual transcript content.
2. After retrieving, synthesize a clear answer and cite the source video ID(s).
3. If multiple chunks support your answer, mention the top 2-3 most relevant ones.
4. Include a **Confidence** indicator at the end of your response:
   - 🟢 High — multiple high-RRF-score chunks align with the question
   - 🟡 Medium — partial or low-scoring matches
   - 🔴 Low — no strong matches; answer may be incomplete

## Rules
- Never fabricate transcript content. If you don't find it, say so.
- If a video is not indexed, offer to scrape it (but check first).
- Keep answers concise and structured.`;

const llm = new ChatGroq({
  model: "qwen/qwen3.6-27b",
  apiKey: process.env.GROQ_API_KEY,
  temperature: 0.2,
});

export const agent = createReactAgent({
  llm,
  tools: [
    retrieveTool,
    findSimilarVideosTool,
    checkVideoIndexedTool,
    triggerScrapeTool,
    kbStatsTool,
  ],
  checkpointer,
  prompt: SYSTEM_PROMPT,
});