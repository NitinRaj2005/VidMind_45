import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

const texts = [
  "Hello world",
  "This is a test sentence", 
  "Batch embedding is faster",
];

const response = await ai.models.embedContent({
  model: "gemini-embedding-001",
  contents: texts,  // pass array directly
});

console.log("Total embeddings:", response.embeddings.length);
console.log("Dimension:", response.embeddings[0].values.length);
console.log("First 10 values:", response.embeddings[0].values.slice(0, 10));