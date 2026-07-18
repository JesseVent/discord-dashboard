import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync('./.env', 'utf8');
const supabaseUrl = envText.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim();
const supabaseKey = envText.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)[1].trim();
const supabaseSchema = envText.match(/^SUPABASE_SCHEMA=(.*)$/m)?.[1]?.trim() || 'discord';

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: supabaseSchema },
  auth: { persistSession: false },
});

async function main() {
  console.log("Checking DB connection and table sizes...");
  
  const { count: issueCount, error: err1 } = await supabase
    .from('issues')
    .select('id', { count: 'exact', head: true });
  
  if (err1) {
    console.error("Error fetching issues count:", err1);
    return;
  }
  
  const { count: replyCount, error: err2 } = await supabase
    .from('replies')
    .select('id', { count: 'exact', head: true });
  
  if (err2) {
    console.error("Error fetching replies count:", err2);
    return;
  }

  const { count: answeredCount, error: err3 } = await supabase
    .from('issues')
    .select('id', { count: 'exact', head: true })
    .eq('is_answered', true);
  
  console.log(`Total issues: ${issueCount}`);
  console.log(`Total replies: ${replyCount}`);
  console.log(`Issues marked as answered (is_answered=true): ${answeredCount}`);
}

main().catch(console.error);
