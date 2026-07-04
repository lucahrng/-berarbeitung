export async function runApifyActor(actorId: string, input: Record<string, unknown>) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN fehlt");

  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Apify Actor Fehler (${actorId}): ${res.status} ${await res.text()}`);
  }
  return res.json();
}
