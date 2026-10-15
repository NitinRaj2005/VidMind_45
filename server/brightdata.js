const brightDataTriggerUrl = 'https://api.brightdata.com/datasets/v3/trigger';
const brightDataSnapshotUrl = 'https://api.brightdata.com/datasets/v3/snapshot';

export const triggerYoutubeVideoScrape = async (url) => {
  const data = JSON.stringify([{ url, country: '' }]);

  // 1. Trigger scrape (no webhook endpoint)
  const response = await fetch(
    `${brightDataTriggerUrl}?dataset_id=gd_lk56epmy2i5g7lzu0k&format=json&include_errors=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: data,
    }
  );
  const { snapshot_id } = await response.json();
  console.log('[brightdata] snapshot_id:', snapshot_id);

  // 2. Poll until ready (max 20 attempts x 5s = 100s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const snap = await fetch(
      `${brightDataSnapshotUrl}/${snapshot_id}?format=json`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
        },
      }
    );

    if (snap.status === 200) {
      const result = await snap.json();
      console.log('[brightdata] snapshot ready, videos:', result.length);
      return result;
    }

    console.log(`[brightdata] waiting... attempt ${i + 1}`);
  }

  console.log('[brightdata] timed out');
  return null;
};