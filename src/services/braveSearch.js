export async function braveSearch(query, { count = 10 } = {}) {
  const url =
    "https://api.search.brave.com/res/v1/web/search?" +
    new URLSearchParams({
      q: query,
      count: String(count),
      country: "IN",
      search_lang: "en",
    });

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search failed: ${response.status}`);
  }

  const data = await response.json();

  return (
    data.web?.results?.map((result) => ({
      title: result.title,
      url: result.url,
      description: result.description,
    })) || []
  );
}
