const brightDataBaseUrl = 'https://api.brightdata.com/datasets/v3';
const datasetId = 'gd_lk56epmy2i5g7lzu0k';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const readError = async (response) => {
  const body = await response.text();
  return 'Bright Data API error (' + response.status + '): ' + body;
};

export const triggerYoutubeVideoScrape = async (url) => {
  const apiKey = process.env.BRIGHTDATA_API_KEY;

  if (!apiKey) {
    throw new Error('BRIGHTDATA_API_KEY is not configured');
  }

  // 1. Start an asynchronous YouTube scrape.
  const triggerResponse = await fetch(
    brightDataBaseUrl + '/trigger?dataset_id=' + datasetId + '&format=json&include_errors=true',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ url, country: '' }]),
    }
  );

  if (!triggerResponse.ok) {
    throw new Error(await readError(triggerResponse));
  }

  const triggerData = await triggerResponse.json();
  const snapshotId = triggerData.snapshot_id;

  if (!snapshotId) {
    throw new Error('Bright Data did not return a snapshot_id: ' + JSON.stringify(triggerData));
  }

  console.log('[brightdata] snapshot_id:', snapshotId);

  // 2. Poll the documented progress endpoint. Allow up to 5 minutes.
  for (let attempt = 1; attempt <= 60; attempt++) {
    await sleep(5000);

    const progressResponse = await fetch(
      brightDataBaseUrl + '/progress/' + encodeURIComponent(snapshotId),
      {
        headers: { Authorization: 'Bearer ' + apiKey },
      }
    );

    if (!progressResponse.ok) {
      throw new Error(await readError(progressResponse));
    }

    const progress = await progressResponse.json();
    console.log('[brightdata] status:', progress.status, '| attempt:', attempt);

    if (progress.status === 'failed') {
      throw new Error('Bright Data snapshot failed: ' + JSON.stringify(progress));
    }

    if (progress.status === 'ready') {
      // 3. Download the completed snapshot only after it is ready.
      const snapshotResponse = await fetch(
        brightDataBaseUrl + '/snapshot/' + encodeURIComponent(snapshotId) + '?format=json',
        {
          headers: { Authorization: 'Bearer ' + apiKey },
        }
      );

      if (!snapshotResponse.ok) {
        throw new Error(await readError(snapshotResponse));
      }

      const result = await snapshotResponse.json();
      console.log('[brightdata] snapshot downloaded; records:', Array.isArray(result) ? result.length : 'non-array response');
      return result;
    }

    if (!['starting', 'running', 'building', 'collecting'].includes(progress.status)) {
      throw new Error('Unexpected Bright Data snapshot status: ' + JSON.stringify(progress));
    }
  }

  throw new Error('Bright Data snapshot timed out after 5 minutes: ' + snapshotId);
};
