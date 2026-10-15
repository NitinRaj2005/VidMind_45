import 'dotenv/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const checkpointer = PostgresSaver.fromConnString(process.env.DB_URL);
await checkpointer.setup(); 

export default checkpointer;