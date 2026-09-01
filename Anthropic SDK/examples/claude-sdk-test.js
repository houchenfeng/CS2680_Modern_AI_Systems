import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const requiredVariables = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

try {
  const message = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL,
    max_tokens: 128,
    messages: [{ role: 'user', content: '你是谁？请用一句中文回答。' }],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  console.log(`Model: ${message.model}`);
  console.log(`Response: ${text}`);
} catch (error) {
  console.error(`Claude SDK request failed: ${error.status ?? 'unknown status'} ${error.message}`);
  process.exitCode = 1;
}
