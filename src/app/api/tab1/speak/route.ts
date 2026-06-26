const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — clear and calm

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) return Response.json({ error: "No text provided" }, { status: 400 });

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[/api/tab1/speak]", err);
      return Response.json({ error: err }, { status: res.status });
    }

    const audio = await res.arrayBuffer();
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab1/speak]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
