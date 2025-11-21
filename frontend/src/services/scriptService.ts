import axios from 'axios';
import type { ScriptSearchResult } from '../types/script';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Search for movie scripts by title
 */
export async function searchScripts(query: string): Promise<ScriptSearchResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  console.log('[API REQUEST] /movies/scripts/search?query=', query);

  try {
    const response = await axios.get<ScriptSearchResult[]>(
      `${API_BASE_URL}/movies/scripts/search`,
      {
        params: { query }
      }
    );

    console.log('[API RESPONSE - SEARCH]', response.data);
    return response.data;
  } catch (error) {
    console.error('[API ERROR - SEARCH]', error);
    throw error;
  }
}

/**
 * Fetch script content from URL
 * NOTE: In production, you'd need to either:
 * 1. Scrape the script from the STANDS4 link
 * 2. Use a different API that provides full script content
 * 3. Store scripts in your database
 *
 * For now, this returns mock script data for demonstration
 */
export async function fetchScriptContent(scriptUrl: string): Promise<string> {
  console.log('[API REQUEST] Fetching script from URL:', scriptUrl);

  // Mock script content for demonstration
  // In production, you would fetch from scriptUrl or have a backend endpoint

  const mockScripts: Record<string, string> = {
    'Interstellar': `
      Cooper: We used to look up at the sky and wonder at our place in the stars.
      Now we just look down and worry about our place in the dirt.

      Murph: Dad, why did you and mom name me after something that's bad?
      Cooper: We didn't name you after something bad. We named you after something that's good.
      Murphy's law doesn't mean that something bad will happen. It means that whatever can happen, will happen.

      Professor Brand: We must reach far beyond our own lifespans. We must think not as individuals but as a species.
      We must confront the reality of interstellar travel.

      Cooper: Mankind was born on Earth. It was never meant to die here.

      Dr. Mann: This is not about saving my life, it's about saving the human race.

      Cooper: Love is the one thing we're capable of perceiving that transcends dimensions of time and space.
      Maybe we should trust that, even if we can't understand it yet.

      Murph: Because my dad promised me. He said he was going to come back.

      TARS: Everybody good? Plenty of slaves for my robot colony?

      Cooper: We've always defined ourselves by the ability to overcome the impossible.
      And we count these moments. These moments when we dare to aim higher, to break barriers,
      to reach for the stars, to make the unknown known. We count these moments as our proudest achievements.

      Professor Brand: Do not go gentle into that good night. Old age should burn and rave at close of day.
      Rage, rage against the dying of the light.

      Cooper: After you kids came along, your mom said something to me. She said that now we're just here to be memories for our kids.
      I think now I understand what she meant. Once you're a parent, you're the ghost of your children's future.

      TARS: That's relativity, folks.

      Romilly: I've waited years for you.

      Dr. Brand: I'm not afraid of death. I'm an old physicist. I'm afraid of time.

      Cooper: Today is my birthday. And it's a special one because you told me... you once told me when you come back,
      we might be the same age. Well, now I'm the same age that you were when you left.
      And it'd be really great if you came back soon.
    `.repeat(10), // Repeat to have enough content for analysis
  };

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  // Extract title from URL (simplified)
  const title = scriptUrl.includes('301') ? 'Interstellar' : 'Unknown';

  const scriptText = mockScripts[title] || mockScripts['Interstellar'];

  console.log('[API RESPONSE - SCRIPT CONTENT]', scriptText.slice(0, 200));

  return scriptText;
}
