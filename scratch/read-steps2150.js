const fs = require('fs');
const readline = require('readline');

async function main() {
  const fileStream = fs.createReadStream('C:/Users/Asus/.gemini/antigravity/brain/d3450027-e159-4567-bae8-2842933747ec/.system_generated/logs/transcript.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const obj = JSON.parse(line);
    if (obj.step_index >= 2181 && obj.step_index <= 2230 && obj.tool_calls) {
      for (const tc of obj.tool_calls) {
        if (tc.name === 'edit_file' || tc.name === 'write_file') {
          console.log(`STEP ${obj.step_index}:`, tc.name, tc.args.Path);
        }
      }
    }
  }
}
main();
