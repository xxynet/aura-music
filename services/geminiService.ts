import { GoogleGenAI } from "@google/genai";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
};

export const analyzeLyrics = async (title: string, artist: string, lyrics: string) => {
  try {
    const ai = getClient();
    
    const prompt = `
      Analyze the song "${title}" by "${artist}".
      Based on the following lyrics, provide a short, poetic "Vibe Check" (max 50 words) describing the emotional atmosphere,
      and then 3 bullet points explaining the deeper meaning.
      Return the response as JSON with keys: "vibe", "meanings" (array of strings).
      
      Lyrics snippet:
      ${lyrics.slice(0, 1000)}...
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return null;
  }
};