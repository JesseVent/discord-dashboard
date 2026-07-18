export default {
  async scheduled(event, env, ctx) {
    const url = env.TARGET_URL;
    if (!url || url.includes("your-vercel-domain")) {
      console.error("Missing or default TARGET_URL environment variable.");
      return;
    }
    
    if (!env.CRON_SECRET) {
      console.error("Missing CRON_SECRET. Please add it via `wrangler secret put CRON_SECRET`.");
      return;
    }

    try {
      const resp = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${env.CRON_SECRET}`
        }
      });
      const data = await resp.text();
      console.log(`Pinged sync endpoint. Status: ${resp.status}. Response: ${data}`);
    } catch (err) {
      console.error(`Failed to ping sync endpoint: ${err.message}`);
    }
  }
};
